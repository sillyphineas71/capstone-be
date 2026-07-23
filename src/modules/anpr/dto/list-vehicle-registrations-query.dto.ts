import {
  IsOptional,
  IsInt,
  Min,
  Max,
  IsIn,
  IsString,
  MaxLength,
} from 'class-validator';
import { Type, Expose } from 'class-transformer';
import {
  VEHICLE_STATUSES,
  type VehicleStatus,
} from './update-vehicle-status.dto.js';

/**
 * ListVehicleRegistrationsQueryDto (VPL-001 / UC3, mở rộng UC-101 / VPL-002)
 * — query GET /anpr/vehicle-registrations (route USER).
 *
 * Mirror pagination repo (iot-devices): page/limit (limit max 100). `@Type(()=>Number)` ép
 * query string → number (cần ValidationPipe transform:true).
 * Filter optional: `status` (exact), `plate` (search — service normalize + ILike),
 * `vehicle_type` (exact, chuỗi tự do — KHÔNG @IsIn vì cột không enum).
 *
 * SEC-01: KHÔNG nhận `user_id`/`owner` — route user LUÔN lọc theo current user (userId từ JWT).
 * (Lớp con `AdminListVehicleRegistrationsQueryDto` mới thêm `user_id`/`owner` cho route admin.)
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

  // UC-101: tìm theo biển số (một phần). Service normalize qua normalizePlate rồi ILike.
  @IsOptional()
  @IsString()
  @MaxLength(20)
  plate?: string;

  // UC-101: lọc loại xe (exact). Cột vehicle_type là varchar tự do ⇒ KHÔNG @IsIn (QĐ-5).
  @Expose({ name: 'vehicle_type' })
  @IsOptional()
  @IsString()
  @MaxLength(50)
  vehicleType?: string;
}
