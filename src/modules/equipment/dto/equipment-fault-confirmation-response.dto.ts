import { HealthStatus } from '../entities/equipment.entity.js';

/**
 * EQUIP-FAULT-LIFECYCLE-001 — Response DTO nhẹ cho hành động xác nhận lỗi (confirmFault).
 * Hành động confirm không đổi entity equipments, chỉ trả kết quả xác nhận.
 */
export class EquipmentFaultConfirmationResponseDto {
  equipmentId: string;
  healthStatus: HealthStatus;
  confirmedBy: string;
  confirmedAt: Date;

  constructor(data: EquipmentFaultConfirmationResponseDto) {
    Object.assign(this, data);
  }
}
