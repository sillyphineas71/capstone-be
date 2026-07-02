import { loadProfile, assertLocalProviderOnly } from './profile-config';

describe('profile-config', () => {
  const ORIGINAL_ENV = { ...process.env };

  afterEach(() => {
    process.env = { ...ORIGINAL_ENV };
  });

  describe('loadProfile()', () => {
    it('local: dùng medium/cpu/int8 mặc định, diarization/separation off', () => {
      process.env['AI_PROFILE'] = 'local';
      delete process.env['WHISPER_MODEL'];
      const profile = loadProfile();

      expect(profile.profile).toBe('local');
      expect(profile.whisperModel).toBe('medium');
      expect(profile.whisperDevice).toBe('cpu');
      expect(profile.whisperComputeType).toBe('int8');
      expect(profile.separationEnabled).toBe(false);
      expect(profile.maxAudioDurationLocalSeconds).toBe(300);
      expect(profile.maxConcurrentJobs).toBe(1);
    });

    it('local-quality-test: large-v3/cpu/int8, cap 180s, không bật diarization/overlap/separation (chỉ để benchmark STT — T014B)', () => {
      process.env['AI_PROFILE'] = 'local-quality-test';
      delete process.env['WHISPER_MODEL'];
      const profile = loadProfile();

      expect(profile.profile).toBe('local-quality-test');
      expect(profile.whisperModel).toBe('large-v3');
      expect(profile.whisperDevice).toBe('cpu');
      expect(profile.whisperComputeType).toBe('int8');
      expect(profile.maxAudioDurationLocalSeconds).toBe(180);
      expect(profile.diarizationEnabled).toBe(false);
      expect(profile.overlapDetectionEnabled).toBe(false);
      expect(profile.separationEnabled).toBe(false);
      expect(profile.maxConcurrentJobs).toBe(1);
    });

    it('AI_WORKER_MAX_CONCURRENT_JOBS đọc từ env, áp dụng cho mọi profile (MVP constraint)', () => {
      process.env['AI_PROFILE'] = 'local';
      process.env['AI_WORKER_MAX_CONCURRENT_JOBS'] = '1';
      expect(loadProfile().maxConcurrentJobs).toBe(1);
    });

    it('production-gpu: dùng large-v3/cuda/float16 khi có CUDA', () => {
      process.env['AI_PROFILE'] = 'production-gpu';
      process.env['CUDA_AVAILABLE'] = 'true';
      const profile = loadProfile();

      expect(profile.profile).toBe('production-gpu');
      expect(profile.whisperModel).toBe('large-v3');
      expect(profile.whisperDevice).toBe('cuda');
      expect(profile.whisperComputeType).toBe('float16');
    });

    it('production-gpu: fail-fast khi thiếu CUDA — KHÔNG fallback CPU âm thầm', () => {
      process.env['AI_PROFILE'] = 'production-gpu';
      delete process.env['CUDA_AVAILABLE'];

      expect(() => loadProfile()).toThrow('CUDA_NOT_AVAILABLE_FOR_PROFILE');
    });

    it('production-cpu-fallback: dùng medium/cpu/int8, là lựa chọn tường minh', () => {
      process.env['AI_PROFILE'] = 'production-cpu-fallback';
      const profile = loadProfile();

      expect(profile.profile).toBe('production-cpu-fallback');
      expect(profile.whisperDevice).toBe('cpu');
      expect(profile.whisperModel).toBe('medium');
    });

    it('AI_PROFILE đổi qua env mà không sửa code', () => {
      process.env['AI_PROFILE'] = 'local';
      process.env['WHISPER_MODEL'] = 'medium';
      const profile = loadProfile();
      expect(profile.whisperModel).toBe('medium');
    });
  });

  describe('assertLocalProviderOnly()', () => {
    it('pass khi TRANSCRIPTION_PROVIDER=local_faster_whisper hoặc không set', () => {
      delete process.env['TRANSCRIPTION_PROVIDER'];
      expect(() => assertLocalProviderOnly()).not.toThrow();

      process.env['TRANSCRIPTION_PROVIDER'] = 'local_faster_whisper';
      expect(() => assertLocalProviderOnly()).not.toThrow();
    });

    it('throw khi provider khác local_faster_whisper (không gọi cloud STT)', () => {
      process.env['TRANSCRIPTION_PROVIDER'] = 'google_stt';
      expect(() => assertLocalProviderOnly()).toThrow(
        'TRANSCRIPTION_PROVIDER_NOT_SUPPORTED',
      );
    });
  });
});
