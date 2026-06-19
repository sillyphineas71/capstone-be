import { IsOptional, IsInt, Min, Max } from 'class-validator';
import { Type } from 'class-transformer';

/**
 * ListStrangerAlertsQueryDto (SAL-001) — query GET /api/v1/face-access/stranger-alerts.
 * page/limit (limit max 100); windowMinutes tùy chọn override STRANGER_ALERT_WINDOW_MINUTES.
 */
export class ListStrangerAlertsQueryDto {
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  page: number = 1;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(100)
  limit: number = 20;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  windowMinutes?: number;
}
