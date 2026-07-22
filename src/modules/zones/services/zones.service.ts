import {
  Injectable,
  ConflictException,
  NotFoundException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import {
  Repository,
  IsNull,
  Not,
  DataSource,
  type FindOptionsWhere,
} from 'typeorm';
import { ZoneEntity } from '../entities/zone.entity.js';
import { normalizeZoneCode } from '../utils/normalize-zone-code.js';
import { ZonesAuditRepository } from '../repositories/zones-audit.repository.js';
import { IotDevicesService } from '../../iot/services/iot-devices.service.js';
import type { CreateZoneDto } from '../dto/create-zone.dto.js';
import type { UpdateZoneDto } from '../dto/update-zone.dto.js';
import type { ListZonesQueryDto } from '../dto/list-zones-query.dto.js';

/**
 * Meta phân trang (ZNL-001 / UC-93) — shape khớp CLAUDE.md §8.4 và tiền lệ repo.
 *
 * CỐ Ý khai lại trong module `zones`: interface cùng tên bên ANPR là **cục bộ, không export**,
 * và import xuyên module sẽ vi phạm ARCH-01.
 */
export interface PaginationMeta {
  page: number;
  limit: number;
  total: number;
  totalPages: number;
}

/**
 * Conflict trùng mã khu vực — dùng CHUNG cho pre-check và safety-net 23505 để hai nhánh
 * trả về ĐÚNG một payload (client không phân biệt được mình thua ở bước nào).
 */
const zoneCodeConflict = (): ConflictException =>
  new ConflictException({
    code: 'ZONE_CODE_EXISTS',
    message: 'Mã khu vực đã tồn tại',
  });

/** Field được phép cập nhật qua UC-91 (OQ-1: tất cả field nghiệp vụ, gồm cả `zone_code`). */
type ZoneUpdatableFields = Pick<
  ZoneEntity,
  | 'zoneCode'
  | 'zoneName'
  | 'zoneType'
  | 'status'
  | 'building'
  | 'floor'
  | 'description'
  | 'metadataJson'
>;

/**
 * ZonesService (ZNC-001 / UC-90 + ZNU-001 / UC-91) — tạo và cập nhật khu vực.
 *
 * OQ-8: KHÔNG audit, KHÔNG transaction, KHÔNG `DataSource`/`queryRunner` — mỗi thao tác chỉ
 * ghi 1 bảng bằng 1 lệnh. Audit cho cả cụm zone làm ở UC-92 (xóa zone).
 *
 * ⚠ Ràng buộc kèm UC-91 (OQ-1): `zone_code` nay VỪA đổi được (UC-91) VỪA tái dùng được sau
 * soft-delete (UC-90 OQ-3) ⇒ mọi báo cáo/truy vết lịch sử PHẢI khóa theo `zone_id`, KHÔNG
 * theo `zone_code`.
 */
@Injectable()
export class ZonesService {
  constructor(
    @InjectRepository(ZoneEntity)
    private readonly repo: Repository<ZoneEntity>,
    private readonly dataSource: DataSource,
    private readonly zonesAuditRepository: ZonesAuditRepository,
    // ARCH-01: kiểm tra thiết bị của zone PHẢI qua service của module `iot`, KHÔNG query
    // thẳng bảng `iot_devices`. Phụ thuộc `zones → iot` là MỘT CHIỀU, vĩnh viễn (OQ-1b).
    private readonly iotDevicesService: IotDevicesService,
  ) {}

  /**
   * Tạo khu vực (UC-90) — UC-92 bọc thêm transaction + audit, **hành vi nghiệp vụ KHÔNG đổi**.
   *
   * Pre-check trùng mã đặt NGOÀI transaction (nhất quán với `remove()`: fail nhanh, không tốn
   * connection). Safety-net `23505` nằm TRONG transaction vẫn phủ race, và nhánh catch phải
   * rollback — thiếu rollback là treo transaction → rò connection pool.
   */
  async create(dto: CreateZoneDto, actorUserId: string): Promise<ZoneEntity> {
    // OQ-5: chuẩn hóa TRƯỚC pre-check để pre-check và bản ghi lưu dùng cùng một giá trị.
    const zoneCode = normalizeZoneCode(dto.zoneCode);

    // CRUX: `deletedAt: IsNull()` BẮT BUỘC — khớp ngữ nghĩa partial unique
    // `UQ_zones_code_active` và OQ-3 (mã của zone đã xóa-mềm được phép dùng lại).
    const existing = await this.repo.findOne({
      where: { zoneCode, deletedAt: IsNull() },
    });
    if (existing) {
      throw zoneCodeConflict();
    }

    const entity = this.repo.create({
      zoneCode,
      zoneName: dto.zoneName,
      zoneType: dto.zoneType,
      building: dto.building ?? null,
      floor: dto.floor ?? null,
      description: dto.description ?? null,
      metadataJson: dto.metadataJson ?? null,
    });

    const queryRunner = this.dataSource.createQueryRunner();
    await queryRunner.connect();
    await queryRunner.startTransaction();

    try {
      const saved = await queryRunner.manager.save(ZoneEntity, entity);
      await this.zonesAuditRepository.logZoneCreation(queryRunner.manager, {
        userId: actorUserId,
        zoneId: saved.id,
        zoneCode: saved.zoneCode,
        zoneType: saved.zoneType,
      });
      await queryRunner.commitTransaction();
      return saved;
    } catch (e) {
      await queryRunner.rollbackTransaction();
      // Safety-net race: hai request cùng mã cùng lọt pre-check → partial unique chặn ở DB.
      // Dịch thành 409 sạch, KHÔNG để lỗi driver/stack phọt ra client (ENG-03).
      if (this.isUniqueViolation(e)) {
        throw zoneCodeConflict();
      }
      throw e;
    } finally {
      await queryRunner.release();
    }
  }

  // ── UC-91 (ZNU-001): cập nhật khu vực ──

  /**
   * Load 1 zone ĐANG SỐNG (OQ-9). Fold existence + soft-delete vào 1 query → không khớp = 404.
   *
   * KHÔNG có phần ownership như `loadOwned` của ANPR: zone là dữ liệu dùng chung, không có
   * chủ sở hữu, nên 404 ở đây thuần túy là "không tồn tại".
   */
  private async loadActive(id: string): Promise<ZoneEntity> {
    const entity = await this.repo.findOne({
      where: { id, deletedAt: IsNull() },
    });
    if (!entity) {
      throw new NotFoundException({
        code: 'ZONE_NOT_FOUND',
        message: 'Không tìm thấy khu vực',
      });
    }
    return entity;
  }

  /**
   * Cập nhật khu vực (UC-91). Ngữ nghĩa OQ-8: `undefined` giữ nguyên · `null` xóa giá trị
   * (chỉ 4 field nullable) · có giá trị thì gán. `metadataJson` thay thế TOÀN BỘ.
   *
   * ⚠ `metadataJson` là object nên so sánh tham chiếu ở bước lọc LUÔN khác ⇒ hễ gửi
   * `metadata_json` là coi như có thay đổi. Đúng ngữ nghĩa replace toàn bộ — KHÔNG phải bug.
   *
   * ⚠ Lệch CÓ CHỦ ĐÍCH với `iot-devices.service.ts`: bảng đó ném `400 NO_UPDATABLE_FIELDS`
   * khi body không có field updatable nào. UC-91 theo tiền lệ ANPR UC2 (OQ-4): body rỗng
   * hoặc gửi đúng giá trị đang có đều là **no-op trả 200**, KHÔNG `save`, `updated_at` không
   * nhảy. KHÔNG được "sửa cho giống iot-devices".
   */
  async update(
    id: string,
    dto: UpdateZoneDto,
    actorUserId: string,
  ): Promise<ZoneEntity> {
    // 1. Load zone đang sống — 404 trước mọi thứ khác.
    const entity = await this.loadActive(id);

    // 2. Gom field THỰC SỰ được gửi. `zoneCode` chuẩn hóa NGAY tại đây (trước mọi so sánh)
    //    để pre-check và bản ghi lưu dùng chung một giá trị — cấm trim/uppercase rời rạc.
    const updates: Partial<ZoneUpdatableFields> = {};
    if (dto.zoneCode !== undefined) {
      updates.zoneCode = normalizeZoneCode(dto.zoneCode);
    }
    if (dto.zoneName !== undefined) updates.zoneName = dto.zoneName;
    if (dto.zoneType !== undefined) updates.zoneType = dto.zoneType;
    if (dto.status !== undefined) updates.status = dto.status;
    if (dto.building !== undefined) updates.building = dto.building;
    if (dto.floor !== undefined) updates.floor = dto.floor;
    if (dto.description !== undefined) updates.description = dto.description;
    if (dto.metadataJson !== undefined) updates.metadataJson = dto.metadataJson;

    // 3. CRUX: pre-check trùng mã — CHỈ khi mã thực sự đổi, và PHẢI loại chính bản ghi này
    //    ra khỏi truy vấn (`Not(id)`). Thiếu `Not(id)` thì PATCH gửi lại đúng mã cũ sẽ tự
    //    đụng chính mình → 409 GIẢ. Mirror iot-devices (check `!== device.macAddress` trước).
    if (
      updates.zoneCode !== undefined &&
      updates.zoneCode !== entity.zoneCode
    ) {
      const existing = await this.repo.findOne({
        where: {
          zoneCode: updates.zoneCode,
          deletedAt: IsNull(),
          id: Not(id),
        },
      });
      if (existing) {
        throw zoneCodeConflict();
      }
    }

    // 4. Lọc field ĐỔI GIÁ TRỊ THẬT (OQ-4) — không chỉ dựa vào "có gửi hay không".
    const changedKeys = (
      Object.keys(updates) as (keyof ZoneUpdatableFields)[]
    ).filter((key) => updates[key] !== entity[key]);

    // 5. Không có thay đổi thực → no-op: KHÔNG save, KHÔNG audit (không có gì để ghi vết),
    //    `updated_at` không nhảy. Bất biến từ UC-91, UC-92 giữ nguyên.
    if (changedKeys.length === 0) {
      return entity;
    }

    // Gom changes {old, new} cho audit TRƯỚC khi ghi đè entity.
    const changes: Record<string, { old: unknown; new: unknown }> = {};
    for (const key of changedKeys) {
      changes[key] = { old: entity[key] ?? null, new: updates[key] ?? null };
      Object.assign(entity, { [key]: updates[key] });
    }

    const queryRunner = this.dataSource.createQueryRunner();
    await queryRunner.connect();
    await queryRunner.startTransaction();

    try {
      const saved = await queryRunner.manager.save(ZoneEntity, entity);
      await this.zonesAuditRepository.logZoneUpdate(queryRunner.manager, {
        userId: actorUserId,
        zoneId: id,
        changes,
      });
      await queryRunner.commitTransaction();
      return saved;
    } catch (e) {
      await queryRunner.rollbackTransaction();
      // Safety-net race: hai request cùng đổi sang một mã, cùng lọt pre-check → DB chặn.
      if (this.isUniqueViolation(e)) {
        throw zoneCodeConflict();
      }
      throw e;
    } finally {
      await queryRunner.release();
    }
  }

  // ── UC-93 (ZNL-001): xem & tra cứu khu vực (READ-ONLY) ──

  /**
   * Danh sách khu vực đang sống, phân trang + filter (UC-93).
   *
   * ⚠ READ-ONLY TUYỆT ĐỐI: constructor có `DataSource` (từ UC-92) nhưng method này KHÔNG
   * `createQueryRunner`, KHÔNG transaction, KHÔNG ghi audit.
   *
   * 2 nhánh truy vấn (OQ-3):
   * - không `search` → `findAndCount` (đơn giản, đủ dùng);
   * - có `search`    → QueryBuilder vì cần `ILIKE ... OR ...`.
   * CẢ HAI nhánh BẮT BUỘC có `deleted_at IS NULL` (vừa đúng nghiệp vụ, vừa là điều kiện để 3
   * partial index của bảng `zones` có tác dụng) và `ORDER BY zone_code ASC` (OQ-4: hard-code,
   * client KHÔNG điều khiển được sort).
   *
   * SEC-03: `search` đi qua bound param (`{ s: '%kw%' }`), KHÔNG nội suy chuỗi vào SQL.
   * OQ-3: KHÔNG normalize `search` — `ILIKE` đã không phân biệt hoa/thường; normalize sẽ phá
   * tìm kiếm theo tên có dấu.
   */
  async list(
    query: ListZonesQueryDto,
  ): Promise<{ items: ZoneEntity[]; meta: PaginationMeta }> {
    const page = query.page ?? 1;
    const limit = query.limit ?? 20;
    const skip = (page - 1) * limit;

    // Chỉ thêm khoá khi filter CÓ giá trị — không để `undefined` lọt vào `where`.
    const where: FindOptionsWhere<ZoneEntity> = { deletedAt: IsNull() };
    if (query.zoneType) where.zoneType = query.zoneType;
    if (query.building) where.building = query.building;
    if (query.floor) where.floor = query.floor;
    if (query.status) where.status = query.status;

    let items: ZoneEntity[];
    let total: number;

    if (query.search) {
      // Nhánh QueryBuilder: PHẢI gắn ĐỦ filter, không chỉ điều kiện ILIKE — thiếu filter thì
      // `search` sẽ trả về cả zone không khớp filter (sai âm thầm).
      const qb = this.repo.createQueryBuilder('z').where(where);
      qb.andWhere('(z.zoneCode ILIKE :s OR z.zoneName ILIKE :s)', {
        s: `%${query.search}%`,
      });
      [items, total] = await qb
        .orderBy('z.zoneCode', 'ASC')
        .skip(skip)
        .take(limit)
        .getManyAndCount();
    } else {
      [items, total] = await this.repo.findAndCount({
        where,
        order: { zoneCode: 'ASC' },
        skip,
        take: limit,
      });
    }

    return {
      items,
      meta: { page, limit, total, totalPages: Math.ceil(total / limit) },
    };
  }

  /**
   * Chi tiết 1 khu vực đang sống (UC-93) — tái dùng `loadActive` (404 `ZONE_NOT_FOUND` khi
   * không tồn tại hoặc đã xóa mềm). KHÔNG viết lại logic lookup, KHÔNG đổi `loadActive` sang
   * public. READ-ONLY: không transaction, không audit.
   */
  async getDetail(id: string): Promise<ZoneEntity> {
    return this.loadActive(id);
  }

  // ── UC-92 (ZND-001): xoá khu vực ──

  /**
   * Xoá mềm khu vực (UC-92).
   *
   * Thứ tự bắt buộc:
   * 1. `loadActive` → 404 `ZONE_NOT_FOUND` (phủ luôn lần gọi DELETE thứ hai — OQ-4).
   * 2. Chặn theo THIẾT BỊ (OQ-1) — đặt NGOÀI transaction để fail nhanh, không tốn connection.
   *    KHÔNG đếm `gate_access_logs`/`zone_presence_events`: log chỉ tăng, chặn theo log sẽ
   *    khiến zone bất tử.
   * 3. Transaction { softDelete + audit } — "đã xoá nhưng không có audit" là mất dấu vết
   *    vĩnh viễn, nên hai việc phải cùng sống hoặc cùng chết.
   *
   * DATA-01: chỉ soft-delete, TUYỆT ĐỐI không hard-delete.
   *
   * ⚠ `ON DELETE RESTRICT` của `gate_access_logs`/`zone_presence_events` KHÔNG kích hoạt ở
   * đây: soft-delete chỉ là `UPDATE deleted_at`, hàng `zones` vẫn tồn tại. Việc chặn/không
   * chặn hoàn toàn do tầng application quyết định.
   */
  async remove(id: string, actorUserId: string): Promise<void> {
    const entity = await this.loadActive(id);

    // CRUX (OQ-1): chặn theo thiết bị — camera là cấu hình đang sống, phải do người vận hành
    // gỡ có ý thức, tránh âm thầm để lại `iot_devices.zone_id` trỏ vào zone đã chết.
    const deviceCount = await this.iotDevicesService.countByZoneId(id);
    if (deviceCount > 0) {
      throw new ConflictException({
        code: 'ZONE_HAS_DEVICES',
        message: 'Khu vực còn thiết bị được gán, hãy gỡ thiết bị trước khi xoá',
        details: { device_count: deviceCount },
      });
    }

    const queryRunner = this.dataSource.createQueryRunner();
    await queryRunner.connect();
    await queryRunner.startTransaction();

    try {
      await queryRunner.manager.softDelete(ZoneEntity, id);
      await this.zonesAuditRepository.logZoneDeletion(queryRunner.manager, {
        userId: actorUserId,
        zoneId: id,
        zoneCode: entity.zoneCode,
        zoneType: entity.zoneType,
      });
      await queryRunner.commitTransaction();
    } catch (e) {
      await queryRunner.rollbackTransaction();
      throw e;
    } finally {
      await queryRunner.release();
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
