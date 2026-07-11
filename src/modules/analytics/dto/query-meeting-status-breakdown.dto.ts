import {
  IsOptional,
  IsEnum,
  IsDateString,
  IsUUID,
  IsArray,
} from 'class-validator';
import { ApiPropertyOptional } from '@nestjs/swagger';
import { Transform } from 'class-transformer';

export class QueryMeetingStatusBreakdownDto {
  @IsOptional()
  @IsEnum(['day', 'week', 'month', 'custom'], {
    message: 'preset must be one of: day, week, month, custom',
  })
  @ApiPropertyOptional({
    description: 'Time range preset',
    enum: ['day', 'week', 'month', 'custom'],
    default: 'month',
  })
  preset?: string;

  @IsOptional()
  @IsDateString({}, { message: 'from must be a valid ISO date string' })
  @ApiPropertyOptional({
    description: 'Start date (ISO 8601)',
    example: '2026-06-01',
  })
  from?: string;

  @IsOptional()
  @IsDateString({}, { message: 'to must be a valid ISO date string' })
  @ApiPropertyOptional({
    description: 'End date (ISO 8601)',
    example: '2026-06-30',
  })
  to?: string;

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
  @IsUUID('4', {
    each: true,
    message: 'departmentIds must contain valid UUID v4 elements',
  })
  @ApiPropertyOptional({
    description:
      'Filter by one or more department UUIDs (comma-separated or multiple parameters)',
    type: [String],
  })
  departmentIds?: string[];
}
