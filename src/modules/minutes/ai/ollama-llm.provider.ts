import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Agent } from 'undici';
import { LlmGenerateOptions, LlmProviderPort } from './llm-provider.port.js';

interface OllamaChatResponse {
  message?: { content?: string };
}

/**
 * MKM-AI-01 — SelfHostedLlmProvider qua Ollama (plan T016):
 * POST {AI_SUMMARY_LLM_BASE_URL}/api/chat với `format: "json"` (ép model trả
 * JSON hợp lệ, giảm tỉ lệ sai schema), `stream: false`, AbortSignal timeout
 * theo AI_SUMMARY_LLM_TIMEOUT_MS (NFR-003).
 *
 * Base URL là internal service trong private network — KHÔNG trỏ external API
 * (OOS-003, FR-002). Mọi lỗi network/timeout/HTTP đều throw Error thường →
 * processor phân loại retryable LLM_UNAVAILABLE (plan 9.2).
 * FR-025: không log prompt/response — chỉ log status/duration ở processor.
 *
 * BUG THẬT #1 đã phát hiện qua test (2026-07-08): Ollama mặc định `num_ctx=2048`
 * khi request không set — với prompt dài (transcript lớn), phần lớn nội dung
 * bị cắt NGẦM (không lỗi), model chỉ thấy vài nghìn ký tự đầu, dẫn tới output
 * rác/chung chung dù request "thành công". Phải luôn set `num_ctx` theo đúng
 * kích thước prompt thực tế, không dựa vào default của Ollama.
 *
 * BUG THẬT #2 đã phát hiện qua test (2026-07-08): Node fetch (dựng trên undici)
 * có `headersTimeout`/`bodyTimeout` NỘI BỘ mặc định 300_000ms, tách biệt và
 * ĐỘC LẬP với `AbortSignal.timeout(opts.timeoutMs)` mà code tự set. Với prompt
 * lớn cần >5 phút để Ollama xử lý xong, request bị chính undici cắt ngang ở
 * mốc ~300s (throw TypeError "fetch failed"), dù `timeoutMs` cấu hình cao hơn
 * nhiều (900_000/1_200_000ms). Phải tắt timeout nội bộ này bằng dispatcher
 * riêng, để AbortSignal.timeout(opts.timeoutMs) là NGUỒN DUY NHẤT quyết định
 * timeout — tránh 2 cơ chế timeout xung đột nhau.
 *
 * VẤN ĐỀ #3 đã phát hiện qua test (2026-07-08): model 3B đôi khi trả
 * decisions/actionItems sai cấu trúc dù prompt đã mô tả rõ (lẫn key giữa 2
 * schema, thiếu key bắt buộc) — lỗi xác suất (temperature sampling), không
 * cố định. `format: "json"` chỉ ép JSON hợp lệ cú pháp, KHÔNG ép đúng schema.
 * Nếu `opts.responseJsonSchema` được truyền (Ollama >=0.5 hỗ trợ), dùng
 * grammar-constrained decoding để model KHÔNG THỂ trả sai cấu trúc.
 */
const OLLAMA_MIN_NUM_CTX = 4096;
const OLLAMA_MAX_NUM_CTX = 32768; // context_length toi da cua qwen2.5:3b/7b-instruct
const OLLAMA_OUTPUT_TOKEN_RESERVE = 4096; // cho JSON minutes output + repair-prompt

@Injectable()
export class OllamaLlmProvider implements LlmProviderPort {
  private readonly logger = new Logger(OllamaLlmProvider.name);

  // headersTimeout/bodyTimeout=0 tat timeout noi bo cua undici — chi con
  // AbortSignal.timeout(opts.timeoutMs) o duoi la nguon timeout duy nhat.
  private readonly dispatcher = new Agent({
    headersTimeout: 0,
    bodyTimeout: 0,
  });

  constructor(private readonly configService: ConfigService) {}

  async generate(prompt: string, opts: LlmGenerateOptions): Promise<string> {
    const baseUrl = this.configService.get<string>(
      'AI_SUMMARY_LLM_BASE_URL',
      'http://localhost:11434',
    );

    // Heuristic chars/3 giống processor (minutes-ai-draft.processor.ts) — chỉ
    // để tính num_ctx đủ dùng, không phải nguồn sự thật cho token guard.
    const estimatedPromptTokens = Math.ceil(prompt.length / 3);
    const numCtx = Math.min(
      OLLAMA_MAX_NUM_CTX,
      Math.max(
        OLLAMA_MIN_NUM_CTX,
        estimatedPromptTokens + OLLAMA_OUTPUT_TOKEN_RESERVE,
      ),
    );

    let response: Response;
    try {
      response = await fetch(`${baseUrl}/api/chat`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          model: opts.modelName,
          messages: [{ role: 'user', content: prompt }],
          format: opts.responseJsonSchema ?? 'json',
          stream: false,
          options: { temperature: opts.temperature, num_ctx: numCtx },
        }),
        signal: AbortSignal.timeout(opts.timeoutMs),
        // @ts-expect-error dispatcher la option cua undici, khong nam trong
        // type chuan RequestInit nhung Node fetch (built tren undici) doc duoc.
        dispatcher: this.dispatcher,
      });
    } catch (error) {
      // Timeout (TimeoutError/AbortError) hoặc lỗi network — retryable
      const reason = error instanceof Error ? error.name : 'unknown';
      this.logger.error(
        `Ollama call failed — reason=${reason} model=${opts.modelName}`,
      );
      throw new Error(`Ollama khong phan hoi (${reason})`);
    }

    if (!response.ok) {
      this.logger.error(
        `Ollama HTTP error — status=${response.status} model=${opts.modelName}`,
      );
      throw new Error(`Ollama tra HTTP ${response.status}`);
    }

    const body = (await response.json()) as OllamaChatResponse;
    const content = body.message?.content;
    if (typeof content !== 'string' || content.trim() === '') {
      throw new Error('Ollama tra response khong co message.content');
    }
    return content;
  }
}
