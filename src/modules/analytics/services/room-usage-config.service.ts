import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { DataSource } from 'typeorm';

@Injectable()
export class RoomUsageConfigService {
  private readonly logger = new Logger(RoomUsageConfigService.name);
  private static readonly DEFAULT_OPERATING_HOURS = 8;

  constructor(
    private readonly dataSource: DataSource,
    private readonly configService: ConfigService,
  ) {}

  async getOperatingHoursPerDay(): Promise<number> {
    try {
      const rows = await this.dataSource.query(
        `SELECT config_value FROM system_configs WHERE config_key = 'analytics.room_operating_hours_per_day' LIMIT 1`,
      );
      const raw = rows?.[0]?.config_value;
      if (raw != null) {
        const n = parseInt(raw, 10);
        if (Number.isInteger(n) && n > 0) return n;
      }
    } catch (e) {
      this.logger.warn(
        `read analytics.room_operating_hours_per_day from system_configs failed: ${
          e instanceof Error ? e.message : 'unknown'
        }`,
      );
    }
    return this.configService.get<number>(
      'ANALYTICS_ROOM_OPERATING_HOURS_PER_DAY',
      RoomUsageConfigService.DEFAULT_OPERATING_HOURS,
    );
  }
}
