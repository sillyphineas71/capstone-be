import {
  IsString,
  IsNotEmpty,
  IsOptional,
  IsIn,
  IsUUID,
  IsBoolean,
  MaxLength,
} from 'class-validator';
import { Expose } from 'class-transformer';

/** UC-125 (PWL-001): mirror `vehicle_control_list.list_type` (Hải review §1.3). */
export const PERSON_CONTROL_LIST_TYPES = ['watchlist', 'blocklist'] as const;
export type PersonControlListType = (typeof PERSON_CONTROL_LIST_TYPES)[number];

/** Cùng vocabulary với `security_alerts.severity` — priority dùng thẳng làm severity (spec §2.1). */
export const PERSON_CONTROL_PRIORITIES = [
  'low',
  'medium',
  'high',
  'critical',
] as const;
export type PersonControlPriority = (typeof PERSON_CONTROL_PRIORITIES)[number];

/**
 * CreatePersonControlListDto (PWL-001 / UC-125) — body POST /api/v1/person-control-list.
 *
 * KHÔNG có `createdBy`: lấy từ JWT (@CurrentUser), KHÔNG từ body — mirror SEC-01/02 UC1/UC8.
 * `userId`/`faceProfileId` đều optional, ĐỘC LẬP (người ngoài chỉ có `displayName`).
 */
export class CreatePersonControlListDto {
  @Expose({ name: 'user_id' })
  @IsOptional()
  @IsUUID()
  userId?: string;

  @Expose({ name: 'face_profile_id' })
  @IsOptional()
  @IsUUID()
  faceProfileId?: string;

  @Expose({ name: 'display_name' })
  @IsString()
  @IsNotEmpty()
  @MaxLength(255)
  displayName: string;

  @Expose({ name: 'photo_media_file_id' })
  @IsOptional()
  @IsUUID()
  photoMediaFileId?: string;

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
