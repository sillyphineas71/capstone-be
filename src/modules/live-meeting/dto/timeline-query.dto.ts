import {
  IsOptional,
  IsISO8601,
  IsString,
  IsIn,
  IsInt,
  Min,
  Max,
} from 'class-validator';
import { Type } from 'class-transformer';

/**
 * UC-99 — Query cho timeline cuộc họp (GET /meetings/:meetingId/timeline).
 *
 * Tất cả optional. `from ≤ to` được validate ở service. `sort` allowlist asc/desc.
 * `types` (csv category) lọc nguồn nếu truyền.
 */
export class TimelineQueryDto {
  @IsOptional()
  @IsISO8601({}, { message: 'from phải là ISO 8601' })
  from?: string;

  @IsOptional()
  @IsISO8601({}, { message: 'to phải là ISO 8601' })
  to?: string;

  @IsOptional()
  @IsString({ message: 'types phải là chuỗi ký tự' })
  types?: string;

  @IsOptional()
  @IsIn(['asc', 'desc'], { message: 'sort chỉ được là asc hoặc desc' })
  sort?: 'asc' | 'desc' = 'asc';

  @Type(() => Number)
  @IsOptional()
  @IsInt({ message: 'page phải là số nguyên' })
  @Min(1, { message: 'page phải lớn hơn hoặc bằng 1' })
  page?: number = 1;

  @Type(() => Number)
  @IsOptional()
  @IsInt({ message: 'limit phải là số nguyên' })
  @Min(1, { message: 'limit phải lớn hơn hoặc bằng 1' })
  @Max(100, { message: 'limit không được vượt quá 100' })
  limit?: number = 20;
}
