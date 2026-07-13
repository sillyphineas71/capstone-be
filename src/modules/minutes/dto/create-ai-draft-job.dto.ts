import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsBoolean, IsIn, IsOptional, IsUUID } from 'class-validator';
import { AI_MINUTES_LANGUAGE_ALLOWLIST } from '../constants/ai-minutes-draft.constants.js';

/**
 * MKM-AI-01 — request body cho POST /meetings/:meetingId/minutes/ai-draft-jobs.
 * Spec 5.4: transcriptId bắt buộc; language allowlist MVP chỉ vi-VN;
 * forceRerun mặc định false.
 */
export class CreateAiDraftJobDto {
  @ApiProperty({
    format: 'uuid',
    description: 'Transcript nguồn — phải thuộc đúng meeting trong path',
  })
  @IsUUID()
  transcriptId: string;

  @ApiPropertyOptional({
    enum: AI_MINUTES_LANGUAGE_ALLOWLIST,
    default: 'vi-VN',
    description: 'Ngôn ngữ output. MVP chỉ hỗ trợ vi-VN (spec 5.4).',
  })
  @IsOptional()
  @IsIn([...AI_MINUTES_LANGUAGE_ALLOWLIST])
  language?: string;

  @ApiPropertyOptional({
    default: false,
    description:
      'Cho phép ghi đè bản nháp AI cũ (chỉ khi minutes hiện tại là AI-draft và còn status=draft — FR-016/FR-020)',
  })
  @IsOptional()
  @IsBoolean()
  forceRerun?: boolean;
}
