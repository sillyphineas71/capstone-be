import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsOptional, IsString, MinLength } from 'class-validator';

/**
 * QuerySearchDto (SRCH-01) — `q` bắt buộc ≥2 ký tự (spec R2, tránh full-scan).
 * `types` optional, comma-separated — validate allowlist thủ công ở controller
 * (spec §2.2 — không dùng decorator enum-array phức tạp cho 1 field đơn giản).
 */
export class QuerySearchDto {
  @ApiProperty({
    description: 'Từ khóa tìm kiếm, tối thiểu 2 ký tự',
    minLength: 2,
  })
  @IsString()
  @MinLength(2)
  q: string;

  @ApiPropertyOptional({
    description:
      'Danh sách loại đối tượng cần tìm, phân cách bởi dấu phẩy (bỏ trống = tìm tất cả loại được phép)',
  })
  @IsOptional()
  @IsString()
  types?: string;
}
