import {
  IsString,
  IsOptional,
  IsIn,
  IsUUID,
  IsBoolean,
  MaxLength,
} from 'class-validator';
import { Expose } from 'class-transformer';
import {
  PERSON_CONTROL_LIST_TYPES,
  PERSON_CONTROL_PRIORITIES,
  type PersonControlListType,
  type PersonControlPriority,
} from './create-person-control-list.dto.js';

/**
 * UpdatePersonControlListDto (PWL-001 / UC-125) — body PATCH /api/v1/person-control-list/:id.
 *
 * TẤT CẢ field optional. Đổi `userId`/`faceProfileId` → service re-check dedup 2 nhánh
 * ĐỘC LẬP (mirror create — spec §2.6).
 */
export class UpdatePersonControlListDto {
  @Expose({ name: 'user_id' })
  @IsOptional()
  @IsUUID()
  userId?: string | null;

  @Expose({ name: 'face_profile_id' })
  @IsOptional()
  @IsUUID()
  faceProfileId?: string | null;

  @Expose({ name: 'display_name' })
  @IsOptional()
  @IsString()
  @MaxLength(255)
  displayName?: string;

  @Expose({ name: 'photo_media_file_id' })
  @IsOptional()
  @IsUUID()
  photoMediaFileId?: string | null;

  @Expose({ name: 'list_type' })
  @IsOptional()
  @IsIn(PERSON_CONTROL_LIST_TYPES)
  listType?: PersonControlListType;

  @IsOptional()
  @IsString()
  @MaxLength(255)
  reason?: string;

  @IsOptional()
  @IsIn(PERSON_CONTROL_PRIORITIES)
  priority?: PersonControlPriority;

  @IsOptional()
  @IsBoolean()
  active?: boolean;
}
