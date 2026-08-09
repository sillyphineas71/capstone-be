import { Injectable, Logger } from '@nestjs/common';
import { AuditLogsService } from '../../administration/services/audit-logs.service.js';
import { SecurityAlertsDailyTrendRepository } from '../repositories/security-alerts-daily-trend.repository.js';
import { QuerySecurityAlertsDailyTrendDto } from '../dto/query-security-alerts-daily-trend.dto.js';
import {
  SecurityAlertsDailyTrendResponseDto,
  DailyTrendPointDto,
} from '../dto/security-alerts-daily-trend-response.dto.js';

const TZ_OFFSET_MS = 7 * 60 * 60 * 1000; // Asia/Ho_Chi_Minh (UTC+7, khong DST)

/**
 * SecurityAlertsDailyTrendService (AA-DASHBOARD-CHARTS-001).
 *
 * Dem security_alerts theo `triggered_at` (ngay phat sinh lan dau), KHONG dung
 * last_seen_at (spec.md §0.3 — co che dedup co the update ban ghi cu sang ngay
 * khac ma khong tao ban ghi moi).
 */
@Injectable()
export class SecurityAlertsDailyTrendService {
  private readonly logger = new Logger(SecurityAlertsDailyTrendService.name);

  constructor(
    private readonly repo: SecurityAlertsDailyTrendRepository,
    private readonly auditLogsService: AuditLogsService,
  ) {}

  async getDailyTrend(
    currentUser: { userId: string },
    query: QuerySecurityAlertsDailyTrendDto,
  ): Promise<{ data: SecurityAlertsDailyTrendResponseDto; message: string }> {
    const days = query.days ?? 7;

    const todayIct = this.getTodayIctCalendarDate();
    const startIct = new Date(todayIct);
    startIct.setUTCDate(startIct.getUTCDate() - (days - 1));

    const endExclusiveIct = new Date(todayIct);
    endExclusiveIct.setUTCDate(endExclusiveIct.getUTCDate() + 1);

    const fromUtc = this.ictCalendarMidnightToUtc(startIct);
    const toUtcExclusive = this.ictCalendarMidnightToUtc(endExclusiveIct);

    const rows = await this.repo.countByDayAndType(fromUtc, toUtcExclusive);

    const rowsByDate = new Map<string, Map<string, number>>();
    for (const row of rows) {
      const cnt = parseInt(row.cnt, 10);
      if (!rowsByDate.has(row.alert_date)) {
        rowsByDate.set(row.alert_date, new Map());
      }
      rowsByDate.get(row.alert_date)!.set(row.alert_type, cnt);
    }

    const series: DailyTrendPointDto[] = [];
    for (let i = 0; i < days; i++) {
      const d = new Date(startIct);
      d.setUTCDate(d.getUTCDate() + i);
      const dateStr = d.toISOString().split('T')[0];

      const byTypeMap = rowsByDate.get(dateStr);
      const byType: Record<string, number> = {};
      let total = 0;
      if (byTypeMap) {
        for (const [type, cnt] of byTypeMap.entries()) {
          byType[type] = cnt;
          total += cnt;
        }
      }
      series.push({ date: dateStr, total, byType });
    }

    const totalInPeriod = series.reduce((sum, point) => sum + point.total, 0);
    const data: SecurityAlertsDailyTrendResponseDto = { series, totalInPeriod };

    try {
      await this.auditLogsService.logAction({
        userId: currentUser.userId,
        actionType: 'read_analytics_security_alerts_daily_trend',
        entityType: 'security_alerts',
        metadataJson: {
          viewerUserId: currentUser.userId,
          days,
          totalInPeriod,
        },
      });
    } catch (err) {
      this.logger.warn(
        'Failed to write audit log for security alerts daily trend analytics',
        err instanceof Error ? err.message : undefined,
      );
    }

    return {
      data,
      message: 'Xu hướng cảnh báo an ninh theo ngày được truy xuất thành công',
    };
  }

  /**
   * Tra ve Date (UTC ms) co Y/M/D dai dien cho ngay hom nay theo lich ICT
   * (UTC+7), luu o gio 00:00:00 UTC de tien tinh toan cong/tru ngay.
   */
  private getTodayIctCalendarDate(): Date {
    const nowIctMs = Date.now() + TZ_OFFSET_MS;
    const ict = new Date(nowIctMs);
    return new Date(
      Date.UTC(ict.getUTCFullYear(), ict.getUTCMonth(), ict.getUTCDate()),
    );
  }

  /**
   * Quy doi "00:00:00 ICT tai ngay lich calendarDate" (dang luu o dang UTC
   * midnight) thanh thoi diem UTC that su (tru di 7 tieng).
   */
  private ictCalendarMidnightToUtc(calendarDate: Date): Date {
    return new Date(calendarDate.getTime() - TZ_OFFSET_MS);
  }
}
