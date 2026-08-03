import { Type } from 'class-transformer';
import {
  ArrayMinSize,
  IsArray,
  IsNumber,
  IsOptional,
  IsString,
  IsUUID,
  Min,
  MaxLength,
  MinLength,
  ValidateNested,
} from 'class-validator';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

/**
 * REC-006 (feat-fixed-station-browser-recording) — 1 mốc gán tên kèm
 * offsetSeconds tường minh do FE tự tính (đồng hồ trình duyệt cục bộ trong
 * lúc ghi tại trạm cố định). Khác SpeakerMappingItemDto (GIAI ĐOẠN 2, dùng
 * speakerLabel) và CreateLiveSpeakerTagDto (GIAI ĐOẠN 3, server tự tính mốc
 * qua marker) — ở đây offset đã được tính sẵn phía client.
 */
export class OffsetSpeakerMarkItemDto {
  @ApiProperty({ description: 'Giây tính từ lúc bắt đầu ghi (>= 0)' })
  @IsNumber()
  @Min(0)
  offsetSeconds: number;

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

/**
 * REC-006 — POST /meetings/:meetingId/recording-sessions/:sessionId/speaker-marks.
 */
export class CreateOffsetSpeakerMarksDto {
  @ApiProperty({
    type: [OffsetSpeakerMarkItemDto],
    description: 'Danh sách mốc gán tên thu thập trong lúc ghi',
  })
  @IsArray()
  @ArrayMinSize(1)
  @ValidateNested({ each: true })
  @Type(() => OffsetSpeakerMarkItemDto)
  marks: OffsetSpeakerMarkItemDto[];
}
