import { Injectable, Logger } from '@nestjs/common';
import { DataSource } from 'typeorm';
import { ConfigService } from '@nestjs/config';

export interface ReportParams {
  from: string;
  to: string;
  scope: { roomId: string | null };
}

export interface ReportMetadata {
  organizationLabel: string;
  period: { from: string; to: string };
  extractedByEmail: string;
  generatedAt: Date;
}

export interface UtilizationSection {
  reservationUtilizationRate: number;
  roomOccupancyRate: number;
  bookedHours: number;
  actualHours: number;
  availableHours: number;
}

export interface NoShowSection {
  noShowCount: number;
  totalBookings: number;
  noShowRate: number;
}

export interface RoomUsageRow {
  roomCode: string;
  roomName: string;
  bookedHours: number;
  actualHours: number;
  roomOccupancyRate: number;
}

export interface ReleasedRoomRow {
  roomCode: string;
  roomName: string;
  eventType: string;
  eventTime: Date;
  actorUserId: string | null;
  oldStatus: string | null;
  newStatus: string | null;
}

export interface CsvRow {
  bookingId: string;
  roomCode: string;
  roomName: string;
  meetingId: string;
  reservedStartTime: Date;
  reservedEndTime: Date;
  actualStartTime: Date | null;
  actualEndTime: Date | null;
  usageStatus: string | null;
  isNoShow: boolean;
  isReleased: boolean;
  releaseType: string | null;
  releasedAt: Date | null;
}

/**
 * RoomUtilizationReportDataService — tổng hợp dữ liệu cho UC-RUM-16.
 *
 * Nguồn công thức (research.md §0.7, kế thừa từ UC-AA-08/UC-AA-09 đã ship):
 * - reservationUtilizationRate = bookedHours ÷ availableHours × 100
 * - roomOccupancyRate = actualHours ÷ bookedHours × 100
 * - noShowRate = noShowCount ÷ totalBookings × 100
 *
 * QUAN TRỌNG: room_bookings.status hợp lệ là ('approved','active','completed',
 * 'released') — đúng theo RoomBookingStatus enum thật (room-booking.entity.ts),
 * KHÔNG dùng ('confirmed','in_use') như file meeting-activity-report-data.service.ts
 * đang bị lỗi (đã tách task riêng để sửa, không sao chép lỗi đó vào đây).
 */
@Injectable()
export class RoomUtilizationReportDataService {
  private readonly logger = new Logger(RoomUtilizationReportDataService.name);
  private static readonly DEFAULT_OPERATING_HOURS = 8;

  constructor(
    private readonly dataSource: DataSource,
    private readonly configService: ConfigService,
  ) {}

  // ─── Empty-data check (FR-017) ─────────────────────────────────────────────

  async hasAnyBookingInScope(params: ReportParams): Promise<boolean> {
    const { clause, values } = this.buildRoomScopeClause(params, 'rb', 3);
    const rows: { exists: boolean }[] = await this.dataSource.query(
      `SELECT EXISTS (
          SELECT 1 FROM room_bookings rb
          WHERE rb.status IN ('approved','active','completed','released')
            AND rb.reserved_start_time < $1::date + interval '1 day'
            AND rb.reserved_end_time > $2::date
            ${clause}
        ) AS exists`,
      [params.to, params.from, ...values],
    );
    return rows[0]?.exists ?? false;
  }

  // ─── Phần 0: Metadata ───────────────────────────────────────────────────────

  async getReportMetadata(
    params: ReportParams,
    requestedByEmail: string,
  ): Promise<ReportMetadata> {
    let organizationLabel = 'Toàn công ty';
    if (params.scope.roomId) {
      const rows: { room_name: string }[] = await this.dataSource.query(
        `SELECT room_name FROM rooms WHERE id = $1 LIMIT 1`,
        [params.scope.roomId],
      );
      if (rows.length > 0) organizationLabel = rows[0].room_name;
    }
    return {
      organizationLabel,
      period: { from: params.from, to: params.to },
      extractedByEmail: requestedByEmail,
      generatedAt: new Date(),
    };
  }

