import { IsOptional, IsString, Min, Max } from 'class-validator';
import { Type } from 'class-transformer';

export class ListUsersQueryDto {
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
  @IsString({ message: 'search phải là chuỗi ký tự' })
  search?: string;
}
