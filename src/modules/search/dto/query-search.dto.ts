import { IsOptional, IsString, MinLength } from 'class-validator';

/**
 * QuerySearchDto (SRCH-01) — `q` bắt buộc ≥2 ký tự (spec R2, tránh full-scan).
 * `types` optional, comma-separated — validate allowlist thủ công ở controller
 * (spec §2.2 — không dùng decorator enum-array phức tạp cho 1 field đơn giản).
 */
export class QuerySearchDto {
  @IsString()
  @MinLength(2)
  q: string;

  @IsOptional()
  @IsString()
  types?: string;
}
