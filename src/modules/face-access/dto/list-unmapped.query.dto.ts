import { ApiPropertyOptional } from '@nestjs/swagger';
import { IsOptional, IsInt, Min, Max } from 'class-validator';
import { Type } from 'class-transformer';

/**
 * ListUnmappedQueryDto (UMR-001) — query GET /api/v1/face-access/unmapped-verifies.
 *
 * page/limit phân trang (limit max 100). windowMinutes tùy chọn override env
 * FACE_UNMAPPED_WINDOW_MINUTES (cửa sổ thời gian lấy verify gần đây).
 */
export class ListUnmappedQueryDto {
  @ApiPropertyOptional({ description: 'Số trang', default: 1 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  page: number = 1;

  @ApiPropertyOptional({
    description: 'Số bản ghi mỗi trang (tối đa 100)',
    default: 20,
  })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(100)
  limit: number = 20;

  @ApiPropertyOptional({
    description:
      'Override cửa sổ thời gian lấy verify gần đây (phút), mặc định FACE_UNMAPPED_WINDOW_MINUTES',
  })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  windowMinutes?: number;
}
