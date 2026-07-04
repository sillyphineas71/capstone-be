import { Injectable, Logger } from '@nestjs/common';
import { DataSource } from 'typeorm';
import { ConfigService } from '@nestjs/config';

export interface ReportParams {
  from: string;
  to: string;
  scope: {
    departmentId: string | null;
    roomId: string | null;
    organizerId: string | null;
  };
}

export interface ReportMetadata {
  organizationLabel: string;
  period: { from: string; to: string };
  extractedByEmail: string;
  generatedAt: Date;
}

export interface CoreKpis {
  meetingCount: number;
  reservationUtilizationRate: number;
  noShowRate: number;
  onTimeRate: number;
}

export interface StatusBreakdownItem {
  status: string;
  count: number;
  percentage: number;
}

export interface MeetingDetailItem {
  meetingCode: string | null;
  title: string;
  organizerEmail: string | null;
  roomName: string | null;
  startTime: Date | null;
  endTime: Date | null;
  status: string;
  participationRate: number;
}

/**
 * MeetingActivityReportDataService — tổng hợp dữ liệu 4 phần cho báo cáo hoạt động cuộc họp.
 *
 * Luồng được worker gọi:
 *   Phần 1: getReportMetadata (T022)
 *   Phần 2: getCoreKpis (T023) — quan trọng nhất
 *   Phần 3: getStatusBreakdown (T024)
 *   Phần 4: getMeetingDetailList (T025)
 *
 * ARCH: Tự viết lại SQL query (không import analytics repositories)
 * vì analytics module có thể chưa export các repositories cần thiết.
 * Khi analytics module hoàn thiện, có thể refactor để tái dùng trực tiếp.
 *
 * Ghi chú nguồn công thức:
 * - meetingCount: UC-AA-01 FR-026
 * - reservationUtilizationRate: UC-AA-08
 * - noShowRate: UC-AA-09
 * - onTimeRate: UC-AA-10 (scope theo organizer, KHÔNG phải attendee — §0.3 spec)
 */
@Injectable()
export class MeetingActivityReportDataService {
  private readonly logger = new Logger(MeetingActivityReportDataService.name);
  private static readonly DEFAULT_OPERATING_HOURS = 8;

  constructor(
    private readonly dataSource: DataSource,
    private readonly configService: ConfigService,
  ) {}

  // ─── Phần 1: Metadata ───────────────────────────────────────────────────────

  /**
   * T022 [FR-023]: Phần 1 — Metadata báo cáo.
   */
  async getReportMetadata(
    params: ReportParams,
    requestedByEmail: string,
  ): Promise<ReportMetadata> {
    let organizationLabel = 'Toàn tổ chức';

    if (params.scope.departmentId) {
      const rows: { department_name: string }[] = await this.dataSource.query(
        `SELECT department_name FROM departments WHERE id = $1 LIMIT 1`,
        [params.scope.departmentId],
      );
      if (rows.length > 0) {
        organizationLabel = rows[0].department_name;
      }
    }

    return {
      organizationLabel,
      period: { from: params.from, to: params.to },
      extractedByEmail: requestedByEmail,
      generatedAt: new Date(),
    };
  }

  // ─── Phần 2: Core KPIs ──────────────────────────────────────────────────────

  /**
   * T023 [FR-024]: Phần 2 — 4 KPI cốt lõi.
   * Nguồn công thức: UC-AA-01, UC-AA-08, UC-AA-09, UC-AA-10.
   */
  async getCoreKpis(params: ReportParams): Promise<CoreKpis> {
    const [meetingCount, reservationUtilizationRate, noShowRate, onTimeRate] =
      await Promise.all([
        this.getMeetingCount(params),
        this.getReservationUtilizationRate(params),
        this.getNoShowRate(params),
        this.getOnTimeRate(params),
      ]);

    return {
      meetingCount,
      reservationUtilizationRate,
      noShowRate,
      onTimeRate,
    };
  }

