import {
  IsIn,
  IsString,
  IsOptional,
  IsBoolean,
  IsInt,
  Min,
  Max,
  MaxLength,
} from 'class-validator';
import { Type } from 'class-transformer';

/**
 * DTO cho UC-103/104 Xem & Tim kiem ghi chu.
 * Query params: noteType, pinned, q, page, limit.
 */
export class ListNotesQueryDto {
  @IsOptional()
  @IsIn(['in_meeting', 'private', 'host_note', 'system_note'])
  noteType?: string;

  @IsOptional()
  @Type(() => Boolean)
  @IsBoolean()
  pinned?: boolean;

  @IsOptional()
  @IsString()
  @MaxLength(200)
  q?: string;

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
  limit?: number = 20;
}
