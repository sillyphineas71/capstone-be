import { Injectable, Logger } from '@nestjs/common';
import { DataSource } from 'typeorm';
import type {
  VehicleEventHandlerPort,
  VehicleEvent,
} from '../../../common/ports/vehicle-event-hook.js';

interface IdRow {
  id: string;
}
interface UserRow {
  user_id: string;
}

type Direction = 'enter' | 'leave' | 'seen';

const BRIDGE_DEVICE_CODE = 'IVSS-BRIDGE';
const BRIDGE_DEVICE_TYPE = 'ivss_bridge';
const SKEW_MS = 60 * 60 * 1000; // 1h
// OQ-3: eventAction → direction. Owed: chốt giá trị thật khi live (UC9).
const ENTER_ACTIONS = new Set(['enter', 'in', 'entry', '1']);
const LEAVE_ACTIONS = new Set(['leave', 'out', 'exit', '2']);

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

  constructor(private readonly dataSource: DataSource) {}

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
      const userId = await this.resolveUserByPlate(evt.plateNumber);
      const direction = this.normalizeVehicleDirection(evt.eventAction);
      const matchState = userId ? 'matched' : 'unmatched';
      const processedStatus = userId ? 'processed' : 'unmatched';
      const { eventTime } = this.parseUtc(evt.utc);

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
      };

      // OQ-2: room_id/meeting_id literal NULL (ANPR không gắn phòng/họp).
      await this.dataSource.manager.query(
        `INSERT INTO iot_device_events
           (device_id, room_id, meeting_id, event_type, event_time, source_protocol, severity, payload_json, processed_status)
         VALUES ($1, NULL, NULL, 'ivss_vehicle_event', $2, 'ivss', 'info', $3::jsonb, $4)`,
        [deviceId, eventTime, JSON.stringify(payload), processedStatus],
      );

      if (matchState !== 'matched') {
        // OQ-4: biển lạ — vẫn persist row unmatched (UC6/UC7 đọc).
        this.logger.warn(
          `Vehicle event unmatched (channel=${evt.channelId} plate=${evt.plateNumber}).`,
        );
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

  private async resolveBridgeDeviceId(): Promise<string | null> {
    const rows: IdRow[] = await this.dataSource.manager.query(
      `SELECT id FROM iot_devices WHERE device_code = $1 AND device_type = $2 LIMIT 1`,
      [BRIDGE_DEVICE_CODE, BRIDGE_DEVICE_TYPE],
    );
    return rows[0]?.id ?? null;
  }

  /** OQ-1: biển active đang sống → userId; disabled/đã-xóa/không-có → null (unmatched). */
  private async resolveUserByPlate(
    plateNumber: string,
  ): Promise<string | null> {
    const rows: UserRow[] = await this.dataSource.manager.query(
      `SELECT user_id FROM vehicle_registrations
       WHERE plate_number = $1 AND status = 'active' AND deleted_at IS NULL
       LIMIT 1`,
      [plateNumber],
    );
    return rows[0]?.user_id ?? null;
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
}
