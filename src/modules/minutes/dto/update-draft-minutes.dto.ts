import {
  IsOptional,
  IsString,
  IsArray,
  IsInt,
  ValidateNested,
  ArrayMaxSize,
  MaxLength,
} from 'class-validator';
import { Type } from 'class-transformer';

import {
  MinutesActionItemDto,
  MinutesAiSummaryEditDto,
  MinutesDecisionItemDto,
} from './minutes-content.dto.js';

/**
 * PATCH /meeting-minutes/:id (UC-MKM-04) — cập nhật bản nháp.
 *
 * Dùng schema GIÀU THỐNG NHẤT ([[minutes-content.dto]]) cho decisions/actionItems
 * nên người dùng sửa tay được TRỌN VẸN kết quả AI mà không mất confidence/
 * evidence. `aiSummary` cho phép sửa các khối insight (keyPoints/risks/
 * openQuestions/uncertainParts); `meta` được service giữ nguyên, không cho sửa.
 */
export class UpdateDraftMinutesDto {
  @IsInt()
  versionNo: number;

  @IsOptional()
  @IsString()
  @MaxLength(255)
  title?: string;

  @IsOptional()
  @IsString()
  @MaxLength(20000)
  minutesContent?: string;

  @IsOptional()
  @IsArray()
  @ArrayMaxSize(100)
  @ValidateNested({ each: true })
  @Type(() => MinutesDecisionItemDto)
  decisionsJson?: MinutesDecisionItemDto[];

  @IsOptional()
  @IsArray()
  @ArrayMaxSize(100)
  @ValidateNested({ each: true })
  @Type(() => MinutesActionItemDto)
  actionItemsJson?: MinutesActionItemDto[];

  @IsOptional()
  @ValidateNested()
  @Type(() => MinutesAiSummaryEditDto)
  aiSummary?: MinutesAiSummaryEditDto;
}
