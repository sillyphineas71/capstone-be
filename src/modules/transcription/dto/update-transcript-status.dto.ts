import { IsEnum, IsOptional, IsString, MaxLength } from 'class-validator';
import { ApiPropertyOptional } from '@nestjs/swagger';

/**
 * Gap fix (Nhóm A) — enum của DTO này CHỈ chứa 2 trạng thái đích cho phép
 * chuyển thủ công qua endpoint (draft → reviewed, draft/reviewed → approved).
 * `processing`/`draft`/`failed`/`hidden` là trạng thái do hệ thống tự set
 * (worker/pipeline), không cho client set qua endpoint này.
 */
export enum TranscriptStatusTransition {
  REVIEWED = 'reviewed',
  APPROVED = 'approved',
}

export class UpdateTranscriptStatusDto {
  @ApiPropertyOptional({
    description: 'Trạng thái đích',
    enum: TranscriptStatusTransition,
  })
  @IsEnum(TranscriptStatusTransition, {
    message: 'status phải là "reviewed" hoặc "approved"',
  })
  status: TranscriptStatusTransition;

  @ApiPropertyOptional({ description: 'Ghi chú khi chuyển trạng thái (audit)' })
  @IsOptional()
  @IsString()
  @MaxLength(500)
  note?: string;
}
