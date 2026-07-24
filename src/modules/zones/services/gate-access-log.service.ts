import { Injectable, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { DataSource, Repository } from 'typeorm';
import { GateAccessLogEntity } from '../entities/gate-access-log.entity.js';
import type { PaginationMeta } from './zones.service.js';
// Import chéo CÓ CHỦ ĐÍCH: normalizePlate là nguồn DUY NHẤT chuẩn hoá biển số toàn hệ
// (pure util, không phải service/module) — biển ở gate_access_logs phải cùng dạng chuẩn hoá
// với vehicle_registrations, khác dạng thì đối chiếu vỡ. `anpr` không import `zones` ⇒ không circular.
import { normalizePlate } from '../../anpr/utils/normalize-plate.js';
import type { ListGateAccessLogsQueryDto } from '../dto/list-gate-access-logs-query.dto.js';
import type { AdminListGateAccessLogsQueryDto } from '../dto/admin-list-gate-access-logs-query.dto.js';

/**
 * Input ghi một dòng `gate_access_logs` (GAW-001 / UC-105). `anpr` đã resolve sạch:
 * `direction` chỉ enter/leave (đã loại seen), `accessTime` TỪ `evt.utc` (KHÔNG now()),
 * `plateNumber` đã normalize + đảm bảo ≤16 (rỗng → null; >16 → phía anpr skip plate_too_long).
 */
export interface WriteGateLogInput {
  zoneId: string;
  direction: 'enter' | 'leave';
  accessTime: Date;
  deviceId?: string | null;
  eventId?: string | null;
  userId?: string | null;
  vehicleRegistrationId?: string | null;
  plateNumber?: string | null;
  metadata?: Record<string, unknown> | null;
}

/** Kết quả ghi: thành công (có logId để pairing) hoặc không ghi (nêu lý do). */
export type WriteGateLogResult =
  | { written: true; logId: string }
  | { written: false; skipReason: 'zone_not_gate' | 'duplicate' };

/**
 * GateAccessLogService (GAL-001 / UC-107) — đọc lịch sử ra/vào cổng (read-only).
 *
 * 2 method: listForUser (log CỦA MÌNH, fold cứng userId) / listAll (admin, mọi người).
 * QueryBuilder cho cả hai vì cần leftJoinAndSelect tên cổng (route user cũng trả zone_name).
 *
 * ⚠⚠ BẢNG APPEND-ONLY: `gate_access_logs` KHÔNG có cột `deleted_at` ⇒ TUYỆT ĐỐI KHÔNG
 * `deletedAt`/`IsNull()`. Và cũng KHÔNG lọc `z.deletedAt`/`u.deletedAt` của bảng được join:
 * đây là log LỊCH SỬ, phải giữ tên cổng/người kể cả khi zone/user đã xoá mềm (khác truy vấn
 * VẬN HÀNH của UC-92/93/94). SEC-03: mọi giá trị qua bound param.
 */
@Injectable()
export class GateAccessLogService {
  private readonly logger = new Logger(GateAccessLogService.name);

  constructor(
    @InjectRepository(GateAccessLogEntity)
    private readonly repo: Repository<GateAccessLogEntity>,
    private readonly dataSource: DataSource,
  ) {}

  /** USER: log của current user. Fold cứng gal.userId (SEC-01). */
  async listForUser(
    userId: string,
    query: ListGateAccessLogsQueryDto,
  ): Promise<{ items: GateAccessLogEntity[]; meta: PaginationMeta }> {
    const page = query.page ?? 1;
    const limit = query.limit ?? 20;

    const qb = this.repo
      .createQueryBuilder('gal')
      // KHÔNG lọc z.deletedAt: log lịch sử phải giữ tên cổng dù zone đã xoá mềm.
      .leftJoinAndSelect('gal.zone', 'z')
      .where('gal.userId = :userId', { userId });

    this.applyFilters(qb, query);

    const [items, total] = await qb
      .orderBy('gal.accessTime', 'DESC')
      .skip((page - 1) * limit)
      .take(limit)
      .getManyAndCount();

    return {
      items,
      meta: { page, limit, total, totalPages: Math.ceil(total / limit) },
    };
  }

  /** ADMIN: log của mọi người (KHÔNG fold userId). Thêm filter user_id/plate. */
  async listAll(
    query: AdminListGateAccessLogsQueryDto,
  ): Promise<{ items: GateAccessLogEntity[]; meta: PaginationMeta }> {
    const page = query.page ?? 1;
    const limit = query.limit ?? 20;

    const qb = this.repo
      .createQueryBuilder('gal')
      // KHÔNG lọc z.deletedAt/u.deletedAt: log lịch sử phải giữ tên cổng/người dù đã xoá mềm.
      .leftJoinAndSelect('gal.zone', 'z')
      .leftJoinAndSelect('gal.user', 'u');
    // KHÔNG .where() fold — andWhere từ đầu HỢP LỆ (TypeORM bỏ tiền tố AND ở mệnh đề đầu).

    this.applyFilters(qb, query);

    if (query.userId) {
      qb.andWhere('gal.userId = :uid', { uid: query.userId });
    }
    if (query.plate) {
      // normalize trước so exact (dùng IDX_gate_logs_plate) — giả định writer ghi chuẩn hoá.
      qb.andWhere('gal.plateNumber = :plate', {
        plate: normalizePlate(query.plate),
      });
    }

    const [items, total] = await qb
      .orderBy('gal.accessTime', 'DESC')
      .skip((page - 1) * limit)
      .take(limit)
      .getManyAndCount();

    return {
      items,
      meta: { page, limit, total, totalPages: Math.ceil(total / limit) },
    };
  }

  /**
   * Filter dùng chung (mutate qb): from/to/direction/zone_id — chỉ thêm khi có giá trị
   * (cấm undefined lọt where), bound param (SEC-03). KHÔNG deletedAt.
   */
  private applyFilters(
    qb: import('typeorm').SelectQueryBuilder<GateAccessLogEntity>,
    query: ListGateAccessLogsQueryDto,
  ): void {
    if (query.from) {
      qb.andWhere('gal.accessTime >= :from', { from: query.from });
    }
    if (query.to) {
      qb.andWhere('gal.accessTime <= :to', { to: query.to });
    }
    if (query.direction) {
      qb.andWhere('gal.direction = :direction', { direction: query.direction });
    }
    if (query.zoneId) {
      qb.andWhere('gal.zoneId = :zoneId', { zoneId: query.zoneId });
    }
  }

  /**
   * WRITER (GAW-001 / UC-105) — ghi MỘT dòng `gate_access_logs`. Nguồn ghi DUY NHẤT của bảng
   * (QĐ-1/QC-3): `anpr` gọi method này, KHÔNG bắn raw SQL chéo.
   *
   * Tự kiểm zone là bên chủ (QC-4): zone phải tồn tại, `zone_type='gate'`, chưa xoá mềm —
   * kiểm TRƯỚC khi mở queryRunner nên nhánh `zone_not_gate` thoát sớm, không cần release.
   *
   * Transaction RIÊNG, COMMIT trước khi return (nền QĐ-8: pairing là tx khác của caller).
   * Bắt `23505` (UQ_gate_logs_content — bridge retry) → rollback → `duplicate`, KHÔNG ném.
   * Lỗi khác → rollback → ném lại (caller nuốt theo spec §8.1). `release()` trong `finally`.
   *
   * ⚠ `accessTime` do caller đưa vào PHẢI từ `evt.utc` — method KHÔNG tự sinh thời gian.
   */
  async writeGateLog(input: WriteGateLogInput): Promise<WriteGateLogResult> {
    // 1. Kiểm zone (QC-4) — ngoài transaction. deleted_at IS NULL vì zone soft-delete
    //    (FK RESTRICT không chạy với soft-delete, chặn theo tầng application).
    const zoneRows: Array<{ zone_type: string }> =
      await this.dataSource.manager.query(
        `SELECT zone_type FROM zones WHERE id = $1 AND deleted_at IS NULL LIMIT 1`,
        [input.zoneId],
      );
    if (zoneRows.length === 0 || zoneRows[0].zone_type !== 'gate') {
      return { written: false, skipReason: 'zone_not_gate' };
    }

    // 2. INSERT trong transaction riêng. metadata → jsonb (NULL nếu không có).
    const metaJson =
      input.metadata && Object.keys(input.metadata).length > 0
        ? JSON.stringify(input.metadata)
        : null;

    const qr = this.dataSource.createQueryRunner();
    await qr.connect();
    await qr.startTransaction();
    try {
      const rows: Array<{ id: string }> = await qr.manager.query(
        `INSERT INTO gate_access_logs
           (zone_id, device_id, event_id, user_id, vehicle_registration_id,
            plate_number, direction, access_time, metadata_json)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9::jsonb)
         RETURNING id`,
        [
          input.zoneId,
          input.deviceId ?? null,
          input.eventId ?? null,
          input.userId ?? null,
          input.vehicleRegistrationId ?? null,
          input.plateNumber ?? null,
          input.direction,
          input.accessTime,
          metaJson,
        ],
      );
      await qr.commitTransaction();
      return { written: true, logId: rows[0].id };
    } catch (e) {
      await qr.rollbackTransaction();
      if (this.isUniqueViolation(e)) {
        // Bridge retry → UQ_gate_logs_content chặn đúng (QC-1). KHÔNG phải lỗi.
        this.logger.log(
          `writeGateLog: dedup (23505) zone=${input.zoneId} plate=${input.plateNumber ?? 'null'} dir=${input.direction}`,
        );
        return { written: false, skipReason: 'duplicate' };
      }
      throw e;
    } finally {
      await qr.release();
    }
  }

  /** Nhận diện lỗi unique violation Postgres (23505). Mirror vehicle-registration.service. */
  private isUniqueViolation(e: unknown): boolean {
    return (
      (e as { driverError?: { code?: string } })?.driverError?.code ===
        '23505' || (e as { code?: string })?.code === '23505'
    );
  }
}
