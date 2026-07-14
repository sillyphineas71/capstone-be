import { IsOptional, IsString, MaxLength } from 'class-validator';
import { Transform } from 'class-transformer';

/**
 * UC-12 — Khóa tài khoản người dùng.
 *
 * `reason` là lý do khóa (tùy chọn). Được ghi vào audit_logs.metadataJson;
 * KHÔNG lưu vào cột riêng của bảng users (users không có cột lý do khóa).
 */
export class LockUserDto {
  @Transform(({ value }: { value: unknown }) =>
    typeof value === 'string' ? value.trim() : value,
  )
  @IsOptional()
  @IsString({ message: 'Lý do khóa phải là chuỗi ký tự' })
  @MaxLength(500, { message: 'Lý do khóa không được vượt quá 500 ký tự' })
  reason?: string;
}
