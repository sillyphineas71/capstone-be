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
/** Múi giờ nghiệp vụ — dùng cho CẢ mặc định `date` lẫn biên ngày trong SQL. */
const BUSINESS_TIMEZONE = 'Asia/Ho_Chi_Minh';

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

  /**
   * YYYY-MM-DD của HÔM NAY THEO GIỜ VIỆT NAM — dùng khi client không truyền `date`.
   *
   * ⚠ KHÔNG dùng getFullYear/getMonth/getDate: chúng theo timezone TIẾN TRÌNH NODE.
   * EC2 chạy UTC ⇒ trong khoảng 00:00–07:00 giờ VN, bản cũ trả về NGÀY HÔM QUA.
   * Cùng bản chất lỗi timezone đã sửa ở biên ngày SQL bên dưới.
   *
   * Dùng Intl.DateTimeFormat('en-CA') — 'en-CA' cho ra sẵn dạng YYYY-MM-DD. Mirror
   * pattern có sẵn ở room-usage-dashboard.service.ts:285 và facegate-time.util.ts:13
   * (tránh cộng tay +7h, vốn sai với code DST-aware).
   */
  private todayStr(): string {
    return new Intl.DateTimeFormat('en-CA', {
      timeZone: BUSINESS_TIMEZONE,
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
    }).format(new Date());
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
    //
    // Biên ngày: [00:00, 24:00) GIỜ VIỆT NAM, KHÔNG phụ thuộc timezone phiên DB.
    // ⚠ RDS production chạy UTC. Để `$2::date` trần thì "ngày 28/7" bị hiểu là
    // 00:00→24:00 UTC = 07:00 sáng 28 → 07:00 sáng 29 giờ VN ⇒ event buổi tối giờ VN
    // rơi nhầm sang ngày hôm sau.
    //
    // ⚠⚠ BẮT BUỘC có `::timestamp` trước `AT TIME ZONE`. Thiếu nó, Postgres ép
    // `date` → `timestamptz` rồi `AT TIME ZONE` chạy CHIỀU NGƯỢC (timestamptz →
    // wall-time), trả `timestamp without time zone` = '2026-07-29 07:00:00' ⇒ biên
    // lệch +7h SAI HƯỚNG, còn tệ hơn bản gốc. Có `::timestamp` thì phép đổi đúng
    // chiều: '00:00 ngày đó giờ VN' → timestamptz '2026-07-28 17:00:00+00'.
    // Đã nghiệm thu bằng psql với SET TIME ZONE 'UTC'.
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
          AND e.event_time >= ($2::date::timestamp AT TIME ZONE 'Asia/Ho_Chi_Minh')
          AND e.event_time <  (($2::date + interval '1 day')::timestamp AT TIME ZONE 'Asia/Ho_Chi_Minh')
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
