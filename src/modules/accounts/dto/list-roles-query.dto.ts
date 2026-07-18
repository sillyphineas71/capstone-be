import {
  IsOptional,
  IsString,
  IsBoolean,
  IsIn,
  Min,
  Max,
} from 'class-validator';
import { Type, Transform } from 'class-transformer';
import { ROLE_SORT_FIELDS } from '../constants/role-sort-fields.constant.js';

export class ListRolesQueryDto {
  @Type(() => Number)
  @Min(1)
  @IsOptional()
  page?: number = 1;

  @Type(() => Number)
  @Min(1)
  @Max(100)
  @IsOptional()
  limit?: number = 20;

  @IsOptional()
  @IsString()
  @IsIn(ROLE_SORT_FIELDS)
  sortBy?: string = 'createdAt';

  @IsOptional()
  @IsIn(['asc', 'desc'])
  sortOrder?: 'asc' | 'desc' = 'desc';

  @IsOptional()
  @Transform(({ value }: { value: unknown }) =>
    value === true || value === 'true'
      ? true
      : value === false || value === 'false'
        ? false
        : value,
  )
  @IsBoolean()
  isActive?: boolean;

  @IsOptional()
  @IsString()
  search?: string;
}