  /**
   * meetingCount — UC-AA-01 FR-026.
   * COUNT meetings WHERE status <> 'draft', trong scope + kỳ.
   * Scope: theo organizer (người tổ chức thuộc phòng ban trong scope).
   */
  private async getMeetingCount(params: ReportParams): Promise<number> {
    const { conditions, bindValues } = this.buildOrganizerScopeConditions(params);

    const rows: { count: string }[] = await this.dataSource.query(
      `SELECT COUNT(m.id)::text AS count
         FROM meetings m
        WHERE m.status <> 'draft'
          AND m.start_time >= $1::date
          AND m.start_time < ($2::date + interval '1 day')
          ${conditions}`,
      [params.from, params.to, ...bindValues],
    );
    return parseInt(rows[0]?.count ?? '0', 10);
  }

  /**
   * reservationUtilizationRate — UC-AA-08.
   * Công thức: bookedHours(room_bookings hợp lệ) ÷ (operatingHoursPerDay × numberOfDays × activeRoomCount)
   */
  private async getReservationUtilizationRate(
    params: ReportParams,
  ): Promise<number> {
    // Số giờ vận hành mỗi ngày — đọc từ system_configs
    const operatingHours = await this.getOperatingHoursPerDay();

    // Số ngày trong kỳ (tính cả hai đầu)
    const fromDate = new Date(params.from);
    const toDate = new Date(params.to);
    const numberOfDays =
      Math.round(
        (toDate.getTime() - fromDate.getTime()) / 86400000,
      ) + 1;

    // Số phòng active trong scope + kỳ
    const roomCountRows: { count: string }[] = await this.dataSource.query(
      `SELECT COUNT(DISTINCT r.id)::text AS count
         FROM rooms r
        WHERE r.is_active = true
          ${params.scope.roomId ? 'AND r.id = $1' : ''}`,
      params.scope.roomId ? [params.scope.roomId] : [],
    );
    const activeRoomCount = parseInt(roomCountRows[0]?.count ?? '0', 10);
    if (activeRoomCount === 0) return 0;

    const totalCapacityHours = operatingHours * numberOfDays * activeRoomCount;
    if (totalCapacityHours === 0) return 0;

    // Tổng giờ đã đặt (room_bookings hợp lệ: status IN (confirmed, in_use, completed))
    const { conditions: scopeConds, bindValues: scopeVals } =
      this.buildOrganizerScopeConditions(params);
    const fixedParamsCount = 2 + (params.scope.roomId ? 1 : 0);
    const queryParams = [
      params.from,
      params.to,
      ...(params.scope.roomId ? [params.scope.roomId] : []),
      ...scopeVals,
    ];

    const bookedRows: { hours: string }[] = await this.dataSource.query(
      `SELECT COALESCE(
            SUM(
              EXTRACT(EPOCH FROM (rb.reserved_end_time - rb.reserved_start_time)) / 3600
            ), 0
          )::text AS hours
         FROM room_bookings rb
         JOIN meetings m ON m.id = rb.meeting_id
        WHERE rb.status IN ('confirmed', 'in_use', 'completed')
          AND rb.reserved_start_time >= $1::date
          AND rb.reserved_start_time < ($2::date + interval '1 day')
          ${params.scope.roomId ? `AND rb.room_id = $3` : ''}
          ${scopeConds.replace(/\$(\d+)/g, (_, n) => `$${parseInt(n, 10) - 2 + fixedParamsCount}`)}`,
      queryParams,
    );

    const bookedHours = parseFloat(bookedRows[0]?.hours ?? '0');
    const rate = bookedHours / totalCapacityHours;
    return Math.round(rate * 10000) / 100; // Trả về % (2 chữ số thập phân)
  }

