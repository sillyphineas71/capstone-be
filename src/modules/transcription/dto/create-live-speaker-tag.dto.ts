import {
  IsOptional,
  IsString,
  IsUUID,
  MaxLength,
  MinLength,
} from 'class-validator';
import { ApiPropertyOptional, ApiProperty } from '@nestjs/swagger';

/**
 * GA-32 (feat-speaker-tagging-live) — POST
 * /api/v1/meetings/:meetingId/recording/live-speaker-tag.
 *
 * KHÔNG có `speakerLabel` — khác `SpeakerMappingItemDto` (GIAI ĐOẠN 2): tại
 * thời điểm Host bấm TRONG lúc họp, chưa có cụm giọng nào tồn tại để chọn.
 * Cụm sẽ được xác định SAU, ở bước quy chiếu (applySpeakerMappingsFromEvents).
 */
export class CreateLiveSpeakerTagDto {
  @ApiPropertyOptional({ description: 'Map tới user hệ thống (UUID)' })
  @IsOptional()
  @IsUUID()
  speakerUserId?: string;

  @ApiPropertyOptional({
    description:
      'Map tới khách ngoài công ty (UUID meeting_external_participants)',
  })
  @IsOptional()
  @IsUUID()
  externalParticipantId?: string;

  @ApiProperty({ description: 'Tên hiển thị' })
  @IsString()
  @MinLength(1)
  @MaxLength(255)
  displayName: string;
}