  // ─── Phần 1: Utilization Rate ───────────────────────────────────────────────

  async getUtilizationSection(
    params: ReportParams,
  ): Promise<UtilizationSection> {
    const operatingHours = await this.getOperatingHoursPerDay();
    const numberOfDays =
      Math.round(
        (new Date(params.to).getTime() - new Date(params.from).getTime()) /
          86400000,
      ) + 1;

    const roomCountRows: { count: string }[] = await this.dataSource.query(
      `SELECT COUNT(DISTINCT r.id)::text AS count
         FROM rooms r
        WHERE r.is_active = true
          ${params.scope.roomId ? 'AND r.id = $1' : ''}`,
      params.scope.roomId ? [params.scope.roomId] : [],
    );
    const activeRoomCount = parseInt(roomCountRows[0]?.count ?? '0', 10);
    const availableHours = operatingHours * numberOfDays * activeRoomCount;

    const { clause, values } = this.buildRoomScopeClause(params, 'rb', 3);
    const bookedRows: { hours: string }[] = await this.dataSource.query(
      `SELECT COALESCE(SUM(EXTRACT(EPOCH FROM (rb.reserved_end_time - rb.reserved_start_time)) / 3600), 0)::text AS hours
         FROM room_bookings rb
        WHERE rb.status IN ('approved','active','completed','released')
          AND rb.reserved_start_time < $1::date + interval '1 day'
          AND rb.reserved_end_time > $2::date
          ${clause}`,
      [params.to, params.from, ...values],
    );
    const bookedHours = parseFloat(bookedRows[0]?.hours ?? '0');

    const actualRows: { hours: string }[] = await this.dataSource.query(
      `SELECT COALESCE(SUM(
            CASE
              WHEN rbu.actual_start_time IS NOT NULL AND rbu.actual_end_time IS NOT NULL
                THEN EXTRACT(EPOCH FROM (rbu.actual_end_time - rbu.actual_start_time)) / 3600
              WHEN rbu.first_presence_at IS NOT NULL AND rbu.last_presence_at IS NOT NULL
                THEN EXTRACT(EPOCH FROM (rbu.last_presence_at - rbu.first_presence_at)) / 3600
              ELSE 0
            END
          ), 0)::text AS hours
         FROM room_booking_usages rbu
         JOIN room_bookings rb ON rb.id = rbu.booking_id
        WHERE rb.status IN ('approved','active','completed','released')
          AND rb.reserved_start_time < $1::date + interval '1 day'
          AND rb.reserved_end_time > $2::date
          ${clause}`,
      [params.to, params.from, ...values],
    );
    const actualHours = parseFloat(actualRows[0]?.hours ?? '0');

    return {
      reservationUtilizationRate: this.pctOf(bookedHours, availableHours),
      roomOccupancyRate: this.pctOf(actualHours, bookedHours),
      bookedHours: this.round1(bookedHours),
      actualHours: this.round1(actualHours),
      availableHours: this.round1(availableHours),
    };
  }

  // ─── Phần 2: No-show Rate ───────────────────────────────────────────────────

  async getNoShowSection(params: ReportParams): Promise<NoShowSection> {
    const { clause, values } = this.buildRoomScopeClause(params, 'rb', 3);

    const totalRows: { count: string }[] = await this.dataSource.query(
      `SELECT COUNT(rb.id)::text AS count
         FROM room_bookings rb
        WHERE rb.status IN ('approved','active','completed','released')
          AND rb.reserved_start_time < $1::date + interval '1 day'
          AND rb.reserved_start_time >= $2::date
          ${clause}`,
      [params.to, params.from, ...values],
    );
    const totalBookings = parseInt(totalRows[0]?.count ?? '0', 10);

    const noShowRows: { count: string }[] = await this.dataSource.query(
      `SELECT COUNT(DISTINCT rb.id)::text AS count
         FROM room_bookings rb
         JOIN no_show_cases nsc ON nsc.booking_id = rb.id
        WHERE nsc.detection_status IN ('confirmed','released')
          AND rb.reserved_start_time < $1::date + interval '1 day'
          AND rb.reserved_start_time >= $2::date
          ${clause}`,
      [params.to, params.from, ...values],
    );
    const noShowCount = parseInt(noShowRows[0]?.count ?? '0', 10);

    return {
      noShowCount,
      totalBookings,
      noShowRate: this.pctOf(noShowCount, totalBookings),
    };
  }

