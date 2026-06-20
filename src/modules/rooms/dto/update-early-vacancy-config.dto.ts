import { IsInt, IsOptional, Min, Max } from 'class-validator';
import { Type } from 'class-transformer';

/**
 * EVD-001 (#48) — body PUT early-vacancy-config. Chỉ 3 field whitelist.
 * forbidNonWhitelisted ở ValidationPipe → key tùy ý bị 400 (SEC).
 */
export class UpdateEarlyVacancyConfigDto {
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(1440)
  emptyMinutes?: number;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(0)
  @Max(1440)
  minRemainingMinutes?: number;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(0)
  @Max(1440)
  minElapsedMinutes?: number;
}
