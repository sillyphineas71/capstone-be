import { IsOptional, IsInt, Min, Max, IsIn } from 'class-validator';
import { Type } from 'class-transformer';
import {
  VEHICLE_STATUSES,
  type VehicleStatus,
} from './update-vehicle-status.dto.js';

/**
 * ListVehicleRegistrationsQueryDto (VPL-001 / UC3) — query GET /anpr/vehicle-registrations.
 *
 * Mirror pagination repo (iot-devices): page/limit (limit max 100). `@Type(()=>Number)` ép
 * query string → number (cần ValidationPipe transform:true). `status` filter optional.
 * KHÔNG nhận `user_id` — server lọc theo current user (SEC-01).
 */
export class ListVehicleRegistrationsQueryDto {
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
  @IsIn(VEHICLE_STATUSES)
  status?: VehicleStatus;
}
