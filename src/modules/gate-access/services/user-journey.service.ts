import { Injectable } from '@nestjs/common';
import { DataSource } from 'typeorm';
import type {
  UserJourneyEventDto,
  UserJourneyResponseDto,
} from '../dto/user-journey-response.dto.js';

interface GateRow {
  access_time: Date | string;
  direction: string | null;
  plate_number: string | null;
  zone_name: string | null;
}

interface MeetingRow {
  event_time: Date | string;
  direction: string | null;
  room_name: string | null;
  meeting_id: string | null;
}

interface ZoneRow {
  event_time: Date | string;
  event_type: string | null;
  zone_name: string | null;
}

interface UserRow {
  full_name: string | null;
}

const FACE_EVENT_TYPE = 'ivss_face_event';
/**
 * Múi giờ nghiệp vụ. Trùng giá trị với hằng cùng tên trong
 * ivss-room-access-log.service.ts — bản đó là `const` private không export được,
 * nên khai lại tại đây thay vì sửa file module khác. Đổi thì phải đổi CẢ HAI.
 */
const BUSINESS_TIMEZONE = 'Asia/Ho_Chi_Minh';

/**
 * Biên ngày [00:00, 24:00) GIỜ VIỆT NAM cho cột `<col>`.
 *
 * ⚠ `::timestamp` BẮT BUỘC. Thiếu nó, Postgres ép `date` → `timestamptz` trước, khiến
 * `AT TIME ZONE` chạy CHIỀU NGƯỢC và trả `timestamp without time zone` ⇒ biên lệch +7h
 * SAI HƯỚNG (đã đo bằng psql khi làm ivss-room-access-log). RDS chạy UTC nên bắt buộc ép.
 */
const vnDayBounds = (col: string) => `
          AND ${col} >= ($2::date::timestamp AT TIME ZONE '${BUSINESS_TIMEZONE}')
          AND ${col} <  (($2::date + interval '1 day')::timestamp AT TIME ZONE '${BUSINESS_TIMEZONE}')`;

/**
 * UserJourneyService (UJN-001) — hành trình khuôn viên của 1 người trong 1 ngày.
 *
 * Ghép 3 KIỂU nguồn (KHÔNG phải 3 camera):
 *   1. `gate_access_logs`        — xe qua cổng (chỉ log CÓ user_id: hành trình theo NGƯỜI)
 *   2. `iot_device_events`       — check-in/out phòng họp qua face (ivss_face_event)
 *   3. `zone_presence_events`    — hiện diện khu vực, GOM MỌI ZONE của user
 *
 * ⭐ Nguồn 3 KHÔNG hard-code zone/cam: lọc theo `user_id`, lấy mọi `zone_id`. Lắp thêm
 * camera zone mới ⇒ chỉ khác `zone_id`, cùng bảng ⇒ endpoint TỰ có, không phải sửa code.
 *
 * 100% READ-ONLY: chỉ SELECT, không đụng webhook/ingest/writeGateLog/writeAppearEvent.
 * SEC-03: bind $1/$2 (tên timezone là hằng nội bộ, không phải input người dùng).
 */
@Injectable()
export class UserJourneyService {
  constructor(private readonly dataSource: DataSource) {}

  /** YYYY-MM-DD hôm nay THEO GIỜ VN — không phụ thuộc timezone tiến trình (EC2 chạy UTC). */
  private todayStr(): string {
    return new Intl.DateTimeFormat('en-CA', {
      timeZone: BUSINESS_TIMEZONE,
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
    }).format(new Date());
  }

  private toIso(v: Date | string): string {
    return new Date(v).toISOString();
  }

