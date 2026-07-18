import { Transform } from 'class-transformer';
import { IsString, IsOptional, Matches, MaxLength } from 'class-validator';

export class CreateRoleDto {
  @Transform(({ value }: { value: unknown }) =>
    typeof value === 'string' ? value.trim().toUpperCase() : value,
  )
  @IsString()
  @Matches(/^[A-Z][A-Z0-9_]{1,49}$/, {
    message:
      'roleCode phải bắt đầu bằng chữ hoa, chỉ chứa A-Z, 0-9, underscore, tối đa 50 ký tự',
  })
  @MaxLength(50)
  roleCode: string;

  @IsString()
  @MaxLength(100)
  roleName: string;

  @IsOptional()
  @IsString()
  description?: string;
}
