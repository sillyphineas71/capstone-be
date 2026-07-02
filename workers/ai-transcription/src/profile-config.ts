export type AIProfileName =
  | 'local'
  | 'local-quality-test'
  | 'production-gpu'
  | 'production-cpu-fallback';

export interface AIProfile {
  profile: AIProfileName;
  whisperModel: string;
  whisperDevice: 'cpu' | 'cuda';
  whisperComputeType: string;
  diarizationEnabled: boolean;
  overlapDetectionEnabled: boolean;
  separationEnabled: boolean;
  maxAudioDurationLocalSeconds: number;
  minFreeRamMb: number;
  /** AI_WORKER_MAX_CONCURRENT_JOBS=1 ở mọi profile trong MVP (xem plan.md mục 2 Constraints). */
  maxConcurrentJobs: number;
}

function envBool(name: string, defaultValue: boolean): boolean {
  const raw = process.env[name];
  if (raw === undefined) return defaultValue;
  return raw === 'true';
}

function envNumber(name: string, defaultValue: number): number {
  const raw = process.env[name];
  if (raw === undefined || raw === '') return defaultValue;
  const parsed = Number(raw);
  return Number.isFinite(parsed) ? parsed : defaultValue;
}

function maxConcurrentJobs(): number {
  return envNumber('AI_WORKER_MAX_CONCURRENT_JOBS', 1);
}

/**
 * Đọc AI_PROFILE từ env và map sang toàn bộ cấu hình model/device/compute_type.
 * production-gpu fail-fast nếu thiếu CUDA — KHÔNG tự fallback CPU âm thầm (T002C).
 * production-cpu-fallback là lựa chọn TƯỜNG MINH (ops tự chọn), không phải nhánh
 * tự động khi production-gpu thiếu CUDA.
 * local-quality-test: chỉ dùng để benchmark chất lượng STT large-v3 trên CPU một
 * lần (T014B), KHÔNG dùng cho dev hằng ngày — chậm hơn nhiều so với local/medium.
 */
export function loadProfile(): AIProfile {
  const profile = (process.env['AI_PROFILE'] || 'local') as AIProfileName;

  if (profile === 'production-gpu') {
    const hasCuda = process.env['CUDA_AVAILABLE'] === 'true';
    if (!hasCuda) {
      throw new Error('CUDA_NOT_AVAILABLE_FOR_PROFILE');
    }
    return {
      profile: 'production-gpu',
      whisperModel: process.env['WHISPER_MODEL'] || 'large-v3',
      whisperDevice: 'cuda',
      whisperComputeType: process.env['WHISPER_COMPUTE_TYPE'] || 'float16',
      diarizationEnabled: envBool('DIARIZATION_ENABLED', true),
      overlapDetectionEnabled: envBool('OVERLAP_DETECTION_ENABLED', true),
      separationEnabled: envBool('SEPARATION_ENABLED', true),
      maxAudioDurationLocalSeconds: envNumber(
        'MAX_AUDIO_DURATION_LOCAL_SECONDS',
        300,
      ),
      minFreeRamMb: envNumber('AI_WORKER_MIN_FREE_RAM_MB', 2048),
      maxConcurrentJobs: maxConcurrentJobs(),
    };
  }

  if (profile === 'production-cpu-fallback') {
    return {
      profile: 'production-cpu-fallback',
      whisperModel: process.env['WHISPER_MODEL'] || 'medium',
      whisperDevice: 'cpu',
      whisperComputeType: process.env['WHISPER_COMPUTE_TYPE'] || 'int8',
      diarizationEnabled: envBool('DIARIZATION_ENABLED', true),
      overlapDetectionEnabled: envBool('OVERLAP_DETECTION_ENABLED', true),
      separationEnabled: envBool('SEPARATION_ENABLED', false),
      maxAudioDurationLocalSeconds: envNumber(
        'MAX_AUDIO_DURATION_LOCAL_SECONDS',
        1800,
      ),
      minFreeRamMb: envNumber('AI_WORKER_MIN_FREE_RAM_MB', 4096),
      maxConcurrentJobs: maxConcurrentJobs(),
    };
  }

  if (profile === 'local-quality-test') {
    return {
      profile: 'local-quality-test',
      whisperModel: process.env['WHISPER_MODEL'] || 'large-v3',
      whisperDevice: 'cpu',
      whisperComputeType: process.env['WHISPER_COMPUTE_TYPE'] || 'int8',
      diarizationEnabled: false,
      overlapDetectionEnabled: false,
      separationEnabled: false,
      maxAudioDurationLocalSeconds: envNumber(
        'MAX_AUDIO_DURATION_LOCAL_SECONDS',
        180,
      ),
      minFreeRamMb: envNumber('AI_WORKER_MIN_FREE_RAM_MB', 4096),
      maxConcurrentJobs: maxConcurrentJobs(),
    };
  }

  return {
    profile: 'local',
    whisperModel: process.env['WHISPER_MODEL'] || 'medium',
    whisperDevice: 'cpu',
    whisperComputeType: process.env['WHISPER_COMPUTE_TYPE'] || 'int8',
    diarizationEnabled: envBool('DIARIZATION_ENABLED', false),
    overlapDetectionEnabled: envBool('OVERLAP_DETECTION_ENABLED', false),
    separationEnabled: false,
    maxAudioDurationLocalSeconds: envNumber(
      'MAX_AUDIO_DURATION_LOCAL_SECONDS',
      300,
    ),
    // T-BENCH-001 (2026-07-01): đo thật trên máy dev cho thấy path nặng nhất
    // hiện có (medium + diarization, M2) peak ~2583MB — giá trị đoán cũ 2048
    // THẤP hơn cả peak thật. Nâng default lên 4096 (đồng bộ production profiles)
    // để guard có headroom thật cho cả SepFormer (M3) khi bật. Bảng số đo: xem
    // quickstart.md mục "T-BENCH-001".
    minFreeRamMb: envNumber('AI_WORKER_MIN_FREE_RAM_MB', 4096),
    maxConcurrentJobs: maxConcurrentJobs(),
  };
}

/**
 * Validate TRANSCRIPTION_PROVIDER — chỉ chấp nhận local_faster_whisper (T024).
 * Không có code path gọi cloud STT/API ngoài nào trong worker này.
 */
export function assertLocalProviderOnly(): void {
  const provider = process.env['TRANSCRIPTION_PROVIDER'] || 'local_faster_whisper';
  if (provider !== 'local_faster_whisper') {
    throw new Error(
      `TRANSCRIPTION_PROVIDER_NOT_SUPPORTED: "${provider}" — chỉ chấp nhận local_faster_whisper.`,
    );
  }
}
