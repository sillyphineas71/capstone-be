import {
  Injectable,
  ConflictException,
  NotFoundException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository, IsNull, Not, type FindOptionsWhere } from 'typeorm';
import { AlertRuleEntity } from '../entities/alert-rule.entity.js';
import type { CreateAlertRuleDto } from '../dto/create-alert-rule.dto.js';
import type { UpdateAlertRuleDto } from '../dto/update-alert-rule.dto.js';
import type { QueryAlertRulesDto } from '../dto/query-alert-rules.dto.js';
import type { PaginationMeta } from '../types/pagination-meta.type.js';

/** ARL-001/DATA-02: conflict trùng (alert_type, zone_id) còn sống — dùng chung pre-check + safety-net 23505. */
const alertRuleConflict = (
  alertType: string,
  zoneId: string | null,
): ConflictException =>
  new ConflictException({
    code: 'ALERT_RULE_ALREADY_EXISTS',
    message: zoneId
      ? `Đã tồn tại rule "${alertType}" cho zone này`
      : `Đã tồn tại rule mặc định "${alertType}" cho toàn khuôn viên`,
  });

export interface EffectiveRuleResult {
  rule: AlertRuleEntity | null;
  suppressed: boolean;
}

/**
 * AlertRulesService (ARL-001 / UC-122) — CRUD ngưỡng/kênh/bật-tắt theo loại sự kiện,
 * rule theo zone override rule mặc định (BR2). File MỚI HOÀN TOÀN, KHÔNG đụng
 * `VehicleControlListService` (chấp nhận trùng nhỏ `isUniqueViolation` giữa các service,
 * mirror decision đã áp dụng ở UC8/UC9 — xem spec plan §0).
 */
@Injectable()
export class AlertRulesService {
  constructor(
    @InjectRepository(AlertRuleEntity)
    private readonly repo: Repository<AlertRuleEntity>,
  ) {}

  async create(
    dto: CreateAlertRuleDto,
    actorUserId: string,
  ): Promise<AlertRuleEntity> {
    const zoneId = dto.zoneId ?? null;
    await this.assertNoConflict(dto.alertType, zoneId);

    const entity = this.repo.create({
      alertType: dto.alertType,
      zoneId,
      threshold: dto.threshold ?? null,
      channels: dto.channels,
      enabled: dto.enabled ?? true,
      restrictedHoursJson:
        (dto.restrictedHoursJson as unknown as Record<string, unknown>) ?? null,
      allowedPersonIdsJson: dto.allowedPersonIdsJson ?? null,
      createdBy: actorUserId,
      updatedBy: actorUserId,
    });

    try {
      return await this.repo.save(entity);
    } catch (e) {
      if (this.isUniqueViolation(e)) {
        throw alertRuleConflict(dto.alertType, zoneId);
      }
      throw e;
    }
  }

  async list(
    query: QueryAlertRulesDto,
  ): Promise<{ items: AlertRuleEntity[]; meta: PaginationMeta }> {
    const page = query.page ?? 1;
    const limit = query.limit ?? 20;

    const where: FindOptionsWhere<AlertRuleEntity> = { deletedAt: IsNull() };
    if (query.alertType) {
      where.alertType = query.alertType;
    }
    if (query.zoneId) {
      where.zoneId = query.zoneId;
    }
    // enabled=false là filter hợp lệ — PHẢI check !== undefined, KHÔNG if-truthy.
    if (query.enabled !== undefined) {
      where.enabled = query.enabled;
    }

    const sortBy = query.sortBy ?? 'createdAt';
    const sortOrder = (query.sortOrder ?? 'desc').toUpperCase() as
      | 'ASC'
      | 'DESC';

    const [items, total] = await this.repo.findAndCount({
      where,
      order: { [sortBy]: sortOrder },
      skip: (page - 1) * limit,
      take: limit,
    });

    return {
      items,
      meta: { page, limit, total, totalPages: Math.ceil(total / limit) },
    };
  }

  async findOne(id: string): Promise<AlertRuleEntity> {
    const entity = await this.repo.findOne({
      where: { id, deletedAt: IsNull() },
    });
    if (!entity) {
      throw new NotFoundException({
        code: 'ALERT_RULE_NOT_FOUND',
        message: 'Không tìm thấy rule cảnh báo',
      });
    }
    return entity;
  }

