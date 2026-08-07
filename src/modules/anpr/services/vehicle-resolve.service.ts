import { Injectable, Logger } from '@nestjs/common';
import { DataSource } from 'typeorm';
import type {
  VehicleEventHandlerPort,
  VehicleEvent,
} from '../../../common/ports/vehicle-event-hook.js';
import { VehicleControlAlertService } from './vehicle-control-alert.service.js';
import { GateAccessLogService } from '../../zones/services/gate-access-log.service.js';
import { GateLogPairingService } from '../../zones/services/gate-log-pairing.service.js';
import { StorageService } from '../../storage/storage.service.js';
import { saveEventSnapshot } from '../../../common/utils/save-event-snapshot.util.js';
import {
  IVSS_CHANNEL_ZONE_MAP_KEY,
  IVSS_CHANNEL_DIRECTION_MAP_KEY,
  type GateLogSkippedReason,
} from '../constants/gate-writer.constant.js';

/** F-D: subfolder storage cho snapshot ảnh sự kiện ANPR. */
const SNAPSHOT_FOLDER = 'anpr-snapshots';
/** media_files.related_entity_type cho snapshot lưu từ luồng ANPR ingestion. */
const SNAPSHOT_RELATED_ENTITY_TYPE = 'anpr_device_event';

interface IdRow {
  id: string;
}
interface UserRow {
  id: string;
  user_id: string;
}
interface ConfigRow {
  config_json: Record<string, unknown> | null;
}

/** Kết quả resolve biển → chủ xe (QC-7): user + đăng ký xe (cho gate_access_logs). */
interface ResolvedVehicle {
  userId: string;
  vehicleRegistrationId: string;
}

type Direction = 'enter' | 'leave' | 'seen';

const BRIDGE_DEVICE_CODE = 'IVSS-BRIDGE';
const BRIDGE_DEVICE_TYPE = 'ivss_bridge';
const SKEW_MS = 60 * 60 * 1000; // 1h
// OQ-3: eventAction → direction. Owed: chốt giá trị thật khi live (UC9).
const ENTER_ACTIONS = new Set(['enter', 'in', 'entry', '1']);
const LEAVE_ACTIONS = new Set(['leave', 'out', 'exit', '2']);
// OCR-MERGE: cửa sổ gộp nhiều lần đọc biển KHÁC NHAU cho CÙNG 1 lượt xe qua
// (channel+direction giống, cách nhau ngắn) — NGẮN hơn khoảng cách đọc lặp
// quan sát thực tế của 1 xe thật (~9-10s), để không gộp nhầm 2 xe kế tiếp.
const OCR_MERGE_WINDOW_SECONDS = 15;
const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * VehicleResolveService (VRE-001 / UC5) — handler thật cho VEHICLE_EVENT_HANDLER (override UC4).
 *
 * onVehicleEvent: resolve biển (plateNumber đã normalize từ UC4) → user qua vehicle_registrations
 * (status='active', deleted_at IS NULL) → persist per-event vào iot_device_events
 * (device=IVSS-BRIDGE, event_type='ivss_vehicle_event', source_protocol='ivss').
 *
 * DATA-01 C1-isolation: event_type riêng → KHÔNG nhiễm face ('ivss_face_event').
 * OQ-4: unmatched VẪN persist (userId null) để UC6/UC7 thấy biển lạ. room/meeting=NULL (OQ-2).
 * DATA-03: KHÔNG normalize lại (evt.plateNumber đã chuẩn từ UC4). SEC-01 KHÔNG imageBase64.
 * SEC-03 bind tham số. NotThrow (webhook UC4 always-ack). KHÔNG dùng VehicleRegistrationService
 * (raw query riêng, mirror face ingestion).
 */
@Injectable()
export class VehicleResolveService implements VehicleEventHandlerPort {
  private readonly logger = new Logger(VehicleResolveService.name);

  constructor(
    private readonly dataSource: DataSource,
    private readonly vehicleControlAlertService: VehicleControlAlertService,
    private readonly gateAccessLogService: GateAccessLogService,
    private readonly gateLogPairingService: GateLogPairingService,
    private readonly storageService: StorageService,
  ) {}

