import {
  Injectable,
  BadRequestException,
  ConflictException,
  NotFoundException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository, IsNull, Not, type FindOptionsWhere } from 'typeorm';
import { AlertRuleEntity } from '../entities/alert-rule.entity.js';
import { ZoneEntity } from '../../zones/entities/zone.entity.js';
import { PRESENCE_ZONE_TYPES } from '../../ivss/constants/zone-presence.constant.js';
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
    @InjectRepository(ZoneEntity)
    private readonly zoneRepo: Repository<ZoneEntity>,
  ) {}

  async create(
    dto: CreateAlertRuleDto,
    actorUserId: string,
  ): Promise<AlertRuleEntity> {
    const zoneId = dto.zoneId ?? null;
    await this.assertNoConflict(dto.alertType, zoneId);
    if (dto.alertType === 'intrusion' && zoneId) {
      await this.assertValidIntrusionZone(zoneId);
    }

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
      if (nextAlertType === 'intrusion' && nextZoneId) {
        await this.assertValidIntrusionZone(nextZoneId);
      }
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

  /**
   * [FIX 2026-08-11] Chặn tạo/sửa rule `intrusion` gắn zone KHÔNG hợp lệ cho presence —
   * tránh bẫy cấu hình im lặng (rule tạo được nhưng KHÔNG BAO GIỜ kích hoạt vì
   * `ZonePresenceWriterService.writeAppearEvent()` chỉ ghi `zone_presence_events` cho
   * `zone.type ∈ PRESENCE_ZONE_TYPES`, xem `zone-presence-writer.service.ts` QC-5). CHỈ gọi
   * cho `alertType === 'intrusion'` (đọc `event_type='appear'`) — KHÔNG áp cho `crowd` (đọc
   * `event_type='count'`, không giới hạn zone_type) hay 4 loại còn lại (không đọc
   * `zone_presence_events`). Tái dùng `PRESENCE_ZONE_TYPES` export sẵn từ `ivss` — KHÔNG
   * hardcode lại danh sách lần 2 (`zones/services/zone-presence-writer.service.ts` cũng có
   * 1 bản PRIVATE tương tự, chủ ý không export để giữ đúng chiều phụ thuộc `ivss → zones`).
   */
  private async assertValidIntrusionZone(zoneId: string): Promise<void> {
    const zone = await this.zoneRepo.findOne({
      where: { id: zoneId, deletedAt: IsNull() },
    });
    if (!zone) {
      throw new BadRequestException({
        code: 'ALERT_RULE_ZONE_NOT_FOUND',
        message: 'Không tìm thấy zone hoặc zone đã bị xoá.',
      });
    }
    if (!(PRESENCE_ZONE_TYPES as readonly string[]).includes(zone.zoneType)) {
      throw new BadRequestException({
        code: 'ALERT_RULE_ZONE_WRONG_TYPE',
        message: `Zone này (loại "${zone.zoneType}") không ghi nhận dữ liệu hiện diện (appear) — chỉ khu vực corridor/lobby/parking mới hợp lệ cho rule intrusion. Chọn zone khác hoặc đổi loại rule.`,
      });
    }
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
