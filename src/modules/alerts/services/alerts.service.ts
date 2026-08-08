import {
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import {
  Repository,
  IsNull,
  Not,
  Between,
  type FindOptionsWhere,
} from 'typeorm';
import { SecurityAlertEntity } from '../entities/security-alert.entity.js';
import type { ZoneEntity } from '../../zones/entities/zone.entity.js';
import type {
  AlertSeverity,
  RecordAlertInput,
  RecordAlertResult,
} from '../dto/record-alert.input.js';
import type { QuerySecurityAlertsDto } from '../dto/query-security-alerts.dto.js';
import type { ResolveSecurityAlertDto } from '../dto/resolve-security-alert.dto.js';
import type { PaginationMeta } from '../types/pagination-meta.type.js';

/**
 * Trần số phần tử `payload_json.occurrences` giữ lại mỗi alert (mirror `loadHistory()`
 * limit 20) — tránh phình payload vô hạn khi 1 alert bị bump hàng trăm lần.
 */
const MAX_OCCURRENCES_PER_ALERT = 20;

/** ASC-001 §2.2: severity mặc định tĩnh theo alert_type khi caller KHÔNG truyền override. */
const DEFAULT_SEVERITY_BY_TYPE: Record<string, AlertSeverity> = {
  intrusion: 'critical',
  crowd: 'high',
  vehicle_control_match: 'medium',
  person_watchlist_match: 'medium',
  stranger: 'medium',
  unknown_vehicle: 'medium',
  device_error: 'low',
};

export interface SecurityAlertDetail {
  alert: SecurityAlertEntity;
  zone: ZoneEntity | null;
  history: SecurityAlertEntity[];
}

const alertNotFound = (): NotFoundException =>
  new NotFoundException({
    code: 'SECURITY_ALERT_NOT_FOUND',
    message: 'Không tìm thấy cảnh báo an ninh',
  });

/**
 * AlertsService (ASC-001 / UC-123) — hạt nhân `recordAlert()` (điểm ghi DUY NHẤT vào
 * `security_alerts`, dùng chung cho 3d/UC-124/UC-125/UC-121 sau) + API Trung tâm cảnh
 * báo (list/detail/acknowledge/resolve/bulk).
 *
 * Dedup PHẢI qua unique partial index + bắt `23505` (KHÔNG pre-check — race window UC-121
 * EX1 gốc). Acknowledge/resolve PHẢI qua conditional UPDATE (`WHERE status = 'x'`) +
 * kiểm `affected` (EX1 race giữa 2 người cùng xử lý).
 */
@Injectable()
export class AlertsService {
  constructor(
    @InjectRepository(SecurityAlertEntity)
    private readonly repo: Repository<SecurityAlertEntity>,
  ) {}

  private resolveSeverity(
    alertType: string,
    override?: AlertSeverity,
  ): AlertSeverity {
    if (override) return override;
    return DEFAULT_SEVERITY_BY_TYPE[alertType] ?? 'medium';
  }

  /**
   * recordAlert (R1/R2 crux) — INSERT mới; nếu đã có alert đang mở cùng
   * (alertType, zoneId) → bắt 23505, chuyển UPDATE tăng occurrenceCount, GIỮ NGUYÊN
   * severity/triggeredAt gốc (§2.3/§2.4).
   */
  async recordAlert(input: RecordAlertInput): Promise<RecordAlertResult> {
    const zoneId = input.zoneId ?? null;
    const severity = this.resolveSeverity(input.alertType, input.severity);
    const triggeredAt = input.triggeredAt ?? new Date();

    const inserted = await this.tryInsert(input, zoneId, severity, triggeredAt);
    if (inserted) return { alert: inserted, isNew: true };

    const open = await this.findOpenAlert(input.alertType, zoneId);
    if (open) {
      const reloaded = await this.bumpOccurrence(open.id, input);
      return { alert: reloaded, isNew: false };
    }

    // Race hiếm: 23505 báo có alert mở nhưng SELECT lại không thấy (vừa resolved giữa
    // 2 bước) — retry INSERT đúng 1 lần, KHÔNG lặp vô hạn.
    const retried = await this.tryInsert(input, zoneId, severity, triggeredAt);
    if (retried) return { alert: retried, isNew: true };

    const openAfterRetry = await this.findOpenAlert(input.alertType, zoneId);
    if (openAfterRetry) {
      const reloaded = await this.bumpOccurrence(openAfterRetry.id, input);
      return { alert: reloaded, isNew: false };
    }
    throw new Error(
      `recordAlert: không thể INSERT hoặc UPDATE alert (alertType=${input.alertType}, zoneId=${String(zoneId)}) sau 1 lần retry`,
    );
  }

  private async tryInsert(
    input: RecordAlertInput,
    zoneId: string | null,
    severity: AlertSeverity,
    triggeredAt: Date,
  ): Promise<SecurityAlertEntity | null> {
    try {
      const entity = this.repo.create({
        alertType: input.alertType,
        severity,
        zoneId,
        status: 'new',
        triggeredAt,
        occurrenceCount: 1,
        sourceEventId: input.sourceEventId ?? null,
        ruleId: input.ruleId ?? null,
        payloadJson: input.payloadJson ?? null,
      });
      return await this.repo.save(entity);
    } catch (e) {
      if (this.isUniqueViolation(e)) return null;
      throw e;
    }
  }

  private async findOpenAlert(
    alertType: string,
    zoneId: string | null,
  ): Promise<SecurityAlertEntity | null> {
    const where: FindOptionsWhere<SecurityAlertEntity> = {
      alertType,
      zoneId: zoneId ?? IsNull(),
      status: Not('resolved'),
    };
    return this.repo.findOne({ where });
  }

  /**
   * bumpOccurrence (fix 2026-08-09, recon "nhiều người vi phạm cùng 1 alert") — trước đây
   * CHỈ update `last_seen_at`/`occurrence_count`, làm mất danh tính (`userId`/
   * `sourceEventId`) của MỌI lần vi phạm sau lần đầu (chỉ alert gốc từ `tryInsert()` giữ
   * được). Nay APPEND {userId, sourceEventId, occurredAt} của lần vi phạm hiện tại vào
   * `payload_json.occurrences` — top-level `source_event_id`/`payload_json` gốc của alert
   * VẪN giữ nguyên làm "đại diện" (ảnh chính hiển thị UI), `occurrences` chỉ bổ sung lịch
   * sử đầy đủ. Cắt còn `MAX_OCCURRENCES_PER_ALERT` phần tử gần nhất.
   *
   * PHẢI atomic trong 1 câu UPDATE (đọc + ghi `payload_json` của CHÍNH row đang bị khoá bởi
   * `WHERE id = $1`, giống hệt cách `occurrence_count = occurrence_count + 1` đã an toàn từ
   * trước) — KHÔNG SELECT rồi UPDATE riêng ở tầng JS, vì đó là race giữa 2 bump gần như
   * đồng thời (mất 1 entry). Áp dụng chung cho CẢ 5 alertType gọi `recordAlert()`
   * (intrusion/crowd/stranger/vehicle_control_match/person_watchlist_match) — cùng 1 bài
   * toán "mất dấu vết khi nhiều sự kiện bump vào 1 alert", không gate riêng theo loại.
   */
  private async bumpOccurrence(
    id: string,
    input: RecordAlertInput,
  ): Promise<SecurityAlertEntity> {
    const entry = {
      userId: (input.payloadJson?.userId as string | null | undefined) ?? null,
      sourceEventId: input.sourceEventId ?? null,
      occurredAt:
        (input.payloadJson?.occurredAt as string | undefined) ??
        new Date().toISOString(),
    };

    await this.repo.query(
      `UPDATE security_alerts
          SET last_seen_at = NOW(),
              occurrence_count = occurrence_count + 1,
              payload_json = jsonb_set(
                COALESCE(payload_json, '{}'::jsonb),
                '{occurrences}',
                (
                  SELECT COALESCE(jsonb_agg(elem ORDER BY ord), '[]'::jsonb)
                  FROM jsonb_array_elements(
                         COALESCE(payload_json -> 'occurrences', '[]'::jsonb)
                         || jsonb_build_array($2::jsonb)
                       ) WITH ORDINALITY AS t(elem, ord)
                  WHERE ord > GREATEST(
                    jsonb_array_length(
                      COALESCE(payload_json -> 'occurrences', '[]'::jsonb)
                      || jsonb_build_array($2::jsonb)
                    ) - $3,
                    0
                  )
                ),
                true
              )
        WHERE id = $1`,
      [id, JSON.stringify(entry), MAX_OCCURRENCES_PER_ALERT],
    );
    return this.getOrThrow(id);
  }

  async list(
    query: QuerySecurityAlertsDto,
  ): Promise<{ items: SecurityAlertEntity[]; meta: PaginationMeta }> {
    const page = query.page ?? 1;
    const limit = query.limit ?? 20;

    const where: FindOptionsWhere<SecurityAlertEntity> = {};
    if (query.alertType) where.alertType = query.alertType;
    if (query.zoneId) where.zoneId = query.zoneId;
    if (query.status) where.status = query.status;
    if (query.from && query.to) {
      where.triggeredAt = Between(new Date(query.from), new Date(query.to));
    }

    const sortBy = query.sortBy ?? 'triggeredAt';
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

  /** R4 — detail: alert + zone (deleted_at IS NULL filter, §5.5 rule 1) + history (§2.6). */
  async findDetail(id: string): Promise<SecurityAlertDetail> {
    const alert = await this.repo.findOne({
      where: { id },
      relations: { zone: true, sourceEvent: true, rule: true },
    });
    if (!alert) throw alertNotFound();

    const zone = alert.zone && !alert.zone.deletedAt ? alert.zone : null;

    const history = await this.loadHistory(
      alert.alertType,
      alert.zoneId,
      alert.id,
    );

    return { alert, zone, history };
  }

  /** §2.6: cùng alertType + zoneId (IS NOT DISTINCT FROM cho case zoneId NULL), tối đa 20. */
  private async loadHistory(
    alertType: string,
    zoneId: string | null,
    excludeId: string,
  ): Promise<SecurityAlertEntity[]> {
    return this.repo
      .createQueryBuilder('a')
      .where('a.alert_type = :alertType', { alertType })
      .andWhere('a.zone_id IS NOT DISTINCT FROM :zoneId', { zoneId })
      .andWhere('a.id != :excludeId', { excludeId })
      .orderBy('a.triggered_at', 'DESC')
      .limit(20)
      .getMany();
  }

  /** R5/R6 (crux EX1) — conditional UPDATE, KHÔNG select-rồi-update. */
  async acknowledge(
    id: string,
    actorUserId: string,
  ): Promise<SecurityAlertEntity> {
    const result = await this.repo.update(
      { id, status: 'new' },
      {
        status: 'acknowledged',
        acknowledgedBy: actorUserId,
        acknowledgedAt: new Date(),
      },
    );
    if (!result.affected) {
      throw this.alreadyProcessedConflict(await this.getOrThrow(id));
    }
    return this.getOrThrow(id);
  }

  /** R7/R8 — chỉ resolve được từ status='acknowledged'. */
  async resolve(
    id: string,
    dto: ResolveSecurityAlertDto,
    actorUserId: string,
  ): Promise<SecurityAlertEntity> {
    const result = await this.repo.update(
      { id, status: 'acknowledged' },
      {
        status: 'resolved',
        resolvedBy: actorUserId,
        resolvedAt: new Date(),
        resolutionNote: dto.resolutionNote,
      },
    );
    if (!result.affected) {
      throw this.alreadyProcessedConflict(await this.getOrThrow(id));
    }
    return this.getOrThrow(id);
  }

  /** R9 AF1 — xử lý từng id độc lập, 1 lỗi/conflict KHÔNG chặn id khác. */
  async bulkAcknowledge(
    ids: string[],
    actorUserId: string,
  ): Promise<{
    acknowledged: string[];
    alreadyProcessed: Array<{
      id: string;
      status: string;
      by: string | null;
      at: Date | null;
    }>;
  }> {
    const acknowledged: string[] = [];
    const alreadyProcessed: Array<{
      id: string;
      status: string;
      by: string | null;
      at: Date | null;
    }> = [];

    for (const id of ids) {
      try {
        await this.acknowledge(id, actorUserId);
        acknowledged.push(id);
      } catch (e) {
        if (e instanceof ConflictException) {
          const response = e.getResponse() as {
            status?: string;
            by?: string | null;
            at?: Date | null;
          };
          alreadyProcessed.push({
            id,
            status: response.status ?? 'unknown',
            by: response.by ?? null,
            at: response.at ?? null,
          });
        } else {
          throw e;
        }
      }
    }

    return { acknowledged, alreadyProcessed };
  }

  private async getOrThrow(id: string): Promise<SecurityAlertEntity> {
    const entity = await this.repo.findOne({ where: { id } });
    if (!entity) throw alertNotFound();
    return entity;
  }

  private alreadyProcessedConflict(
    current: SecurityAlertEntity,
  ): ConflictException {
    const by =
      current.status === 'resolved'
        ? current.resolvedBy
        : current.acknowledgedBy;
    const at =
      current.status === 'resolved'
        ? current.resolvedAt
        : current.acknowledgedAt;
    return new ConflictException({
      code: 'SECURITY_ALERT_ALREADY_PROCESSED',
      message: `Cảnh báo đã được xử lý (status=${current.status})`,
      status: current.status,
      by,
      at,
    });
  }

  /** Postgres unique_violation = 23505 (TypeORM QueryFailedError.driverError.code). */
  private isUniqueViolation(e: unknown): boolean {
    const code =
      (e as { driverError?: { code?: string }; code?: string })?.driverError
        ?.code ?? (e as { code?: string })?.code;
    return code === '23505';
  }
}
