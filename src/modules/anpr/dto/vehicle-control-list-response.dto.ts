import { VehicleControlListEntity } from '../entities/vehicle-control-list.entity.js';

/**
 * VehicleControlListResponseDto (VCL-001 / UC8) — shape công khai (mirror toVehicleRegistrationResponse).
 * KHÔNG lộ `deleted_at`.
 */
export class VehicleControlListResponseDto {
  id: string;
  plate_number: string;
  plate_raw: string | null;
  list_type: string;
  reason: string | null;
  active: boolean;
  created_by: string | null;
  created_at: Date;
  updated_at: Date;
}

export function toVehicleControlListResponse(
  entity: VehicleControlListEntity,
): VehicleControlListResponseDto {
  return {
    id: entity.id,
    plate_number: entity.plateNumber,
    plate_raw: entity.plateRaw,
    list_type: entity.listType,
    reason: entity.reason,
    active: entity.active,
    created_by: entity.createdBy,
    created_at: entity.createdAt,
    updated_at: entity.updatedAt,
  };
}
