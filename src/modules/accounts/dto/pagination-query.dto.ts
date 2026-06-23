import { IsOptional, IsString, IsEnum, Min, Max, IsIn } from 'class-validator';
import { Type } from 'class-transformer';
import { PERMISSION_SORT_FIELDS } from '../constants/permission-sort-fields.constant.js';

export class PaginationQueryDto {
  @Type(() => Number)
  @Min(1, { message: 'page phải lớn hơn hoặc bằng 1' })
  @IsOptional()
  page?: number = 1;

  @Type(() => Number)
  @Min(1, { message: 'limit phải lớn hơn hoặc bằng 1' })
  @Max(100, { message: 'limit không được vượt quá 100' })
  @IsOptional()
  limit?: number = 20;

  @IsOptional()
  @IsString({ message: 'sortBy phải là chuỗi ký tự' })
  @IsIn(PERMISSION_SORT_FIELDS as unknown as string[], {
    message: `sortBy không hợp lệ. Giá trị cho phép: ${(PERMISSION_SORT_FIELDS as unknown as string[]).join(', ')}`,
  })
  sortBy?: string = 'createdAt';

  @IsOptional()
  @IsIn(['asc', 'desc'], { message: 'sortOrder phải là "asc" hoặc "desc"' })
  sortOrder?: 'asc' | 'desc' = 'desc';

  @IsOptional()
  @IsString({ message: 'moduleCode phải là chuỗi ký tự' })
  moduleCode?: string;

  @IsOptional()
  @IsString({ message: 'search phải là chuỗi ký tự' })
  search?: string;
}
