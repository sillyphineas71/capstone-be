import {
  IsOptional,
  IsInt,
  Min,
  Max,
  IsISO8601,
  IsUUID,
} from 'class-validator';
import { Type, Expose } from 'class-transformer';

/**
 * ListGateAccessHistoryQueryDto (GAH-001 / UC-117) — query GET /gate-access/history (own).
 * Mirror pagination chuẩn repo (page/limit, limit max 100).
 */
export class ListGateAccessHistoryQueryDto {
  @Type(() => Number)
  @IsOptional()
  @IsInt()
  @Min(1)
  page: number = 1;

  @Type(() => Number)
  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(100)
  limit: number = 20;

  @IsOptional()
  @IsISO8601()
  from?: string;

  @IsOptional()
  @IsISO8601()
  to?: string;

  @Expose({ name: 'zone_id' })
  @IsOptional()
  @IsUUID()
  zoneId?: string;
}
