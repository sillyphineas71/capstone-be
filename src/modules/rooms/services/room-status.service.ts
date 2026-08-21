import { Injectable, NotFoundException } from '@nestjs/common';
import { DataSource } from 'typeorm';
import { RealtimeStatusQueryDto } from '../dto/realtime-status-query.dto.js';

interface RoomStatusRow {
  room_id: string;
  room_code: string;
  room_name: string;
  current_status: string;
  administrative_status: string;
  occupancy_count: number | null;
  last_presence_at: Date | string | null;
  booking_id: string | null;
  meeting_id: string | null;
  title: string | null;
  host_name: string | null;
  reserved_start_time: Date | string | null;
  reserved_end_time: Date | string | null;
  no_show_status: string | null;
  /** [Việc B, tái đánh giá 2026-08-21] Chỉ có giá trị khi no_show_status='snoozed'. */
  no_show_snooze_until: Date | string | null;
}

export interface RoomStatusListItem {
  roomId: string;
  roomCode: string;
  roomName: string;
  currentStatus: string;
  currentBooking: {
    meetingId: string | null;
    meetingTitle: string | null;
    hostName: string | null;
    reservedEndTime: Date | string | null;
  } | null;
  occupancyCount: number | null;
  /** detection_status của no_show_case mới nhất thuộc booking đang diễn ra; null nếu không có. */
  noShowStatus: string | null;
  /** [Việc B, tái đánh giá 2026-08-21] Mốc hết hạn gia hạn "Tôi vẫn đến" — chỉ có giá trị khi noShowStatus='snoozed'. */
  noShowSnoozeUntil: Date | string | null;
  lastPresenceAt: Date | string | null;
}

export interface RoomStatusDetail {
  roomId: string;
  roomCode: string;
  currentStatus: string;
  currentBooking: {
    bookingId: string | null;
    meetingId: string | null;
    title: string | null;
    hostName: string | null;
    reservedStartTime: Date | string | null;
    reservedEndTime: Date | string | null;
  } | null;
  /** Object case đầy đủ — vẫn defer #31. Trạng thái rút gọn xem `noShowStatus`. */
  noShowCase: null;
  /** detection_status của no_show_case mới nhất thuộc booking đang diễn ra; null nếu không có. */
  noShowStatus: string | null;
  /** [Việc B, tái đánh giá 2026-08-21] Mốc hết hạn gia hạn "Tôi vẫn đến" — chỉ có giá trị khi noShowStatus='snoozed'. */
  noShowSnoozeUntil: Date | string | null;
  releaseHistory: never[];
  lastPresenceAt: Date | string | null;
  occupancyCount: number | null;
}

/**
 * RoomStatusService (RMS-001 / UC-36+38) — read-only realtime room status.
 *
 * SEC-03: raw SQL parameterized. DATA-01: loại room soft-deleted (deleted_at IS NULL).
 * Read-only: KHÔNG ghi DB, KHÔNG emit WS (writer #29). KHÔNG migration.
 * occupancyCount/lastPresenceAt từ room_events (NC-A/NC-C).
 * noShowStatus: detection_status của no_show_case MỚI NHẤT thuộc booking đang diễn ra
 * (LATERAL `nsc` join theo `cb.booking_id` — phải khai SAU `cb`). Phòng không có booking
 * đang chạy → cb.booking_id NULL → nsc rỗng → noShowStatus null. Object case đầy đủ
 * (`noShowCase`) vẫn defer #31.
 */
@Injectable()
export class RoomStatusService {
  /**
   * [FIX 2026-08-20] Dong bo voi RoomSearchService — tin hieu occupancy chi
   * "con hieu luc" trong vong OCCUPANCY_SIGNAL_TTL_MINUTES phut ke tu
   * event_time, tranh phong bi ket dinh 'occupied' vinh vien khi camera
   * ngung gui event sau 1 lan bao occupancy_count > 0 (xac nhan tren RDS:
   * co phong con occupancy_count > 0 tu event cach day hon 700 gio).
   */
  private static readonly OCCUPANCY_SIGNAL_TTL_MINUTES = 15;

  // LATERAL subquery dùng chung cho list + detail (anti-N+1).
  private static readonly LATERAL_JOINS = `
    LEFT JOIN LATERAL (
      SELECT occupancy_count FROM room_events
      WHERE room_id = r.id AND occupancy_count IS NOT NULL
        AND event_time >= now() - interval '${RoomStatusService.OCCUPANCY_SIGNAL_TTL_MINUTES} minutes'
      ORDER BY event_time DESC LIMIT 1
    ) oc ON true
    LEFT JOIN LATERAL (
      SELECT event_time FROM room_events
      WHERE room_id = r.id AND occupancy_count > 0
      ORDER BY event_time DESC LIMIT 1
    ) lp ON true
    LEFT JOIN LATERAL (
      SELECT b.id AS booking_id, b.meeting_id, m.title,
             u.full_name AS host_name, b.reserved_start_time, b.reserved_end_time
      FROM room_bookings b
      JOIN meetings m ON m.id = b.meeting_id
      LEFT JOIN users u ON u.id = COALESCE(m.host_id, m.organizer_id)
      WHERE b.room_id = r.id
        AND b.reserved_start_time <= now() AND b.reserved_end_time >= now()
        AND b.status IN ('approved','active')
      ORDER BY b.reserved_start_time ASC LIMIT 1
    ) cb ON true
    LEFT JOIN LATERAL (
      SELECT ns.detection_status, ns.snooze_until
      FROM no_show_cases ns
      WHERE ns.booking_id = cb.booking_id
      ORDER BY ns.detected_at DESC LIMIT 1
    ) nsc ON true`;

