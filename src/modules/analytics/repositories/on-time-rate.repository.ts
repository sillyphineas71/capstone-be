import { Injectable, Logger } from '@nestjs/common';
import { DataSource } from 'typeorm';

export interface OnTimeRateQueryParams {
  from: string;
  to: string;
  scopeDepartmentIds: string[] | null;
  departmentId?: string;
  meetingId?: string;
  search?: string;
  graceMinutes: number;
}

@Injectable()
export class OnTimeRateRepository {
  private readonly logger = new Logger(OnTimeRateRepository.name);

  constructor(private readonly dataSource: DataSource) {}

  async getManagerDepartmentIds(userId: string): Promise<string[]> {
    const rows = await this.dataSource.query(
      `SELECT id FROM departments WHERE manager_user_id = $1 AND is_active = true`,
      [userId],
    );
    return rows.map((r: { id: string }) => r.id);
  }

  async getUserDetails(userId: string): Promise<{
    id: string;
    fullName: string;
    email: string;
    departmentId: string;
  } | null> {
    const rows = await this.dataSource.query(
      `SELECT id, full_name AS "fullName", email, department_id AS "departmentId" FROM users WHERE id = $1 LIMIT 1`,
      [userId],
    );
    if (!rows || rows.length === 0) return null;
    return rows[0];
  }

  private buildScopeWhere(params: OnTimeRateQueryParams): {
    clause: string;
    values: unknown[];
  } {
    const values: unknown[] = [];
    let idx = 1;
    const conditions: string[] = [];

    // Enforce Manager Department Scope (filters u.department_id!)
    if (params.scopeDepartmentIds !== null) {
      if (params.scopeDepartmentIds.length === 0) {
        return { clause: 'FALSE', values: [] };
      }
      conditions.push(`u.department_id = ANY($${idx}::uuid[])`);
      values.push(params.scopeDepartmentIds);
      idx++;
    }

    // Filter departmentId
    if (params.departmentId) {
      conditions.push(`u.department_id = $${idx}`);
      values.push(params.departmentId);
      idx++;
    }

    // Filter meetingId
    if (params.meetingId) {
      conditions.push(`m.id = $${idx}`);
      values.push(params.meetingId);
      idx++;
    }

    // Filter search
    if (params.search) {
      conditions.push(
        `(u.full_name ILIKE $${idx} OR u.email ILIKE $${idx} OR u.employee_code ILIKE $${idx})`,
      );
      values.push(`%${params.search}%`);
      idx++;
    }

    const clause = conditions.length > 0 ? conditions.join(' AND ') : 'TRUE';
    return { clause, values };
  }

  async getKpiTotals(params: OnTimeRateQueryParams): Promise<{
    onTimeCount: number;
    lateCount: number;
    absentCount: number;
    totalRequiredParticipants: number;
  }> {
    const scope = this.buildScopeWhere(params);
    const graceIdx = scope.values.length + 1;
    const fromIdx = graceIdx + 1;
    const toIdx = graceIdx + 2;

    const sql = `
      WITH classified AS (
        SELECT
          CASE
            WHEN ar.id IS NULL OR ar.attendance_status = 'absent' OR NOT ar.is_present THEN 'absent'
            WHEN $${graceIdx} = 0 THEN
              CASE WHEN NOT ar.is_late THEN 'on_time' ELSE 'late' END
            ELSE
              CASE WHEN ar.late_minutes IS NULL OR ar.late_minutes <= $${graceIdx} THEN 'on_time' ELSE 'late' END
          END AS status_bucket
        FROM meeting_participants mp
        INNER JOIN meetings m ON m.id = mp.meeting_id
        INNER JOIN users u ON u.id = mp.user_id
        LEFT JOIN attendance_records ar ON ar.meeting_id = m.id AND ar.user_id = mp.user_id
        WHERE m.status = 'completed'
          AND m.deleted_at IS NULL
          AND mp.invitation_status <> 'declined'
          AND (ar.id IS NULL OR ar.attendance_status NOT IN ('invalidated', 'pending_review'))
          AND m.start_time >= ($${fromIdx} || ' 00:00:00+07')::timestamptz
          AND m.start_time <= ($${toIdx} || ' 23:59:59.999+07')::timestamptz
          AND ${scope.clause}
      )
      SELECT
        COUNT(*) FILTER (WHERE status_bucket = 'on_time')::int AS on_time_count,
        COUNT(*) FILTER (WHERE status_bucket = 'late')::int AS late_count,
        COUNT(*) FILTER (WHERE status_bucket = 'absent')::int AS absent_count,
        COUNT(*)::int AS total_count
      FROM classified
    `;

    const rows = await this.dataSource.query(sql, [
      ...scope.values,
      params.graceMinutes,
      params.from,
      params.to,
    ]);

    return {
      onTimeCount: rows?.[0]?.on_time_count ?? 0,
      lateCount: rows?.[0]?.late_count ?? 0,
      absentCount: rows?.[0]?.absent_count ?? 0,
      totalRequiredParticipants: rows?.[0]?.total_count ?? 0,
    };
  }

