import { BadRequestException, Injectable, Logger } from '@nestjs/common';
import { DataSource } from 'typeorm';
import {
  SystemConfigEntity,
  SystemConfigValueType,
} from '../entities/system-config.entity.js';
import {
  findAllowlistEntry,
  type SystemConfigAllowlistEntry,
} from '../constants/system-config-allowlist.js';
import { SystemConfigResponseDto } from '../dto/system-config-response.dto.js';
import { AuditLogsService } from './audit-logs.service.js';
import { AuditLogSeverity } from '../entities/audit-log.entity.js';

/**
 * SystemConfigService (BE-09) — GET/PATCH `/system-configurations`.
 *
 * Chỉ đọc/ghi 9 key trong SYSTEM_CONFIG_ALLOWLIST (hệ tên phẳng FE quản trị) — KHÔNG đụng
 * 5 key có dấu chấm mà các `*-config.service.ts` khác (no-show, dashboard-overview,
 * gate-access...) đang đọc trực tiếp cho nghiệp vụ nội bộ của chúng.
 *
 * [Rủi ro đã biết — PLAN_THUC_THI_P1 §0.2b] `config_key` KHÔNG có unique index/constraint
 * trên RDS thật (chỉ PK trên `id`) — KHÔNG được dùng `ON CONFLICT (config_key)`. Upsert ở
 * đây dùng `SELECT ... FOR UPDATE` trong transaction rồi UPDATE/INSERT thủ công. Nếu phát
 * hiện >1 dòng cùng key (dữ liệu rác có sẵn), log cảnh báo + cập nhật dòng mới nhất
 * (`updated_at` lớn nhất), KHÔNG tạo thêm dòng mới.
 */
@Injectable()
export class SystemConfigService {
  private readonly logger = new Logger(SystemConfigService.name);

  constructor(
    private readonly dataSource: DataSource,
    private readonly auditLogsService: AuditLogsService,
  ) {}

  /** GET: chỉ trả key trong allowlist, is_active=true. Mask value khi is_sensitive=true. */
  async list(): Promise<SystemConfigResponseDto[]> {
    const repo = this.dataSource.getRepository(SystemConfigEntity);
    const rows = await repo.find({
      where: { isActive: true },
      order: { configGroup: 'ASC', configKey: 'ASC' },
    });

    const allowedKeys = new Set(
      rows
        .map((r) => r.configKey)
        .filter((k) => findAllowlistEntry(k) !== undefined),
    );

    return rows
      .filter((r) => allowedKeys.has(r.configKey))
      .map((r) => this.toResponse(r));
  }

  /**
   * PATCH: validate theo metadata allowlist (kiểu + biên) → SELECT FOR UPDATE trong
   * transaction → có thì UPDATE (version_no+1, updated_by, updated_at) → không thì INSERT.
   */
  async upsert(
    key: string,
    value: string,
    userId: string | undefined,
  ): Promise<SystemConfigResponseDto> {
    const entry = findAllowlistEntry(key);
    if (!entry) {
      throw new BadRequestException({
        success: false,
        message: `Key cấu hình '${key}' không nằm trong allowlist.`,
        error: { code: 'CONFIG_KEY_NOT_ALLOWED', details: { key } },
      });
    }

    this.validateValue(entry, value);

    let result: SystemConfigEntity;

    await this.dataSource.transaction(async (em) => {
      const rows: SystemConfigEntity[] = await em
        .createQueryBuilder(SystemConfigEntity, 'c')
        .where('c.configKey = :key', { key })
        .setLock('pessimistic_write')
        .getMany();

      if (rows.length > 1) {
        this.logger.warn(
          `system_configs.config_key='${key}' có ${rows.length} dòng trùng (thiếu unique index) — cập nhật dòng mới nhất, không tạo thêm.`,
        );
      }

      const target =
        rows.length > 0
          ? rows.reduce((latest, r) =>
              r.updatedAt > latest.updatedAt ? r : latest,
            )
          : null;

      if (target) {
        target.configValue = value;
        target.valueType = entry.valueType;
        target.configGroup = entry.configGroup;
        target.description = entry.description;
        target.isActive = true;
        target.updatedBy = userId ?? null;
        target.versionNo = (target.versionNo ?? 1) + 1;
        result = await em.save(SystemConfigEntity, target);
      } else {
        result = await em.save(
          SystemConfigEntity,
          em.create(SystemConfigEntity, {
            configKey: key,
            configValue: value,
            valueType: entry.valueType,
            configGroup: entry.configGroup,
            description: entry.description,
            isSensitive: false,
            isActive: true,
            versionNo: 1,
            updatedBy: userId ?? null,
          }),
        );
      }
    });

    await this.auditLogsService.logAction({
      userId,
      actionType: 'system_config_update',
      entityType: 'system_configs',
      severity: AuditLogSeverity.WARNING,
      metadataJson: { key, value },
    });

    return this.toResponse(result!);
  }

  private validateValue(
    entry: SystemConfigAllowlistEntry,
    value: string,
  ): void {
    if (entry.valueType === SystemConfigValueType.BOOLEAN) {
      if (value !== 'true' && value !== 'false') {
        throw new BadRequestException({
          success: false,
          message: `Value cho key '${entry.key}' phải là 'true' hoặc 'false'.`,
          error: {
            code: 'INVALID_CONFIG_VALUE',
            details: { key: entry.key, value },
          },
        });
      }
      return;
    }

    // NUMBER
    const n = Number(value);
    if (!Number.isFinite(n) || Number.isNaN(n)) {
      throw new BadRequestException({
        success: false,
        message: `Value cho key '${entry.key}' phải là số.`,
        error: {
          code: 'INVALID_CONFIG_VALUE',
          details: { key: entry.key, value },
        },
      });
    }
    if (entry.min !== undefined && n < entry.min) {
      throw new BadRequestException({
        success: false,
        message: `Value cho key '${entry.key}' phải >= ${entry.min}.`,
        error: {
          code: 'INVALID_CONFIG_VALUE',
          details: { key: entry.key, value, min: entry.min },
        },
      });
    }
    if (entry.max !== undefined && n > entry.max) {
      throw new BadRequestException({
        success: false,
        message: `Value cho key '${entry.key}' phải <= ${entry.max}.`,
        error: {
          code: 'INVALID_CONFIG_VALUE',
          details: { key: entry.key, value, max: entry.max },
        },
      });
    }
  }

  private toResponse(row: SystemConfigEntity): SystemConfigResponseDto {
    return {
      id: row.id,
      key: row.configKey,
      value: row.isSensitive ? null : row.configValue,
      valueType: row.valueType,
      configGroup: row.configGroup,
      description: row.description,
      isSensitive: row.isSensitive,
      updatedAt: row.updatedAt,
    };
  }
}
