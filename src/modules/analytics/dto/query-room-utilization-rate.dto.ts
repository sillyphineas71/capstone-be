import { IsOptional, IsEnum, IsDateString, IsUUID } from 'class-validator';
import { ApiPropertyOptional } from '@nestjs/swagger';

export class QueryRoomUtilizationRateDto {
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
  @IsEnum(['previous_period', 'same_period_last_year', 'custom'], {
    message: 'comparisonMode must be: previous_period, same_period_last_year, custom',
  })
  @ApiPropertyOptional({
    description: 'Comparison period calculation mode',
    enum: ['previous_period', 'same_period_last_year', 'custom'],
    default: 'previous_period',
  })
  comparisonMode?: string;

  @IsOptional()
  @IsDateString({}, { message: 'comparisonFrom must be a valid ISO date string' })
  @ApiPropertyOptional({ description: 'Comparison start date (ISO 8601) - only used if comparisonMode=custom', example: '2026-05-01' })
  comparisonFrom?: string;

  @IsOptional()
  @IsDateString({}, { message: 'comparisonTo must be a valid ISO date string' })
  @ApiPropertyOptional({ description: 'Comparison end date (ISO 8601) - only used if comparisonMode=custom', example: '2026-05-30' })
  comparisonTo?: string;

  @IsOptional()
  @IsUUID('4', { message: 'roomId must be a valid UUID v4' })
  @ApiPropertyOptional({ description: 'Filter by room UUID' })
  roomId?: string;

  @IsOptional()
  @IsEnum(['day', 'week'], {
    message: 'granularity must be: day, week',
  })
  @ApiPropertyOptional({
    description: 'Granularity of trend buckets',
    enum: ['day', 'week'],
  })
  granularity?: string;
}
