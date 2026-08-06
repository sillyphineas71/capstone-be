import { Injectable, Logger, BadRequestException } from '@nestjs/common';
import { DataSource } from 'typeorm';
import { ConfigService } from '@nestjs/config';
import {
  SystemConfigEntity,
  SystemConfigValueType,
} from '../../administration/entities/system-config.entity.js';
import { AuditLogsService } from '../../administration/services/audit-logs.service.js';
import { AuditLogSeverity } from '../../administration/entities/audit-log.entity.js';

export interface UpdateNoShowConfigInput {
  thresholdMinutes?: number;
  warningGraceMinutes?: number;
  autoReleaseGraceMinutes?: number;
  autoReleaseEnabled?: boolean;
}

interface ConfigKeyDef {
  key: string;
  env: string;
  def: number;
  min: number;
}

type ConfigField = keyof Omit<UpdateNoShowConfigInput, 'autoReleaseEnabled'>;

const AUTO_RELEASE_ENABLED_KEY = 'no_show.auto_release_enabled';
const AUTO_RELEASE_ENABLED_ENV = 'NO_SHOW_AUTO_RELEASE_ENABLED';
const AUTO_RELEASE_ENABLED_DEFAULT = true;

/**
 * NoShowConfigService (NSL-001 #35) — đọc/ghi ngưỡng no-show vào system_configs.
 *
 * SEC-03: whitelist đúng 3 key (không cho ghi key tùy ý). Precedence đọc:
 * system_configs → env → default. Upsert tăng version_no. DATA-01 no-migration.
 */
@Injectable()
export class NoShowConfigService {
  private readonly logger = new Logger(NoShowConfigService.name);

  private static readonly DEFS: Record<ConfigField, ConfigKeyDef> = {
    thresholdMinutes: {
      key: 'no_show.threshold_minutes',
      env: 'NO_SHOW_THRESHOLD_MINUTES',
      def: 15,
      min: 1,
    },
    warningGraceMinutes: {
      key: 'no_show.warning_grace_minutes',
      env: 'NO_SHOW_WARNING_GRACE_MINUTES',
      def: 0,
      min: 0,
    },
    autoReleaseGraceMinutes: {
      key: 'no_show.auto_release_grace_minutes',
      env: 'NO_SHOW_AUTO_RELEASE_GRACE_MINUTES',
      def: 5,
      min: 1,
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
    const def = NoShowConfigService.DEFS[field];
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

  /** Đọc flag bool hiệu lực theo precedence system_configs → env → default true. */
  async getEffectiveBoolValue(): Promise<{
    value: boolean;
    source: 'system_configs' | 'env' | 'default';
  }> {
    const repo = this.dataSource.getRepository(SystemConfigEntity);
    const row = await repo.findOne({
      where: { configKey: AUTO_RELEASE_ENABLED_KEY, isActive: true },
    });
    if (row?.configValue === 'true' || row?.configValue === 'false') {
      return { value: row.configValue === 'true', source: 'system_configs' };
    }
    const envVal = this.configService.get<boolean>(AUTO_RELEASE_ENABLED_ENV);
    if (envVal !== undefined) {
      return { value: Boolean(envVal), source: 'env' };
    }
    return { value: AUTO_RELEASE_ENABLED_DEFAULT, source: 'default' };
  }

  /** GET API: cả 3 key số + flag bool + source. */
  async getAll(): Promise<
    Record<ConfigField, { value: number; source: string }> & {
      autoReleaseEnabled: { value: boolean; source: string };
    }
  > {
    const [
      thresholdMinutes,
      warningGraceMinutes,
      autoReleaseGraceMinutes,
      autoReleaseEnabled,
    ] = await Promise.all([
      this.getEffectiveValue('thresholdMinutes'),
      this.getEffectiveValue('warningGraceMinutes'),
      this.getEffectiveValue('autoReleaseGraceMinutes'),
      this.getEffectiveBoolValue(),
    ]);
    return {
      thresholdMinutes,
      warningGraceMinutes,
      autoReleaseGraceMinutes,
      autoReleaseEnabled,
    };
  }

  /** Đọc gọn dạng number/boolean (lifecycle dùng). */
  async getValues(): Promise<{
    thresholdMinutes: number;
    warningGraceMinutes: number;
    autoReleaseGraceMinutes: number;
    autoReleaseEnabled: boolean;
  }> {
    const all = await this.getAll();
    return {
      thresholdMinutes: all.thresholdMinutes.value,
      warningGraceMinutes: all.warningGraceMinutes.value,
      autoReleaseGraceMinutes: all.autoReleaseGraceMinutes.value,
      autoReleaseEnabled: all.autoReleaseEnabled.value,
    };
  }

  /** PUT API: upsert các field gửi lên (validate dương). version_no++ khi update. */
  async update(
    input: UpdateNoShowConfigInput,
    adminId: string | null,
  ): Promise<
    Record<ConfigField, { value: number; source: string }> & {
      autoReleaseEnabled: { value: boolean; source: string };
    }
  > {
    const provided = (
      Object.keys(NoShowConfigService.DEFS) as ConfigField[]
    ).filter((f) => input[f] !== undefined);
    const boolProvided = input.autoReleaseEnabled !== undefined;
    if (provided.length === 0 && !boolProvided) {
      throw new BadRequestException({
        code: 'NO_CONFIG_FIELDS',
        message: 'At least one config field is required.',
      });
    }

    const repo = this.dataSource.getRepository(SystemConfigEntity);
    const changed: Record<string, number | boolean> = {};

    for (const f of provided) {
      const def = NoShowConfigService.DEFS[f];
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
        existing.configGroup = 'no_show';
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
            configGroup: 'no_show',
            isSensitive: false,
            isActive: true,
            versionNo: 1,
            updatedBy: adminId,
          }),
        );
      }
      changed[def.key] = val;
    }

    if (boolProvided) {
      const val = input.autoReleaseEnabled as boolean;
      const existing = await repo.findOne({
        where: { configKey: AUTO_RELEASE_ENABLED_KEY },
      });
      if (existing) {
        existing.configValue = String(val);
        existing.valueType = SystemConfigValueType.BOOLEAN;
        existing.configGroup = 'no_show';
        existing.isActive = true;
        existing.updatedBy = adminId;
        existing.versionNo = (existing.versionNo ?? 1) + 1;
        await repo.save(existing);
      } else {
        await repo.save(
          repo.create({
            configKey: AUTO_RELEASE_ENABLED_KEY,
            configValue: String(val),
            valueType: SystemConfigValueType.BOOLEAN,
            configGroup: 'no_show',
            isSensitive: false,
            isActive: true,
            versionNo: 1,
            updatedBy: adminId,
          }),
        );
      }
      changed[AUTO_RELEASE_ENABLED_KEY] = val;
    }

    // SEC-01: audit metadata = key→value đã đổi (không secret).
    await this.auditLogsService.logAction({
      userId: adminId ?? undefined,
      actionType: 'no_show_config_update',
      entityType: 'system_configs',
      severity: AuditLogSeverity.WARNING,
      metadataJson: { changed },
    });

    return this.getAll();
  }
}
