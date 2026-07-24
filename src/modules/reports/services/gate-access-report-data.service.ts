import { Injectable } from '@nestjs/common';
import { DataSource } from 'typeorm';

export interface GateAccessExportParams {
  from: string;
  to: string;
  scope: {
    zoneId: string | null;
    departmentId: string | null;
    userId: string | null;
  };
}

export interface GateAccessExportRow {
  zoneCode: string;
  zoneName: string;
  employeeCode: string | null;
  fullName: string | null;
  departmentName: string | null;
  plateNumber: string | null;
  checkInTime: Date | null;
  checkOutTime: Date | null;
  durationSeconds: number | null;
}

/**
 * GateAccessReportDataService — tổng hợp dữ liệu cho UC-127.
 *
 * CTE `sessions` MIRROR (không import) `GateAccessHistoryService.SESSIONS_CTE` —
 * data service này phục vụ export (không phân trang, toàn bộ dữ liệu khớp filter),
 * khác API tra cứu UC-117 (phân trang, scope theo 1 user).
 *
 * §0.3 spec: khác `GateAccessHistoryService`, ở ĐÂY lọc CỨNG `session_status='completed'`
 * — phiên "Chưa hoàn tất" KHÔNG tính vào báo cáo chính thức (BR2 UC-116).
 * §0.2 spec: giữ TẤT CẢ phiên kể cả vãng lai (`user_id IS NULL`) — LEFT JOIN `users`,
 * không loại bỏ dòng khi thiếu định danh.
 */
@Injectable()
export class GateAccessReportDataService {
  constructor(private readonly dataSource: DataSource) {}

  async listSessionsForExport(
    params: GateAccessExportParams,
  ): Promise<GateAccessExportRow[]> {
    const sqlParams: unknown[] = [params.from, params.to];
    const conditions: string[] = [
      `sessions.session_status = 'completed'`,
      `COALESCE(sessions.check_in_time, sessions.check_out_time) >= $1`,
      `COALESCE(sessions.check_in_time, sessions.check_out_time) <= $2`,
    ];

    if (params.scope.zoneId) {
      sqlParams.push(params.scope.zoneId);
      conditions.push(`sessions.zone_id = $${sqlParams.length}`);
    }
    if (params.scope.departmentId) {
      sqlParams.push(params.scope.departmentId);
      conditions.push(`u.department_id = $${sqlParams.length}`);
    }
    if (params.scope.userId) {
      sqlParams.push(params.scope.userId);
      conditions.push(`sessions.user_id = $${sqlParams.length}`);
    }

    const rows: Array<{
      zone_code: string;
      zone_name: string;
      employee_code: string | null;
      full_name: string | null;
      department_name: string | null;
      plate_number: string | null;
      check_in_time: Date | null;
      check_out_time: Date | null;
      duration_seconds: number | null;
    }> = await this.dataSource.manager.query(
      `WITH sessions AS (
         SELECT
           l.id, l.zone_id, z.zone_code, z.zone_name, l.user_id, l.plate_number,
           CASE WHEN l.direction = 'enter' THEN l.access_time ELSE NULL END AS check_in_time,
           CASE
             WHEN l.direction = 'leave' THEN l.access_time
             WHEN l.direction = 'enter' AND paired.id IS NOT NULL THEN paired.access_time
             ELSE NULL
           END AS check_out_time,
           l.duration_seconds,
           CASE WHEN l.paired_log_id IS NOT NULL THEN 'completed' ELSE 'incomplete' END AS session_status
         FROM gate_access_logs l
         LEFT JOIN zones z ON z.id = l.zone_id AND z.deleted_at IS NULL
         LEFT JOIN gate_access_logs paired ON paired.id = l.paired_log_id
         WHERE (l.direction = 'enter' OR l.paired_log_id IS NULL)
       )
       SELECT
         sessions.zone_code, sessions.zone_name,
         u.employee_code, u.full_name, d.department_name,
         sessions.plate_number, sessions.check_in_time, sessions.check_out_time,
         sessions.duration_seconds
       FROM sessions
       LEFT JOIN users u ON u.id = sessions.user_id
       LEFT JOIN departments d ON d.id = u.department_id
       WHERE ${conditions.join(' AND ')}
       ORDER BY COALESCE(sessions.check_in_time, sessions.check_out_time) ASC`,
      sqlParams,
    );

    return rows.map((r) => ({
      zoneCode: r.zone_code,
      zoneName: r.zone_name,
      employeeCode: r.employee_code,
      fullName: r.full_name,
      departmentName: r.department_name,
      plateNumber: r.plate_number,
      checkInTime: r.check_in_time,
      checkOutTime: r.check_out_time,
      durationSeconds: r.duration_seconds,
    }));
  }
}