  /**
   * noShowRate — UC-AA-09.
   * Công thức: noShowCount(no_show_cases.detection_status IN ('confirmed','released')) ÷ totalBookings
   * Scope theo reserved_start_time.
   */
  private async getNoShowRate(params: ReportParams): Promise<number> {
    const { conditions, bindValues } = this.buildOrganizerScopeConditions(params);

    // Total valid bookings
    const totalRows: { count: string }[] = await this.dataSource.query(
      `SELECT COUNT(rb.id)::text AS count
         FROM room_bookings rb
         JOIN meetings m ON m.id = rb.meeting_id
        WHERE rb.status IN ('confirmed', 'in_use', 'completed', 'cancelled')
          AND rb.reserved_start_time >= $1::date
          AND rb.reserved_start_time < ($2::date + interval '1 day')
          ${conditions}`,
      [params.from, params.to, ...bindValues],
    );
    const totalBookings = parseInt(totalRows[0]?.count ?? '0', 10);
    if (totalBookings === 0) return 0;

    // No-show count (no_show_cases detection_status IN 'confirmed','released')
    const noShowRows: { count: string }[] = await this.dataSource.query(
      `SELECT COUNT(DISTINCT rb.id)::text AS count
         FROM room_bookings rb
         JOIN meetings m ON m.id = rb.meeting_id
         JOIN no_show_cases nsc ON nsc.booking_id = rb.id
        WHERE nsc.detection_status IN ('confirmed', 'released')
          AND rb.reserved_start_time >= $1::date
          AND rb.reserved_start_time < ($2::date + interval '1 day')
          ${conditions}`,
      [params.from, params.to, ...bindValues],
    );
    const noShowCount = parseInt(noShowRows[0]?.count ?? '0', 10);
    return Math.round((noShowCount / totalBookings) * 10000) / 100;
  }

  /**
   * onTimeRate — UC-AA-10 NHƯNG scope theo ORGANIZER (§0.3 spec).
   * Công thức: onTimeCount ÷ totalRequiredParticipants (gồm absent), chỉ meetings.status='completed'.
   *
   * ⚠️ RỦI RO CAO: dùng scope organizer, KHÔNG phải scope attendee như UC-AA-10 gốc.
   */
  private async getOnTimeRate(params: ReportParams): Promise<number> {
    const { conditions, bindValues } = this.buildOrganizerScopeConditions(params);

    // totalRequiredParticipants = tất cả meeting_participants của completed meetings trong scope (không declined)
    const totalRows: { count: string }[] = await this.dataSource.query(
      `SELECT COUNT(mp.id)::text AS count
         FROM meetings m
         JOIN meeting_participants mp ON mp.meeting_id = m.id
        WHERE m.status = 'completed'
          AND mp.invitation_status <> 'declined'
          AND m.start_time >= $1::date
          AND m.start_time < ($2::date + interval '1 day')
          ${conditions}`,
      [params.from, params.to, ...bindValues],
    );
    const totalRequired = parseInt(totalRows[0]?.count ?? '0', 10);
    if (totalRequired === 0) return 0;

    // onTimeCount = attendance_records với status IN ('present','late') — dùng scope organizer
    // late vẫn tính là "đến" nhưng không tính là "on-time" trong UC-AA-10 gốc.
    // Theo spec §0.3: onTimeRate = onTimeCount / totalRequired, gồm cả absent.
    // "on-time" = check_in_time <= scheduled_start + grace (không có grace ở đây → check_in_time <= start_time).
    const onTimeRows: { count: string }[] = await this.dataSource.query(
      `SELECT COUNT(ar.id)::text AS count
         FROM meetings m
         JOIN meeting_participants mp ON mp.meeting_id = m.id
         JOIN attendance_records ar
           ON ar.meeting_id = m.id
          AND ar.user_id = mp.user_id
          AND ar.check_in_time <= m.start_time
        WHERE m.status = 'completed'
          AND mp.invitation_status <> 'declined'
          AND m.start_time >= $1::date
          AND m.start_time < ($2::date + interval '1 day')
          ${conditions}`,
      [params.from, params.to, ...bindValues],
    );
    const onTimeCount = parseInt(onTimeRows[0]?.count ?? '0', 10);
    return Math.round((onTimeCount / totalRequired) * 10000) / 100;
  }

  // ─── Phần 3: Status Breakdown ────────────────────────────────────────────────

