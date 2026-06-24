/* eslint-disable @typescript-eslint/no-unsafe-return */
import { Writable } from 'stream';

/**
 * ACCT-AVATAR-SUBMIT-001 — Unit test cho CloudinaryService (BR-013).
 * Mock SDK cloudinary để không gọi network thật.
 */

const uploadStreamMock = jest.fn();
const destroyMock = jest.fn();
const configMock = jest.fn();

jest.mock('cloudinary', () => ({
  v2: {
    config: (...args: unknown[]) => configMock(...args),
    uploader: {
      upload_stream: (...args: unknown[]) => uploadStreamMock(...args),
      destroy: (...args: unknown[]) => destroyMock(...args),
    },
  },
}));

import { CloudinaryService } from './cloudinary.service.js';

/** Tạo Writable giả: nuốt dữ liệu pipe vào rồi gọi callback của upload_stream. */
const makeFakeUploadStream = (
  cb: (err: unknown, res: unknown) => void,
  outcome: { error?: unknown; response?: unknown },
): Writable => {
  const sink = new Writable({
    write(_chunk, _enc, done) {
      done();
    },
  });
  sink.on('finish', () => cb(outcome.error ?? null, outcome.response ?? null));
  return sink;
};

const makeConfigService = () =>
  ({
    get: jest.fn((key: string, def?: unknown) => {
      const map: Record<string, unknown> = {
        CLOUDINARY_CLOUD_NAME: 'demo',
        CLOUDINARY_API_KEY: 'key',
        CLOUDINARY_API_SECRET: 'secret',
        CLOUDINARY_AVATAR_FOLDER: 'avatars',
      };
      return map[key] ?? def;
    }),
  }) as never;

describe('CloudinaryService', () => {
  let service: CloudinaryService;

  beforeEach(() => {
    jest.clearAllMocks();
    service = new CloudinaryService(makeConfigService());
    service.onModuleInit();
  });

  it('onModuleInit cấu hình cloudinary', () => {
    expect(configMock).toHaveBeenCalledWith(
      expect.objectContaining({ cloud_name: 'demo', api_key: 'key' }),
    );
  });

  it('uploadImage trả về { publicId, secureUrl } khi SDK thành công', async () => {
    uploadStreamMock.mockImplementation(
      (_opts: unknown, cb: (e: unknown, r: unknown) => void) =>
        makeFakeUploadStream(cb, {
          response: {
            public_id: 'avatars/abc123',
            secure_url: 'https://res.cloudinary.com/demo/avatars/abc123.jpg',
          },
        }),
    );

    const result = await service.uploadImage(
      Buffer.from('JPEGDATA'),
      'avatars',
    );
    expect(result).toEqual({
      publicId: 'avatars/abc123',
      secureUrl: 'https://res.cloudinary.com/demo/avatars/abc123.jpg',
    });
    expect(uploadStreamMock).toHaveBeenCalledWith(
      expect.objectContaining({ folder: 'avatars', resource_type: 'image' }),
      expect.any(Function),
    );
  });

  it('uploadImage reject khi SDK trả error', async () => {
    uploadStreamMock.mockImplementation(
      (_opts: unknown, cb: (e: unknown, r: unknown) => void) =>
        makeFakeUploadStream(cb, { error: new Error('cloudinary down') }),
    );

    await expect(
      service.uploadImage(Buffer.from('x'), 'avatars'),
    ).rejects.toThrow('cloudinary down');
  });

  it('deleteImage gọi destroy với publicId + resource_type image', async () => {
    destroyMock.mockResolvedValue({ result: 'ok' });
    await service.deleteImage('avatars/abc123');
    expect(destroyMock).toHaveBeenCalledWith('avatars/abc123', {
      resource_type: 'image',
    });
  });
});