  // ─── Phần 3: Actual Usage theo phòng ─────────────────────────────────────────

  async getActualUsageByRoom(params: ReportParams): Promise<RoomUsageRow[]> {
    const { clause, values } = this.buildRoomScopeClause(params, 'rb', 3);

    const rows: {
      room_code: string;
      room_name: string;
      booked_hours: string;
      actual_hours: string;
    }[] = await this.dataSource.query(
      `SELECT
            r.room_code,
            r.room_name,
            COALESCE(SUM(EXTRACT(EPOCH FROM (rb.reserved_end_time - rb.reserved_start_time)) / 3600), 0)::text AS booked_hours,
            COALESCE(SUM(
              CASE
                WHEN rbu.actual_start_time IS NOT NULL AND rbu.actual_end_time IS NOT NULL
                  THEN EXTRACT(EPOCH FROM (rbu.actual_end_time - rbu.actual_start_time)) / 3600
                WHEN rbu.first_presence_at IS NOT NULL AND rbu.last_presence_at IS NOT NULL
                  THEN EXTRACT(EPOCH FROM (rbu.last_presence_at - rbu.first_presence_at)) / 3600
                ELSE 0
              END
            ), 0)::text AS actual_hours
         FROM room_bookings rb
         JOIN rooms r ON r.id = rb.room_id
         LEFT JOIN room_booking_usages rbu ON rbu.booking_id = rb.id
        WHERE rb.status IN ('approved','active','completed','released')
          AND rb.reserved_start_time < $1::date + interval '1 day'
          AND rb.reserved_end_time > $2::date
          ${clause}
        GROUP BY r.id, r.room_code, r.room_name
        ORDER BY r.room_name ASC`,
      [params.to, params.from, ...values],
    );

    return rows.map((row) => {
      const bookedHours = parseFloat(row.booked_hours);
      const actualHours = parseFloat(row.actual_hours);
      return {
        roomCode: row.room_code,
        roomName: row.room_name,
        bookedHours: this.round1(bookedHours),
        actualHours: this.round1(actualHours),
        roomOccupancyRate: this.pctOf(actualHours, bookedHours),
      };
    });
  }

  // ─── Phần 4: Released Rooms ──────────────────────────────────────────────────

  async getReleasedRooms(params: ReportParams): Promise<ReleasedRoomRow[]> {
    const values: unknown[] = [
      params.to,
      params.from,
      ['room_auto_released', 'room_manual_released'],
    ];
    let roomClause = '';
    if (params.scope.roomId) {
      roomClause = `AND re.room_id = $4`;
      values.push(params.scope.roomId);
    }

    const rows: {
      room_code: string;
      room_name: string;
      event_type: string;
      event_time: Date;
      actor_user_id: string | null;
      old_status: string | null;
      new_status: string | null;
    }[] = await this.dataSource.query(
      `SELECT r.room_code, r.room_name, re.event_type, re.event_time,
              re.actor_user_id, re.old_status, re.new_status
         FROM room_events re
         JOIN rooms r ON r.id = re.room_id
        WHERE re.event_type = ANY($3::varchar[])
          AND re.event_time < $1::date + interval '1 day'
          AND re.event_time >= $2::date
          ${roomClause}
        ORDER BY re.event_time DESC`,
      values,
    );

    return rows.map((row) => ({
      roomCode: row.room_code,
      roomName: row.room_name,
      eventType: row.event_type,
      eventTime: row.event_time,
      actorUserId: row.actor_user_id,
      oldStatus: row.old_status,
      newStatus: row.new_status,
    }));
  }

