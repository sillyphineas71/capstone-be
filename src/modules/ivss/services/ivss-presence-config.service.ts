import { Injectable, Logger, BadRequestException } from '@nestjs/common';
import { DataSource } from 'typeorm';
import { ConfigService } from '@nestjs/config';
import {
  SystemConfigEntity,
  SystemConfigValueType,
} from '../../administration/entities/system-config.entity.js';
import { AuditLogsService } from '../../administration/services/audit-logs.service.js';
import { AuditLogSeverity } from '../../administration/entities/audit-log.entity.js';

export interface UpdateIvssPresenceConfigInput {
  minSimilarityThreshold?: number;
}

interface ConfigKeyDef {
  key: string;
  env: string;
  def: number;
  min: number;
  max: number;
}

type ConfigField = keyof UpdateIvssPresenceConfigInput;

/**
 * IvssPresenceConfigService (Phần B, Case 5) — đọc/ghi ngưỡng similarity tối thiểu
 * cho luồng nhận diện khuôn mặt IVSS vào system_configs. Mirror cấu trúc
 * NoShowConfigService (DEFS + precedence system_configs → env → default) nhưng
 * TÁCH RIÊNG configGroup ('ivss_presence') và actionType audit — ngưỡng no-show
 * (thời gian, phút/giây) không cùng miền nghiệp vụ với ngưỡng similarity (tỉ lệ
 * 0..1) của nhận diện khuôn mặt, nên KHÔNG gộp vào NoShowConfigService.
 *
 * minSimilarityThreshold là số THỰC (0..1), khác các field số NGUYÊN của
 * NoShowConfigService — validate bằng Number.isFinite, không Number.isInteger.
 */
@Injectable()
export class IvssPresenceConfigService {
  private readonly logger = new Logger(IvssPresenceConfigService.name);

  private static readonly DEFS: Record<ConfigField, ConfigKeyDef> = {
    minSimilarityThreshold: {
      key: 'ivss.min_similarity_threshold',
      env: 'IVSS_MIN_SIMILARITY_THRESHOLD',
      def: 0.7,
      min: 0,
      max: 1,
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
    const def = IvssPresenceConfigService.DEFS[field];
    const repo = this.dataSource.getRepository(SystemConfigEntity);
    const row = await repo.findOne({
      where: { configKey: def.key, isActive: true },
    });
    if (row?.configValue != null) {
      const n = parseFloat(row.configValue);
      if (Number.isFinite(n) && n >= def.min && n <= def.max) {
        return { value: n, source: 'system_configs' };
      }
    }
    const envVal = this.configService.get<string>(def.env);
    if (envVal != null) {
      const n = Number(envVal);
      if (Number.isFinite(n) && n >= def.min && n <= def.max)
        return { value: n, source: 'env' };
    }
    return { value: def.def, source: 'default' };
  }

  /** GET: field số + source. */
  async getAll(): Promise<
    Record<ConfigField, { value: number; source: string }>
  > {
    const [minSimilarityThreshold] = await Promise.all([
      this.getEffectiveValue('minSimilarityThreshold'),
    ]);
    return { minSimilarityThreshold };
  }

  /** Đọc gọn dạng number (ivss-presence-ingestion dùng). */
  async getValues(): Promise<{ minSimilarityThreshold: number }> {
    const all = await this.getAll();
    return { minSimilarityThreshold: all.minSimilarityThreshold.value };
  }

  /** PUT: upsert field gửi lên (validate 0..1). version_no++ khi update. */
  async update(
    input: UpdateIvssPresenceConfigInput,
    adminId: string | null,
  ): Promise<Record<ConfigField, { value: number; source: string }>> {
    const provided = (
      Object.keys(IvssPresenceConfigService.DEFS) as ConfigField[]
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
      const def = IvssPresenceConfigService.DEFS[f];
      const val = input[f] as number;
      if (!Number.isFinite(val) || val < def.min || val > def.max) {
        throw new BadRequestException({
          code: 'INVALID_CONFIG_VALUE',
          message: `${def.key} must be a number between ${def.min} and ${def.max}.`,
        });
      }
      const existing = await repo.findOne({ where: { configKey: def.key } });
      if (existing) {
        existing.configValue = String(val);
        existing.valueType = SystemConfigValueType.NUMBER;
        existing.configGroup = 'ivss_presence';
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
            configGroup: 'ivss_presence',
            isSensitive: false,
            isActive: true,
            versionNo: 1,
            updatedBy: adminId,
          }),
        );
      }
      changed[def.key] = val;
    }

    await this.auditLogsService.logAction({
      userId: adminId ?? undefined,
      actionType: 'ivss_presence_config_update',
      entityType: 'system_configs',
      severity: AuditLogSeverity.WARNING,
      metadataJson: { changed },
    });

    return this.getAll();
  }
}
