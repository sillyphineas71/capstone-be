import {
  IsOptional,
  IsString,
  IsEnum,
  IsInt,
  Min,
  Max,
  MaxLength,
  IsIn,
} from 'class-validator';
import { Type } from 'class-transformer';
import { ApiPropertyOptional } from '@nestjs/swagger';

export const AttendanceQueryStatusList = [
  'all',
  'present',
  'late',
  'absent',
  'not_checked_in',
  'left_early',
] as const;

export type AttendanceQueryStatus = (typeof AttendanceQueryStatusList)[number];

export class QueryAttendanceDto {
  @ApiPropertyOptional({
    description: 'Filter by attendance status',
    enum: AttendanceQueryStatusList,
    default: 'all',
  })
  @IsOptional()
  @IsString()
  @IsIn(AttendanceQueryStatusList, {
    message:
      'status must be one of: all, present, late, absent, not_checked_in, left_early',
  })
  status?: AttendanceQueryStatus;

  @ApiPropertyOptional({
    description: 'Search by name/email, max 100 chars',
    maxLength: 100,
  })
  @IsOptional()
  @IsString()
  @MaxLength(100, { message: 'search cannot exceed 100 characters' })
  search?: string;

  @ApiPropertyOptional({ description: 'Page number', default: 1, minimum: 1 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1, { message: 'page must be >= 1' })
  page?: number = 1;

  @ApiPropertyOptional({
    description: 'Items per page (1-100)',
    default: 20,
    minimum: 1,
    maximum: 100,
  })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1, { message: 'pageSize must be >= 1' })
  @Max(100, { message: 'pageSize cannot exceed 100' })
  pageSize?: number = 20;
}
