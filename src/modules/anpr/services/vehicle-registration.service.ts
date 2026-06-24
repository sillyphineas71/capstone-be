import {
  Injectable,
  BadRequestException,
  ConflictException,
  NotFoundException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository, IsNull } from 'typeorm';
import { VehicleRegistrationEntity } from '../entities/vehicle-registration.entity.js';
import { normalizePlate } from '../utils/normalize-plate.js';
import type { CreateVehicleRegistrationDto } from '../dto/create-vehicle-registration.dto.js';
import type { UpdateVehicleRegistrationDto } from '../dto/update-vehicle-registration.dto.js';
import type { VehicleStatus } from '../dto/update-vehicle-status.dto.js';

// OQ-4: biển hợp lệ sau normalize — chỉ [A-Z0-9], dài 6–10.
const PLATE_FORMAT_RE = /^[0-9A-Z]+$/;
const PLATE_MIN = 6;
const PLATE_MAX = 10;

/** VAL-02: conflict trùng biển — dùng chung cho pre-check + safety-net 23505. */
const plateConflict = (): ConflictException =>
  new ConflictException({
    code: 'PLATE_ALREADY_REGISTERED',
    message: 'Biển số này đã được đăng ký',
  });

/**
 * VehicleRegistrationService (VPR-001 / UC1) — đăng ký biển số xe.
 *
 * `register(userId, dto)` dùng chung cho cả route user (userId từ JWT) và admin
 * (userId từ body) — controller quyết nguồn userId. Mirror iot-devices: pre-check + throw.
 */
@Injectable()
export class VehicleRegistrationService {
  constructor(
    @InjectRepository(VehicleRegistrationEntity)
    private readonly repo: Repository<VehicleRegistrationEntity>,
  ) {}

  async register(
    userId: string,
    dto: CreateVehicleRegistrationDto,
  ): Promise<VehicleRegistrationEntity> {
    const plateNumber = normalizePlate(dto.plateRaw);

    // OQ-4: validate trên giá trị ĐÃ normalize.
    if (!this.isValidPlate(plateNumber)) {
      throw new BadRequestException({
        code: 'INVALID_PLATE',
        message:
          'Biển số không hợp lệ (cần 6–10 ký tự chữ-số, có cả chữ và số).',
      });
    }

    // OQ-3: pre-check trùng biển đang sống — KHÔNG lộ user nào giữ biển.
    const existing = await this.repo.findOne({
      where: { plateNumber, deletedAt: IsNull() },
    });
    if (existing) {
      throw plateConflict();
    }

    const entity = this.repo.create({
      userId,
      plateRaw: dto.plateRaw,
      plateNumber,
      vehicleType: dto.vehicleType ?? null,
      note: dto.note ?? null,
      status: 'active',
    });

    try {
      return await this.repo.save(entity);
    } catch (e) {
      // VAL-02 safety-net: partial-unique race → 23505 → 409 sạch, KHÔNG để lỗi DB phọt client.
      if (this.isUniqueViolation(e)) {
        throw plateConflict();
      }
      throw e;
    }
  }

  // ── UC2 (VPM-001): sửa / disable / xóa-mềm — chỉ biển CỦA MÌNH ──

  /**
   * CRUX ownership (SEC-01/02): load biển của current user, chưa xóa-mềm.
   * Fold ownership + existence + soft-delete vào 1 query → không khớp = 404
   * (KHÔNG 403, message trung tính — giấu tồn tại biển người khác).
   */
  private async loadOwned(
    id: string,
    userId: string,
  ): Promise<VehicleRegistrationEntity> {
    const entity = await this.repo.findOne({
      where: { id, userId, deletedAt: IsNull() },
    });
    if (!entity) {
      throw new NotFoundException({
        code: 'VEHICLE_NOT_FOUND',
        message: 'Không tìm thấy biển số',
      });
    }
    return entity;
  }

  /**
   * Sửa metadata (DATA-01: CHỈ note + vehicle_type). undefined→giữ nguyên,
   * null→xóa (set null). Cả 2 absent → no-op (KHÔNG save), trả nguyên trạng (OQ-5).
   */
  async updateMetadata(
    id: string,
    userId: string,
    dto: UpdateVehicleRegistrationDto,
  ): Promise<VehicleRegistrationEntity> {
    const entity = await this.loadOwned(id, userId);
    let changed = false;
    if (dto.vehicleType !== undefined) {
      entity.vehicleType = dto.vehicleType;
      changed = true;
    }
    if (dto.note !== undefined) {
      entity.note = dto.note;
      changed = true;
    }
    if (!changed) {
      return entity; // no-op
    }
    return this.repo.save(entity);
  }

  /** Đổi status active↔disabled (DATA-02). */
  async setStatus(
    id: string,
    userId: string,
    status: VehicleStatus,
  ): Promise<VehicleRegistrationEntity> {
    const entity = await this.loadOwned(id, userId);
    entity.status = status;
    return this.repo.save(entity);
  }

  /** Xóa-mềm (DATA-02: softDelete, KHÔNG hard-delete). Đã xóa → loadOwned 404. */
  async softDeleteOwned(id: string, userId: string): Promise<void> {
    await this.loadOwned(id, userId);
    await this.repo.softDelete(id);
  }

  /** OQ-4: ^[0-9A-Z]+$ && dài 6–10 && ≥1 chữ && ≥1 số. */
  private isValidPlate(plate: string): boolean {
    if (
      !PLATE_FORMAT_RE.test(plate) ||
      plate.length < PLATE_MIN ||
      plate.length > PLATE_MAX
    ) {
      return false;
    }
    return /[A-Z]/.test(plate) && /[0-9]/.test(plate);
  }

  /** Postgres unique_violation = 23505 (TypeORM QueryFailedError.driverError.code). */
  private isUniqueViolation(e: unknown): boolean {
    const code =
      (e as { driverError?: { code?: string }; code?: string })?.driverError
        ?.code ?? (e as { code?: string })?.code;
    return code === '23505';
  }
}
