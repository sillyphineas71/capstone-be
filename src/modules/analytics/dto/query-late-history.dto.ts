import { IsOptional, IsEnum, IsDateString, IsInt, Min } from 'class-validator';
import { ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';

export class QueryLateHistoryDto {
  @IsOptional()
  @IsEnum(['day', 'week', 'month', 'quarter', 'custom'], {
    message: 'preset must be one of: day, week, month, quarter, custom',
  })
  @ApiPropertyOptional({
    description: 'Time range preset',
    enum: ['day', 'week', 'month', 'quarter', 'custom'],
    default: 'month',
  })
  preset?: string;

  @IsOptional()
  @IsDateString({}, { message: 'from must be a valid ISO date string' })
  @ApiPropertyOptional({ description: 'Start date (ISO 8601) - only used if preset=custom', example: '2026-06-01' })
  from?: string;

  @IsOptional()
  @IsDateString({}, { message: 'to must be a valid ISO date string' })
  @ApiPropertyOptional({ description: 'End date (ISO 8601) - only used if preset=custom', example: '2026-06-30' })
  to?: string;

  @IsOptional()
  @Type(() => Number)
  @IsInt({ message: 'graceMinutes must be an integer' })
  @Min(0, { message: 'graceMinutes must be at least 0' })
  @ApiPropertyOptional({ description: 'Grace period in minutes', default: 0 })
  graceMinutes?: number;
}
