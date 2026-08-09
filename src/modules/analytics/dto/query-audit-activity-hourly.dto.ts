import { IsOptional, IsDateString } from 'class-validator';
import { ApiPropertyOptional } from '@nestjs/swagger';

/**
 * QueryAuditActivityHourlyDto — GET /analytics/audit-activity/hourly
 */
export class QueryAuditActivityHourlyDto {
  @ApiPropertyOptional({
    description: 'Ngay thong ke (YYYY-MM-DD), mac dinh hom nay theo UTC+7',
    example: '2026-08-09',
  })
  @IsOptional()
  @IsDateString(
    {},
    { message: 'date must be a valid ISO date string (YYYY-MM-DD)' },
  )
  date?: string;
}
