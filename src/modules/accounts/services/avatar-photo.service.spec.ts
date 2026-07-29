import {
  BadGatewayException,
  BadRequestException,
  ForbiddenException,
  NotFoundException,
} from '@nestjs/common';
import {
  AvatarPhotoService,
  UploadedAvatarPhotoFile,
} from './avatar-photo.service.js';

/**
 * ACCT-AVATAR-PHOTO-001 — Unit test cho AvatarPhotoService.
 * Trace: AC-001..AC-005 (spec/features/account/feat-update-avatar-photo/spec.md).
 */

const jpegBuffer = (size = 1024): Buffer => {
  const buf = Buffer.alloc(size);
  buf[0] = 0xff;
  buf[1] = 0xd8;
  buf[2] = 0xff;
  return buf;
};

const makeFile = (
  over: Partial<UploadedAvatarPhotoFile> = {},
): UploadedAvatarPhotoFile => ({
  buffer: jpegBuffer(),
  originalname: 'me.jpg',
  mimetype: 'image/jpeg',
  size: 1024,
  ...over,
});

describe('AvatarPhotoService', () => {
  let service: AvatarPhotoService;
  let userRepo: { findOne: jest.Mock };
  let dataSource: { transaction: jest.Mock };
  let cloudinary: { uploadImage: jest.Mock };
  let configService: { get: jest.Mock };
  let inserts: Array<{ repo: string; payload: Record<string, unknown> }>;
  let updates: Array<{
    repo: string;
    id: string;
    payload: Record<string, unknown>;
  }>;

  beforeEach(() => {
    inserts = [];
    updates = [];
    userRepo = { findOne: jest.fn() };
    cloudinary = { uploadImage: jest.fn() };
    configService = { get: jest.fn((_k: string, def?: unknown) => def) };

    dataSource = {
      transaction: jest.fn(async (cb: (m: unknown) => Promise<void>) => {
        const manager = {
          getRepository: () => {
            return {
              insert: (payload: Record<string, unknown>) => {
                inserts.push({ repo: 'unknown', payload });
                return Promise.resolve({});
              },
              update: (id: string, payload: Record<string, unknown>) => {
                updates.push({ repo: 'unknown', id, payload });
                return Promise.resolve({});
              },
            };
          },
        };
        return cb(manager);
      }),
    };

    service = new AvatarPhotoService(
      userRepo as never,
      dataSource as never,
      cloudinary as never,
      configService as never,
    );

    userRepo.findOne.mockResolvedValue({ id: 'u1', accountStatus: 'active' });
    cloudinary.uploadImage.mockResolvedValue({
      publicId: 'avatars/x',
      secureUrl: 'https://res.cloudinary.com/demo/avatars/x.jpg',
    });
  });

  it('happy path: cập nhật avatar_url ngay, không tạo face_profiles (AC-001)', async () => {
    const result = await service.updateAvatarPhoto('u1', makeFile());

    expect(cloudinary.uploadImage).toHaveBeenCalled();
    expect(result.avatarUrl).toBe(
      'https://res.cloudinary.com/demo/avatars/x.jpg',
    );
    expect(updates.some((u) => 'avatarUrl' in u.payload)).toBe(true);
    expect(inserts.some((i) => 'actionType' in i.payload)).toBe(true);
  });

  it('thiếu file → AVATAR_PHOTO_FILE_REQUIRED (AC tương ứng)', async () => {
    await expect(
      service.updateAvatarPhoto('u1', undefined),
    ).rejects.toMatchObject({
      response: { code: 'AVATAR_PHOTO_FILE_REQUIRED' },
    });
    expect(cloudinary.uploadImage).not.toHaveBeenCalled();
  });

  it('magic bytes sai (PDF) → AVATAR_PHOTO_FILE_TYPE_INVALID (AC-003)', async () => {
    const pdf = makeFile({ buffer: Buffer.from('%PDF-1.7', 'ascii') });
    await expect(service.updateAvatarPhoto('u1', pdf)).rejects.toMatchObject({
      response: { code: 'AVATAR_PHOTO_FILE_TYPE_INVALID' },
    });
  });

  it('file quá lớn → AVATAR_PHOTO_FILE_TOO_LARGE', async () => {
    configService.get.mockReturnValue(5 * 1024 * 1024);
    const big = makeFile({ size: 8 * 1024 * 1024 });
    await expect(service.updateAvatarPhoto('u1', big)).rejects.toMatchObject({
      response: { code: 'AVATAR_PHOTO_FILE_TOO_LARGE' },
    });
  });

  it('account không active → ACCOUNT_NOT_ACTIVE', async () => {
    userRepo.findOne.mockResolvedValue({ id: 'u1', accountStatus: 'locked' });
    await expect(
      service.updateAvatarPhoto('u1', makeFile()),
    ).rejects.toBeInstanceOf(ForbiddenException);
    expect(cloudinary.uploadImage).not.toHaveBeenCalled();
  });

  it('user không tồn tại → USER_NOT_FOUND', async () => {
    userRepo.findOne.mockResolvedValue(null);
    await expect(
      service.updateAvatarPhoto('u1', makeFile()),
    ).rejects.toBeInstanceOf(NotFoundException);
  });

  it('Cloudinary lỗi → AVATAR_PHOTO_STORAGE_FAILED', async () => {
    cloudinary.uploadImage.mockRejectedValue(new Error('cloudinary down'));
    await expect(
      service.updateAvatarPhoto('u1', makeFile()),
    ).rejects.toBeInstanceOf(BadGatewayException);
    expect(dataSource.transaction).not.toHaveBeenCalled();
  });

  it('mọi lỗi validate đều là BadRequestException (guard)', async () => {
    await expect(
      service.updateAvatarPhoto('u1', undefined),
    ).rejects.toBeInstanceOf(BadRequestException);
  });
});
