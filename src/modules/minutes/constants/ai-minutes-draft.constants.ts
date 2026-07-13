/**
 * MKM-AI-01 (feat-ai-meeting-minutes-draft) — constants dùng chung cho
 * controller/service/processor/provider. Single source of truth cho queue
 * name (QueueModule + @Processor), config key và error codes — không dùng
 * magic string rải rác.
 */

/** Tên BullMQ queue — khớp env QUEUE_MINUTES_AI_DRAFT (default). */
export const AI_MINUTES_QUEUE_NAME = 'minutes.generate_ai_draft';

/** Tên job trong queue (prefix để processor lọc job lạ, pattern transcription). */
export const AI_MINUTES_JOB_NAME = 'ai-minutes:generate';

/** Key trong system_configs chứa feature flag + cấu hình AI summary. */
export const AI_MINUTES_CONFIG_KEY = 'ai.minutes_summary';

/**
 * Version của prompt template — bump thủ công mỗi khi sửa template (DM-04).
 * v2 (2026-07-08): thêm yêu cầu ĐỘ ĐẦY ĐỦ (liệt kê hết decisions/actionItems,
 * summary tối thiểu ~150-250 từ) + few-shot example nhiều mục hơn — sửa lỗi
 * output quá ngắn/sơ sài so với transcript dài do model anchor theo ví dụ cũ
 * chỉ có 1 decision/1 action item.
 */
export const AI_MINUTES_PROMPT_VERSION = 'mvp-v2';

/** action ghi vào audit_logs khi AI draft được tạo/ghi đè (FR-009). */
export const AI_MINUTES_AUDIT_ACTION = 'minutes.ai_draft.generated';

/** Permission code cho endpoint tạo AI draft job (seed 20260707000001). */
export const AI_MINUTES_PERMISSION_CREATE = 'meeting.minutes.ai_draft.create';

/**
 * Error codes — API layer (HTTP) + worker (ghi vào background_jobs.error_message).
 * Mapping HTTP status: xem spec.md mục 6 / plan.md mục 9.1.
 */
export const AI_MINUTES_ERROR_CODES = {
  // API layer
  PERMISSION_DENIED: 'PERMISSION_DENIED',
  AI_SUMMARY_DISABLED: 'AI_SUMMARY_DISABLED',
  MEETING_NOT_FOUND: 'MEETING_NOT_FOUND',
  TRANSCRIPT_NOT_FOUND: 'TRANSCRIPT_NOT_FOUND',
  TRANSCRIPT_NOT_READY: 'TRANSCRIPT_NOT_READY',
  TRANSCRIPT_RESTRICTED: 'TRANSCRIPT_RESTRICTED',
  MINUTES_ALREADY_EXISTS: 'MINUTES_ALREADY_EXISTS',
  MINUTES_NOT_AI_DRAFT: 'MINUTES_NOT_AI_DRAFT',
  AI_JOB_ALREADY_RUNNING: 'AI_JOB_ALREADY_RUNNING',
  // Worker (job failed — non-retryable trừ LLM_UNAVAILABLE)
  LLM_UNAVAILABLE: 'LLM_UNAVAILABLE',
  AI_OUTPUT_INVALID_SCHEMA: 'AI_OUTPUT_INVALID_SCHEMA',
  TRANSCRIPT_TOO_LONG_FOR_MVP: 'TRANSCRIPT_TOO_LONG_FOR_MVP',
} as const;

export type AiMinutesErrorCode =
  (typeof AI_MINUTES_ERROR_CODES)[keyof typeof AI_MINUTES_ERROR_CODES];

/** Allowlist ngôn ngữ output — MVP chỉ vi-VN (quyết định 2026-07-07). */
export const AI_MINUTES_LANGUAGE_ALLOWLIST = ['vi-VN'] as const;

/** Số attempts khi enqueue job LLM: 1 lần chạy + 1 retry (FR-018). */
export const AI_MINUTES_JOB_ATTEMPTS = 2;
