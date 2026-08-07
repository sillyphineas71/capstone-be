import { Injectable, Logger, BadRequestException } from '@nestjs/common';
import { DataSource } from 'typeorm';
import { ConfigService } from '@nestjs/config';
import {
  SystemConfigEntity,
  SystemConfigValueType,
} from '../../administration/entities/system-config.entity.js';
import { AuditLogsService } from '../../administration/services/audit-logs.service.js';
import { AuditLogSeverity } from '../../administration/entities/audit-log.entity.js';

const CONFIG_KEY = 'security_alerts.auto_resolve_timeout_minutes';
const CONFIG_ENV = 'SECURITY_ALERTS_AUTO_RESOLVE_TIMEOUT_MINUTES';
const CONFIG_DEFAULT = 15;
const CONFIG_MIN = 1;

export interface UpdateSecurityAlertConfigInput {
  autoResolveTimeoutMinutes?: number;
}

/**
 * SecurityAlertConfigService — đọc/ghi ngưỡng auto-resolve alert vào
 * system_configs. Mirror NoShowConfigService (rooms module).
 *
 * Whitelist đúng 1 key (không cho ghi key tùy ý). Precedence đọc:
 * system_configs → env → default (15 phút — an toàn, không quá ngắn gây tách
 * vụ ảo, không quá dài gây gộp nhầm).
 */
@Injectable()
export class SecurityAlertConfigService {
  private readonly logger = new Logger(SecurityAlertConfigService.name);

  constructor(
    private readonly dataSource: DataSource,
    private readonly configService: ConfigService,
    private readonly auditLogsService: AuditLogsService,
  ) {}

  /** Đọc giá trị hiệu lực theo precedence system_configs → env → default. */
  async getEffectiveTimeoutMinutes(): Promise<{
    value: number;
    source: 'system_configs' | 'env' | 'default';
  }> {
    const repo = this.dataSource.getRepository(SystemConfigEntity);
    const row = await repo.findOne({
      where: { configKey: CONFIG_KEY, isActive: true },
    });
    if (row?.configValue != null) {
      const n = parseInt(row.configValue, 10);
      if (Number.isInteger(n) && n >= CONFIG_MIN) {
        return { value: n, source: 'system_configs' };
      }
    }
    const envVal = this.configService.get<number>(CONFIG_ENV);
    if (envVal != null) {
      const n = Number(envVal);
      if (Number.isInteger(n) && n >= CONFIG_MIN)
        return { value: n, source: 'env' };
    }
    return { value: CONFIG_DEFAULT, source: 'default' };
  }

  /** GET API. */
  async getAll(): Promise<{
    autoResolveTimeoutMinutes: { value: number; source: string };
  }> {
    const autoResolveTimeoutMinutes = await this.getEffectiveTimeoutMinutes();
    return { autoResolveTimeoutMinutes };
  }

  /** Đọc gọn dạng number (cron dùng). */
  async getTimeoutMinutes(): Promise<number> {
    const { value } = await this.getEffectiveTimeoutMinutes();
    return value;
  }

  /** PUT API: upsert key. version_no++ khi update. */
  async update(
    input: UpdateSecurityAlertConfigInput,
    adminId: string | null,
  ): Promise<{ autoResolveTimeoutMinutes: { value: number; source: string } }> {
    if (input.autoResolveTimeoutMinutes === undefined) {
      throw new BadRequestException({
        code: 'NO_CONFIG_FIELDS',
        message: 'autoResolveTimeoutMinutes is required.',
      });
    }
    const val = input.autoResolveTimeoutMinutes;
    if (!Number.isInteger(val) || val < CONFIG_MIN) {
      throw new BadRequestException({
        code: 'INVALID_CONFIG_VALUE',
        message: `${CONFIG_KEY} must be an integer >= ${CONFIG_MIN}.`,
      });
    }

    const repo = this.dataSource.getRepository(SystemConfigEntity);
    const existing = await repo.findOne({ where: { configKey: CONFIG_KEY } });
    if (existing) {
      existing.configValue = String(val);
      existing.valueType = SystemConfigValueType.NUMBER;
      existing.configGroup = 'security_alerts';
      existing.isActive = true;
      existing.updatedBy = adminId;
      existing.versionNo = (existing.versionNo ?? 1) + 1;
      await repo.save(existing);
    } else {
      await repo.save(
        repo.create({
          configKey: CONFIG_KEY,
          configValue: String(val),
          valueType: SystemConfigValueType.NUMBER,
          configGroup: 'security_alerts',
          isSensitive: false,
          isActive: true,
          versionNo: 1,
          updatedBy: adminId,
        }),
      );
    }

    await this.auditLogsService.logAction({
      userId: adminId ?? undefined,
      actionType: 'security_alert_config_update',
      entityType: 'system_configs',
      severity: AuditLogSeverity.WARNING,
      metadataJson: { changed: { [CONFIG_KEY]: val } },
    });

    return this.getAll();
  }
}
