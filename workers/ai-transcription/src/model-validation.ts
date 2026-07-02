import * as fs from 'fs';
import * as path from 'path';
import type { AIProfile } from './profile-config';

/**
 * T026 — Model preload validation.
 *
 * Trước khi spawn Python pipeline, validate model đang CẦN theo profile đã được
 * preload sẵn (T-HF-001). Mục tiêu: fail-fast với error rõ ràng thay vì để Python
 * crash sâu bên trong, VÀ chặn khả năng tải model từ internet lúc runtime (không
 * runtime download — mục 2 plan + T025).
 *
 * Nguyên tắc:
 *  - Chỉ validate model THẬT SỰ cần theo profile hiện tại (không bắt buộc có
 *    large-v3 nếu profile dùng small/medium — đúng T026).
 *  - Log/throw chỉ ghi PATH thiếu, KHÔNG ghi secret/token (T027).
 *  - CUDA fail-fast cho production-gpu đã xử lý ở loadProfile (T002C), tách riêng
 *    khỏi lỗi thiếu model — hàm này không lặp lại.
 */

export const MODEL_VALIDATION_ERRORS = {
  WHISPER_MODEL_NOT_PRELOADED: 'WHISPER_MODEL_NOT_PRELOADED',
  PYANNOTE_MODEL_NOT_PRELOADED: 'PYANNOTE_MODEL_NOT_PRELOADED',
  SEPFORMER_MODEL_NOT_PRELOADED: 'SEPFORMER_MODEL_NOT_PRELOADED',
} as const;

/**
 * Validate model preload theo profile. Throw Error (chứa mã *_NOT_PRELOADED —
 * đã thêm vào isNonRetryableError ở processor để KHÔNG retry lỗi cấu hình) nếu
 * thiếu model cần thiết. Không throw nếu mọi model cần đã sẵn sàng.
 *
 * @param env cho phép inject env trong test; mặc định process.env.
 */
export function validateModelsAvailable(
  profile: AIProfile,
  env: NodeJS.ProcessEnv = process.env,
): void {
  // ── faster-whisper ──────────────────────────────────────────────────────
  // Chỉ validate khi WHISPER_MODEL_PATH được set (trỏ tới snapshot đã preload).
  // Nếu KHÔNG set, faster-whisper resolve theo tên model từ HuggingFace cache —
  // tính offline lúc đó do WHISPER_LOCAL_FILES_ONLY kiểm soát (xem whisper_runner.py),
  // không validate path ở đây để tránh false-fail trên máy dev dùng cache.
  const whisperPath = env['WHISPER_MODEL_PATH'];
  if (whisperPath && !fs.existsSync(whisperPath)) {
    throw new Error(
      `${MODEL_VALIDATION_ERRORS.WHISPER_MODEL_NOT_PRELOADED}: ` +
        `WHISPER_MODEL_PATH="${whisperPath}" không tồn tại ` +
        `(WHISPER_MODEL=${profile.whisperModel}). Preload model trước khi chạy.`,
    );
  }

  // ── pyannote (diarization) ──────────────────────────────────────────────
  // Bắt buộc preload khi diarization bật. Phải có config.yaml bên trong thư mục
  // (nhất quán với diarization_runner._resolve_model_path).
  if (profile.diarizationEnabled) {
    const pyannotePath = env['PYANNOTE_MODEL_PATH'];
    const configPath = pyannotePath
      ? path.join(pyannotePath, 'config.yaml')
      : '';
    if (!pyannotePath || !fs.existsSync(configPath)) {
      throw new Error(
        `${MODEL_VALIDATION_ERRORS.PYANNOTE_MODEL_NOT_PRELOADED}: ` +
          `cần PYANNOTE_MODEL_PATH trỏ tới thư mục chứa config.yaml đã preload ` +
          `qua T-HF-001 khi DIARIZATION_ENABLED=true. Hiện: ` +
          `"${pyannotePath || '(chưa set)'}".`,
      );
    }
  }

  // ── SepFormer (separation, M3) ──────────────────────────────────────────
  // Bắt buộc preload khi separation bật.
  if (profile.separationEnabled) {
    const sepformerPath = env['SEPFORMER_MODEL_PATH'];
    if (!sepformerPath || !fs.existsSync(sepformerPath)) {
      throw new Error(
        `${MODEL_VALIDATION_ERRORS.SEPFORMER_MODEL_NOT_PRELOADED}: ` +
          `cần SEPFORMER_MODEL_PATH preload khi SEPARATION_ENABLED=true. Hiện: ` +
          `"${sepformerPath || '(chưa set)'}".`,
      );
    }
  }
}
