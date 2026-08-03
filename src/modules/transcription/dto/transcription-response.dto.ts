import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { TranscriptStatus } from '../entities/transcript.entity.js';

export class TranscriptSegmentDto {
  @ApiProperty() segmentId!: string;
  @ApiProperty() startMs!: number;
  @ApiProperty() endMs!: number;
  @ApiProperty() speakerLabel!: string;
  @ApiProperty() userId!: string | null;
  @ApiProperty() channelId!: string | null;
  @ApiProperty() roomZoneLabel!: string | null;
  @ApiProperty() text!: string;
  @ApiProperty() confidence!: number;
  @ApiProperty() overlap!: boolean;
  @ApiProperty() lowConfidence!: boolean;
  @ApiProperty() manualReviewRequired!: boolean;
  // feat-speaker-tagging-post-meeting/live (2026-08-02/03): field mở rộng
  // do SpeakerMappingService ghi thêm khi Host gán tên — không có trong
  // contract gốc của Python AI worker (schemas.py), chỉ xuất hiện SAU khi
  // đã gán ít nhất 1 lần cho cụm chứa segment này.
  @ApiPropertyOptional() mappedExternalParticipantId?: string | null;
  @ApiPropertyOptional() displayName?: string | null;
}

export class TranscriptResponseDto {
  @ApiProperty() transcriptId!: string;
  @ApiProperty() meetingId!: string;
  @ApiProperty({ enum: TranscriptStatus }) status!: TranscriptStatus;
  @ApiProperty() language!: string;
  @ApiProperty() versionNo!: number;
  @ApiProperty() confidenceScore!: number | null;
  @ApiProperty() cleanedText!: string | null;
  @ApiPropertyOptional({ type: [TranscriptSegmentDto] })
  segments?: TranscriptSegmentDto[];
  @ApiProperty() generatedAt!: Date;
}

export class CreateJobResponseDto {
  @ApiProperty() jobId!: string;
  @ApiProperty() meetingId!: string;
  @ApiProperty() status!: string;
  @ApiProperty() transcriptStatus!: string;
}