  // ─── CSV: dữ liệu chi tiết từng dòng (§0.3) ──────────────────────────────────

  async getCsvRows(params: ReportParams): Promise<CsvRow[]> {
    const { clause, values } = this.buildRoomScopeClause(params, 'rb', 3);

    const rows: {
      booking_id: string;
      room_code: string;
      room_name: string;
      meeting_id: string;
      reserved_start_time: Date;
      reserved_end_time: Date;
      actual_start_time: Date | null;
      actual_end_time: Date | null;
      usage_status: string | null;
      is_no_show: boolean;
      is_released: boolean;
      release_type: string | null;
      released_at: Date | null;
    }[] = await this.dataSource.query(
      `SELECT
            rb.id AS booking_id, r.room_code, r.room_name, rb.meeting_id,
            rb.reserved_start_time, rb.reserved_end_time,
            rbu.actual_start_time, rbu.actual_end_time, rbu.usage_status,
            (nsc.id IS NOT NULL) AS is_no_show,
            (re.id IS NOT NULL) AS is_released,
            re.event_type AS release_type,
            re.event_time AS released_at
         FROM room_bookings rb
         JOIN rooms r ON r.id = rb.room_id
         LEFT JOIN room_booking_usages rbu ON rbu.booking_id = rb.id
         LEFT JOIN no_show_cases nsc
           ON nsc.booking_id = rb.id AND nsc.detection_status IN ('confirmed','released')
         LEFT JOIN LATERAL (
           SELECT id, event_type, event_time
             FROM room_events
            WHERE booking_id = rb.id
              AND event_type = ANY(ARRAY['room_auto_released','room_manual_released'])
            ORDER BY event_time DESC
            LIMIT 1
         ) re ON true
        WHERE rb.status IN ('approved','active','completed','released')
          AND rb.reserved_start_time < $1::date + interval '1 day'
          AND rb.reserved_end_time > $2::date
          ${clause}
        ORDER BY rb.reserved_start_time ASC`,
      [params.to, params.from, ...values],
    );

    return rows.map((row) => ({
      bookingId: row.booking_id,
      roomCode: row.room_code,
      roomName: row.room_name,
      meetingId: row.meeting_id,
      reservedStartTime: row.reserved_start_time,
      reservedEndTime: row.reserved_end_time,
      actualStartTime: row.actual_start_time,
      actualEndTime: row.actual_end_time,
      usageStatus: row.usage_status,
      isNoShow: row.is_no_show,
      isReleased: row.is_released,
      releaseType: row.release_type,
      releasedAt: row.released_at,
    }));
  }

  // ─── Helpers ──────────────────────────────────────────────────────────────

  private buildRoomScopeClause(
    params: ReportParams,
    alias: string,
    startIdx: number,
  ): { clause: string; values: unknown[] } {
    if (!params.scope.roomId) return { clause: '', values: [] };
    return {
      clause: `AND ${alias}.room_id = $${startIdx}`,
      values: [params.scope.roomId],
    };
  }

  private pctOf(numerator: number, denominator: number): number {
    if (!denominator || denominator <= 0) return 0;
    return this.round1((numerator / denominator) * 100);
  }

  private round1(n: number): number {
    return Math.round(n * 10) / 10;
  }

  private async getOperatingHoursPerDay(): Promise<number> {
    try {
      const rows: { config_value: string }[] = await this.dataSource.query(
        `SELECT config_value FROM system_configs WHERE config_key = 'analytics.room_operating_hours_per_day' LIMIT 1`,
      );
      const raw = rows?.[0]?.config_value;
      if (raw != null) {
        const n = parseFloat(raw);
        if (isFinite(n) && n > 0) return n;
      }
    } catch (e) {
      this.logger.warn(
        `read analytics.room_operating_hours_per_day failed: ${e instanceof Error ? e.message : 'unknown'}`,
      );
    }
    return this.configService.get<number>(
      'ANALYTICS_ROOM_OPERATING_HOURS_PER_DAY',
      RoomUtilizationReportDataService.DEFAULT_OPERATING_HOURS,
    );
  }
}
