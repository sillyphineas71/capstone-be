import { IsOptional, IsEnum, IsDateString } from 'class-validator';
import { ApiPropertyOptional } from '@nestjs/swagger';

export class QueryRoomDetailDto {
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
    description: 'Start date (ISO 8601) - only used if preset=custom',
    example: '2026-06-01',
  })
  from?: string;

  @IsOptional()
  @IsDateString({}, { message: 'to must be a valid ISO date string' })
  @ApiPropertyOptional({
    description: 'End date (ISO 8601) - only used if preset=custom',
    example: '2026-06-30',
  })
  to?: string;
}
