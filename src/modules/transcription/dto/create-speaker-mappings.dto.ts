import { Type } from 'class-transformer';
import {
  ArrayMinSize,
  IsArray,
  IsOptional,
  IsString,
  IsUUID,
  MaxLength,
  MinLength,
  ValidateNested,
} from 'class-validator';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

/**
 * 1 mapping cho một cụm giọng (Speaker_N) — GA-20. Đúng MỘT trong
 * speakerUserId/externalParticipantId phải được truyền (kiểm tra ở tầng
 * service, xem ERR-TAG-005 spec.md — cross-field validation không tiện làm
 * bằng class-validator decorator đơn giản, giữ nhất quán với cách
 * UpdateSegmentItemDto/UpdateTranscriptSegmentsDto đẩy business rule xuống
 * service).
 */
export class SpeakerMappingItemDto {
  @ApiProperty({
    description: 'Nhãn cụm hiện có trong transcript (vd Speaker_1)',
  })
  @IsString()
  @MinLength(1)
  @MaxLength(120)
  speakerLabel: string;

  @ApiPropertyOptional({ description: 'Map cụm tới user hệ thống (UUID)' })
  @IsOptional()
  @IsUUID()
  speakerUserId?: string;

  @ApiPropertyOptional({
    description:
      'Map cụm tới khách ngoài công ty (UUID meeting_external_participants)',
  })
  @IsOptional()
  @IsUUID()
  externalParticipantId?: string;

  @ApiProperty({ description: 'Tên hiển thị cho cụm này' })
  @IsString()
  @MinLength(1)
  @MaxLength(255)
  displayName: string;
}

/**
 * GA-20 — POST /api/v1/transcripts/:transcriptId/speaker-mappings.
 */
export class CreateSpeakerMappingsDto {
  @ApiProperty({
    type: [SpeakerMappingItemDto],
    description: 'Danh sách mapping cần gán hàng loạt',
  })
  @IsArray()
  @ArrayMinSize(1)
  @ValidateNested({ each: true })
  @Type(() => SpeakerMappingItemDto)
  mappings: SpeakerMappingItemDto[];
}
