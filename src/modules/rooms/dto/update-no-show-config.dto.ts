import { IsInt, IsOptional, Min, Max } from 'class-validator';
import { Type } from 'class-transformer';

/**
 * NSL-001 (#35) — body PUT no-show-config. Chỉ 3 field whitelist.
 * forbidNonWhitelisted ở ValidationPipe → key tùy ý bị 400 (SEC).
 */
export class UpdateNoShowConfigDto {
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(1440)
  thresholdMinutes?: number;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(0)
  @Max(1440)
  warningGraceMinutes?: number;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(1440)
  autoReleaseGraceMinutes?: number;
}
