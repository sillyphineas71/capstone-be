import * as os from 'os';
import { checkResources } from './resource-guard';

jest.mock('os');
const mockOs = os as jest.Mocked<typeof os>;

describe('resource-guard (T002B/T002E)', () => {
  const ORIGINAL_ENV = { ...process.env };

  beforeEach(() => {
    jest.clearAllMocks();
    mockOs.freemem.mockReturnValue(8 * 1024 * 1024 * 1024); // 8GB free mặc định
  });

  afterEach(() => {
    process.env = { ...ORIGINAL_ENV };
  });

  it('local + audio 360s + limit 300s → reject AUDIO_TOO_LONG_FOR_LOCAL_PROFILE', () => {
    process.env['AI_PROFILE'] = 'local';
    process.env['MAX_AUDIO_DURATION_LOCAL_SECONDS'] = '300';

    const result = checkResources(360);

    expect(result.allowed).toBe(false);
    expect(result.warnings).toContain('AUDIO_TOO_LONG_FOR_LOCAL_PROFILE');
  });

  it('local + audio 240s + limit 300s → allowed', () => {
    process.env['AI_PROFILE'] = 'local';
    process.env['MAX_AUDIO_DURATION_LOCAL_SECONDS'] = '300';

    const result = checkResources(240);

    expect(result.allowed).toBe(true);
    expect(result.warnings).not.toContain('AUDIO_TOO_LONG_FOR_LOCAL_PROFILE');
  });

  it('RAM khả dụng thấp hơn AI_WORKER_MIN_FREE_RAM_MB → tự skip SepFormer, quyết định từ Node', () => {
    process.env['AI_PROFILE'] = 'local';
    process.env['AI_WORKER_MIN_FREE_RAM_MB'] = '4096';
    mockOs.freemem.mockReturnValue(1 * 1024 * 1024 * 1024); // 1GB free — dưới ngưỡng

    const result = checkResources(120);

    expect(result.allowed).toBe(true);
    expect(result.skipSepformer).toBe(true);
    expect(result.warnings).toContain('sepformer_skipped_low_resources');
    expect(mockOs.freemem).toHaveBeenCalled();
  });

  it('RAM khả dụng đủ → không skip SepFormer', () => {
    process.env['AI_PROFILE'] = 'local';
    process.env['AI_WORKER_MIN_FREE_RAM_MB'] = '2048';
    mockOs.freemem.mockReturnValue(8 * 1024 * 1024 * 1024);

    const result = checkResources(120);

    expect(result.skipSepformer).toBe(false);
    expect(result.warnings).not.toContain('sepformer_skipped_low_resources');
  });

  it('không reject duration cho profile khác local (production-gpu giới hạn khác)', () => {
    process.env['AI_PROFILE'] = 'production-gpu';
    process.env['CUDA_AVAILABLE'] = 'true';

    const result = checkResources(3600);

    expect(result.allowed).toBe(true);
  });
});
