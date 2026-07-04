import { IsOptional, IsEnum, IsDateString, IsUUID, IsArray, IsEmail, IsInt, Min, Max } from 'class-validator';
import { ApiPropertyOptional } from '@nestjs/swagger';
import { Transform, Type } from 'class-transformer';

export class QueryNoShowRateDto {
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

  @IsOptional()
  @IsEnum(['room', 'department', 'organizer'], {
    message: 'rankBy must be room, department, or organizer',
  })
  @ApiPropertyOptional({
    description: 'Ranking category',
    enum: ['room', 'department', 'organizer'],
    default: 'room',
  })
  rankBy?: string;

  @IsOptional()
  @Type(() => Number)
  @IsInt({ message: 'page must be an integer' })
  @Min(1, { message: 'page must be at least 1' })
  @ApiPropertyOptional({ description: 'Page number', default: 1 })
  page?: number;

  @IsOptional()
  @Type(() => Number)
  @IsInt({ message: 'limit must be an integer' })
  @Min(1, { message: 'limit must be at least 1' })
  @Max(100, { message: 'limit must not exceed 100' })
  @ApiPropertyOptional({ description: 'Limit number of items per page', default: 20 })
  limit?: number;
}
