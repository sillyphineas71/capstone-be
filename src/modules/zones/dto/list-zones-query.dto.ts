import {
  IsOptional,
  IsInt,
  IsString,
  IsIn,
  Min,
  Max,
  MaxLength,
} from 'class-validator';
import { Expose, Type } from 'class-transformer';
import { ZONE_TYPES, type ZoneType } from '../constants/zone-type.constant.js';
import {
  ZONE_STATUSES,
  type ZoneStatus,
} from '../constants/zone-status.constant.js';

/**
 * ListZonesQueryDto (ZNL-001 / UC-93) — query cho `GET /api/v1/zones`.
 *
 * `@Type(() => Number)` BẮT BUỘC cho `page`/`limit`: query string luôn là string, thiếu nó
 * `@IsInt` sẽ fail toàn bộ. Chỉ hoạt động khi pipe có `transform: true` (`ZONE_PIPE` đã có).
 *
 * Chi phí truy vấn của từng filter (migration 20260721000001, cả 3 index đều partial
 * `WHERE deleted_at IS NULL`):
 * - `zone_type`                → dùng `IDX_zones_type`
 * - `building` (± `floor`)     → dùng `IDX_zones_building_floor`
 * - `floor` ĐƠN LẺ             → KHÔNG dùng được index (cột thứ 2 của composite) — chấp nhận scan
 * - `status`                   → KHÔNG có index — chấp nhận scan
 * - `search` (`ILIKE '%kw%'`)  → leading wildcard, luôn full scan
 * Chấp nhận được vì `zones` là danh mục cấu hình (số bản ghi nhỏ). Thêm index là task riêng.
 *
 * CỐ Ý KHÔNG khai `sort_by`/`sort_order` (OQ-4: hard-code `zone_code ASC`, không mở bề mặt
 * `ORDER BY`), `include_deleted` (OQ-7), `fields`. `whitelist: true` loại sạch nếu client gửi.
 */
export class ListZonesQueryDto {
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

  @Expose({ name: 'zone_type' })
  @IsOptional()
  @IsIn([...ZONE_TYPES])
  zoneType?: ZoneType;

  @IsOptional()
  @IsString()
  @MaxLength(100)
  building?: string;

  @IsOptional()
  @IsString()
  @MaxLength(30)
  floor?: string;

  @IsOptional()
  @IsIn([...ZONE_STATUSES])
  status?: ZoneStatus;

  @IsOptional()
  @IsString()
  @MaxLength(200)
  search?: string;
}