  /**
   * T024 [FR-025]: Phần 3 — Phân loại trạng thái cuộc họp.
   * Thứ tự ưu tiên UC-AA-05:
   *   Cancelled → No-show (có no_show_cases confirmed/released) → Completed → Scheduled
   * Loại: draft, pending_approval, in_progress.
   */
  async getStatusBreakdown(
    params: ReportParams,
  ): Promise<StatusBreakdownItem[]> {
    const { conditions, bindValues } = this.buildOrganizerScopeConditions(params);

    // Cancelled
    const cancelledRows: { count: string }[] = await this.dataSource.query(
      `SELECT COUNT(m.id)::text AS count
         FROM meetings m
        WHERE m.status = 'cancelled'
          AND m.start_time >= $1::date
          AND m.start_time < ($2::date + interval '1 day')
          ${conditions}`,
      [params.from, params.to, ...bindValues],
    );
    const cancelledCount = parseInt(cancelledRows[0]?.count ?? '0', 10);

    // No-show: status NOT 'cancelled', có no_show_cases confirmed/released
    const noShowRows: { count: string }[] = await this.dataSource.query(
      `SELECT COUNT(DISTINCT m.id)::text AS count
         FROM meetings m
         JOIN room_bookings rb ON rb.meeting_id = m.id
         JOIN no_show_cases nsc ON nsc.booking_id = rb.id
        WHERE m.status <> 'cancelled'
          AND m.status NOT IN ('draft','pending_approval','in_progress')
          AND nsc.detection_status IN ('confirmed','released')
          AND m.start_time >= $1::date
          AND m.start_time < ($2::date + interval '1 day')
          ${conditions}`,
      [params.from, params.to, ...bindValues],
    );
    const noShowCount = parseInt(noShowRows[0]?.count ?? '0', 10);

    // Completed: status='completed', không có no-show
    const completedRows: { count: string }[] = await this.dataSource.query(
      `SELECT COUNT(DISTINCT m.id)::text AS count
         FROM meetings m
        WHERE m.status = 'completed'
          AND m.start_time >= $1::date
          AND m.start_time < ($2::date + interval '1 day')
          AND NOT EXISTS (
            SELECT 1 FROM room_bookings rb
            JOIN no_show_cases nsc ON nsc.booking_id = rb.id
            WHERE rb.meeting_id = m.id
              AND nsc.detection_status IN ('confirmed','released')
          )
          ${conditions}`,
      [params.from, params.to, ...bindValues],
    );
    const completedCount = parseInt(completedRows[0]?.count ?? '0', 10);

    // Scheduled: status='scheduled', không có no-show
    const scheduledRows: { count: string }[] = await this.dataSource.query(
      `SELECT COUNT(DISTINCT m.id)::text AS count
         FROM meetings m
        WHERE m.status = 'scheduled'
          AND m.start_time >= $1::date
          AND m.start_time < ($2::date + interval '1 day')
          AND NOT EXISTS (
            SELECT 1 FROM room_bookings rb
            JOIN no_show_cases nsc ON nsc.booking_id = rb.id
            WHERE rb.meeting_id = m.id
              AND nsc.detection_status IN ('confirmed','released')
          )
          ${conditions}`,
      [params.from, params.to, ...bindValues],
    );
    const scheduledCount = parseInt(scheduledRows[0]?.count ?? '0', 10);

    const total = cancelledCount + noShowCount + completedCount + scheduledCount;

    const calcPercent = (count: number): number =>
      total > 0 ? Math.round((count / total) * 10000) / 100 : 0;

    return [
      {
        status: 'Cancelled',
        count: cancelledCount,
        percentage: calcPercent(cancelledCount),
      },
      {
        status: 'No-show',
        count: noShowCount,
        percentage: calcPercent(noShowCount),
      },
      {
        status: 'Completed',
        count: completedCount,
        percentage: calcPercent(completedCount),
      },
      {
        status: 'Scheduled',
        count: scheduledCount,
        percentage: calcPercent(scheduledCount),
      },
    ];
  }

  // ─── Phần 4: Meeting Detail List ────────────────────────────────────────────

