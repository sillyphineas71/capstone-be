import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { GateAccessLogEntity } from '../entities/gate-access-log.entity.js';
import type { PaginationMeta } from './zones.service.js';
// Import chéo CÓ CHỦ ĐÍCH: normalizePlate là nguồn DUY NHẤT chuẩn hoá biển số toàn hệ
// (pure util, không phải service/module) — biển ở gate_access_logs phải cùng dạng chuẩn hoá
// với vehicle_registrations, khác dạng thì đối chiếu vỡ. `anpr` không import `zones` ⇒ không circular.
import { normalizePlate } from '../../anpr/utils/normalize-plate.js';
import type { ListGateAccessLogsQueryDto } from '../dto/list-gate-access-logs-query.dto.js';
import type { AdminListGateAccessLogsQueryDto } from '../dto/admin-list-gate-access-logs-query.dto.js';

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
  constructor(
    @InjectRepository(GateAccessLogEntity)
    private readonly repo: Repository<GateAccessLogEntity>,
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
}
