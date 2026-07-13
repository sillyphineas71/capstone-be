/**
 * MKM-AI-01 — LlmProviderPort (NFR-012): cô lập việc gọi LLM sau interface
 * để thay provider (mock/self-hosted) qua config mà không đổi business logic,
 * và là điểm mở rộng cho RAG/provider khác ở phase sau.
 */

export interface LlmGenerateOptions {
  /** Timeout 1 lần gọi (ms) — từ env AI_SUMMARY_LLM_TIMEOUT_MS (NFR-003). */
  timeoutMs: number;
  /** Từ system_configs ai.minutes_summary.temperature. */
  temperature: number;
  /** Từ system_configs ai.minutes_summary.modelName. */
  modelName: string;
  /**
   * JSON Schema mô tả output mong muốn — nếu provider hỗ trợ (vd Ollama
   * structured output từ v0.5+), dùng để ép model tuân thủ schema ở tầng
   * decode, không chỉ dựa vào prompt. Provider không hỗ trợ có thể bỏ qua.
   * Phát hiện qua test (2026-07-08): model 3B đôi khi trả decisions/
   * actionItems sai cấu trúc (thiếu key, lẫn key giữa 2 schema) dù prompt đã
   * mô tả rõ — grammar-constrained decoding loại bỏ hẳn lớp lỗi này.
   */
  responseJsonSchema?: Record<string, unknown>;
}

export interface LlmProviderPort {
  /**
   * Gửi prompt, trả raw string output của model (kỳ vọng là JSON, validate
   * bởi ai-output-validator trước khi dùng).
   * @throws Error khi runtime không phản hồi/timeout — processor phân loại
   *         là retryable (LLM_UNAVAILABLE, FR-018).
   */
  generate(prompt: string, opts: LlmGenerateOptions): Promise<string>;
}

/** DI token — factory resolve provider theo config_json.provider lúc chạy job. */
export const LLM_PROVIDER_FACTORY = Symbol('LLM_PROVIDER_FACTORY');

/**
 * Lỗi non-retryable trong worker (plan 9.2): markFailed ngay, KHÔNG throw
 * ra BullMQ để tránh retry vô ích (schema sai, transcript quá dài, TOCTOU...).
 */
export class NonRetryableAiJobError extends Error {
  constructor(
    public readonly code: string,
    message: string,
  ) {
    super(`${code}: ${message}`);
    this.name = 'NonRetryableAiJobError';
  }
}
