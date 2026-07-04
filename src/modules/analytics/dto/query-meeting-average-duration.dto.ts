import { IsOptional, IsDateString, IsEnum, IsUUID, IsArray } from 'class-validator';
import { ApiPropertyOptional } from '@nestjs/swagger';
import { Transform } from 'class-transformer';

export class QueryMeetingAverageDurationDto {
  @IsOptional()
  @IsDateString({}, { message: 'from must be a valid ISO date string' })
  @ApiPropertyOptional({ description: 'Start date (ISO 8601)', example: '2026-06-01' })
  from?: string;

  @IsOptional()
  @IsDateString({}, { message: 'to must be a valid ISO date string' })
  @ApiPropertyOptional({ description: 'End date (ISO 8601)', example: '2026-06-30' })
  to?: string;

  @IsOptional()
  @IsEnum(['day', 'week', 'month', 'quarter'], {
    message: 'granularity must be one of: day, week, month, quarter',
  })
  @ApiPropertyOptional({
    description: 'Grouping granularity',
    enum: ['day', 'week', 'month', 'quarter'],
    default: 'week',
  })
  granularity?: string;

  @IsOptional()
  @Transform(({ value }) => {
    if (typeof value === 'string') {
      return value.split(',').map((v) => v.trim());
    }
    if (Array.isArray(value)) {
      return value.map((v) => (typeof v === 'string' ? v.trim() : v));
    }
    return value;
  })
  @IsArray({ message: 'departmentIds must be an array' })
  @IsUUID('4', { each: true, message: 'departmentIds must contain valid UUID v4 elements' })
  @ApiPropertyOptional({
    description: 'Filter by one or more department UUIDs (comma-separated or multiple parameters)',
    type: [String],
  })
  departmentIds?: string[];

  @IsOptional()
  @IsUUID('4', { message: 'roomId must be a valid UUID v4' })
  @ApiPropertyOptional({ description: 'Filter by room UUID' })
  roomId?: string;
}
