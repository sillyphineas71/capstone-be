import { Type } from 'class-transformer';
import {
  ArrayMinSize,
  IsArray,
  IsOptional,
  IsString,
  IsUUID,
  MaxLength,
  ValidateNested,
} from 'class-validator';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

/**
 * 1 segment cần sửa (UC-127). `segmentId` bắt buộc để định vị segment trong
 * `speaker_segments_json`. `text`/`speakerLabel`/`speakerUserId` đều optional —
 * chỉ field nào truyền mới bị ghi đè.
 */
export class UpdateSegmentItemDto {
  @ApiProperty({ description: 'ID segment cần sửa (vd seg-0001)' })
  @IsString()
  @MaxLength(64)
  segmentId: string;

  @ApiPropertyOptional({ description: 'Nội dung text đã sửa tay' })
  @IsOptional()
  @IsString()
  @MaxLength(5000)
  text?: string;

  @ApiPropertyOptional({
    description: 'Nhãn speaker hiển thị do người dùng gán',
  })
  @IsOptional()
  @IsString()
  @MaxLength(120)
  speakerLabel?: string;

  @ApiPropertyOptional({ description: 'Map segment tới user hệ thống (UUID)' })
  @IsOptional()
  @IsUUID()
  speakerUserId?: string;

  @ApiPropertyOptional({ description: 'Lý do sửa (audit)' })
  @IsOptional()
  @IsString()
  @MaxLength(500)
  reason?: string;
}

/**
 * UC-127 — PATCH /api/v1/transcripts/:transcriptId/segments.
 */
export class UpdateTranscriptSegmentsDto {
  @ApiProperty({
    type: [UpdateSegmentItemDto],
    description: 'Danh sách segment cần sửa',
  })
  @IsArray()
  @ArrayMinSize(1)
  @ValidateNested({ each: true })
  @Type(() => UpdateSegmentItemDto)
  segments: UpdateSegmentItemDto[];

  @ApiPropertyOptional({ description: 'Ghi chú cho lần revision này' })
  @IsOptional()
  @IsString()
  @MaxLength(500)
  revisionNote?: string;
}
