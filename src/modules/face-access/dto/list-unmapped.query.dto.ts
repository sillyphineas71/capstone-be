import { IsOptional, IsInt, Min, Max } from 'class-validator';
import { Type } from 'class-transformer';

/**
 * ListUnmappedQueryDto (UMR-001) — query GET /api/v1/face-access/unmapped-verifies.
 *
 * page/limit phân trang (limit max 100). windowMinutes tùy chọn override env
 * FACE_UNMAPPED_WINDOW_MINUTES (cửa sổ thời gian lấy verify gần đây).
 */
export class ListUnmappedQueryDto {
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  page: number = 1;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(100)
  limit: number = 20;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  windowMinutes?: number;
}
