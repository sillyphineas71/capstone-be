import { IsOptional, IsString, MaxLength } from 'class-validator';
import { ApiPropertyOptional } from '@nestjs/swagger';

/**
 * PATCH /api/v1/transcripts/:transcriptId/content — ghi đè trực tiếp
 * `rawText`/`cleanedText` (dùng để test AI summarize với input tự soạn,
 * hoặc sửa tay khi nội dung STT sai nhiều). Đây là nguồn text thật sự mà
 * `minutes-ai-draft.processor` đọc (`cleanedText || rawText`) — KHÁC với
 * `speaker_segments_json` mà UC-127 (`PATCH .../segments`) chỉnh sửa.
 */
export class UpdateTranscriptContentDto {
  @ApiPropertyOptional({ description: 'Nội dung raw_text ghi đè' })
  @IsOptional()
  @IsString()
  @MaxLength(200000)
  rawText?: string;

  @ApiPropertyOptional({ description: 'Nội dung cleaned_text ghi đè' })
  @IsOptional()
  @IsString()
  @MaxLength(200000)
  cleanedText?: string;

  @ApiPropertyOptional({ description: 'Lý do sửa (audit)' })
  @IsOptional()
  @IsString()
  @MaxLength(500)
  revisionNote?: string;
}
