import { IsArray, ArrayNotEmpty, IsUUID } from 'class-validator';

/**
 * UC-08 — Cập nhật vai trò tài khoản (replace-set).
 *
 * `roleIds` là TẬP vai trò mong muốn (full desired set). Service sẽ tự tính diff
 * so với tập role active hiện tại (soft-remove role bị bỏ, reactivate/insert role thêm).
 *
 * BR-01: danh sách vai trò không được rỗng — enforce ở boundary bằng @ArrayNotEmpty (HTTP 400).
 */
export class UpdateUserRolesDto {
  @IsArray({ message: 'Danh sách vai trò phải là mảng' })
  @ArrayNotEmpty({ message: 'Danh sách vai trò không được rỗng' })
  @IsUUID('4', {
    each: true,
    message: 'Mỗi vai trò trong danh sách phải là định dạng UUID',
  })
  roleIds: string[];
}
