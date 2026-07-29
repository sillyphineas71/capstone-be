import { Injectable, NotFoundException } from '@nestjs/common';
import { DataSource } from 'typeorm';
import type {
  RoomAccessLogEventDto,
  RoomAccessLogResponseDto,
} from '../dto/room-access-log-response.dto.js';

interface AccessLogRow {
  id: string;
  event_time: Date | string;
  user_id: string | null;
  full_name: string | null;
  direction: string | null;
  match_state: string | null;
  similarity: string | null;
  meeting_id: string | null;
}

interface RoomRow {
  room_name: string;
}

const FACE_EVENT_TYPE = 'ivss_face_event';

/**
 * IvssRoomAccessLogService (RAL-001 / Màn 2) — nhật ký ra/vào của MỘT PHÒNG theo NGÀY.
 *
 * Khác Màn 1 (`IvssPresenceQueryService`, góc nhìn theo CUỘC HỌP): ở đây lấy MỌI
 * `ivss_face_event` của phòng trong ngày, KỂ CẢ người không dự họp nào và event chưa
 * khớp danh tính — phục vụ giám sát an ninh.
 *
 * 100% READ-ONLY: không ghi DB, không gọi bridge, không emit WS.
 * SEC-03 bind tham số. SEC-01 KHÔNG lộ ảnh (payload chỉ metadata).
 */
@Injectable()
export class IvssRoomAccessLogService {
  constructor(private readonly dataSource: DataSource) {}

  /** YYYY-MM-DD theo giờ máy chủ — dùng khi client không truyền `date`. */
  private todayStr(): string {
    const d = new Date();
    return (
      d.getFullYear().toString() +
      '-' +
      String(d.getMonth() + 1).padStart(2, '0') +
      '-' +
      String(d.getDate()).padStart(2, '0')
    );
  }

  /** matchState 'unmatched_location' | 'unmatched_identity' → người lạ/ngoài lịch. */
  private isStranger(matchState: string | null): boolean {
    return typeof matchState === 'string' && matchState.startsWith('unmatched');
  }

  async getRoomAccessLog(
    roomId: string,
    date?: string,
  ): Promise<RoomAccessLogResponseDto> {
    const day = date ?? this.todayStr();

    // Phòng phải tồn tại (loại soft-delete) — mirror cách RoomStatusService kiểm.
    const rooms: RoomRow[] = await this.dataSource.manager.query(
      `SELECT room_name FROM rooms WHERE id = $1 AND deleted_at IS NULL LIMIT 1`,
      [roomId],
    );
    if (!rooms[0]) {
      throw new NotFoundException({
        code: 'ROOM_NOT_FOUND',
        message: 'Room not found.',
      });
    }

    // LEFT JOIN users: event chưa khớp danh tính có payload_json->>'userId' = NULL
    // (hoặc uid lạ) → full_name null, KHÔNG loại dòng khỏi kết quả.
    // Biên ngày: [date, date + 1 day) theo timezone của phiên DB.
    const rows: AccessLogRow[] = await this.dataSource.manager.query(
      `SELECT e.id,
              e.event_time,
              e.payload_json->>'userId'     AS user_id,
              u.full_name                   AS full_name,
              e.payload_json->>'direction'  AS direction,
              e.payload_json->>'matchState' AS match_state,
              e.payload_json->>'similarity' AS similarity,
              e.meeting_id                  AS meeting_id
         FROM iot_device_events e
         LEFT JOIN users u
                ON u.id = NULLIF(e.payload_json->>'userId', '')::uuid
        WHERE e.event_type = $3
          AND e.room_id = $1
          AND e.event_time >= $2::date
          AND e.event_time <  ($2::date + interval '1 day')
        ORDER BY e.event_time ASC`,
      [roomId, day, FACE_EVENT_TYPE],
    );

    const events: RoomAccessLogEventDto[] = rows.map((r) => {
      const similarity = r.similarity === null ? null : Number(r.similarity);
      return {
        id: r.id,
        eventTime: new Date(r.event_time).toISOString(),
        userId: r.user_id ?? null,
        fullName: r.full_name ?? null,
        direction: r.direction ?? null,
        matchState: r.match_state ?? null,
        similarity: Number.isFinite(similarity as number) ? similarity : null,
        meetingId: r.meeting_id ?? null,
        isStranger: this.isStranger(r.match_state),
      };
    });

    const matchedCount = events.filter(
      (e) => e.matchState === 'matched',
    ).length;
    const unmatchedCount = events.filter((e) => e.isStranger).length;

    return {
      roomId,
      roomName: rooms[0].room_name ?? null,
      date: day,
      totalEvents: events.length,
      matchedCount,
      unmatchedCount,
      events,
    };
  }
}
