import { Type } from 'class-transformer';
import {
  IsDateString,
  IsEnum,
  IsInt,
  IsOptional,
  Max,
  MaxLength,
  Min,
} from 'class-validator';

export class MeetingHistoryQueryDto {
  @IsOptional()
  @IsEnum(
    [
      'draft',
      'pending_approval',
      'scheduled',
      'in_progress',
      'cancelled',
      'completed',
    ],
    {
      each: true,
      message: 'status khong hop le',
    },
  )
  status?: string[] = ['completed'];

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
  @IsDateString(
    {},
    { message: 'from phai la ISO date string (vd: 2026-06-08T00:00:00+07:00)' },
  )
  from?: string;

  @IsOptional()
  @IsDateString(
    {},
    { message: 'to phai la ISO date string (vd: 2026-06-08T00:00:00+07:00)' },
  )
  to?: string;

  @IsOptional()
  @MaxLength(200, { message: 'q khong duoc vuot qua 200 ky tu' })
  q?: string;
}
