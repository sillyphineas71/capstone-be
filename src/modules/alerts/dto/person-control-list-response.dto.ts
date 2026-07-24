import { PersonControlListEntity } from '../entities/person-control-list.entity.js';

/**
 * PersonControlListResponseDto (PWL-001 / UC-125) — shape công khai (mirror
 * toVehicleControlListResponse). KHÔNG lộ `deleted_at`.
 */
export class PersonControlListResponseDto {
  id: string;
  user_id: string | null;
  face_profile_id: string | null;
  display_name: string;
  photo_media_file_id: string | null;
  list_type: string;
  reason: string | null;
  priority: string;
  active: boolean;
  created_by: string | null;
  created_at: Date;
  updated_at: Date;
}

export function toPersonControlListResponse(
  entity: PersonControlListEntity,
): PersonControlListResponseDto {
  return {
    id: entity.id,
    user_id: entity.userId,
    face_profile_id: entity.faceProfileId,
    display_name: entity.displayName,
    photo_media_file_id: entity.photoMediaFileId,
    list_type: entity.listType,
    reason: entity.reason,
    priority: entity.priority,
    active: entity.active,
    created_by: entity.createdBy,
    created_at: entity.createdAt,
    updated_at: entity.updatedAt,
  };
}
