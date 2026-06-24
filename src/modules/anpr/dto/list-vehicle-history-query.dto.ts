import {
  IsOptional,
  IsInt,
  Min,
  Max,
  IsISO8601,
  IsIn,
  IsString,
  MaxLength,
} from 'class-validator';
import { Type } from 'class-transformer';

/**
 * ListVehicleHistoryQueryDto (VHI-001 / UC7) — query GET /anpr/vehicle-history + /anpr/admin/vehicle-history.
 *
 * 1 DTO chung 2 route. `listForUser` BỎ QUA `matchState` (chỉ `listAll` dùng).
 * `plateNumber` nhận RAW — service normalize qua normalizePlate (UC1) trước khi so DB (DATA-03).
 */
export class ListVehicleHistoryQueryDto {
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
  @IsIn(['enter', 'leave', 'seen'])
  direction?: string;

  @IsOptional()
  @IsString()
  @MaxLength(20)
  plateNumber?: string;

  // Chỉ admin route (listAll) dùng — lọc chỉ-khớp / chỉ-lạ.
  @IsOptional()
  @IsIn(['matched', 'unmatched'])
  matchState?: string;
}
