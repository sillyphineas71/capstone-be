import { Injectable, Logger, BadRequestException } from '@nestjs/common';
import { DataSource } from 'typeorm';
import { ConfigService } from '@nestjs/config';
import {
  SystemConfigEntity,
  SystemConfigValueType,
} from '../../administration/entities/system-config.entity.js';
import { AuditLogsService } from '../../administration/services/audit-logs.service.js';
import { AuditLogSeverity } from '../../administration/entities/audit-log.entity.js';

export interface UpdateEarlyVacancyConfigInput {
  emptyMinutes?: number;
  minRemainingMinutes?: number;
  minElapsedMinutes?: number;
}

interface ConfigKeyDef {
  key: string;
  env: string;
  def: number;
  min: number;
}

type ConfigField = keyof UpdateEarlyVacancyConfigInput;

/**
 * EarlyVacancyConfigService (EVD-001 #48) — đọc/ghi ngưỡng early-vacancy vào system_configs.
 *
 * SEC-03: whitelist đúng 3 key early_vacancy.* (không cho ghi key tùy ý). Precedence đọc:
 * system_configs → env → default. Upsert tăng version_no. DATA-01 no-migration.
 */
@Injectable()
export class EarlyVacancyConfigService {
  private readonly logger = new Logger(EarlyVacancyConfigService.name);

  private static readonly DEFS: Record<ConfigField, ConfigKeyDef> = {
    emptyMinutes: {
      key: 'early_vacancy.empty_minutes',
      env: 'EARLY_VACANCY_EMPTY_MINUTES',
      def: 10,
      min: 1,
    },
    minRemainingMinutes: {
      key: 'early_vacancy.min_remaining_minutes',
      env: 'EARLY_VACANCY_MIN_REMAINING_MINUTES',
      def: 15,
      min: 0,
    },
    minElapsedMinutes: {
      key: 'early_vacancy.min_elapsed_minutes',
      env: 'EARLY_VACANCY_MIN_ELAPSED_MINUTES',
      def: 10,
      min: 0,
    },
  };

  constructor(
    private readonly dataSource: DataSource,
    private readonly configService: ConfigService,
    private readonly auditLogsService: AuditLogsService,
  ) {}

  /** Đọc 1 key hiệu lực theo precedence system_configs → env → default. */
  async getEffectiveValue(
    field: ConfigField,
  ): Promise<{ value: number; source: 'system_configs' | 'env' | 'default' }> {
    const def = EarlyVacancyConfigService.DEFS[field];
    const repo = this.dataSource.getRepository(SystemConfigEntity);
    const row = await repo.findOne({
      where: { configKey: def.key, isActive: true },
    });
    if (row?.configValue != null) {
      const n = parseInt(row.configValue, 10);
      if (Number.isInteger(n) && n >= def.min) {
        return { value: n, source: 'system_configs' };
      }
    }
    const envVal = this.configService.get<number>(def.env);
    if (envVal != null) {
      const n = Number(envVal);
      if (Number.isInteger(n) && n >= def.min)
        return { value: n, source: 'env' };
    }
    return { value: def.def, source: 'default' };
  }

  /** GET API: cả 3 key + source. */
  async getAll(): Promise<
    Record<ConfigField, { value: number; source: string }>
  > {
    const [emptyMinutes, minRemainingMinutes, minElapsedMinutes] =
      await Promise.all([
        this.getEffectiveValue('emptyMinutes'),
        this.getEffectiveValue('minRemainingMinutes'),
        this.getEffectiveValue('minElapsedMinutes'),
      ]);
    return { emptyMinutes, minRemainingMinutes, minElapsedMinutes };
  }

  /** Đọc gọn dạng number (detect dùng). */
  async getValues(): Promise<{
    emptyMinutes: number;
    minRemainingMinutes: number;
    minElapsedMinutes: number;
  }> {
    const all = await this.getAll();
    return {
      emptyMinutes: all.emptyMinutes.value,
      minRemainingMinutes: all.minRemainingMinutes.value,
      minElapsedMinutes: all.minElapsedMinutes.value,
    };
  }

  /** PUT API: upsert các field gửi lên (validate dương). version_no++ khi update. */
  async update(
    input: UpdateEarlyVacancyConfigInput,
    adminId: string | null,
  ): Promise<Record<ConfigField, { value: number; source: string }>> {
    const provided = (
      Object.keys(EarlyVacancyConfigService.DEFS) as ConfigField[]
    ).filter((f) => input[f] !== undefined);
    if (provided.length === 0) {
      throw new BadRequestException({
        code: 'NO_CONFIG_FIELDS',
        message: 'At least one config field is required.',
      });
    }

    const repo = this.dataSource.getRepository(SystemConfigEntity);
    const changed: Record<string, number> = {};

    for (const f of provided) {
      const def = EarlyVacancyConfigService.DEFS[f];
      const val = input[f] as number;
      if (!Number.isInteger(val) || val < def.min) {
        throw new BadRequestException({
          code: 'INVALID_CONFIG_VALUE',
          message: `${def.key} must be an integer >= ${def.min}.`,
        });
      }
      const existing = await repo.findOne({ where: { configKey: def.key } });
      if (existing) {
        existing.configValue = String(val);
        existing.valueType = SystemConfigValueType.NUMBER;
        existing.configGroup = 'room_utilization';
        existing.isActive = true;
        existing.updatedBy = adminId;
        existing.versionNo = (existing.versionNo ?? 1) + 1;
        await repo.save(existing);
      } else {
        await repo.save(
          repo.create({
            configKey: def.key,
            configValue: String(val),
            valueType: SystemConfigValueType.NUMBER,
            configGroup: 'room_utilization',
            isSensitive: false,
            isActive: true,
            versionNo: 1,
            updatedBy: adminId,
          }),
        );
      }
      changed[def.key] = val;
    }

    // SEC-01: audit metadata = key→value đã đổi (không secret).
    await this.auditLogsService.logAction({
      userId: adminId ?? undefined,
      actionType: 'early_vacancy_config_update',
      entityType: 'system_configs',
      severity: AuditLogSeverity.WARNING,
      metadataJson: { changed },
    });

    return this.getAll();
  }
}