  async getUserJourney(
    userId: string,
    date?: string,
  ): Promise<UserJourneyResponseDto> {
    const day = date ?? this.todayStr();
    const params = [userId, day];

    // ── Tên người (1 query, không chặn nếu user đã xoá mềm) ──
    const users: UserRow[] = await this.dataSource.manager.query(
      `SELECT full_name FROM users WHERE id = $1 LIMIT 1`,
      [userId],
    );

    // ── Nguồn 1: xe qua cổng ──
    const gateRows: GateRow[] = await this.dataSource.manager.query(
      `SELECT g.access_time, g.direction, g.plate_number, z.zone_name
         FROM gate_access_logs g
         LEFT JOIN zones z ON z.id = g.zone_id AND z.deleted_at IS NULL
        WHERE g.user_id = $1${vnDayBounds('g.access_time')}
        ORDER BY g.access_time ASC`,
      params,
    );

    // ── Nguồn 2: check-in/out phòng họp qua face ──
    // room_name lấy qua e.room_id, fallback payload_json->>'roomId' (UC5 ghi top-level).
    const meetingRows: MeetingRow[] = await this.dataSource.manager.query(
      `SELECT e.event_time,
              e.payload_json->>'direction' AS direction,
              r.room_name,
              COALESCE(e.meeting_id::text, e.payload_json->>'meetingId') AS meeting_id
         FROM iot_device_events e
         LEFT JOIN rooms r
                ON r.id = COALESCE(e.room_id, NULLIF(e.payload_json->>'roomId','')::uuid)
               AND r.deleted_at IS NULL
        WHERE e.event_type = $3
          AND e.payload_json->>'userId' = $1${vnDayBounds('e.event_time')}
        ORDER BY e.event_time ASC`,
      [...params, FACE_EVENT_TYPE],
    );

    // ── Nguồn 3: hiện diện khu vực — MỌI zone của user (không lọc zone cụ thể) ──
    const zoneRows: ZoneRow[] = await this.dataSource.manager.query(
      `SELECT p.event_time, p.event_type, z.zone_name
         FROM zone_presence_events p
         LEFT JOIN zones z ON z.id = p.zone_id AND z.deleted_at IS NULL
        WHERE p.user_id = $1${vnDayBounds('p.event_time')}
        ORDER BY p.event_time ASC`,
      params,
    );

    const gateEvents: UserJourneyEventDto[] = gateRows.map((r) => {
      const plate = r.plate_number ?? 'không rõ biển';
      const zone = r.zone_name ?? 'cổng không rõ';
      const verb = r.direction === 'leave' ? 'rời' : 'vào';
      return {
        time: this.toIso(r.access_time),
        type: 'gate',
        direction: r.direction ?? null,
        detail: `Xe ${plate} ${verb} ${zone}`,
        zoneName: r.zone_name ?? null,
        plateNumber: r.plate_number ?? null,
        roomName: null,
        meetingId: null,
      };
    });

    const meetingEvents: UserJourneyEventDto[] = meetingRows.map((r) => {
      const room = r.room_name ?? 'phòng không rõ';
      const verb = r.direction === 'leave' ? 'rời khỏi' : 'vào';
      return {
        time: this.toIso(r.event_time),
        type: 'meeting',
        direction: r.direction ?? null,
        detail: `Nhận diện khuôn mặt: ${verb} ${room}`,
        zoneName: null,
        plateNumber: null,
        roomName: r.room_name ?? null,
        meetingId: r.meeting_id ?? null,
      };
    });

    const zoneEvents: UserJourneyEventDto[] = zoneRows.map((r) => {
      const zone = r.zone_name ?? 'khu vực không rõ';
      const verb = r.event_type === 'disappear' ? 'rời' : 'xuất hiện tại';
      return {
        time: this.toIso(r.event_time),
        type: 'zone',
        direction: r.event_type ?? null,
        detail: `Camera khu vực: ${verb} ${zone}`,
        zoneName: r.zone_name ?? null,
        plateNumber: null,
        roomName: null,
        meetingId: null,
      };
    });

    // Gộp 3 nguồn → sort THEO THỜI GIAN TĂNG DẦN (so chuỗi ISO UTC là đủ, cùng định dạng).
    const events = [...gateEvents, ...meetingEvents, ...zoneEvents].sort(
      (a, b) => (a.time < b.time ? -1 : a.time > b.time ? 1 : 0),
    );

    return {
      userId,
      fullName: users[0]?.full_name ?? null,
      date: day,
      events,
      gateCount: gateEvents.length,
      meetingCount: meetingEvents.length,
      zoneCount: zoneEvents.length,
    };
  }
}
