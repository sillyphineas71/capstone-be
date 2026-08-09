import { Injectable } from '@nestjs/common';
import { DataSource } from 'typeorm';

export interface AuditActivityHourCountRow {
  hour_of_day: number;
  cnt: string;
}

/**
 * AuditActivityHourlyRepository — repository DOC rieng cho AA-DASHBOARD-CHARTS-001.
 *
 * Khac muc dich voi AuditLogQueryRepository (administration/) — repository do la
 * list phan trang (UC-AA-11), con day la aggregate theo gio cho dashboard. Khong
 * import cheo giua analytics/ va administration/repositories (module boundary).
 */
@Injectable()
export class AuditActivityHourlyRepository {
  constructor(private readonly dataSource: DataSource) {}

  /**
   * @param dayStartUtc - moc bat dau ngay (inclusive), da quy doi sang UTC o tang service
   * @param dayEndUtcExclusive - moc ket thuc ngay (exclusive), da quy doi sang UTC o tang service
   */
  async countByHour(
    dayStartUtc: Date,
    dayEndUtcExclusive: Date,
  ): Promise<AuditActivityHourCountRow[]> {
    const query = `
      SELECT
        EXTRACT(HOUR FROM (created_at AT TIME ZONE 'Asia/Ho_Chi_Minh'))::int AS hour_of_day,
        COUNT(*) AS cnt
      FROM audit_logs
      WHERE created_at >= $1 AND created_at < $2
      GROUP BY 1
      ORDER BY 1
    `;
    return this.dataSource.query(query, [dayStartUtc, dayEndUtcExclusive]);
  }
}
