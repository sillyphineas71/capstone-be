import { ApiPropertyOptional } from '@nestjs/swagger';
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
  @ApiPropertyOptional({
    description:
      'ID user hệ thống ứng với người này — đổi sẽ kích hoạt re-check dedup',
  })
  @Expose({ name: 'user_id' })
  @IsOptional()
  @IsUUID()
  userId?: string | null;

  @ApiPropertyOptional({
    description:
      'ID face profile dùng để so khớp trực tiếp — đổi sẽ kích hoạt re-check dedup',
  })
  @Expose({ name: 'face_profile_id' })
  @IsOptional()
  @IsUUID()
  faceProfileId?: string | null;

  @ApiPropertyOptional({
    description: 'Tên hiển thị của người trong danh sách kiểm soát',
    maxLength: 255,
  })
  @Expose({ name: 'display_name' })
  @IsOptional()
  @IsString()
  @MaxLength(255)
  displayName?: string;

  @ApiPropertyOptional({ description: 'ID ảnh chân dung đính kèm' })
  @Expose({ name: 'photo_media_file_id' })
  @IsOptional()
  @IsUUID()
  photoMediaFileId?: string | null;

  @ApiPropertyOptional({
    description: 'Phân loại danh sách',
    enum: PERSON_CONTROL_LIST_TYPES,
  })
  @Expose({ name: 'list_type' })
  @IsOptional()
  @IsIn(PERSON_CONTROL_LIST_TYPES)
  listType?: PersonControlListType;

  @ApiPropertyOptional({
    description: 'Lý do đưa vào danh sách kiểm soát',
    maxLength: 255,
  })
  @IsOptional()
  @IsString()
  @MaxLength(255)
  reason?: string;

  @ApiPropertyOptional({
    description: 'Mức độ ưu tiên',
    enum: PERSON_CONTROL_PRIORITIES,
  })
  @IsOptional()
  @IsIn(PERSON_CONTROL_PRIORITIES)
  priority?: PersonControlPriority;

  @ApiPropertyOptional({ description: 'Trạng thái kích hoạt theo dõi' })
  @IsOptional()
  @IsBoolean()
  active?: boolean;
}
