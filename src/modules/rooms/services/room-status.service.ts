import { Injectable, NotFoundException } from '@nestjs/common';
import { DataSource } from 'typeorm';
import { RealtimeStatusQueryDto } from '../dto/realtime-status-query.dto.js';

interface RoomStatusRow {
  room_id: string;
  room_code: string;
  room_name: string;
  current_status: string;
  occupancy_count: number | null;
  last_presence_at: Date | string | null;
  booking_id: string | null;
  meeting_id: string | null;
  title: string | null;
  host_name: string | null;
  reserved_start_time: Date | string | null;
  reserved_end_time: Date | string | null;
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
  noShowStatus: null;
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
  noShowCase: null;
  releaseHistory: never[];
  lastPresenceAt: Date | string | null;
  occupancyCount: number | null;
}

/**
 * RoomStatusService (RMS-001 / UC-36+38) — read-only realtime room status.
 *
 * SEC-03: raw SQL parameterized. DATA-01: loại room soft-deleted (deleted_at IS NULL).
 * Read-only: KHÔNG ghi DB, KHÔNG emit WS (writer #29). KHÔNG migration.
 * occupancyCount/lastPresenceAt từ room_events (NC-A/NC-C). No-show defer #31.
 */
@Injectable()
export class RoomStatusService {
  // LATERAL subquery dùng chung cho list + detail (anti-N+1).
  private static readonly LATERAL_JOINS = `
    LEFT JOIN LATERAL (
      SELECT occupancy_count FROM room_events
      WHERE room_id = r.id AND occupancy_count IS NOT NULL
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
    ) cb ON true`;

  private static readonly SELECT_COLS = `
    r.id AS room_id, r.room_code, r.room_name, r.current_status,
    oc.occupancy_count, lp.event_time AS last_presence_at,
    cb.booking_id, cb.meeting_id, cb.title, cb.host_name,
    cb.reserved_start_time, cb.reserved_end_time`;

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

  private toListItem(row: RoomStatusRow): RoomStatusListItem {
    return {
      roomId: row.room_id,
      roomCode: row.room_code,
      roomName: row.room_name,
      currentStatus: row.current_status,
      currentBooking: row.booking_id
        ? {
            meetingId: row.meeting_id,
            meetingTitle: row.title,
            hostName: row.host_name,
            reservedEndTime: row.reserved_end_time,
          }
        : null,
      occupancyCount: row.occupancy_count ?? null,
      noShowStatus: null,
      lastPresenceAt: row.last_presence_at ?? null,
    };
  }

  private toDetail(row: RoomStatusRow): RoomStatusDetail {
    return {
      roomId: row.room_id,
      roomCode: row.room_code,
      currentStatus: row.current_status,
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
      releaseHistory: [],
      lastPresenceAt: row.last_presence_at ?? null,
      occupancyCount: row.occupancy_count ?? null,
    };
  }
}
