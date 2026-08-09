import { Injectable } from '@nestjs/common';
import { DataSource } from 'typeorm';

export interface SecurityAlertDailyTypeCountRow {
  alert_date: string;
  alert_type: string;
  cnt: string;
}

/**
 * SecurityAlertsDailyTrendRepository — repository DOC rieng cho AA-DASHBOARD-CHARTS-001.
 *
 * Group theo `triggered_at` (khong phai `last_seen_at`) vi co che dedup cua
 * security_alerts: alert dang mo tiep dien chi UPDATE last_seen_at/occurrence_count
 * tren ban ghi cu, khong INSERT moi (xem security-alert.entity.ts). Group theo
 * triggered_at moi phan anh dung ngay phat sinh su co (spec.md §0.3).
 *
 * Raw SQL parameterized qua DataSource — khong join/mo rong entity khac module
 * (dung nguyen tac mot chieu da chot voi Hai, xem security-alert.entity.ts).
 */
@Injectable()
export class SecurityAlertsDailyTrendRepository {
  constructor(private readonly dataSource: DataSource) {}

  /**
   * @param fromUtc - moc bat dau (inclusive), da quy doi sang UTC o tang service
   * @param toUtcExclusive - moc ket thuc (exclusive), da quy doi sang UTC o tang service
   */
  async countByDayAndType(
    fromUtc: Date,
    toUtcExclusive: Date,
  ): Promise<SecurityAlertDailyTypeCountRow[]> {
    const query = `
      SELECT
        (triggered_at AT TIME ZONE 'Asia/Ho_Chi_Minh')::date::text AS alert_date,
        alert_type,
        COUNT(*) AS cnt
      FROM security_alerts
      WHERE triggered_at >= $1 AND triggered_at < $2
      GROUP BY 1, 2
      ORDER BY 1, 2
    `;
    return this.dataSource.query(query, [fromUtc, toUtcExclusive]);
  }
}
