import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { DataSource } from 'typeorm';
import type {
  IvssEventHandlerPort,
  IvssFaceEvent,
} from '../../../common/ports/ivss-event-hook.js';
import { WebsocketService } from '../../websocket/websocket.service.js';

interface IdRow {
  id: string;
}
interface UserRow {
  user_id: string;
}
interface ConfigRow {
  config_json: Record<string, unknown> | null;
}
interface FullNameRow {
  full_name: string | null;
}

/** IRP-001 (#40): payload realtime đẩy về client — SEC-01/C4 KHÔNG szUid/imageBase64/similarity. */
interface PresenceBroadcast {
  meetingId: string;
  roomId: string;
  userId: string;
  fullName: string | null;
  direction: Direction;
  matchState: 'matched';
  at: string;
}

const IVSS_PRESENCE_EVENT = 'ivss.presence';
const IVSS_MEETING_ROOM = (meetingId: string): string =>
  `ivss:meeting:${meetingId}`;

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
  // IRP-001 (#40) C1/B1: gate broadcast realtime — default OFF (mirror SCHEDULER_*_ENABLED).
  private readonly realtimeEnabled: boolean;

  constructor(
    private readonly dataSource: DataSource,
    private readonly websocketService: WebsocketService,
    private readonly configService: ConfigService,
  ) {
    this.realtimeEnabled = this.configService.get<boolean>(
      'IVSS_REALTIME_ENABLED',
      false,
    );
  }

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

      // Task B: direction ưu tiên channel-direction-map (camera nào thấy mặt) →
      // fallback eventAction (normalizeDirection) → 'seen'. C5: ĐỘC LẬP matchState.
      const directionMap = await this.getChannelDirectionMap();
      const direction =
        directionMap[String(evt.channelId)] ??
        this.normalizeDirection(evt.eventAction);
      // Nợ #3: chỉ điểm danh người THỰC SỰ thuộc cuộc họp đang diễn ra tại room đó.
      // meetingId null (không có họp lúc đi qua camera) → isParticipant=false → không matched.
      let isParticipant = false;
      if (userId && meetingId) {
        const pr: IdRow[] = await this.dataSource.manager.query(
          `SELECT id FROM meeting_participants
           WHERE meeting_id = $1 AND user_id = $2 LIMIT 1`,
          [meetingId, userId],
        );
        isParticipant = !!pr[0];
      }
      const matchState = this.matchStateOf(userId, roomId, isParticipant);
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
      } else if (this.realtimeEnabled && meetingId && roomId && userId) {
        // IRP-001 (#40): broadcast SAU persist (OQ-7), chỉ matched + có họp (OQ-4/5).
        // C1 gate + C3 best-effort: broadcastPresence tự nuốt lỗi, KHÔNG vỡ ingest.
        await this.broadcastPresence({
          meetingId,
          roomId,
          userId,
          direction,
          eventTime,
        });
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

  /**
   * IRP-001 (#40): đẩy realtime presence về room ivss:meeting:<meetingId>.
   * B2/C3: TOÀN BỘ thân (query fullName + emit) trong try/catch → KHÔNG bao giờ throw
   * ra ngoài (không vỡ ingest, không floating-reject). C4/SEC-01: payload KHÔNG
   * szUid/imageBase64/similarity. SEC-03: query full_name bind tham số.
   */
  private async broadcastPresence(args: {
    meetingId: string;
    roomId: string;
    userId: string;
    direction: Direction;
    eventTime: Date;
  }): Promise<void> {
    try {
      const rows: FullNameRow[] = await this.dataSource.manager.query(
        `SELECT full_name FROM users WHERE id = $1 AND deleted_at IS NULL LIMIT 1`,
        [args.userId],
      );
      const payload: PresenceBroadcast = {
        meetingId: args.meetingId,
        roomId: args.roomId,
        userId: args.userId,
        fullName: rows[0]?.full_name ?? null,
        direction: args.direction,
        matchState: 'matched',
        at: args.eventTime.toISOString(),
      };
      this.websocketService.emitToRoom(
        IVSS_MEETING_ROOM(args.meetingId),
        IVSS_PRESENCE_EVENT,
        payload,
      );
    } catch (e) {
      // C3 best-effort: lỗi query/emit/gateway-down → log, KHÔNG throw, KHÔNG rollback persist.
      this.logger.warn(
        `IVSS realtime broadcast skipped: ${
          e instanceof Error ? e.message : 'unknown'
        }`,
      );
    }
  }

  /**
   * C5: 4 trạng thái khớp, tách khỏi direction.
   * Nợ #3: `matched` YÊU CẦU thêm `isParticipant` — nhận ra người + có room vẫn chưa đủ.
   * Người còn mặt trên IVSS (deprovision lỗi) nhưng KHÔNG thuộc meeting đang diễn ra
   * → 'unmatched_identity' → processed_status='unmatched' → KHÔNG được điểm danh.
   */
  private matchStateOf(
    userId: string | null,
    roomId: string | null,
    isParticipant: boolean,
  ): MatchState {
    if (userId && roomId && isParticipant) return 'matched';
    // Nhận ra người nhưng không có trong họp (hoặc không map được meeting).
    if (userId && roomId && !isParticipant) return 'unmatched_identity';
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

  /**
   * Task B: system_configs[ivss.channel_direction_map] config_json {channelId: enter|leave|seen}.
   * MIRROR getChannelRoomMap (cùng query, is_active=true). Chỉ nhận value ∈ {enter,leave,seen}
   * (value lạ → bỏ entry). Lookup dùng String(channelId) — nhất quán channel_room_map.
   * Đọc config lỗi → trả rỗng (KHÔNG throw): map-miss = đường cũ (eventAction/'seen').
   */
  private async getChannelDirectionMap(): Promise<Record<string, Direction>> {
    const out: Record<string, Direction> = {};
    try {
      const rows: ConfigRow[] = await this.dataSource.manager.query(
        `SELECT config_json FROM system_configs
         WHERE config_key = 'ivss.channel_direction_map' AND is_active = true LIMIT 1`,
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
