import { Injectable, Logger } from '@nestjs/common';
import { DataSource } from 'typeorm';
import type {
  IvssEventHandlerPort,
  IvssFaceEvent,
} from '../../../common/ports/ivss-event-hook.js';

interface IdRow {
  id: string;
}
interface UserRow {
  user_id: string;
}
interface ConfigRow {
  config_json: Record<string, unknown> | null;
}

type Direction = 'enter' | 'leave' | 'seen';
type MatchState =
  | 'matched'
  | 'unmatched_identity'
  | 'unmatched_location'
  | 'unmatched_both';

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const BRIDGE_DEVICE_CODE = 'IVSS-BRIDGE';
const BRIDGE_DEVICE_TYPE = 'ivss_bridge';
const SKEW_MS = 60 * 60 * 1000; // 1h
// eventAction biết → direction. VERIFY-LIVE owed: tập giá trị thực bridge gửi.
const ENTER_ACTIONS = new Set(['enter', 'in', '1']);
const LEAVE_ACTIONS = new Set(['leave', 'out', 'exit', '2']);

/**
 * IvssPresenceIngestionService (IPI-001 #38+#39) — handler thật cho IVSS_EVENT_HANDLER.
 *
 * onFaceEvent: resolve identity (szUid→user, source='ivss'+deleted_at) + location (channel→room
 * qua system_configs[ivss.channel_room_map]) + meeting best-effort → persist per-identity event vào
 * iot_device_events (device=bridge, event_type='ivss_face_event', source_protocol='ivss') — OQ-1 né migration.
 *
 * C5: matchState (matched|unmatched_identity|unmatched_location|unmatched_both) TÁCH khỏi direction
 *     (enter/leave/seen theo eventAction, độc lập). processed_status='processed' chỉ khi matched.
 * OQ-5: unmatched VẪN persist (debuggable). C3: utc rác → fallback receivedAt. C1: event_type distinct
 *     ('ivss_face_event') → KHÔNG nhiễm query face_verify/face_stranger/occupancy.
 * SEC-01 KHÔNG lưu/log imageBase64. SEC-03 bind tham số + validate channel-map uuid.
 * Handler KHÔNG throw (webhook always-ack #36). ARCH-01 qua port, KHÔNG NetSDK.
 */
@Injectable()
export class IvssPresenceIngestionService implements IvssEventHandlerPort {
  private readonly logger = new Logger(IvssPresenceIngestionService.name);

  constructor(private readonly dataSource: DataSource) {}

  async onFaceEvent(evt: IvssFaceEvent): Promise<void> {
    try {
      const deviceId = await this.resolveBridgeDeviceId();
      if (!deviceId) {
        this.logger.warn(
          'IVSS bridge device không tồn tại — skip ingest (chưa enroll #37?).',
        );
        return;
      }

      const szUid = evt.personUid;
      const userId = await this.resolveUser(szUid);
      const roomId = await this.resolveRoom(evt.channelId);

      const { eventTime, utcFallback } = this.parseUtc(evt.utc);
      const meetingId = roomId
        ? await this.resolveMeeting(roomId, eventTime)
        : null;

      // C5: direction normalize ĐỘC LẬP với matchState.
      const direction = this.normalizeDirection(evt.eventAction);
      const matchState = this.matchStateOf(userId, roomId);
      const processedStatus =
        matchState === 'matched' ? 'processed' : 'unmatched';

      // SEC-01: KHÔNG imageBase64; szUid metadata-only.
      const payload = {
        szUid,
        userId,
        channelId: evt.channelId,
        roomId,
        meetingId,
        direction,
        matchState,
        eventActionRaw: evt.eventAction ?? null,
        similarity: evt.similarity ?? null,
        name: evt.name ?? null,
        utc: evt.utc,
        utcFallback,
        receivedAt: new Date().toISOString(),
      };

      await this.dataSource.manager.query(
        `INSERT INTO iot_device_events
           (device_id, room_id, meeting_id, event_type, event_time, source_protocol, severity, payload_json, processed_status)
         VALUES ($1, $2, $3, 'ivss_face_event', $4, 'ivss', 'info', $5::jsonb, $6)`,
        [
          deviceId,
          roomId,
          meetingId,
          eventTime,
          JSON.stringify(payload),
          processedStatus,
        ],
      );

      if (matchState !== 'matched') {
        // OQ-5: log + metric (đếm qua log); vẫn đã persist row unmatched.
        this.logger.warn(
          `IVSS event ${matchState} (channel=${evt.channelId} szUid=${szUid}).`,
        );
      }
    } catch (e) {
      // Webhook always-ack (#36) — handler KHÔNG throw.
      this.logger.error(
        `IVSS presence ingest failed: ${
          e instanceof Error ? e.message : 'unknown'
        }`,
      );
    }
  }