  async update(
    id: string,
    dto: UpdateAlertRuleDto,
    actorUserId: string,
  ): Promise<AlertRuleEntity> {
    const entity = await this.findOne(id);

    const nextAlertType = dto.alertType ?? entity.alertType;
    const nextZoneId =
      dto.zoneId !== undefined ? (dto.zoneId ?? null) : entity.zoneId;
    const zoneOrTypeChanged =
      nextAlertType !== entity.alertType || nextZoneId !== entity.zoneId;

    if (zoneOrTypeChanged) {
      await this.assertNoConflict(nextAlertType, nextZoneId, id);
    }

    entity.alertType = nextAlertType;
    entity.zoneId = nextZoneId;
    if (dto.threshold !== undefined) entity.threshold = dto.threshold;
    if (dto.channels !== undefined) entity.channels = dto.channels;
    if (dto.enabled !== undefined) entity.enabled = dto.enabled;
    if (dto.restrictedHoursJson !== undefined)
      entity.restrictedHoursJson = dto.restrictedHoursJson as unknown as Record<
        string,
        unknown
      >;
    if (dto.allowedPersonIdsJson !== undefined)
      entity.allowedPersonIdsJson = dto.allowedPersonIdsJson;
    entity.updatedBy = actorUserId;

    try {
      return await this.repo.save(entity);
    } catch (e) {
      if (this.isUniqueViolation(e)) {
        throw alertRuleConflict(nextAlertType, nextZoneId);
      }
      throw e;
    }
  }

  async remove(id: string, actorUserId: string): Promise<void> {
    await this.findOne(id);
    await this.repo.update(id, { updatedBy: actorUserId });
    await this.repo.softDelete(id);
  }

  /**
   * findActiveRule (spec §4/R8) — rule riêng zone trước, fallback rule mặc định toàn
   * khuôn viên (BR2 override). Trả `null` nếu không có rule nào BẬT (không phân biệt
   * "chưa cấu hình" vs "đã tắt" — dùng `findEffectiveRule` nếu cần phân biệt).
   */
  async findActiveRule(
    alertType: string,
    zoneId?: string | null,
  ): Promise<AlertRuleEntity | null> {
    if (zoneId) {
      const zoned = await this.repo.findOne({
        where: { alertType, zoneId, enabled: true, deletedAt: IsNull() },
      });
      if (zoned) return zoned;
    }
    return this.repo.findOne({
      where: {
        alertType,
        zoneId: IsNull(),
        enabled: true,
        deletedAt: IsNull(),
      },
    });
  }

  /**
   * findEffectiveRule (spec §2.8/§4/R10) — phân biệt "chưa cấu hình" (fail-open, KHÔNG
   * suppress) vs "đã tắt tường minh" (suppress). Dùng bởi UC-123/3d/124/125 TRƯỚC KHI
   * gọi `recordAlert()`.
   */
  async findEffectiveRule(
    alertType: string,
    zoneId?: string | null,
  ): Promise<EffectiveRuleResult> {
    const enabled = await this.findActiveRule(alertType, zoneId);
    if (enabled) return { rule: enabled, suppressed: false };

    if (zoneId) {
      const zonedDisabled = await this.repo.findOne({
        where: { alertType, zoneId, enabled: false, deletedAt: IsNull() },
      });
      if (zonedDisabled) return { rule: null, suppressed: true };
    }
    const globalDisabled = await this.repo.findOne({
      where: {
        alertType,
        zoneId: IsNull(),
        enabled: false,
        deletedAt: IsNull(),
      },
    });
    if (globalDisabled) return { rule: null, suppressed: true };

    return { rule: null, suppressed: false }; // chưa từng cấu hình — fail-open (§2.8).
  }

  private async assertNoConflict(
    alertType: string,
    zoneId: string | null,
    excludeId?: string,
  ): Promise<void> {
    const where: FindOptionsWhere<AlertRuleEntity> = {
      alertType,
      zoneId: zoneId ?? IsNull(),
      deletedAt: IsNull(),
    };
    if (excludeId) {
      where.id = Not(excludeId);
    }
    const existing = await this.repo.findOne({ where });
    if (existing) {
      throw alertRuleConflict(alertType, zoneId);
    }
  }

  /** Postgres unique_violation = 23505 (TypeORM QueryFailedError.driverError.code). */
  private isUniqueViolation(e: unknown): boolean {
    const code =
      (e as { driverError?: { code?: string }; code?: string })?.driverError
        ?.code ?? (e as { code?: string })?.code;
    return code === '23505';
  }
}
