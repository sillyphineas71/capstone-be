import * as fs from 'fs';
import * as path from 'path';
import { fetchAudio } from './audio-source-loader';
import { downloadAudioFromMinio } from './minio-audio-loader';

jest.mock('fs');
jest.mock('./minio-audio-loader', () => ({
  downloadAudioFromMinio: jest.fn(),
}));

const mockFs = fs as jest.Mocked<typeof fs>;
const mockDownload = downloadAudioFromMinio as jest.Mock;

describe('audio-source-loader (bug #2)', () => {
  const minioConfig = {
    endpoint: 'localhost',
    port: 9000,
    useSSL: false,
    accessKey: 'ak',
    secretKey: 'sk',
    bucket: 'recordings',
  };
  const fakeClient = {} as never;

  beforeEach(() => {
    jest.clearAllMocks();
    delete process.env['STORAGE_DRIVER'];
    delete process.env['STORAGE_LOCAL_PATH'];
  });

  it('STORAGE_DRIVER=local (mặc định) → copy trực tiếp từ đĩa, không gọi MinIO', async () => {
    process.env['STORAGE_LOCAL_PATH'] = '/uploads';
    mockFs.existsSync.mockReturnValue(true);
    mockFs.copyFileSync.mockReturnValue(undefined);

    await fetchAudio(null, null, {
      storageKey: 'recordings/m-1/audio.wav',
      destPath: '/tmp/job-1/source-audio',
    });

    expect(mockFs.copyFileSync).toHaveBeenCalledWith(
      path.resolve('/uploads', 'recordings/m-1/audio.wav'),
      '/tmp/job-1/source-audio',
    );
    expect(mockDownload).not.toHaveBeenCalled();
  });

  it('STORAGE_DRIVER=local, file không tồn tại trên đĩa → throw SOURCE_AUDIO_NOT_FOUND', async () => {
    process.env['STORAGE_LOCAL_PATH'] = '/uploads';
    mockFs.existsSync.mockReturnValue(false);

    await expect(
      fetchAudio(null, null, {
        storageKey: 'recordings/m-1/missing.wav',
        destPath: '/tmp/job-1/source-audio',
      }),
    ).rejects.toThrow('SOURCE_AUDIO_NOT_FOUND');
  });

  it('storageKey cố path traversal ra ngoài STORAGE_LOCAL_PATH → throw SOURCE_AUDIO_INVALID_PATH', async () => {
    process.env['STORAGE_LOCAL_PATH'] = '/uploads';

    await expect(
      fetchAudio(null, null, {
        storageKey: '../../etc/passwd',
        destPath: '/tmp/job-1/source-audio',
      }),
    ).rejects.toThrow('SOURCE_AUDIO_INVALID_PATH');
    expect(mockFs.existsSync).not.toHaveBeenCalled();
  });

  it('STORAGE_DRIVER=s3 → gọi downloadAudioFromMinio với client/config đã truyền vào', async () => {
    process.env['STORAGE_DRIVER'] = 's3';
    mockDownload.mockResolvedValue({ path: '/tmp/job-1/source-audio', sizeBytes: 42 });

    await fetchAudio(fakeClient, minioConfig, {
      storageKey: 'meetings/m-1/audio.wav',
      destPath: '/tmp/job-1/source-audio',
    });

    expect(mockDownload).toHaveBeenCalledWith(fakeClient, minioConfig, {
      storageKey: 'meetings/m-1/audio.wav',
      destPath: '/tmp/job-1/source-audio',
    });
  });

  it('STORAGE_DRIVER=s3 nhưng thiếu client/config (chưa cấu hình MinIO) → throw MINIO_NOT_CONFIGURED', async () => {
    process.env['STORAGE_DRIVER'] = 's3';

    await expect(
      fetchAudio(null, null, {
        storageKey: 'meetings/m-1/audio.wav',
        destPath: '/tmp/job-1/source-audio',
      }),
    ).rejects.toThrow('MINIO_NOT_CONFIGURED');
    expect(mockDownload).not.toHaveBeenCalled();
  });
});
