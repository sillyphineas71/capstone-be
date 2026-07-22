import {
  IsOptional,
  IsInt,
  Min,
  Max,
  IsIn,
  IsString,
  IsBoolean,
  MaxLength,
} from 'class-validator';
import { Type, Transform, Expose } from 'class-transformer';
import {
  CONTROL_LIST_TYPES,
  type ControlListType,
} from './create-vehicle-control-list.dto.js';

/**
 * ListVehicleControlListQueryDto (VCL-001 / UC8) — query GET /anpr/admin/control-list.
 *
 * Mirror pagination UC3 (page/limit, limit max 100). `plate` được service normalize
 * (`normalizePlate()`) trước khi so khớp — so khớp CHÍNH XÁC trên `plate_number` đã chuẩn
 * hóa, KHÔNG phải tìm gần đúng (spec §3). `active` là query string 'true'/'false' —
 * `@Type(()=>Boolean)` của class-transformer coi MỌI string non-empty là true nên phải
 * `@Transform` tay để 'false' → false thật.
 */
export class ListVehicleControlListQueryDto {
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
  @IsString()
  @MaxLength(20)
  plate?: string;

  @Expose({ name: 'list_type' })
  @IsOptional()
  @IsIn(CONTROL_LIST_TYPES)
  listType?: ControlListType;

  @Transform(({ value }) =>
    value === undefined ? undefined : value === 'true',
  )
  @IsOptional()
  @IsBoolean()
  active?: boolean;
}
