import {
  IsOptional,
  IsInt,
  Min,
  Max,
  IsISO8601,
  IsIn,
  IsUUID,
} from 'class-validator';
import { Type, Expose } from 'class-transformer';
import { GATE_DIRECTIONS } from '../constants/gate-direction.constant.js';

/**
 * ListGateAccessLogsQueryDto (GAL-001 / UC-107) — query GET /api/v1/gate-access-logs (route USER).
 *
 * Mirror pagination repo: page/limit (limit max 100). Filter optional: `from`/`to`
 * (khoảng access_time, ISO8601), `direction` (enter/leave), `zone_id` (exact).
 *
 * SEC-01: KHÔNG nhận `user_id`/`plate` — route user LUÔN fold cứng userId từ JWT.
 * (Lớp con AdminListGateAccessLogsQueryDto mới thêm `user_id`/`plate` cho route admin.)
 */
export class ListGateAccessLogsQueryDto {
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

  @IsOptional()
  @IsIn(GATE_DIRECTIONS)
  direction?: string;

  @Expose({ name: 'zone_id' })
  @IsOptional()
  @IsUUID('4')
  zoneId?: string;
}
