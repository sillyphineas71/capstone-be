import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { PersonControlListEntity } from '../entities/person-control-list.entity.js';

/**
 * PersonControlListResponseDto (PWL-001 / UC-125) — shape công khai (mirror
 * toVehicleControlListResponse). KHÔNG lộ `deleted_at`.
 */
export class PersonControlListResponseDto {
  @ApiProperty({ description: 'ID mục trong danh sách kiểm soát' })
  id: string;

  @ApiPropertyOptional({ nullable: true, description: 'ID user hệ thống ứng với người này (nếu có)' })
  user_id: string | null;

  @ApiPropertyOptional({ nullable: true, description: 'ID face profile dùng để so khớp trực tiếp' })
  face_profile_id: string | null;

  @ApiProperty({ description: 'Tên hiển thị của người trong danh sách kiểm soát' })
  display_name: string;

  @ApiPropertyOptional({ nullable: true, description: 'ID ảnh chân dung đính kèm' })
  photo_media_file_id: string | null;

  @ApiProperty({ description: 'Phân loại danh sách (watchlist/blocklist)' })
  list_type: string;

  @ApiPropertyOptional({ nullable: true, description: 'Lý do đưa vào danh sách kiểm soát' })
  reason: string | null;

  @ApiProperty({ description: 'Mức độ ưu tiên' })
  priority: string;

  @ApiProperty({ description: 'Trạng thái kích hoạt theo dõi' })
  active: boolean;

  @ApiPropertyOptional({ nullable: true, description: 'ID user tạo mục này' })
  created_by: string | null;

  @ApiProperty({ description: 'Thời điểm tạo' })
  created_at: Date;

  @ApiProperty({ description: 'Thời điểm cập nhật gần nhất' })
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
