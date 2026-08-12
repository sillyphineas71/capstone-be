import { Injectable, Logger } from '@nestjs/common';
import { DataSource } from 'typeorm';

/**
 * Input ghi một dòng `appear` vào `zone_presence_events` (ZPW-001 / UC-109).
 * `ivss` đã resolve sạch: `userId` NOT NULL (restricted-zone coi NULL = vi phạm),
 * `eventTime` TỪ `evt.utc` (parseUtc, KHÔNG now()). `metadata` gồm { channelId, szUid,
 * similarity, sourceEventId } (nhánh B: link raw event qua JSONB, KHÔNG cột event_id).
 */
export interface WriteAppearInput {
  zoneId: string;
  userId: string;
  eventTime: Date;
  deviceId?: string | null;
  metadata?: Record<string, unknown> | null;
}

/**
 * Input ghi một dòng `count` vào `zone_presence_events` (F3, recon B5 — nguồn dữ liệu
 * cho crowd-alert/zone-traffic-heatmap, trước đây KHÔNG có gì ghi event_type='count').
 * KHÔNG có `userId` (đếm số lượng, không gắn 1 người cụ thể).
 */
export interface WriteCountInput {
  zoneId: string;
  occupancyCount: number;
  eventTime: Date;
  deviceId?: string | null;
  metadata?: Record<string, unknown> | null;
}

/** Kết quả validate zone khu vực (đọc, không ghi) — để `ivss` biết type TRƯỚC INSERT raw. */
export type ResolvePresenceZoneResult =
  | { valid: true }
  | { valid: false; reason: 'zone_wrong_type' };

/** Loại zone hợp lệ cho `appear` (QC-5). Trùng PRESENCE_ZONE_TYPES bên ivss — chủ ý ở phía chủ bảng. */
const PRESENCE_ZONE_TYPES = ['corridor', 'lobby', 'parking'];

/**
 * ZonePresenceWriterService (ZPW-001 / UC-109) — nguồn ghi DUY NHẤT của `zone_presence_events`
 * cho vòng `appear` (QĐ-1/QC-4). `ivss` GỌI, KHÔNG bắn raw SQL chéo.
 *
 * Hai method: `resolvePresenceZone` (ĐỌC — validate zone.type để caller biết `zone_wrong_type`
 * TRƯỚC khi ghi raw event, tránh UPDATE bù) + `writeAppearEvent` (GHI — INSERT 1 dòng, tx riêng).
 *
 * ⚠⚠ BẢNG APPEND-ONLY: `zone_presence_events` KHÔNG có `deleted_at` ⇒ TUYỆT ĐỐI KHÔNG
 * `deletedAt`/`IsNull()` trên bảng này. `event_time` do caller đưa vào (từ evt.utc), method
 * KHÔNG tự sinh thời gian.
 */
@Injectable()
export class ZonePresenceWriterService {
  private readonly logger = new Logger(ZonePresenceWriterService.name);

  constructor(private readonly dataSource: DataSource) {}

  /**
   * ĐỌC — zone tồn tại (chưa xoá mềm) + `zone_type ∈ {corridor,lobby,parking}` (QC-5)?
   * Không tồn tại / sai type → `{valid:false, reason:'zone_wrong_type'}`. KHÔNG ghi.
   */
  async resolvePresenceZone(
    zoneId: string,
  ): Promise<ResolvePresenceZoneResult> {
    const rows: Array<{ zone_type: string }> =
      await this.dataSource.manager.query(
        `SELECT zone_type FROM zones WHERE id = $1 AND deleted_at IS NULL LIMIT 1`,
        [zoneId],
      );
    if (rows.length === 0 || !PRESENCE_ZONE_TYPES.includes(rows[0].zone_type)) {
      return { valid: false, reason: 'zone_wrong_type' };
    }
    return { valid: true };
  }

