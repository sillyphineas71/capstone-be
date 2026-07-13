import { IsOptional, IsString, IsUUID, IsIn, Min, Max } from 'class-validator';
import { Type } from 'class-transformer';

/**
 * UC-14 — Query lọc danh sách tài khoản (endpoint quản trị GET /users/manage).
 *
 * Tất cả filter optional, kết hợp AND. sortBy dùng allowlist @IsIn (chống inject
 * field); service map sang cột thật qua SORT_MAP. KHÔNG dùng cho GET /users (autocomplete).
 */
export class ManageUsersQueryDto {
  @IsOptional()
  @IsUUID('4', { message: 'departmentId phải là định dạng UUID' })
  departmentId?: string;

  @IsOptional()
  @IsUUID('4', { message: 'roleId phải là định dạng UUID' })
  roleId?: string;

  @IsOptional()
  @IsIn(['active', 'inactive', 'locked', 'pending_reset'], {
    message:
      'accountStatus chỉ được là active, inactive, locked hoặc pending_reset',
  })
  accountStatus?: string;

  @IsOptional()
  @IsString({ message: 'search phải là chuỗi ký tự' })
  search?: string;

  @IsOptional()
  @IsIn(['fullName', 'email', 'employeeCode', 'accountStatus', 'createdAt'], {
    message:
      'sortBy chỉ được là fullName, email, employeeCode, accountStatus hoặc createdAt',
  })
  sortBy?: string = 'fullName';

  @IsOptional()
  @IsIn(['asc', 'desc'], { message: 'sortOrder chỉ được là asc hoặc desc' })
  sortOrder?: 'asc' | 'desc' = 'asc';

  @Type(() => Number)
  @IsOptional()
  @Min(1, { message: 'page phải lớn hơn hoặc bằng 1' })
  page?: number = 1;

  @Type(() => Number)
  @IsOptional()
  @Min(1, { message: 'limit phải lớn hơn hoặc bằng 1' })
  @Max(100, { message: 'limit không được vượt quá 100' })
  limit?: number = 20;
}
