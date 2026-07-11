import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { DataSource } from 'typeorm';

/**
 * DashboardOverviewConfigService — read analytics.dashboard_max_range_days
 * Precedence: system_configs → env ANALYTICS_DASHBOARD_MAX_RANGE_DAYS → default 366.
 * Mirrors pattern from no-show-detection.service.ts:readThreshold().
 */
@Injectable()
export class DashboardOverviewConfigService {
  private readonly logger = new Logger(DashboardOverviewConfigService.name);
  private static readonly DEFAULT_MAX_RANGE_DAYS = 366;

  constructor(
    private readonly dataSource: DataSource,
    private readonly configService: ConfigService,
  ) {}

  async getMaxRangeDays(): Promise<number> {
    try {
      const rows = await this.dataSource.query(
        `SELECT config_value FROM system_configs WHERE config_key = 'analytics.dashboard_max_range_days' LIMIT 1`,
      );
      const raw = rows?.[0]?.config_value;
      if (raw != null) {
        const n = parseInt(raw, 10);
        if (Number.isInteger(n) && n > 0) return n;
      }
    } catch (e) {
      this.logger.warn(
        `read analytics.dashboard_max_range_days from system_configs failed: ${
          e instanceof Error ? e.message : 'unknown'
        }`,
      );
    }
    return this.configService.get<number>(
      'ANALYTICS_DASHBOARD_MAX_RANGE_DAYS',
      DashboardOverviewConfigService.DEFAULT_MAX_RANGE_DAYS,
    );
  }
}
