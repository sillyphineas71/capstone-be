import { VehicleRegistrationEntity } from '../entities/vehicle-registration.entity.js';
import {
  VehicleRegistrationResponseDto,
  toVehicleRegistrationResponse,
} from './vehicle-registration-response.dto.js';

/**
 * AdminVehicleRegistrationResponseDto (UC-101 / VPL-002) — shape route ADMIN.
 *
 * = toàn bộ field của route user (VehicleRegistrationResponseDto) CỘNG khối `owner`
 * VÀ `account_expires_at` (top-level, xem ghi chú bên dưới).
 *
 * Owner CHỈ `user_id` + `full_name` + `email` — KHÔNG lộ phone/department/username/
 * employee_code/trạng thái tài khoản của UserEntity (SEC-01). Chỉ dùng cho endpoint admin
 * đã qua @RequirePermissions.
 *
 * `account_expires_at` là ngoại lệ có chủ đích (VPT-REQ-06 / VPT-001) — không phải một phần
 * identity của `owner`, chỉ phục vụ nghiệp vụ hiển thị hạn tài khoản đối tác, route đã gate
 * `admin_read`. KHÔNG phải nới lỏng SEC-01 nói chung — SEC-01 vẫn áp cho toàn bộ field
 * khác (phone/department/username/employee_code/passwordHash...).
 */
export interface AdminVehicleOwner {
  user_id: string;
  full_name: string;
  email: string;
}

export interface AdminVehicleRegistrationResponseDto extends VehicleRegistrationResponseDto {
  owner: AdminVehicleOwner | null;
  account_expires_at: string | null; // ISO 8601 — top-level, KHÔNG nhét vào owner{}
}

export function toAdminVehicleRegistrationResponse(
  entity: VehicleRegistrationEntity,
): AdminVehicleRegistrationResponseDto {
  // Tái dùng mapper user (KHÔNG sửa bản gốc) rồi bổ sung owner + account_expires_at.
  return {
    ...toVehicleRegistrationResponse(entity),
    owner: entity.user
      ? {
          user_id: entity.user.id,
          full_name: entity.user.fullName,
          email: entity.user.email,
        }
      : null,
    account_expires_at: entity.user?.accountExpiresAt?.toISOString() ?? null,
  };
}