  async onVehicleEvent(evt: VehicleEvent): Promise<void> {
    try {
      const deviceId = await this.resolveBridgeDeviceId();
      if (!deviceId) {
        this.logger.warn(
          'IVSS-BRIDGE device chưa seed — skip vehicle ingest (chưa seed device?).',
        );
        return;
      }

      // DATA-03: KHÔNG normalize lại — evt.plateNumber đã chuẩn từ UC4.
      const resolved = await this.resolveUserByPlate(evt.plateNumber);
      const userId = resolved?.userId ?? null;
      const direction = this.normalizeVehicleDirection(evt.eventAction);

      // ĐIỂM CHÈN 1 (QĐ-9) — UC9/UC-108 (VCC-001) đã DỜI XUỐNG SAU khối INSERT theo FR-008b:
      // evaluate() cần source_event_id lấy từ RETURNING id. Xem "ĐIỂM CHÈN 1 (dời)" bên dưới.
      const matchState = userId ? 'matched' : 'unmatched';
      const processedStatus = userId ? 'processed' : 'unmatched';
      const { eventTime, utcFallback } = this.parseUtc(evt.utc);

      // GAW-001 (UC-105): resolve zone (QĐ-2) + gate-direction (QĐ-3, channel_direction_map
      // TRƯỚC → eventAction). gateDirection CHỈ dùng cho gate log — KHÔNG đổi `direction` cũ
      // (payload/evaluate giữ nguyên → AC-BACKCOMPAT). dirMap chỉ đọc khi zone mapped.
      const zoneMap = await this.getChannelZoneMap();
      const zoneId = zoneMap[String(evt.channelId)] ?? null;
      let gateDirection: Direction = direction;
      if (zoneId) {
        const dirMap = await this.getChannelDirectionMap();
        gateDirection = dirMap[String(evt.channelId)] ?? direction;
      }

      // Skip biết-TRƯỚC INSERT (QĐ-10): zone_unmapped → bad_utc → direction_seen → plate_too_long.
      let preSkip: GateLogSkippedReason | null = null;
      if (!zoneId) preSkip = 'zone_unmapped';
      else if (utcFallback) preSkip = 'bad_utc';
      else if (gateDirection === 'seen') preSkip = 'direction_seen';
      else if (evt.plateNumber.length > 16) preSkip = 'plate_too_long';

      // F-D: có ảnh (bridge gửi — hiện CHƯA gửi cho ANPR, xem R7, nên thường null) → lưu
      // snapshot. KHÔNG điều kiện matched/unmatched (khác F-B/F-C): biển số đáng giữ ảnh
      // bất kể resolve được chủ xe hay không.
      const snapshotFileId = await this.saveSnapshotSafe(evt.imageBase64);

      // SEC-01: KHÔNG imageBase64. userId nằm trong payload (schema KHÔNG có cột user_id).
      const payload = {
        plateRaw: evt.plateRaw,
        plateNumber: evt.plateNumber,
        userId,
        channelId: evt.channelId,
        direction,
        matchState,
        eventActionRaw: evt.eventAction ?? null,
        plateColor: evt.plateColor ?? null,
        vehicleColor: evt.vehicleColor ?? null,
        vehicleType: evt.vehicleType ?? null,
        utc: evt.utc,
        receivedAt: new Date().toISOString(),
        // QĐ-10: lý do skip biết-trước (null nếu sẽ ghi gate log). zone_not_gate/duplicate
        // ghi SAU qua UPDATE (markGateLogSkipped).
        gateLogSkipped: preSkip,
        // OCR-MERGE: phụ lục mọi chuỗi biển OCR đọc được cho lượt xe này (bắt đầu
        // bằng chính lần đọc này); mergeIntoRecentEvent() nối thêm khi gộp lần đọc
        // sau. plateNumber gốc ở trên KHÔNG đổi khi gộp — vẫn là lần đọc ĐẦU TIÊN.
        rawReads: [evt.plateNumber],
      };

      // OCR-MERGE (recon 2026-08-08): nhiều lần OCR đọc biển KHÁC NHAU cho CÙNG 1
      // lượt xe qua (channel+direction giống, cách nhau < OCR_MERGE_WINDOW_SECONDS)
      // → gộp vào row iot_device_events GẦN NHẤT thay vì tạo row mới (tránh spam
      // "Biển lạ"). Mirror tinh thần bump AlertsService.recordAlert()/bumpOccurrence()
      // (unique-index+23505 KHÔNG áp dụng được ở đây vì nội dung — plateNumber —
      // chính là thứ không đáng tin giữa các lần đọc, nên dùng lookback SELECT
      // best-effort thay vì unique constraint). KHÔNG evaluate() lại (đã evaluate ở
      // lần INSERT gốc — tránh alert trùng) — merge() return SỚM, bỏ qua toàn bộ
      // đoạn INSERT/evaluate/gate-log bên dưới cho lần đọc này.
      const merged = await this.mergeIntoRecentEvent(
        evt.channelId,
        direction,
        evt.plateNumber,
        snapshotFileId,
      );
      if (merged) return;

      // OQ-2: room_id/meeting_id literal NULL. QĐ-6: RETURNING id → event_id cho gate log.
      // FR-008b: INSERT chạy TRƯỚC evaluate() để có source_event_id. AC-006: lỗi INSERT KHÔNG
      // được chặn cảnh báo control-list → nuốt lỗi tại chỗ, eventId = null.
      // F-D/F-E: snapshot_file_id THÊM Ở CUỐI danh sách cột — KHÔNG đổi vị trí cột/tham số cũ.
      let insRows: IdRow[] | undefined;
      try {
        insRows = await this.dataSource.manager.query(
          `INSERT INTO iot_device_events
             (device_id, room_id, meeting_id, event_type, event_time, source_protocol, severity, payload_json, processed_status, snapshot_file_id)
           VALUES ($1, NULL, NULL, 'ivss_vehicle_event', $2, 'ivss', 'info', $3::jsonb, $4, $5)
           RETURNING id`,
          [
            deviceId,
            eventTime,
            JSON.stringify(payload),
            processedStatus,
            snapshotFileId,
          ],
        );
      } catch (e) {
        this.logger.error(
          `Failed to INSERT iot_device_events (plate=${evt.plateNumber}): ${
            e instanceof Error ? e.message : 'unknown'
          }`,
        );
      }
      const eventId = insRows?.[0]?.id ?? null;

      // ĐIỂM CHÈN 1 (dời) — UC9/UC-108 (VCC-001): đối chiếu control-list. FR-004: gọi SAU
      // INSERT kèm source_event_id. Tự NotThrow (evaluate() nằm trong outer try/catch).
      await this.vehicleControlAlertService.evaluate(
        evt.plateNumber,
        { channelId: evt.channelId, direction },
        eventId ?? undefined,
      );

      if (matchState !== 'matched') {
        // OQ-4: biển lạ — vẫn persist row unmatched (UC6/UC7 đọc).
        this.logger.warn(
          `Vehicle event unmatched (channel=${evt.channelId} plate=${evt.plateNumber}).`,
        );
      }

      // ĐIỂM CHÈN 2 (QĐ-9) — GAW-001 writer. Skip biết-trước → KHÔNG ghi (AC-BACKCOMPAT khi
      // channel_zone_map trống → luôn zone_unmapped → hành vi giống hệt trước UC-105). `|| !zoneId`
      // thừa về logic (đã bao ở preSkip) nhưng để TS narrow zoneId → string.
      // `!eventId`: INSERT hỏng (AC-006 nuốt lỗi) → KHÔNG ghi gate log mồ côi, giữ đúng hành vi
      // UC-105 gốc (trước FR-008b, INSERT ném là cả luồng dừng).
      if (preSkip || !zoneId || !eventId) return;

      // seen đã bị chặn (preSkip='direction_seen') ⇒ ở đây chỉ enter|leave.
      const gateDir: 'enter' | 'leave' =
        gateDirection === 'leave' ? 'leave' : 'enter';
      // Biển rỗng sau chuẩn hoá → NULL (vẫn ghi, B′ không bảo vệ — QC-1/A.5).
      const plateForGate = evt.plateNumber === '' ? null : evt.plateNumber;

      const result = await this.gateAccessLogService.writeGateLog({
        zoneId,
        direction: gateDir,
        accessTime: eventTime, // QC-8: TỪ evt.utc (parseUtc), KHÔNG now().
        deviceId,
        eventId,
        userId,
        vehicleRegistrationId: resolved?.vehicleRegistrationId ?? null,
        plateNumber: plateForGate,
        metadata: { channelId: evt.channelId, plateRaw: evt.plateRaw },
      });

      if (!result.written) {
        // zone_not_gate / duplicate: biết SAU khi gọi zones → UPDATE bổ sung (QC-7/A.4).
        await this.markGateLogSkipped(eventId, result.skipReason);
        return;
      }

      // QĐ-8: pairing tx RIÊNG (không manager), try/catch NUỐT — KHÔNG kéo rollback gate log.
      // Chỉ leave kích hoạt ghép (enter chờ leave của nó — FR-07).
      if (gateDir === 'leave') {
        try {
          await this.gateLogPairingService.pairForLeaveLog(result.logId);
        } catch (e) {
          this.logger.error(
            `gate-log pairing failed (logId=${result.logId}): ${
              e instanceof Error ? e.message : 'unknown'
            }`,
          );
        }
      }
    } catch (e) {
      // NotThrow — webhook UC4 always-ack. SEC-01: chỉ metadata, KHÔNG imageBase64.
      this.logger.error(
        `Vehicle resolve ingest failed (channel=${evt.channelId} plate=${evt.plateNumber}): ${
          e instanceof Error ? e.message : 'unknown'
        }`,
      );
    }
  }

