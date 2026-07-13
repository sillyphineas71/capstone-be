import {
  Injectable,
  Logger,
  ConflictException,
  UnprocessableEntityException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { DataSource, Repository } from 'typeorm';
import {
  EquipmentEntity,
  AssetStatus,
  HealthStatus,
} from '../entities/equipment.entity.js';
import {
  AuditLogEntity,
  AuditLogSeverity,
} from '../../administration/entities/audit-log.entity.js';
import { CreateEquipmentDto } from '../dto/create-equipment.dto.js';
import { EquipmentResponseDto } from '../dto/equipment-response.dto.js';

const EQUIPMENTS_PATH = '/api/v1/equipments';

/**
 * UC-61 — Đăng ký thiết bị họp mới.
 * Mirror RoomsService.create: check trùng (withDeleted) → tạo trong transaction
 * → audit fail-separate (transaction riêng, không rollback thiết bị).
 */
@Injectable()
export class EquipmentService {
  private readonly logger = new Logger(EquipmentService.name);

  constructor(
    @InjectRepository(EquipmentEntity)
    private readonly equipmentRepo: Repository<EquipmentEntity>,
    private readonly dataSource: DataSource,
  ) {}

  /**
   * Kiểm serial_number đã tồn tại (kể cả soft-deleted). Chỉ gọi khi serial có giá trị.
   */
  private async checkDuplicateSerial(serial: string): Promise<void> {
    const existing = await this.equipmentRepo.findOne({
      where: { serialNumber: serial },
      withDeleted: true,
    });
    if (existing) {
      throw new ConflictException({
        success: false,
        message: 'Serial number da ton tai',
        error: {
          code: 'EQUIPMENT_SERIAL_ALREADY_EXISTS',
          details: { serialNumber: serial },
        },
        timestamp: new Date().toISOString(),
        path: EQUIPMENTS_PATH,
      });
    }
  }

  /**
   * Kiểm equipment_code đã tồn tại (kể cả soft-deleted).
   */
  private async checkDuplicateCode(code: string): Promise<void> {
    const existing = await this.equipmentRepo.findOne({
      where: { equipmentCode: code },
      withDeleted: true,
    });
    if (existing) {
      throw new ConflictException({
        success: false,
        message: 'Ma thiet bi da ton tai',
        error: {
          code: 'EQUIPMENT_CODE_ALREADY_EXISTS',
          details: { equipmentCode: code },
        },
        timestamp: new Date().toISOString(),
        path: EQUIPMENTS_PATH,
      });
    }
  }

  /**
   * Đăng ký thiết bị mới vào kho.
   */
  async create(
    dto: CreateEquipmentDto,
    userId: string,
    ipAddress?: string,
  ): Promise<EquipmentResponseDto> {
    // 1. Normalize
    const equipmentCode = dto.equipmentCode.toUpperCase().trim();
    const equipmentName = dto.equipmentName.trim();
    const serialNumber =
      dto.serialNumber && dto.serialNumber.trim() !== ''
        ? dto.serialNumber.trim()
        : null;

    // 2. purchaseDate không được là tương lai
    if (dto.purchaseDate) {
      const purchase = new Date(dto.purchaseDate);
      const now = new Date();
      if (purchase.getTime() > now.getTime()) {
        throw new UnprocessableEntityException({
          success: false,
          message: 'purchaseDate khong duoc o tuong lai',
          error: {
            code: 'INVALID_PURCHASE_DATE',
            details: { purchaseDate: dto.purchaseDate },
          },
          timestamp: new Date().toISOString(),
          path: EQUIPMENTS_PATH,
        });
      }
    }

    // 3. Uniqueness — serial (chỉ khi có giá trị)
    if (serialNumber) {
      await this.checkDuplicateSerial(serialNumber);
    }
    // 4. Uniqueness — equipment_code
    await this.checkDuplicateCode(equipmentCode);

    // 5. Tạo thiết bị trong transaction
    const saved = await this.dataSource.transaction(async (em) => {
      const equipment = em.create(EquipmentEntity, {
        equipmentCode,
        equipmentName,
        equipmentType: dto.equipmentType,
        serialNumber,
        brand: dto.brand ?? null,
        model: dto.model ?? null,
        purchaseDate: dto.purchaseDate ?? null,
        specificationJson: dto.specification ?? null,
        // server set cứng — không nhận từ input
        assetStatus: AssetStatus.AVAILABLE,
        healthStatus: dto.healthStatus ?? HealthStatus.UNKNOWN,
        currentRoomId: null,
        assignedBy: null,
        assignedAt: null,
        installedAt: null,
        assignmentNote: null,
        iotDeviceId: null,
        lastMaintenanceAt: null,
        lastIssueReportedAt: null,
        lastIssueNote: null,
      });
      return em.save(EquipmentEntity, equipment);
    });

    // 6. Ghi audit log NGOÀI transaction — fail-separate (audit fail KHÔNG rollback thiết bị)
    try {
      await this.dataSource.transaction(async (em) => {
        const auditLog = em.create(AuditLogEntity, {
          userId,
          actionType: 'create',
          entityType: 'equipment',
          entityId: saved.id,
          newValueJson: {
            equipmentCode: saved.equipmentCode,
            equipmentName: saved.equipmentName,
            equipmentType: saved.equipmentType,
            serialNumber: saved.serialNumber,
            assetStatus: saved.assetStatus,
            healthStatus: saved.healthStatus,
          },
          ipAddress: ipAddress ?? null,
          severity: AuditLogSeverity.INFO,
        });
        await em.save(AuditLogEntity, auditLog);
      });
    } catch (err) {
      this.logger.error(
        `Failed to write audit log for equipment ${saved.id}: ${
          err instanceof Error ? err.message : 'Unknown'
        }`,
      );
    }

    // 7. Map response
    return new EquipmentResponseDto({
      id: saved.id,
      equipmentCode: saved.equipmentCode,
      equipmentName: saved.equipmentName,
      equipmentType: saved.equipmentType,
      serialNumber: saved.serialNumber,
      brand: saved.brand,
      model: saved.model,
      purchaseDate: saved.purchaseDate,
      assetStatus: saved.assetStatus,
      healthStatus: saved.healthStatus,
      currentRoomId: saved.currentRoomId,
      createdAt: saved.createdAt,
    });
  }
}