  async getTrendByWeek(params: OnTimeRateQueryParams): Promise<
    Map<
      string,
      {
        onTimeCount: number;
        lateCount: number;
        absentCount: number;
        totalRequiredParticipants: number;
      }
    >
  > {
    const scope = this.buildScopeWhere(params);
    const graceIdx = scope.values.length + 1;
    const fromIdx = graceIdx + 1;
    const toIdx = graceIdx + 2;

    const sql = `
      WITH classified AS (
        SELECT
          date_trunc('week', m.start_time AT TIME ZONE 'Asia/Ho_Chi_Minh')::date AS week_start,
          CASE
            WHEN ar.id IS NULL OR ar.attendance_status = 'absent' OR NOT ar.is_present THEN 'absent'
            WHEN $${graceIdx} = 0 THEN
              CASE WHEN NOT ar.is_late THEN 'on_time' ELSE 'late' END
            ELSE
              CASE WHEN ar.late_minutes IS NULL OR ar.late_minutes <= $${graceIdx} THEN 'on_time' ELSE 'late' END
          END AS status_bucket
        FROM meeting_participants mp
        INNER JOIN meetings m ON m.id = mp.meeting_id
        INNER JOIN users u ON u.id = mp.user_id
        LEFT JOIN attendance_records ar ON ar.meeting_id = m.id AND ar.user_id = mp.user_id
        WHERE m.status = 'completed'
          AND m.deleted_at IS NULL
          AND mp.invitation_status <> 'declined'
          AND (ar.id IS NULL OR ar.attendance_status NOT IN ('invalidated', 'pending_review'))
          AND m.start_time >= ($${fromIdx} || ' 00:00:00+07')::timestamptz
          AND m.start_time <= ($${toIdx} || ' 23:59:59.999+07')::timestamptz
          AND ${scope.clause}
      )
      SELECT
        week_start::text AS week_key,
        COUNT(*) FILTER (WHERE status_bucket = 'on_time')::int AS on_time_count,
        COUNT(*) FILTER (WHERE status_bucket = 'late')::int AS late_count,
        COUNT(*) FILTER (WHERE status_bucket = 'absent')::int AS absent_count,
        COUNT(*)::int AS total_count
      FROM classified
      GROUP BY week_start
      ORDER BY week_start ASC
    `;

    const rows = await this.dataSource.query(sql, [
      ...scope.values,
      params.graceMinutes,
      params.from,
      params.to,
    ]);

    const result = new Map<
      string,
      {
        onTimeCount: number;
        lateCount: number;
        absentCount: number;
        totalRequiredParticipants: number;
      }
    >();
    for (const row of rows) {
      result.set(row.week_key, {
        onTimeCount: row.on_time_count,
        lateCount: row.late_count,
        absentCount: row.absent_count,
        totalRequiredParticipants: row.total_count,
      });
    }
    return result;
  }

  async getLateByHourOfDay(
    params: OnTimeRateQueryParams,
  ): Promise<
    Map<number, { lateCount: number; totalRequiredParticipants: number }>
  > {
    const scope = this.buildScopeWhere(params);
    const graceIdx = scope.values.length + 1;
    const fromIdx = graceIdx + 1;
    const toIdx = graceIdx + 2;

    const sql = `
      WITH classified AS (
        SELECT
          EXTRACT(HOUR FROM m.start_time AT TIME ZONE 'Asia/Ho_Chi_Minh')::int AS hour_of_day,
          CASE
            WHEN ar.id IS NULL OR ar.attendance_status = 'absent' OR NOT ar.is_present THEN 'absent'
            WHEN $${graceIdx} = 0 THEN
              CASE WHEN NOT ar.is_late THEN 'on_time' ELSE 'late' END
            ELSE
              CASE WHEN ar.late_minutes IS NULL OR ar.late_minutes <= $${graceIdx} THEN 'on_time' ELSE 'late' END
          END AS status_bucket
        FROM meeting_participants mp
        INNER JOIN meetings m ON m.id = mp.meeting_id
        INNER JOIN users u ON u.id = mp.user_id
        LEFT JOIN attendance_records ar ON ar.meeting_id = m.id AND ar.user_id = mp.user_id
        WHERE m.status = 'completed'
          AND m.deleted_at IS NULL
          AND mp.invitation_status <> 'declined'
          AND (ar.id IS NULL OR ar.attendance_status NOT IN ('invalidated', 'pending_review'))
          AND m.start_time >= ($${fromIdx} || ' 00:00:00+07')::timestamptz
          AND m.start_time <= ($${toIdx} || ' 23:59:59.999+07')::timestamptz
          AND ${scope.clause}
      )
      SELECT
        hour_of_day,
        COUNT(*) FILTER (WHERE status_bucket = 'late')::int AS late_count,
        COUNT(*)::int AS total_count
      FROM classified
      GROUP BY hour_of_day
      ORDER BY hour_of_day ASC
    `;

    const rows = await this.dataSource.query(sql, [
      ...scope.values,
      params.graceMinutes,
      params.from,
      params.to,
    ]);

    const result = new Map<
      number,
      { lateCount: number; totalRequiredParticipants: number }
    >();
    for (const row of rows) {
      result.set(row.hour_of_day, {
        lateCount: row.late_count,
        totalRequiredParticipants: row.total_count,
      });
    }
    return result;
  }