  /**
   * OCR-MERGE: tra row iot_device_events GẦN NHẤT cùng channelId + direction, trong
   * vòng OCR_MERGE_WINDOW_SECONDS giây — nếu có, UPDATE (bump) thay vì để caller
   * INSERT row mới. Trả true nếu đã gộp (caller phải return ngay, KHÔNG INSERT/
   * evaluate/gate-log cho lần đọc này — event gốc đã evaluate/gate-log rồi).
   *
   * Best-effort, KHÔNG throw: SELECT/UPDATE lỗi hoặc không thấy row → false (INSERT
   * như bình thường). `rows?.[0]` tự vệ thay vì dựa vào catch để fallback (mirror
   * getChannelZoneMap/getChannelDirectionMap — đọc lỗi = {}/không thấy, KHÔNG throw).
   *
   * snapshot_file_id: ưu tiên ảnh đã có (COALESCE giữ ảnh cũ nếu đã có, chỉ nhận
   * ảnh mới khi row cũ CHƯA có).
   */
  private async mergeIntoRecentEvent(
    channelId: number,
    direction: Direction,
    plateNumber: string,
    snapshotFileId: string | null,
  ): Promise<boolean> {
    try {
      const rows: Array<{ id: string }> | undefined =
        await this.dataSource.manager.query(
          `SELECT id FROM iot_device_events
            WHERE event_type = 'ivss_vehicle_event'
              AND payload_json->>'channelId' = $1
              AND payload_json->>'direction' = $2
              AND event_time > NOW() - ($3::int * INTERVAL '1 second')
            ORDER BY event_time DESC
            LIMIT 1`,
          [String(channelId), direction, OCR_MERGE_WINDOW_SECONDS],
        );
      const recent = rows?.[0];
      if (!recent) return false;

      await this.dataSource.manager.query(
        `UPDATE iot_device_events
            SET event_time = NOW(),
                payload_json = jsonb_set(
                  payload_json,
                  '{rawReads}',
                  COALESCE(payload_json->'rawReads', '[]'::jsonb) || $1::jsonb
                ),
                snapshot_file_id = COALESCE(snapshot_file_id, $2)
          WHERE id = $3`,
        [JSON.stringify([plateNumber]), snapshotFileId, recent.id],
      );
      return true;
    } catch (e) {
      this.logger.warn(
        `OCR merge check failed (channel=${channelId}): ${
          e instanceof Error ? e.message : 'unknown'
        } — fallback INSERT`,
      );
      return false;
    }
  }

