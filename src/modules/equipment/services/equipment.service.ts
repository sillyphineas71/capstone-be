import {
  Injectable,
  Logger,
  ConflictException,
  NotFoundException,
  UnprocessableEntityException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { DataSource, Repository, IsNull } from 'typeorm';
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
import { ReportEquipmentFaultDto } from '../dto/report-equipment-fault.dto.js';
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

  /**
   * UC-62 — Báo lỗi / chuyển bảo trì thiết bị.
   * Chỉ chiều "xấu đi": set healthStatus (warning/faulty/offline) và/hoặc
   * assetStatus (maintenance). Mirror create: transaction cập nhật + audit fail-separate.
   * KHÔNG set lastMaintenanceAt; KHÔNG đụng currentRoomId (gỡ khỏi phòng là UC-65).
   */
  async reportFault(
    equipmentId: string,
    dto: ReportEquipmentFaultDto,
    userId: string,
    ipAddress?: string,
  ): Promise<EquipmentResponseDto> {
    // Phase A — validate
    // A.1: phải có ít nhất một trong (healthStatus, assetStatus) — kiểm TRƯỚC load
    if (!dto.healthStatus && !dto.assetStatus) {
      throw new UnprocessableEntityException({
        success: false,
        message: 'Phai cung cap it nhat healthStatus hoac assetStatus',
        error: { code: 'FAULT_NO_CHANGE', details: {} },
        timestamp: new Date().toISOString(),
        path: `${EQUIPMENTS_PATH}/${equipmentId}/fault`,
      });
    }

    // A.2: load equipment (findOne tự loại soft-deleted nhờ @DeleteDateColumn)
    const equipment = await this.equipmentRepo.findOne({
      where: { id: equipmentId },
    });
    if (!equipment) {
      throw new NotFoundException({
        success: false,
        message: 'Khong tim thay thiet bi',
        error: {
          code: 'EQUIPMENT_NOT_FOUND',
          details: { equipmentId },
        },
        timestamp: new Date().toISOString(),
        path: `${EQUIPMENTS_PATH}/${equipmentId}/fault`,
      });
    }

    // A.3: thiết bị retired/lost không cho báo lỗi
    if (
      equipment.assetStatus === AssetStatus.RETIRED ||
      equipment.assetStatus === AssetStatus.LOST
    ) {
      throw new ConflictException({
        success: false,
        message: 'Thiet bi da thanh ly / mat, khong the bao loi',
        error: {
          code: 'EQUIPMENT_NOT_REPORTABLE',
          details: { assetStatus: equipment.assetStatus },
        },
        timestamp: new Date().toISOString(),
        path: `${EQUIPMENTS_PATH}/${equipmentId}/fault`,
      });
    }

    // A.4: snapshot trạng thái cũ cho audit
    const oldValue = {
      healthStatus: equipment.healthStatus,
      assetStatus: equipment.assetStatus,
    };

    // Phase B — cập nhật trong transaction
    const saved = await this.dataSource.transaction(async (em) => {
      if (dto.healthStatus) {
        equipment.healthStatus = dto.healthStatus;
      }
      if (dto.assetStatus) {
        equipment.assetStatus = dto.assetStatus;
      }
      equipment.lastIssueReportedAt = new Date();
      equipment.lastIssueNote = dto.issueNote;
      // KHÔNG set lastMaintenanceAt; KHÔNG đụng currentRoomId / assigned_*
      return em.save(EquipmentEntity, equipment);
    });

    // Phase C — audit fail-separate (transaction riêng, không rollback thiết bị)
    try {
      await this.dataSource.transaction(async (em) => {
        const auditLog = em.create(AuditLogEntity, {
          userId,
          actionType: 'update',
          entityType: 'equipment',
          entityId: saved.id,
          oldValueJson: oldValue,
          newValueJson: {
            healthStatus: saved.healthStatus,
            assetStatus: saved.assetStatus,
            lastIssueReportedAt: saved.lastIssueReportedAt,
            lastIssueNote: saved.lastIssueNote,
          },
          ipAddress: ipAddress ?? null,
          severity: AuditLogSeverity.WARNING,
        });
        await em.save(AuditLogEntity, auditLog);
      });
    } catch (err) {
      this.logger.error(
        `Failed to write audit log for equipment fault ${saved.id}: ${
          err instanceof Error ? err.message : 'Unknown'
        }`,
      );
    }

    // Map response — tái dùng EquipmentResponseDto (UC-61)
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

  /**
   * UC-63 — Xóa mềm thiết bị + gỡ tham chiếu phòng.
   * Soft-delete (DATA-01), CẤM hard-delete. Gỡ tham chiếu phòng + set retired + softDelete
   * + audit ATOMIC trong CÙNG transaction (khác UC-61/62 fail-separate — CHỦ ĐÍCH):
   * audit fail → rollback toàn bộ, đảm bảo mọi lần xóa đều có vết audit.
   */
  async deleteEquipment(
    equipmentId: string,
    userId: string,
    ipAddress?: string,
  ): Promise<void> {
    // Phase A — validate (READ, ngoài transaction)
    // A.1: load thiết bị chưa soft-delete (đã xóa cũng 404 — idempotent)
    const equipment = await this.equipmentRepo.findOne({
      where: { id: equipmentId, deletedAt: IsNull() },
    });
    if (!equipment) {
      throw new NotFoundException({
        success: false,
        message: 'Khong tim thay thiet bi',
        error: {
          code: 'EQUIPMENT_NOT_FOUND',
          details: { equipmentId },
        },
        timestamp: new Date().toISOString(),
        path: `${EQUIPMENTS_PATH}/${equipmentId}`,
      });
    }

    // A.2: KHÔNG chặn theo assetStatus (cho xóa thiết bị đang assigned + gỡ tham chiếu)

    // A.3: snapshot trạng thái trước xóa cho audit
    const oldValue = {
      equipmentCode: equipment.equipmentCode,
      equipmentName: equipment.equipmentName,
      equipmentType: equipment.equipmentType,
      serialNumber: equipment.serialNumber,
      assetStatus: equipment.assetStatus,
      healthStatus: equipment.healthStatus,
      currentRoomId: equipment.currentRoomId,
    };

    // Phase B — transaction ATOMIC: gỡ ref + softDelete + audit cùng 1 transaction.
    // Audit fail → rollback (KHÔNG try/catch nuốt lỗi — khác UC-61/62).
    await this.dataSource.transaction(async (tem) => {
      // B.1: gỡ tham chiếu phòng + chuyển retired — UPDATE field TRƯỚC softDelete
      await tem.update(EquipmentEntity, equipmentId, {
        currentRoomId: null,
        assignedBy: null,
        assignedAt: null,
        installedAt: null,
        assignmentNote: null,
        assetStatus: AssetStatus.RETIRED,
      });

      // B.2: soft-delete (set deleted_at) — DATA-01, KHÔNG hard-delete
      await tem.softDelete(EquipmentEntity, equipmentId);

      // B.3: audit ATOMIC trong cùng transaction
      const auditLog = tem.create(AuditLogEntity, {
        userId,
        actionType: 'delete',
        entityType: 'equipment',
        entityId: equipmentId,
        oldValueJson: oldValue,
        ipAddress: ipAddress ?? null,
        severity: AuditLogSeverity.WARNING,
      });
      await tem.save(AuditLogEntity, auditLog);
    });
  }
}