  /** C5: 4 trạng thái khớp, tách khỏi direction. */
  private matchStateOf(
    userId: string | null,
    roomId: string | null,
  ): MatchState {
    if (userId && roomId) return 'matched';
    if (!userId && !roomId) return 'unmatched_both';
    if (!userId) return 'unmatched_identity';
    return 'unmatched_location';
  }

  /** OQ-3 defensive: eventAction biết → enter/leave; lạ/thiếu → seen. */
  private normalizeDirection(action?: string): Direction {
    if (action) {
      const a = action.trim().toLowerCase();
      if (ENTER_ACTIONS.has(a)) return 'enter';
      if (LEAVE_ACTIONS.has(a)) return 'leave';
    }
    return 'seen';
  }

  /** C3: ISO + |skew|≤1h → eventTime; sai/lệch → now + fallback. */
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

  private async resolveBridgeDeviceId(): Promise<string | null> {
    const rows: IdRow[] = await this.dataSource.manager.query(
      `SELECT id FROM iot_devices WHERE device_code = $1 AND device_type = $2 LIMIT 1`,
      [BRIDGE_DEVICE_CODE, BRIDGE_DEVICE_TYPE],
    );
    return rows[0]?.id ?? null;
  }

  private async resolveUser(szUid: string): Promise<string | null> {
    const rows: UserRow[] = await this.dataSource.manager.query(
      `SELECT user_id FROM device_user_mappings
       WHERE device_person_id = $1 AND metadata_json->>'source' = 'ivss' AND deleted_at IS NULL
       LIMIT 1`,
      [szUid],
    );
    return rows[0]?.user_id ?? null;
  }

  private async resolveRoom(channelId: number): Promise<string | null> {
    const map = await this.getChannelRoomMap();
    return map[String(channelId)] ?? null;
  }

  /** OQ-2: system_configs[ivss.channel_room_map] config_json {channelId: room_uuid}; validate uuid (SEC-03). */
  private async getChannelRoomMap(): Promise<Record<string, string>> {
    const rows: ConfigRow[] = await this.dataSource.manager.query(
      `SELECT config_json FROM system_configs
       WHERE config_key = 'ivss.channel_room_map' AND is_active = true LIMIT 1`,
    );
    const raw = rows[0]?.config_json;
    const out: Record<string, string> = {};
    if (raw && typeof raw === 'object') {
      for (const [k, v] of Object.entries(raw)) {
        if (typeof v === 'string' && UUID_RE.test(v)) out[k] = v;
      }
    }
    return out;
  }

  private async resolveMeeting(
    roomId: string,
    eventTime: Date,
  ): Promise<string | null> {
    const rows: IdRow[] = await this.dataSource.manager.query(
      `SELECT id FROM meetings
       WHERE room_id = $1 AND status = 'in_progress'
         AND $2 BETWEEN start_time AND end_time
       LIMIT 1`,
      [roomId, eventTime],
    );
    return rows[0]?.id ?? null;
  }
}
