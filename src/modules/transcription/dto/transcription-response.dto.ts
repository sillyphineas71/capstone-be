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
