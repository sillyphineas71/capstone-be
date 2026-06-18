import {
  IsOptional,
  IsString,
  IsInt,
  IsEnum,
  Min,
  Max,
  MaxLength,
} from 'class-validator';
import { Type, Transform } from 'class-transformer';

export enum AttendanceQueryStatus {
  CHECKED_IN = 'checked_in',
  LATE = 'late',
  ABSENT = 'absent',
}

export enum SortOrder {
  ASC = 'asc',
  DESC = 'desc',
}

const ALLOWED_SORT_BY = ['full_name', 'attendance_status', 'check_in_time'] as const;
type AllowedSortBy = (typeof ALLOWED_SORT_BY)[number];

export class AttendanceQueryDto {
  @IsOptional()
  @IsString()
  @MaxLength(100)
  @Transform(({ value }: { value: string }) => value?.trim())
  q?: string;

  @IsOptional()
  @IsEnum(AttendanceQueryStatus)
  status?: AttendanceQueryStatus;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  page?: number = 1;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(100)
  pageSize?: number = 20;

  @IsOptional()
  @IsString()
  @Transform(({ value }: { value: string }) => {
    const v = value?.trim().toLowerCase();
    if (v && ALLOWED_SORT_BY.includes(v as AllowedSortBy)) {
      return v;
    }
    return 'full_name';
  })
  sortBy?: string = 'full_name';

  @IsOptional()
  @IsEnum(SortOrder)
  sortOrder?: SortOrder = SortOrder.ASC;
}
