import {
  IsOptional,
  IsInt,
  Min,
  Max,
  IsDateString,
  IsUUID,
  IsString,
  MaxLength,
  IsEnum,
} from 'class-validator';
import { Type } from 'class-transformer';
import { ApiPropertyOptional } from '@nestjs/swagger';

export enum AuditLogSeverityFilter {
  INFO = 'info',
  WARNING = 'warning',
  ERROR = 'error',
  CRITICAL = 'critical',
}

/**
 * QueryAuditLogsDto — bộ lọc tùy chọn cho GET /api/v1/audit-logs.
 *
 * Tất cả field đều optional. Khi không truyền, không áp filter tương ứng.
 * Validate `from > to` được xử lý ở service (T013).
 */
export class QueryAuditLogsDto {
  @ApiPropertyOptional({ description: 'Trang hiện tại (bắt đầu từ 1)', minimum: 1 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  page?: number;

  @ApiPropertyOptional({ description: 'Số bản ghi mỗi trang (tối đa 100)', minimum: 1, maximum: 100 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(100)
  limit?: number;

  @ApiPropertyOptional({ description: 'Lọc từ thời điểm (ISO 8601)', example: '2026-01-01T00:00:00Z' })
  @IsOptional()
  @IsDateString()
  from?: string;

  @ApiPropertyOptional({ description: 'Lọc đến thời điểm (ISO 8601)', example: '2026-12-31T23:59:59Z' })
  @IsOptional()
  @IsDateString()
  to?: string;

  @ApiPropertyOptional({ description: 'Lọc theo userId (UUID)', format: 'uuid' })
  @IsOptional()
  @IsUUID()
  userId?: string;

  @ApiPropertyOptional({ description: 'Lọc theo loại hành động (actionType)', maxLength: 80 })
  @IsOptional()
  @IsString()
  @MaxLength(80)
  actionType?: string;

  @ApiPropertyOptional({ description: 'Lọc theo loại entity (entityType)', maxLength: 80 })
  @IsOptional()
  @IsString()
  @MaxLength(80)
  entityType?: string;

  @ApiPropertyOptional({
    description: 'Lọc theo mức độ nghiêm trọng',
    enum: AuditLogSeverityFilter,
  })
  @IsOptional()
  @IsEnum(AuditLogSeverityFilter)
  severity?: AuditLogSeverityFilter;
}