  private static readonly SELECT_COLS = `
    r.id AS room_id, r.room_code, r.room_name, r.current_status,
    r.administrative_status,
    oc.occupancy_count, lp.event_time AS last_presence_at,
    cb.booking_id, cb.meeting_id, cb.title, cb.host_name,
    cb.reserved_start_time, cb.reserved_end_time,
    nsc.detection_status AS no_show_status, nsc.snooze_until AS no_show_snooze_until`;

  constructor(private readonly dataSource: DataSource) {}

  /** UC-36: danh sách trạng thái phòng (lọc site/area, loại deleted). */
  async getRealtimeStatus(
    query: RealtimeStatusQueryDto,
  ): Promise<RoomStatusListItem[]> {
    const siteName = query.siteName ?? null;
    const areaName = query.areaName ?? null;

    const rows: RoomStatusRow[] = await this.dataSource.manager.query(
      `SELECT ${RoomStatusService.SELECT_COLS}
       FROM rooms r
       ${RoomStatusService.LATERAL_JOINS}
       WHERE r.deleted_at IS NULL
         AND ($1::text IS NULL OR r.site_name = $1)
         AND ($2::text IS NULL OR r.area_name = $2)
       ORDER BY r.room_code`,
      [siteName, areaName],
    );

    return rows.map((row) => this.toListItem(row));
  }

  /** UC-38: chi tiết trạng thái 1 phòng. */
  async getRoomStatus(roomId: string): Promise<RoomStatusDetail> {
    const rows: RoomStatusRow[] = await this.dataSource.manager.query(
      `SELECT ${RoomStatusService.SELECT_COLS}
       FROM rooms r
       ${RoomStatusService.LATERAL_JOINS}
       WHERE r.id = $1 AND r.deleted_at IS NULL
       LIMIT 1`,
      [roomId],
    );
    const row = rows?.[0];
    if (!row) {
      throw new NotFoundException({
        code: 'ROOM_NOT_FOUND',
        message: 'Room not found.',
      });
    }
    return this.toDetail(row);
  }

  /**
   * [FIX 2026-08-19] Tinh `currentStatus` HIEN THI real-time thay vi doc
   * thang `r.current_status` — cot do bi OccupancyPersistenceService flip
   * mot chieu sang 'occupied' va KHONG BAO GIO tu reset ve 'available', nen
   * doc truc tiep se "dung yen" nhu du lieu tinh/mock. Uu tien:
   * 1. administrative_status (admin dat qua PATCH .../administrative-status)
   *    neu la 'maintenance'/'inactive' — luon thang.
   * 2. 'occupied' neu tin hieu occupancy CON HIEU LUC (trong
   *    OCCUPANCY_SIGNAL_TTL_MINUTES phut gan nhat, xem LATERAL_JOINS/oc) > 0.
   * 3. 'reserved' neu co booking approved/active dang trong khung gio hien tai.
   * 4. 'available' con lai.
   */
  private computeCurrentStatus(row: RoomStatusRow): string {
    if (
      row.administrative_status === 'maintenance' ||
      row.administrative_status === 'inactive'
    ) {
      return row.administrative_status;
    }
    if ((row.occupancy_count ?? 0) > 0) return 'occupied';
    if (row.booking_id) return 'reserved';
    return 'available';
  }

  private toListItem(row: RoomStatusRow): RoomStatusListItem {
    return {
      roomId: row.room_id,
      roomCode: row.room_code,
      roomName: row.room_name,
      currentStatus: this.computeCurrentStatus(row),
      currentBooking: row.booking_id
        ? {
            meetingId: row.meeting_id,
            meetingTitle: row.title,
            hostName: row.host_name,
            reservedEndTime: row.reserved_end_time,
          }
        : null,
      occupancyCount: row.occupancy_count ?? null,
      noShowStatus: row.no_show_status ?? null,
      noShowSnoozeUntil: row.no_show_snooze_until ?? null,
      lastPresenceAt: row.last_presence_at ?? null,
    };
  }

  private toDetail(row: RoomStatusRow): RoomStatusDetail {
    return {
      roomId: row.room_id,
      roomCode: row.room_code,
      currentStatus: this.computeCurrentStatus(row),
      currentBooking: row.booking_id
        ? {
            bookingId: row.booking_id,
            meetingId: row.meeting_id,
            title: row.title,
            hostName: row.host_name,
            reservedStartTime: row.reserved_start_time,
            reservedEndTime: row.reserved_end_time,
          }
        : null,
      noShowCase: null,
      noShowStatus: row.no_show_status ?? null,
      noShowSnoozeUntil: row.no_show_snooze_until ?? null,
      releaseHistory: [],
      lastPresenceAt: row.last_presence_at ?? null,
      occupancyCount: row.occupancy_count ?? null,
    };
  }
}