  /**
   * T025 [FR-026]: Phần 4 — Danh sách chi tiết cuộc họp.
   * participationRate = (present + late) ÷ totalInvited cho từng meeting.
   * KHÔNG giới hạn số dòng (đây là dữ liệu file, không phải API phân trang).
   *
   * ⚠️ participationRate KHÁC on-time-rate: người đến trễ vẫn tính là "tham dự".
   */
  async getMeetingDetailList(
    params: ReportParams,
  ): Promise<MeetingDetailItem[]> {
    const { conditions, bindValues } = this.buildOrganizerScopeConditions(params);

    const rows: {
      meeting_code: string | null;
      title: string;
      organizer_email: string | null;
      room_name: string | null;
      start_time: Date | null;
      end_time: Date | null;
      status: string;
      total_invited: string;
      present_count: string;
    }[] = await this.dataSource.query(
      `SELECT
            m.meeting_code,
            m.title,
            u.email AS organizer_email,
            r.room_name,
            m.start_time,
            m.end_time,
            m.status,
            COUNT(DISTINCT mp.id)::text AS total_invited,
            COUNT(DISTINCT ar.id) FILTER (
              WHERE ar.attendance_status IN ('present','late')
            )::text AS present_count
         FROM meetings m
         LEFT JOIN users u ON u.id = m.organizer_id
         LEFT JOIN room_bookings rb ON rb.meeting_id = m.id
           AND rb.status IN ('confirmed','in_use','completed','cancelled')
         LEFT JOIN rooms r ON r.id = rb.room_id
         LEFT JOIN meeting_participants mp ON mp.meeting_id = m.id AND mp.invitation_status <> 'declined'
         LEFT JOIN attendance_records ar
           ON ar.meeting_id = m.id
          AND ar.user_id = mp.user_id
        WHERE m.status NOT IN ('draft','pending_approval')
          AND m.start_time >= $1::date
          AND m.start_time < ($2::date + interval '1 day')
          ${conditions}
        GROUP BY m.id, m.meeting_code, m.title, u.email, r.room_name, m.start_time, m.end_time, m.status
        ORDER BY m.start_time ASC`,
      [params.from, params.to, ...bindValues],
    );

    return rows.map((row) => {
      const totalInvited = parseInt(row.total_invited ?? '0', 10);
      const presentCount = parseInt(row.present_count ?? '0', 10);
      const participationRate =
        totalInvited > 0
          ? Math.round((presentCount / totalInvited) * 10000) / 100
          : 0;

      return {
        meetingCode: row.meeting_code,
        title: row.title,
        organizerEmail: row.organizer_email,
        roomName: row.room_name,
        startTime: row.start_time,
        endTime: row.end_time,
        status: row.status,
        participationRate,
      };
    });
  }

  // ─── Helpers ────────────────────────────────────────────────────────────────

  /**
   * Xây dựng điều kiện SQL scope theo organizer.
   * - departmentId: lọc theo phòng ban của người tổ chức.
   * - organizerId: lọc trực tiếp theo user organizer.
   * Không có điều kiện nào → không giới hạn.
   *
   * Trả về SQL conditions string (bắt đầu với AND) và bindValues.
   * Caller phải thêm $1, $2 cho from, to trước khi dùng conditions.
   */
  private buildOrganizerScopeConditions(params: ReportParams): {
    conditions: string;
    bindValues: (string | null)[];
  } {
    const parts: string[] = [];
    const values: (string | null)[] = [];
    let idx = 3; // $1=from, $2=to đã dùng bởi caller

    if (params.scope.organizerId) {
      parts.push(`AND m.organizer_id = $${idx++}`);
      values.push(params.scope.organizerId);
    } else if (params.scope.departmentId) {
      parts.push(
        `AND m.organizer_id IN (
          SELECT id FROM users WHERE department_id = $${idx++}
        )`,
      );
      values.push(params.scope.departmentId);
    }

    return {
      conditions: parts.join('\n          '),
      bindValues: values,
    };
  }

  /**
   * Đọc số giờ vận hành mỗi ngày từ system_configs.
   * Key: analytics.room_operating_hours_per_day.
   * Fallback: env ANALYTICS_ROOM_OPERATING_HOURS_PER_DAY → default 8.
   */
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
      MeetingActivityReportDataService.DEFAULT_OPERATING_HOURS,
    );
  }
}
