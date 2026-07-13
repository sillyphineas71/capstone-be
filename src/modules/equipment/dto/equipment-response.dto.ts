import {
  EquipmentType,
  AssetStatus,
  HealthStatus,
} from '../entities/equipment.entity.js';

/**
 * UC-61 — Response cho thiết bị vừa đăng ký.
 * Plain class (không decorator validate) — chỉ shape dữ liệu trả về.
 * KHÔNG lộ deletedAt / field nội bộ nhạy cảm.
 */
export class EquipmentResponseDto {
  id: string;
  equipmentCode: string;
  equipmentName: string;
  equipmentType: EquipmentType;
  serialNumber: string | null;
  brand: string | null;
  model: string | null;
  purchaseDate: string | null;
  assetStatus: AssetStatus;
  healthStatus: HealthStatus;
  currentRoomId: string | null;
  createdAt: Date;

  constructor(data: EquipmentResponseDto) {
    Object.assign(this, data);
  }
}
