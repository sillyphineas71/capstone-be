import { VehicleRegistrationEntity } from '../entities/vehicle-registration.entity.js';
import {
  VehicleRegistrationResponseDto,
  toVehicleRegistrationResponse,
} from './vehicle-registration-response.dto.js';

/**
 * AdminVehicleRegistrationResponseDto (UC-101 / VPL-002) — shape route ADMIN.
 *
 * = toàn bộ field của route user (VehicleRegistrationResponseDto) CỘNG khối `owner`.
 * Owner CHỈ `user_id` + `full_name` + `email` — KHÔNG lộ phone/department/username/
 * employee_code/trạng thái tài khoản của UserEntity (SEC-01). Chỉ dùng cho endpoint admin
 * đã qua @RequirePermissions.
 */
export interface AdminVehicleOwner {
  user_id: string;
  full_name: string;
  email: string;
}

export interface AdminVehicleRegistrationResponseDto extends VehicleRegistrationResponseDto {
  owner: AdminVehicleOwner | null;
}

export function toAdminVehicleRegistrationResponse(
  entity: VehicleRegistrationEntity,
): AdminVehicleRegistrationResponseDto {
  // Tái dùng mapper user (KHÔNG sửa bản gốc) rồi bổ sung owner.
  return {
    ...toVehicleRegistrationResponse(entity),
    owner: entity.user
      ? {
          user_id: entity.user.id,
          full_name: entity.user.fullName,
          email: entity.user.email,
        }
      : null,
  };
}
