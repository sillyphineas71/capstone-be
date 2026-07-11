import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { DataSource } from 'typeorm';

/**
 * RoomUsageHistoryConfigService — đọc ngưỡng "Hủy sát giờ" cho UC-RUM-04.
 * Precedence: system_configs → env ANALYTICS_LATE_CANCELLATION_THRESHOLD_MINUTES
 * → default 60. Mirror pattern RoomUsageConfigService/DashboardOverviewConfigService.
 */
@Injectable()
export class RoomUsageHistoryConfigService {
  private readonly logger = new Logger(RoomUsageHistoryConfigService.name);
  private static readonly DEFAULT_LATE_CANCELLATION_THRESHOLD_MINUTES = 60;

  constructor(
    private readonly dataSource: DataSource,
    private readonly configService: ConfigService,
  ) {}

  async getLateCancellationThresholdMinutes(): Promise<number> {
    try {
      const rows = await this.dataSource.query(
        `SELECT config_value FROM system_configs WHERE config_key = 'analytics.late_cancellation_threshold_minutes' LIMIT 1`,
      );
      const raw = rows?.[0]?.config_value;
      if (raw != null) {
        const n = parseInt(raw, 10);
        if (Number.isInteger(n) && n > 0) return n;
      }
    } catch (e) {
      this.logger.warn(
        `read analytics.late_cancellation_threshold_minutes failed: ${
          e instanceof Error ? e.message : 'unknown'
        }`,
      );
    }
    return this.configService.get<number>(
      'ANALYTICS_LATE_CANCELLATION_THRESHOLD_MINUTES',
      RoomUsageHistoryConfigService.DEFAULT_LATE_CANCELLATION_THRESHOLD_MINUTES,
    );
  }
}
