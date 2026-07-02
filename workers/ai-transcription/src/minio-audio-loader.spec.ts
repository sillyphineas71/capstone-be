import * as fs from 'fs';
import {
  downloadAudioFromMinio,
  loadMinioConfigFromEnv,
} from './minio-audio-loader';

jest.mock('fs');
const mockFs = fs as jest.Mocked<typeof fs>;

describe('minio-audio-loader (T010)', () => {
  const config = {
    endpoint: 'localhost',
    port: 9000,
    useSSL: false,
    accessKey: 'minioadmin',
    secretKey: 'minioadmin',
    bucket: 'recordings',
  };

  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('tải file thành công → trả về path + sizeBytes, không log secret', async () => {
    const fGetObject = jest.fn().mockResolvedValue(undefined);
    const fakeClient = { fGetObject } as never;
    mockFs.existsSync.mockReturnValue(true);
    mockFs.statSync.mockReturnValue({ size: 1024 } as fs.Stats);

    const logSpy = jest.spyOn(console, 'error').mockImplementation(() => {});

    const result = await downloadAudioFromMinio(fakeClient, config, {
      storageKey: 'meetings/abc/audio.wav',
      destPath: '/tmp/job-1/audio.wav',
    });

    expect(result).toEqual({ path: '/tmp/job-1/audio.wav', sizeBytes: 1024 });
    expect(fGetObject).toHaveBeenCalledWith(
      'recordings',
      'meetings/abc/audio.wav',
      '/tmp/job-1/audio.wav',
    );
    const loggedText = logSpy.mock.calls.map((c) => c.join(' ')).join('\n');
    expect(loggedText).not.toContain(config.accessKey);
    expect(loggedText).not.toContain(config.secretKey);
    logSpy.mockRestore();
  });

  it('file không tồn tại trên MinIO → throw SOURCE_AUDIO_NOT_FOUND', async () => {
    const fGetObject = jest
      .fn()
      .mockRejectedValue(new Error('NoSuchKey: not found'));
    const fakeClient = { fGetObject } as never;

    await expect(
      downloadAudioFromMinio(fakeClient, config, {
        storageKey: 'meetings/missing/audio.wav',
        destPath: '/tmp/job-2/audio.wav',
      }),
    ).rejects.toThrow('SOURCE_AUDIO_NOT_FOUND');
  });

  it('thiếu bucket (không truyền + không có config) → throw MINIO_BUCKET_NOT_CONFIGURED', async () => {
    const fakeClient = { fGetObject: jest.fn() } as never;
    await expect(
      downloadAudioFromMinio(
        fakeClient,
        { ...config, bucket: '' },
        { storageKey: 'k', destPath: '/tmp/x' },
      ),
    ).rejects.toThrow('MINIO_BUCKET_NOT_CONFIGURED');
  });

  it('loadMinioConfigFromEnv() đọc đúng tên biến môi trường', () => {
    process.env['STORAGE_S3_ENDPOINT'] = 'https://minio.internal';
    process.env['STORAGE_S3_PORT'] = '9000';
    process.env['STORAGE_S3_USE_SSL'] = 'true';
    process.env['STORAGE_S3_ACCESS_KEY'] = 'ak';
    process.env['STORAGE_S3_SECRET_KEY'] = 'sk';
    process.env['STORAGE_S3_BUCKET'] = 'recordings';

    const cfg = loadMinioConfigFromEnv();
    expect(cfg).toEqual({
      endpoint: 'minio.internal',
      port: 9000,
      useSSL: true,
      accessKey: 'ak',
      secretKey: 'sk',
      bucket: 'recordings',
    });
  });
});
