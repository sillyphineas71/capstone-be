import { Injectable, ConflictException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository, IsNull } from 'typeorm';
import { ZoneEntity } from '../entities/zone.entity.js';
import { normalizeZoneCode } from '../utils/normalize-zone-code.js';
import type { CreateZoneDto } from '../dto/create-zone.dto.js';

/**
 * Conflict trùng mã khu vực — dùng CHUNG cho pre-check và safety-net 23505 để hai nhánh
 * trả về ĐÚNG một payload (client không phân biệt được mình thua ở bước nào).
 */
const zoneCodeConflict = (): ConflictException =>
  new ConflictException({
    code: 'ZONE_CODE_EXISTS',
    message: 'Mã khu vực đã tồn tại',
  });

/**
 * ZonesService (ZNC-001 / UC-90) — tạo khu vực.
 *
 * OQ-8: KHÔNG audit, KHÔNG transaction, KHÔNG `DataSource`/`queryRunner` — UC-90 chỉ ghi 1
 * bảng bằng 1 lệnh. Audit cho cả cụm zone làm ở UC-92 (xóa zone).
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

  /** Postgres unique_violation = 23505 (TypeORM QueryFailedError.driverError.code). */
  private isUniqueViolation(e: unknown): boolean {
    const code =
      (e as { driverError?: { code?: string }; code?: string })?.driverError
        ?.code ?? (e as { code?: string })?.code;
    return code === '23505';
  }
}
