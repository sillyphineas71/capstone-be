import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import {
  validateModelsAvailable,
  MODEL_VALIDATION_ERRORS,
} from './model-validation';
import type { AIProfile } from './profile-config';

function makeProfile(overrides: Partial<AIProfile> = {}): AIProfile {
  return {
    profile: 'local',
    whisperModel: 'medium',
    whisperDevice: 'cpu',
    whisperComputeType: 'int8',
    diarizationEnabled: false,
    overlapDetectionEnabled: false,
    separationEnabled: false,
    maxAudioDurationLocalSeconds: 300,
    minFreeRamMb: 4096,
    maxConcurrentJobs: 1,
    ...overrides,
  };
}

describe('model-validation (T026)', () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'modelval-'));
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  describe('whisper', () => {
    it('không set WHISPER_MODEL_PATH → KHÔNG validate path (dùng HF cache), pass', () => {
      expect(() =>
        validateModelsAvailable(makeProfile(), {}),
      ).not.toThrow();
    });

    it('WHISPER_MODEL_PATH set nhưng không tồn tại → throw WHISPER_MODEL_NOT_PRELOADED', () => {
      expect(() =>
        validateModelsAvailable(makeProfile(), {
          WHISPER_MODEL_PATH: path.join(tmpDir, 'khong-ton-tai'),
        }),
      ).toThrow(MODEL_VALIDATION_ERRORS.WHISPER_MODEL_NOT_PRELOADED);
    });

    it('WHISPER_MODEL_PATH tồn tại → pass', () => {
      expect(() =>
        validateModelsAvailable(makeProfile(), { WHISPER_MODEL_PATH: tmpDir }),
      ).not.toThrow();
    });
  });

  describe('pyannote (diarization)', () => {
    it('diarization off → KHÔNG cần pyannote, pass dù không set path', () => {
      expect(() =>
        validateModelsAvailable(makeProfile({ diarizationEnabled: false }), {}),
      ).not.toThrow();
    });

    it('diarization on + thiếu PYANNOTE_MODEL_PATH → throw PYANNOTE_MODEL_NOT_PRELOADED', () => {
      expect(() =>
        validateModelsAvailable(makeProfile({ diarizationEnabled: true }), {}),
      ).toThrow(MODEL_VALIDATION_ERRORS.PYANNOTE_MODEL_NOT_PRELOADED);
    });

    it('diarization on + path có nhưng thiếu config.yaml → throw', () => {
      expect(() =>
        validateModelsAvailable(makeProfile({ diarizationEnabled: true }), {
          PYANNOTE_MODEL_PATH: tmpDir,
        }),
      ).toThrow(MODEL_VALIDATION_ERRORS.PYANNOTE_MODEL_NOT_PRELOADED);
    });

    it('diarization on + có config.yaml → pass', () => {
      fs.writeFileSync(path.join(tmpDir, 'config.yaml'), 'pipeline: x\n');
      expect(() =>
        validateModelsAvailable(makeProfile({ diarizationEnabled: true }), {
          PYANNOTE_MODEL_PATH: tmpDir,
        }),
      ).not.toThrow();
    });
  });

  describe('SepFormer (separation, M3)', () => {
    it('separation on + thiếu SEPFORMER_MODEL_PATH → throw SEPFORMER_MODEL_NOT_PRELOADED', () => {
      fs.writeFileSync(path.join(tmpDir, 'config.yaml'), 'pipeline: x\n');
      expect(() =>
        validateModelsAvailable(
          makeProfile({ diarizationEnabled: true, separationEnabled: true }),
          { PYANNOTE_MODEL_PATH: tmpDir },
        ),
      ).toThrow(MODEL_VALIDATION_ERRORS.SEPFORMER_MODEL_NOT_PRELOADED);
    });
  });

  it('không log/throw chứa secret — message chỉ có path/model (T027)', () => {
    try {
      validateModelsAvailable(makeProfile({ diarizationEnabled: true }), {
        PYANNOTE_MODEL_PATH: '',
        STORAGE_S3_SECRET_KEY: 'super-secret',
        FACE_DEVICE_CALLBACK_TOKEN: 'tok',
      });
      fail('phải throw');
    } catch (e) {
      const msg = (e as Error).message;
      expect(msg).not.toContain('super-secret');
      expect(msg).not.toContain('tok');
    }
  });
});
