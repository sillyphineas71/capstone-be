import { Injectable } from '@nestjs/common';
import { DataSource } from 'typeorm';
import { ConfigService } from '@nestjs/config';
import { SystemConfigEntity } from '../../administration/entities/system-config.entity.js';

const MAX_DURATION_CONFIG_KEY = 'recording.max_duration_hours';
const MAX_DURATION_CONFIG_ENV = 'RECORDING_MAX_DURATION_HOURS';
const MAX_DURATION_CONFIG_DEFAULT = 6;
const MAX_DURATION_CONFIG_MIN = 1;

/**
 * [FIX 2026-08-12, R9 — Lớp 2] RecordingSystemConfigService — config HỆ THỐNG cho recording
 * (KHÔNG phải per-meeting như RecordingConfigService, vốn có entity RecordingConfigEntity +
 * assertCanConfigure theo ownership từng meeting — sai chỗ cho 1 giá trị toàn hệ thống).
 * Mirror cấu trúc SecurityAlertConfigService (namespace riêng theo domain — bài học từ
 * occurrenceDebounceSeconds): precedence system_configs → env → default.
 */
@Injectable()
export class RecordingSystemConfigService {
  constructor(
    private readonly dataSource: DataSource,
    private readonly configService: ConfigService,
  ) {}

  /** Đọc giá trị hiệu lực theo precedence system_configs → env → default. */
  async getEffectiveMaxDurationHours(): Promise<{
    value: number;
    source: 'system_configs' | 'env' | 'default';
  }> {
    const repo = this.dataSource.getRepository(SystemConfigEntity);
    const row = await repo.findOne({
      where: { configKey: MAX_DURATION_CONFIG_KEY, isActive: true },
    });
    if (row?.configValue != null) {
      const n = parseInt(row.configValue, 10);
      if (Number.isInteger(n) && n >= MAX_DURATION_CONFIG_MIN) {
        return { value: n, source: 'system_configs' };
      }
    }
    const envVal = this.configService.get<number>(MAX_DURATION_CONFIG_ENV);
    if (envVal != null) {
      const n = Number(envVal);
      if (Number.isInteger(n) && n >= MAX_DURATION_CONFIG_MIN)
        return { value: n, source: 'env' };
    }
    return { value: MAX_DURATION_CONFIG_DEFAULT, source: 'default' };
  }

  /** Đọc gọn dạng number (cron recording-max-duration-enforce dùng). */
  async getMaxDurationHours(): Promise<number> {
    const { value } = await this.getEffectiveMaxDurationHours();
    return value;
  }
}
