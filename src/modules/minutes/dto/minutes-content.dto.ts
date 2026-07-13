import {
  ArrayMaxSize,
  IsArray,
  IsIn,
  IsOptional,
  IsString,
  IsUUID,
  MaxLength,
} from 'class-validator';

/**
 * MKM-AI-01 — schema GIÀU THỐNG NHẤT cho nội dung có cấu trúc của biên bản
 * (decisions / actionItems / aiSummary). Dùng CHUNG cho cả bản nháp AI sinh ra
 * lẫn khi Host sửa tay (PATCH /meeting-minutes/:id), để không mất confidence/
 * evidence của AI khi chỉnh sửa.
 *
 * Output LLM hiện tại ({text,confidence,evidence} / {task,owner,deadline,
 * confidence}) là TẬP CON hợp lệ của schema này — worker/validator không đổi.
 */

export type MinutesConfidence = 'high' | 'medium' | 'low';

const CONFIDENCE_VALUES = ['high', 'medium', 'low'] as const;
const PRIORITY_VALUES = ['low', 'medium', 'high'] as const;

/** 1 quyết định trong biên bản. `text` bắt buộc; phần còn lại tùy chọn. */
export class MinutesDecisionItemDto {
  @IsString()
  @MaxLength(2000)
  text: string;

  /** Độ tin cậy do AI gán; sửa tay có thể bỏ trống. */
  @IsOptional()
  @IsIn(CONFIDENCE_VALUES)
  confidence?: MinutesConfidence | null;

  /** Trích dẫn/căn cứ từ transcript (AI cung cấp). */
  @IsOptional()
  @IsString()
  @MaxLength(2000)
  evidence?: string | null;

  /** Người chịu trách nhiệm (map user hệ thống — do người dùng gán tay). */
  @IsOptional()
  @IsUUID('4')
  responsibleUserId?: string | null;
}

/** 1 hạng mục hành động sau họp. `task` bắt buộc; phần còn lại tùy chọn. */
export class MinutesActionItemDto {
  /** UUID ổn định — tự sinh khi lưu nếu client không gửi. */
  @IsOptional()
  @IsUUID('4')
  id?: string;

  @IsString()
  @MaxLength(1000)
  task: string;

  /** Tên người phụ trách dạng text (AI trích từ transcript). */
  @IsOptional()
  @IsString()
  @MaxLength(255)
  owner?: string | null;

  /** UUID user hệ thống nếu người dùng map được (sửa tay). */
  @IsOptional()
  @IsUUID('4')
  assigneeUserId?: string | null;

  /** Hạn — AI trả dạng text tự do; sửa tay có thể là chuỗi ISO date. */
  @IsOptional()
  @IsString()
  @MaxLength(255)
  deadline?: string | null;

  @IsOptional()
  @IsIn(PRIORITY_VALUES)
  priority?: string;

  @IsOptional()
  @IsIn(CONFIDENCE_VALUES)
  confidence?: MinutesConfidence | null;
}

/**
 * Các khối insight do AI sinh — cho phép người dùng sửa tay 4 mảng này.
 * `meta` (provider/model/generatedAt...) là read-only, KHÔNG nằm trong DTO
 * input để tránh bị ghi đè; service giữ nguyên meta khi merge.
 */
export class MinutesAiSummaryEditDto {
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(100)
  @IsString({ each: true })
  keyPoints?: string[];

  @IsOptional()
  @IsArray()
  @ArrayMaxSize(100)
  @IsString({ each: true })
  risks?: string[];

  @IsOptional()
  @IsArray()
  @ArrayMaxSize(100)
  @IsString({ each: true })
  openQuestions?: string[];

  @IsOptional()
  @IsArray()
  @ArrayMaxSize(100)
  @IsString({ each: true })
  uncertainParts?: string[];
}

/* ── Kiểu dùng cho response (đọc) — mô tả contract cho FE ── */

export interface MinutesDecisionItem {
  text: string;
  confidence?: MinutesConfidence | null;
  evidence?: string | null;
  responsibleUserId?: string | null;
}

export interface MinutesActionItem {
  id?: string;
  task: string;
  owner?: string | null;
  assigneeUserId?: string | null;
  deadline?: string | null;
  priority?: string;
  confidence?: MinutesConfidence | null;
}
