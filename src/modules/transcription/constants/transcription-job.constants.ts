export const TRANSCRIPTION_QUEUE_NAME = 'transcription';
export const TRANSCRIPTION_PROVIDER = 'local_faster_whisper';

export const DEFAULT_WHISPER_MODEL_LOCAL = 'small';
export const DEFAULT_WHISPER_MODEL_PRODUCTION = 'large-v3';
export const DEFAULT_WHISPER_DEVICE_LOCAL = 'cpu';
export const DEFAULT_WHISPER_DEVICE_PRODUCTION = 'cuda';
export const DEFAULT_WHISPER_COMPUTE_TYPE_LOCAL = 'int8';
export const DEFAULT_WHISPER_COMPUTE_TYPE_PRODUCTION = 'float16';
export const MAX_AUDIO_DURATION_LOCAL_SECONDS_DEFAULT = 300;
export const AI_WORKER_MIN_FREE_RAM_MB_DEFAULT = 2048;