  /**
   * GHI — INSERT 1 dòng `appear`. Tự validate type lần nữa (defense: chỉ `ivss` gọi + đã
   * resolve, nhưng method phải an toàn nếu bị gọi trực tiếp) → sai type thì ném (không xảy ra
   * ở luồng thật vì caller đã lọc). Tx riêng, COMMIT trước khi trả. KHÔNG unique/pairing
   * (nhật ký bắt gặp cho phép trùng). KHÔNG cột `event_id` (nhánh B — link qua metadata).
   */
  async writeAppearEvent(
    input: WriteAppearInput,
  ): Promise<{ presenceId: string }> {
    const check = await this.resolvePresenceZone(input.zoneId);
    if (!check.valid) {
      // Defense-in-depth: luồng thật KHÔNG tới đây (caller đã resolve). Nếu tới → cấu hình sai.
      throw new Error(
        `writeAppearEvent: zone ${input.zoneId} không phải zone khu vực (zone_wrong_type)`,
      );
    }

    const metaJson =
      input.metadata && Object.keys(input.metadata).length > 0
        ? JSON.stringify(input.metadata)
        : null;

    const qr = this.dataSource.createQueryRunner();
    await qr.connect();
    await qr.startTransaction();
    try {
      const rows: Array<{ id: string }> = await qr.manager.query(
        `INSERT INTO zone_presence_events
           (zone_id, device_id, user_id, event_type, occupancy_count,
            confidence_score, event_time, source_type, metadata_json)
         VALUES ($1, $2, $3, 'appear', NULL, NULL, $4, 'ivss', $5::jsonb)
         RETURNING id`,
        [
          input.zoneId,
          input.deviceId ?? null,
          input.userId,
          input.eventTime,
          metaJson,
        ],
      );
      await qr.commitTransaction();
      return { presenceId: rows[0].id };
    } catch (e) {
      await qr.rollbackTransaction();
      this.logger.error(
        `writeAppearEvent failed (zone=${input.zoneId} user=${input.userId}): ${
          e instanceof Error ? e.message : 'unknown'
        }`,
      );
      throw e;
    } finally {
      await qr.release();
    }
  }

  /**
   * GHI — INSERT 1 dòng `count` (F3, recon B5). KHÔNG giới hạn `zone_type` như
   * `writeAppearEvent` (QC-5 chỉ áp dụng vòng `appear` — crowd-alert/heatmap đọc
   * theo zone_id bất kỳ do `alert_rules`/dashboard chỉ định, không kén loại zone).
   * Chỉ kiểm zone tồn tại (chưa xoá mềm). Tx riêng, COMMIT trước khi trả.
   */
  async writeCountEvent(
    input: WriteCountInput,
  ): Promise<{ presenceId: string }> {
    const zoneRows: Array<{ id: string }> = await this.dataSource.manager.query(
      `SELECT id FROM zones WHERE id = $1 AND deleted_at IS NULL LIMIT 1`,
      [input.zoneId],
    );
    if (zoneRows.length === 0) {
      throw new Error(
        `writeCountEvent: zone ${input.zoneId} không tồn tại hoặc đã xoá`,
      );
    }

    const metaJson =
      input.metadata && Object.keys(input.metadata).length > 0
        ? JSON.stringify(input.metadata)
        : null;

    const qr = this.dataSource.createQueryRunner();
    await qr.connect();
    await qr.startTransaction();
    try {
      const rows: Array<{ id: string }> = await qr.manager.query(
        `INSERT INTO zone_presence_events
           (zone_id, device_id, user_id, event_type, occupancy_count,
            confidence_score, event_time, source_type, metadata_json)
         VALUES ($1, $2, NULL, 'count', $3, NULL, $4, 'ivss', $5::jsonb)
         RETURNING id`,
        [
          input.zoneId,
          input.deviceId ?? null,
          input.occupancyCount,
          input.eventTime,
          metaJson,
        ],
      );
      await qr.commitTransaction();
      return { presenceId: rows[0].id };
    } catch (e) {
      await qr.rollbackTransaction();
      this.logger.error(
        `writeCountEvent failed (zone=${input.zoneId} count=${input.occupancyCount}): ${
          e instanceof Error ? e.message : 'unknown'
        }`,
      );
      throw e;
    } finally {
      await qr.release();
    }
  }
}
