import { Injectable, Logger, BadRequestException } from '@nestjs/common';
import { AuditLogsService } from '../../administration/services/audit-logs.service.js';
import { AuditActivityHourlyRepository } from '../repositories/audit-activity-hourly.repository.js';
import { QueryAuditActivityHourlyDto } from '../dto/query-audit-activity-hourly.dto.js';
import {
  AuditActivityHourlyResponseDto,
  HourlyBucketDto,
} from '../dto/audit-activity-hourly-response.dto.js';

const TZ_OFFSET_MS = 7 * 60 * 60 * 1000; // Asia/Ho_Chi_Minh (UTC+7, khong DST)

/**
 * AuditActivityHourlyService (AA-DASHBOARD-CHARTS-001).
 *
 * Dem audit_logs theo gio trong dung 1 ngay (UTC+7), khong loc theo action_type
 * hay severity (spec.md §0.4 — tai lieu FE xac nhan "khong phan loai action").
 */
@Injectable()
export class AuditActivityHourlyService {
  private readonly logger = new Logger(AuditActivityHourlyService.name);

  constructor(
    private readonly repo: AuditActivityHourlyRepository,
    private readonly auditLogsService: AuditLogsService,
  ) {}

  async getHourlyActivity(
    currentUser: { userId: string },
    query: QueryAuditActivityHourlyDto,
  ): Promise<{ data: AuditActivityHourlyResponseDto; message: string }> {
    const dateStr = query.date ?? this.getTodayIctDateStr();
    const dayIct = this.parseIctCalendarDate(dateStr);

    const nextDayIct = new Date(dayIct);
    nextDayIct.setUTCDate(nextDayIct.getUTCDate() + 1);

    const dayStartUtc = this.ictCalendarMidnightToUtc(dayIct);
    const dayEndUtcExclusive = this.ictCalendarMidnightToUtc(nextDayIct);

    const rows = await this.repo.countByHour(dayStartUtc, dayEndUtcExclusive);

    const countByHour = new Map<number, number>();
    for (const row of rows) {
      countByHour.set(row.hour_of_day, parseInt(row.cnt, 10));
    }

    const buckets: HourlyBucketDto[] = Array.from({ length: 24 }, (_, h) => ({
      hour: `${String(h).padStart(2, '0')}:00`,
      count: countByHour.get(h) ?? 0,
    }));

    const totalToday = buckets.reduce((sum, b) => sum + b.count, 0);
    const dateNormalized = dayIct.toISOString().split('T')[0];

    const data: AuditActivityHourlyResponseDto = {
      date: dateNormalized,
      buckets,
      totalToday,
    };

    try {
      await this.auditLogsService.logAction({
        userId: currentUser.userId,
        actionType: 'read_analytics_audit_activity_hourly',
        entityType: 'audit_logs',
        metadataJson: {
          viewerUserId: currentUser.userId,
          date: dateNormalized,
          totalToday,
        },
      });
    } catch (err) {
      this.logger.warn(
        'Failed to write audit log for audit activity hourly analytics',
        err instanceof Error ? err.message : undefined,
      );
    }

    return {
      data,
      message: 'Hoạt động audit log theo giờ được truy xuất thành công',
    };
  }

  private getTodayIctDateStr(): string {
    const nowIctMs = Date.now() + TZ_OFFSET_MS;
    return new Date(nowIctMs).toISOString().split('T')[0];
  }

  /**
   * Parse "YYYY-MM-DD" (phan date cua @IsDateString, co the kem gio) thanh
   * Date (UTC ms) co Y/M/D dai dien cho ngay lich ICT, luu o 00:00:00 UTC.
   */
  private parseIctCalendarDate(dateStr: string): Date {
    const datePart = dateStr.split('T')[0];
    const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(datePart);
    if (!match) {
      throw new BadRequestException({
        success: false,
        message: 'date must be in YYYY-MM-DD format',
        error: { code: 'VALIDATION_ERROR', details: {} },
      });
    }
    const [, y, m, d] = match;
    const candidate = new Date(Date.UTC(Number(y), Number(m) - 1, Number(d)));
    if (
      candidate.getUTCFullYear() !== Number(y) ||
      candidate.getUTCMonth() !== Number(m) - 1 ||
      candidate.getUTCDate() !== Number(d)
    ) {
      throw new BadRequestException({
        success: false,
        message: 'date is not a valid calendar date',
        error: { code: 'VALIDATION_ERROR', details: {} },
      });
    }
    return candidate;
  }

  private ictCalendarMidnightToUtc(calendarDate: Date): Date {
    return new Date(calendarDate.getTime() - TZ_OFFSET_MS);
  }
}
