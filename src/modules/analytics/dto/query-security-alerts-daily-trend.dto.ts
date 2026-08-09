import { IsOptional, IsInt, Min, Max } from 'class-validator';
import { Type } from 'class-transformer';
import { ApiPropertyOptional } from '@nestjs/swagger';

/**
 * QuerySecurityAlertsDailyTrendDto — GET /analytics/security-alerts/daily-trend
 */
export class QuerySecurityAlertsDailyTrendDto {
  @ApiPropertyOptional({
    description: 'So ngay lay du lieu (1-30)',
    minimum: 1,
    maximum: 30,
    default: 7,
  })
  @IsOptional()
  @Type(() => Number)
  @IsInt({ message: 'days must be an integer' })
  @Min(1, { message: 'days must be at least 1' })
  @Max(30, { message: 'days must not exceed 30' })
  days?: number;
}
