import {
  Injectable,
  ConflictException,
  NotFoundException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository, IsNull, Not } from 'typeorm';
import { ZoneEntity } from '../entities/zone.entity.js';
import { normalizeZoneCode } from '../utils/normalize-zone-code.js';
import type { CreateZoneDto } from '../dto/create-zone.dto.js';
import type { UpdateZoneDto } from '../dto/update-zone.dto.js';

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
  ) {}

  async create(dto: CreateZoneDto): Promise<ZoneEntity> {
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

    try {
      return await this.repo.save(entity);
    } catch (e) {
      // Safety-net race: hai request cùng mã cùng lọt pre-check → partial unique chặn ở DB.
      // Dịch thành 409 sạch, KHÔNG để lỗi driver/stack phọt ra client (ENG-03).
      if (this.isUniqueViolation(e)) {
        throw zoneCodeConflict();
      }
      throw e;
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
  async update(id: string, dto: UpdateZoneDto): Promise<ZoneEntity> {
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

    // 5. Không có thay đổi thực → no-op: KHÔNG save, `updated_at` không nhảy.
    if (changedKeys.length === 0) {
      return entity;
    }

    for (const key of changedKeys) {
      Object.assign(entity, { [key]: updates[key] });
    }

    try {
      return await this.repo.save(entity);
    } catch (e) {
      // Safety-net race: hai request cùng đổi sang một mã, cùng lọt pre-check → DB chặn.
      if (this.isUniqueViolation(e)) {
        throw zoneCodeConflict();
      }
      throw e;
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
