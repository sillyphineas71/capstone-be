import { VehicleRegistrationEntity } from '../entities/vehicle-registration.entity.js';

/**
 * VehicleRegistrationResponseDto (VPR-001 / UC1) — shape công khai (mirror toIotDeviceResponse).
 * Chỉ field cần cho client; KHÔNG lộ field nội bộ ngoài schema.
 */
export class VehicleRegistrationResponseDto {
  id: string;
  user_id: string;
  plate_raw: string;
  plate_number: string;
  vehicle_type: string | null;
  note: string | null;
  status: string;
  created_at: Date;
  updated_at: Date;
}

export function toVehicleRegistrationResponse(
  entity: VehicleRegistrationEntity,
): VehicleRegistrationResponseDto {
  return {
    id: entity.id,
    user_id: entity.userId,
    plate_raw: entity.plateRaw,
    plate_number: entity.plateNumber,
    vehicle_type: entity.vehicleType,
    note: entity.note,
    status: entity.status,
    created_at: entity.createdAt,
    updated_at: entity.updatedAt,
  };
}
