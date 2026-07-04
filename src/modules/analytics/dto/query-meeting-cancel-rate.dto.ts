import { IsOptional, IsEnum, IsDateString, IsUUID, IsArray, IsEmail } from 'class-validator';
import { ApiPropertyOptional } from '@nestjs/swagger';
import { Transform } from 'class-transformer';

export class QueryMeetingCancelRateDto {
  @IsOptional()
  @IsEnum(['month_current', 'month_previous', 'quarter', 'custom'], {
    message: 'preset must be one of: month_current, month_previous, quarter, custom',
  })
  @ApiPropertyOptional({
    description: 'Time range preset',
    enum: ['month_current', 'month_previous', 'quarter', 'custom'],
    default: 'month_current',
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
  @IsEnum(['week', 'month'], {
    message: 'granularity must be week or month',
  })
  @ApiPropertyOptional({
    description: 'Grouping granularity',
    enum: ['week', 'month'],
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

  @IsOptional()
  @IsEmail({}, { message: 'organizerEmail must be a valid email address' })
  @ApiPropertyOptional({ description: 'Filter by organizer email' })
  organizerEmail?: string;
}
