import {
  IsOptional,
  IsInt,
  Min,
  Max,
  IsIn,
  IsUUID,
  IsBoolean,
} from 'class-validator';
import { Type, Transform, Expose } from 'class-transformer';
import {
  PERSON_CONTROL_LIST_TYPES,
  type PersonControlListType,
} from './create-person-control-list.dto.js';

/**
 * QueryPersonControlListDto (PWL-001 / UC-125) — query GET /api/v1/person-control-list.
 * Mirror pagination UC8 (page/limit, limit max 100).
 */
export class QueryPersonControlListDto {
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

  @Expose({ name: 'list_type' })
  @IsOptional()
  @IsIn(PERSON_CONTROL_LIST_TYPES)
  listType?: PersonControlListType;

  @Transform(({ value }) =>
    value === undefined ? undefined : value === 'true',
  )
  @IsOptional()
  @IsBoolean()
  active?: boolean;

  @Expose({ name: 'user_id' })
  @IsOptional()
  @IsUUID()
  userId?: string;

  @Expose({ name: 'face_profile_id' })
  @IsOptional()
  @IsUUID()
  faceProfileId?: string;
}