  /** QC-7/A.4: ghi gateLogSkipped biết-SAU (zone_not_gate/duplicate) vào raw event đã INSERT. */
  private async markGateLogSkipped(
    eventId: string | null,
    reason: GateLogSkippedReason,
  ): Promise<void> {
    if (!eventId) return;
    await this.dataSource.manager.query(
      `UPDATE iot_device_events
         SET payload_json = jsonb_set(payload_json, '{gateLogSkipped}', to_jsonb($1::text))
       WHERE id = $2`,
      [reason, eventId],
    );
  }

  /**
   * F-D: lưu snapshot ảnh (nếu có) qua storageService + media_files — KHÔNG throw
   * (webhook UC4 always-ack): lỗi storage/DB chỉ log + trả null, KHÔNG được chặn
   * persist raw event. Không có ảnh (bridge hiện chưa gửi, xem R7) → null, KHÔNG gọi storage.
   */
  private async saveSnapshotSafe(
    imageBase64: string | null | undefined,
  ): Promise<string | null> {
    if (!imageBase64) return null;
    try {
      return await saveEventSnapshot(this.dataSource, this.storageService, {
        imageBase64,
        folder: SNAPSHOT_FOLDER,
        relatedEntityType: SNAPSHOT_RELATED_ENTITY_TYPE,
      });
    } catch (e) {
      this.logger.warn(
        `snapshot save failed: ${e instanceof Error ? e.message : 'unknown'}`,
      );
      return null;
    }
  }

  private async resolveBridgeDeviceId(): Promise<string | null> {
    const rows: IdRow[] = await this.dataSource.manager.query(
      `SELECT id FROM iot_devices WHERE device_code = $1 AND device_type = $2 LIMIT 1`,
      [BRIDGE_DEVICE_CODE, BRIDGE_DEVICE_TYPE],
    );
    return rows[0]?.id ?? null;
  }

