import { Injectable } from '@nestjs/common';
import { DataSource } from 'typeorm';

export interface AuditLogFilters {
  from?: string;
  to?: string;
  userId?: string;
  actionType?: string;
  entityType?: string;
  severity?: string;
}

export interface AuditLogRow {
  id: string;
  created_at: Date;
  user_id: string | null;
  action_type: string;
  entity_type: string;
  entity_id: string | null;
  severity: string;
  user_full_name: string | null;
}

/**
 * AuditLogQueryRepository — repository ĐỌC dành riêng cho feature view audit logs.
 *
 * KHÔNG sửa và KHÔNG mở rộng AuditLogsService (service GHI dùng chung).
 * Repository này dùng raw SQL parameterized để đảm bảo:
 * - Không nối chuỗi SQL (tránh SQL injection)
 * - LEFT JOIN users để resolve actorName trong 1 query (T015)
 * - COUNT(*) riêng biệt không JOIN/ORDER BY/LIMIT (T016)
 * - ORDER BY al.created_at DESC cố định, không thể thay đổi qua query param
 */
@Injectable()
export class AuditLogQueryRepository {
  constructor(private readonly dataSource: DataSource) {}

  /**
   * T015: Truy vấn phân trang audit_logs với LEFT JOIN users.
   *
   * @param filters - object điều kiện AND từ buildFilters()
   * @param page - trang hiện tại (bắt đầu từ 1)
   * @param limit - số bản ghi mỗi trang
   * @returns mảng row kết quả
   */
  async findPaginated(
    filters: AuditLogFilters,
    page: number,
    limit: number,
  ): Promise<AuditLogRow[]> {
    const { sql, params } = this.buildWhereClause(filters);

    const query = `
      SELECT
        al.id,
        al.created_at,
        al.user_id,
        al.action_type,
        al.entity_type,
        al.entity_id,
        al.severity,
        u.full_name AS user_full_name
      FROM audit_logs al
      LEFT JOIN users u ON u.id = al.user_id
      ${sql}
      ORDER BY al.created_at DESC
      LIMIT $${params.length + 1} OFFSET $${params.length + 2}
    `;

    const offset = (page - 1) * limit;
    return this.dataSource.query(query, [...params, limit, offset]) as Promise<AuditLogRow[]>;
  }

  /**
   * T016: Đếm tổng bản ghi khớp filter — KHÔNG JOIN/ORDER BY/LIMIT.
   *
   * @param filters - cùng object điều kiện AND với findPaginated
   * @returns total count
   */
  async countMatching(filters: AuditLogFilters): Promise<number> {
    const { sql, params } = this.buildWhereClause(filters);

    const query = `
      SELECT COUNT(*) AS total
      FROM audit_logs al
      ${sql}
    `;

    const result = (await this.dataSource.query(query, params)) as Array<{ total: string }>;
    return parseInt(result[0]?.total ?? '0', 10);
  }

  /**
   * Xây dựng mệnh đề WHERE parameterized từ object filters.
   * Bỏ qua field không truyền — tất cả điều kiện kết hợp AND.
   *
   * @param filters - object điều kiện
   * @returns { sql: WHERE clause string | empty, params: positional params }
   */
  private buildWhereClause(filters: AuditLogFilters): {
    sql: string;
    params: unknown[];
  } {
    const conditions: string[] = [];
    const params: unknown[] = [];

    if (filters.from) {
      params.push(filters.from);
      conditions.push(`al.created_at >= $${params.length}`);
    }

    if (filters.to) {
      params.push(filters.to);
      conditions.push(`al.created_at <= $${params.length}`);
    }

    if (filters.userId) {
      params.push(filters.userId);
      conditions.push(`al.user_id = $${params.length}`);
    }

    if (filters.actionType) {
      params.push(filters.actionType);
      conditions.push(`al.action_type = $${params.length}`);
    }

    if (filters.entityType) {
      params.push(filters.entityType);
      conditions.push(`al.entity_type = $${params.length}`);
    }

    if (filters.severity) {
      params.push(filters.severity);
      conditions.push(`al.severity = $${params.length}`);
    }

    const sql =
      conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '';
    return { sql, params };
  }
}
