import { IsOptional, IsString, MaxLength } from 'class-validator';
import { Transform } from 'class-transformer';

export class UpdatePermissionDto {
  @Transform(({ value }: { value: unknown }) =>
    typeof value === 'string' ? value.trim() : value,
  )
  @IsOptional()
  @IsString({ message: 'permissionName phải là chuỗi ký tự' })
  @MaxLength(150, { message: 'permissionName không được vượt quá 150 ký tự' })
  permissionName?: string;

  @Transform(({ value }: { value: unknown }) => {
    if (typeof value === 'string') {
      const trimmed = value.trim();
      return trimmed === '' ? null : trimmed;
    }
    return value ?? null;
  })
  @IsOptional()
  @IsString({ message: 'description phải là chuỗi ký tự' })
  description?: string | null;
}
