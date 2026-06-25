import {
  IsOptional,
  IsIn,
  IsBoolean,
  IsInt,
  IsDateString,
  IsUUID,
  MaxLength,
  Min,
  Max,
} from 'class-validator';
import { Type, Transform } from 'class-transformer';

/**
 * DTO cho UC-IMM-10 View Meeting Notes + UC-IMM-11 Search Meeting Notes query params.
 * All fields optional; default values applied in service.
 */
export class ViewNotesQueryDto {
  // === UC-IMM-11 Search fields ===

  @IsOptional()
  @MaxLength(255)
  q?: string;

  @IsOptional()
  @IsUUID()
  authorId?: string;

  @IsOptional()
  @IsDateString()
  createdFrom?: string;

  @IsOptional()
  @IsDateString()
  createdTo?: string;

  // === UC-IMM-10 View fields ===

  @IsOptional()
  @IsIn(['in_meeting', 'private', 'host_note', 'system_note'])
  noteType?: string;

  @IsOptional()
  @IsIn(['private', 'participants', 'public_internal', 'department'])
  visibility?: string;

  @IsOptional()
  @Transform(({ value }) => value === 'true' || value === true)
  @IsBoolean()
  pinned?: boolean;

  @IsOptional()
  @IsDateString()
  from?: string;

  @IsOptional()
  @IsDateString()
  to?: string;

  @IsOptional()
  @Transform(({ value }) => value === 'true' || value === true)
  @IsBoolean()
  includeSourceEvent?: boolean;

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

  @IsOptional()
  @IsIn(['timeline_asc', 'timeline_desc'])
  sort?: string = 'timeline_asc';
}