  async getLateByDepartment(params: OnTimeRateQueryParams): Promise<
    Array<{
      departmentId: string;
      departmentName: string;
      lateCount: number;
      totalRequiredParticipants: number;
    }>
  > {
    const scope = this.buildScopeWhere(params);
    const graceIdx = scope.values.length + 1;
    const fromIdx = graceIdx + 1;
    const toIdx = graceIdx + 2;

    const sql = `
      WITH classified AS (
        SELECT
          u.department_id,
          CASE
            WHEN ar.id IS NULL OR ar.attendance_status = 'absent' OR NOT ar.is_present THEN 'absent'
            WHEN $${graceIdx} = 0 THEN
              CASE WHEN NOT ar.is_late THEN 'on_time' ELSE 'late' END
            ELSE
              CASE WHEN ar.late_minutes IS NULL OR ar.late_minutes <= $${graceIdx} THEN 'on_time' ELSE 'late' END
          END AS status_bucket
        FROM meeting_participants mp
        INNER JOIN meetings m ON m.id = mp.meeting_id
        INNER JOIN users u ON u.id = mp.user_id
        LEFT JOIN attendance_records ar ON ar.meeting_id = m.id AND ar.user_id = mp.user_id
        WHERE m.status = 'completed'
          AND m.deleted_at IS NULL
          AND mp.invitation_status <> 'declined'
          AND (ar.id IS NULL OR ar.attendance_status NOT IN ('invalidated', 'pending_review'))
          AND m.start_time >= ($${fromIdx} || ' 00:00:00+07')::timestamptz
          AND m.start_time <= ($${toIdx} || ' 23:59:59.999+07')::timestamptz
          AND ${scope.clause}
      )
      SELECT
        d.id AS department_id,
        d.department_name AS department_name,
        COUNT(*) FILTER (WHERE c.status_bucket = 'late')::int AS late_count,
        COUNT(*)::int AS total_count
      FROM classified c
      INNER JOIN departments d ON d.id = c.department_id
      GROUP BY d.id, d.department_name
    `;

    const rows = await this.dataSource.query(sql, [
      ...scope.values,
      params.graceMinutes,
      params.from,
      params.to,
    ]);

    return rows.map((r: any) => ({
      departmentId: r.department_id,
      departmentName: r.department_name,
      lateCount: r.late_count,
      totalRequiredParticipants: r.total_count,
    }));
  }

  async getLateHistory(
    userId: string,
    from: string,
    to: string,
    graceMinutes: number,
  ): Promise<
    Array<{
      meetingId: string;
      meetingTitle: string;
      scheduledStartTime: Date;
      checkInTime: Date;
      lateMinutes: number;
    }>
  > {
    const sql = `
      SELECT
        m.id AS "meetingId",
        m.title AS "meetingTitle",
        m.start_time AS "scheduledStartTime",
        ar.check_in_time AS "checkInTime",
        ar.late_minutes AS "lateMinutes"
      FROM attendance_records ar
      INNER JOIN meetings m ON m.id = ar.meeting_id
      WHERE ar.user_id = $1
        AND m.status = 'completed'
        AND m.deleted_at IS NULL
        AND m.start_time >= ($2 || ' 00:00:00+07')::timestamptz
        AND m.start_time <= ($3 || ' 23:59:59.999+07')::timestamptz
        AND ar.attendance_status NOT IN ('invalidated', 'pending_review')
        AND ar.is_present = true
        AND (
          ($4 = 0 AND ar.is_late = true) OR
          ($4 > 0 AND ar.late_minutes > $4)
        )
      ORDER BY m.start_time DESC
    `;

    return this.dataSource.query(sql, [userId, from, to, graceMinutes]);
  }
}
