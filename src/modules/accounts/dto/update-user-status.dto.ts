import { IsIn, IsNotEmpty, IsString } from 'class-validator';

/**
 * UC-11 — Cập nhật trạng thái tài khoản (ACTIVE ↔ INACTIVE).
 *
 * Chỉ nhận 'active'/'inactive'. Dùng @IsIn literal (KHÔNG dùng full AccountStatus
 * enum) để reject 'locked' (UC-12) / 'pending_reset' (auth) -> HTTP 400.
 */
export class UpdateUserStatusDto {
  @IsNotEmpty({ message: 'Trạng thái không được để trống' })
  @IsString({ message: 'Trạng thái phải là chuỗi ký tự' })
  @IsIn(['active', 'inactive'], {
    message: 'Trạng thái chỉ được là active hoặc inactive',
  })
  status: 'active' | 'inactive';
}
