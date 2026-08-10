import { ApiPropertyOptional } from '@nestjs/swagger';
import { IsOptional, IsInt, Min, Max, IsISO8601 } from 'class-validator';
import { Type } from 'class-transformer';

/**
 * ListUnknownVehiclesQueryDto (VUN-001 / UC6) — query GET /anpr/admin/unknown-vehicles.
 *
 * Mirror pagination UC3 (page/limit, limit max 100). `@Type(()=>Number)` ép query string→number
 * (cần ValidationPipe transform). Filter time-range `from`/`to` (theo event_time, ISO-8601) — OQ-2.
 */
export class ListUnknownVehiclesQueryDto {
  @ApiPropertyOptional({ description: 'Số trang', default: 1 })
  @Type(() => Number)
  @IsOptional()
  @IsInt()
  @Min(1)
  page: number = 1;

  @ApiPropertyOptional({ description: 'Số bản ghi mỗi trang (tối đa 100)', default: 20 })
  @Type(() => Number)
  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(100)
  limit: number = 20;

  @ApiPropertyOptional({ description: 'Lọc từ thời điểm (theo event_time, ISO 8601)' })
  @IsOptional()
  @IsISO8601()
  from?: string;

  @ApiPropertyOptional({ description: 'Lọc đến thời điểm (theo event_time, ISO 8601)' })
  @IsOptional()
  @IsISO8601()
  to?: string;
}