  /**
   * OQ-1: biển active đang sống → {userId, vehicleRegistrationId}; disabled/đã-xóa/không-có → null.
   * QC-7: trả thêm `id` (vehicle_registration_id) cho gate_access_logs — cùng MỘT query.
   */
  private async resolveUserByPlate(
    plateNumber: string,
  ): Promise<ResolvedVehicle | null> {
    const rows: UserRow[] = await this.dataSource.manager.query(
      `SELECT id, user_id FROM vehicle_registrations
       WHERE plate_number = $1 AND status = 'active' AND deleted_at IS NULL
       LIMIT 1`,
      [plateNumber],
    );
    if (!rows[0]) return null;
    return { userId: rows[0].user_id, vehicleRegistrationId: rows[0].id };
  }

  /** OQ-3 defensive: eventAction biết → enter/leave; lạ/thiếu → seen. Owed chốt live (UC9). */
  private normalizeVehicleDirection(action?: string): Direction {
    if (action) {
      const a = action.trim().toLowerCase();
      if (ENTER_ACTIONS.has(a)) return 'enter';
      if (LEAVE_ACTIONS.has(a)) return 'leave';
    }
    return 'seen';
  }

  /** ISO + |skew|≤1h → eventTime; sai/lệch → now (mirror face). */
  private parseUtc(raw: string): { eventTime: Date; utcFallback: boolean } {
    const t = new Date(raw);
    if (
      !Number.isNaN(t.getTime()) &&
      Math.abs(Date.now() - t.getTime()) <= SKEW_MS
    ) {
      return { eventTime: t, utcFallback: false };
    }
    return { eventTime: new Date(), utcFallback: true };
  }

  /**
   * GAW-001 (QĐ-2): system_configs[ivss.channel_zone_map] {channelId: zone_uuid}; validate uuid.
   * Không cache. Đọc lỗi → trả {} (KHÔNG throw): map-miss = zone_unmapped (AC-BACKCOMPAT).
   */
  private async getChannelZoneMap(): Promise<Record<string, string>> {
    const out: Record<string, string> = {};
    try {
      const rows: ConfigRow[] = await this.dataSource.manager.query(
        `SELECT config_json FROM system_configs
         WHERE config_key = $1 AND is_active = true LIMIT 1`,
        [IVSS_CHANNEL_ZONE_MAP_KEY],
      );
      const raw = rows[0]?.config_json;
      if (raw && typeof raw === 'object') {
        for (const [k, v] of Object.entries(raw)) {
          if (typeof v === 'string' && UUID_RE.test(v)) out[k] = v;
        }
      }
    } catch (e) {
      this.logger.warn(
        `IVSS channel_zone_map read failed (→ zone_unmapped): ${
          e instanceof Error ? e.message : 'unknown'
        }`,
      );
    }
    return out;
  }

  /**
   * GAW-001 (QĐ-3): system_configs[ivss.channel_direction_map] {channelId: enter|leave|seen}.
   * Chỉ nhận value ∈ {enter,leave,seen}; value lạ → bỏ entry. Đọc lỗi → {} (KHÔNG throw).
   *
   * ⚠ NỢ A.6 — BẢN ĐỌC THỨ HAI của cùng config `ivss.channel_direction_map`. Bản kia ở
   * ivss-presence-ingestion.service.ts:310 (getChannelDirectionMap, luồng khuôn mặt). Sửa logic
   * validate ở đây thì PHẢI sửa cả bên đó (và ngược lại), nếu không hai luồng diễn giải lệch nhau.
   */
  private async getChannelDirectionMap(): Promise<Record<string, Direction>> {
    const out: Record<string, Direction> = {};
    try {
      const rows: ConfigRow[] = await this.dataSource.manager.query(
        `SELECT config_json FROM system_configs
         WHERE config_key = $1 AND is_active = true LIMIT 1`,
        [IVSS_CHANNEL_DIRECTION_MAP_KEY],
      );
      const raw = rows[0]?.config_json;
      if (raw && typeof raw === 'object') {
        for (const [k, v] of Object.entries(raw)) {
          if (v === 'enter' || v === 'leave' || v === 'seen') out[k] = v;
        }
      }
    } catch (e) {
      this.logger.warn(
        `IVSS channel_direction_map read failed (fallback eventAction): ${
          e instanceof Error ? e.message : 'unknown'
        }`,
      );
    }
    return out;
  }
}
