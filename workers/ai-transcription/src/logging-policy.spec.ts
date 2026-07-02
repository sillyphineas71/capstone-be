import { processTranscriptionJob } from './ai-transcription.worker';

/**
 * T027 — Sensitive logging policy.
 *
 * Yêu cầu (plan T027): log KHÔNG được chứa raw transcript, audio path public,
 * MinIO secret, JWT/service token. Log chỉ nên có jobId/meetingId/
 * recordingSessionId/status/duration/error code.
 *
 * Test này capture toàn bộ output qua console.error của code path log chính và
 * assert không lọt pattern nhạy cảm — bằng chứng enforcement cho T027.
 */
describe('logging policy (T027)', () => {
  const ORIGINAL_ENV = { ...process.env };
  let logSpy: jest.SpyInstance;
  let captured: string;

  // Giá trị nhạy cảm giả — nếu lọt vào log là FAIL.
  const SECRETS = {
    STORAGE_S3_ACCESS_KEY: 'AKIA_FAKE_ACCESS',
    STORAGE_S3_SECRET_KEY: 'super_secret_minio_key',
    FACE_DEVICE_CALLBACK_TOKEN: 'callback_token_xyz',
    JWT_ACCESS_SECRET: 'jwt_signing_secret',
  };

  beforeEach(() => {
    process.env = { ...ORIGINAL_ENV, ...SECRETS, AI_PROFILE: 'local' };
    captured = '';
    logSpy = jest.spyOn(console, 'error').mockImplementation((...args) => {
      captured += args.map(String).join(' ') + '\n';
    });
  });

  afterEach(() => {
    logSpy.mockRestore();
    process.env = ORIGINAL_ENV;
  });

  it('job_start log không chứa secret/token nào từ env', async () => {
    await processTranscriptionJob({
      backgroundJobId: 'job-uuid',
      transcriptId: 'tr-uuid',
      meetingId: 'meeting-uuid',
      recordingSessionId: 'rec-uuid',
      sourceMediaFileId: 'media-uuid',
      language: 'vi-VN',
      speakerMappingMode: 'diarization_only',
      userId: 'user-uuid',
    });

    expect(captured.length).toBeGreaterThan(0);
    for (const secret of Object.values(SECRETS)) {
      expect(captured).not.toContain(secret);
    }
  });

  it('job_start log chỉ chứa các field an toàn (không rawText/cleanedText/password/storageKey)', async () => {
    await processTranscriptionJob({
      backgroundJobId: 'job-uuid',
      transcriptId: 'tr-uuid',
      meetingId: 'meeting-uuid',
      recordingSessionId: 'rec-uuid',
      sourceMediaFileId: 'media-uuid',
      language: 'vi-VN',
      speakerMappingMode: 'diarization_only',
      userId: 'user-uuid',
    });

    const FORBIDDEN_PATTERNS = [
      /rawText/i,
      /cleanedText/i,
      /password/i,
      /secret/i,
      /accessKey/i,
      /\btoken\b/i,
    ];
    for (const pat of FORBIDDEN_PATTERNS) {
      expect(captured).not.toMatch(pat);
    }
  });

  it('log là JSON có event + jobId (đúng allowlist: jobId/status/profile metadata)', async () => {
    await processTranscriptionJob({
      backgroundJobId: 'job-allowlist',
      transcriptId: 'tr',
      meetingId: 'm',
      recordingSessionId: 'r',
      sourceMediaFileId: 'media',
      language: 'vi-VN',
      speakerMappingMode: 'diarization_only',
      userId: 'u',
    });

    const line = captured.trim().split('\n')[0];
    const parsed = JSON.parse(line);
    expect(parsed.event).toBe('job_start');
    expect(parsed.jobId).toBe('job-allowlist');
    // Không có field nội dung/secret.
    expect(parsed).not.toHaveProperty('rawText');
    expect(parsed).not.toHaveProperty('accessKey');
    expect(parsed).not.toHaveProperty('userId');
  });
});
