import {
  BadGatewayException,
  ConflictException,
  ForbiddenException,
  InternalServerErrorException,
  NotFoundException,
} from '@nestjs/common';
import { QueryFailedError } from 'typeorm';
import {
  BiometricSubmissionService,
  UploadedBiometricFile,
} from './biometric-submission.service.js';

/**
 * ACCT-BIOMETRIC-SUBMIT-001 — Unit test cho BiometricSubmissionService (US2).
 * Trace: AC-002,005,006b,007,008,009,010,010b,013,014; ERR-009; EC-003; EC-004.
 */

const jpegBuffer = (size = 1024): Buffer => {
  const buf = Buffer.alloc(size);
  buf[0] = 0xff;
  buf[1] = 0xd8;
  buf[2] = 0xff;
  return buf;
};

const makeFile = (
  over: Partial<UploadedBiometricFile> = {},
): UploadedBiometricFile => ({
  buffer: jpegBuffer(),
  originalname: 'me.jpg',
  mimetype: 'image/jpeg',
  size: 1024,
  ...over,
});

describe('BiometricSubmissionService', () => {
  let service: BiometricSubmissionService;
  let userRepo: { findOne: jest.Mock };
  let faceProfileRepo: { find: jest.Mock };
  let dataSource: { transaction: jest.Mock };
  let cloudinary: { uploadImage: jest.Mock; deleteImage: jest.Mock };
  let configService: { get: jest.Mock };
  let insertCalls: Array<Record<string, unknown>>;

  beforeEach(() => {
    insertCalls = [];
    userRepo = { findOne: jest.fn() };
    faceProfileRepo = { find: jest.fn() };
    cloudinary = {
      uploadImage: jest.fn(),
      deleteImage: jest.fn().mockResolvedValue(undefined),
    };
    configService = {
      get: jest.fn((_k: string, def?: unknown) => def),
    };
    // transaction mặc định: success — manager.getRepository().insert() ghi vào insertCalls.
    dataSource = {
      transaction: jest.fn(async (cb: (m: unknown) => Promise<void>) => {
        const manager = {
          getRepository: () => ({
            insert: (payload: Record<string, unknown>) => {
              insertCalls.push(payload);
              return Promise.resolve({});
            },
          }),
        };
        return cb(manager);
      }),
    };

    service = new BiometricSubmissionService(
      userRepo as never,
      faceProfileRepo as never,
      dataSource as never,
      cloudinary as never,
      configService as never,
    );

    // default: user active
    userRepo.findOne.mockResolvedValue({ id: 'u1', accountStatus: 'active' });
    faceProfileRepo.find.mockResolvedValue([]);
    cloudinary.uploadImage.mockResolvedValue({
      publicId: 'biometrics/x',
      secureUrl: 'https://res.cloudinary.com/demo/biometrics/x.jpg',
    });
  });

  it('happy lần đầu (chưa có row) → pending_review + audit biometric.upload (AC-002)', async () => {
    const result = await service.submit('u1', makeFile(), true);

    expect(cloudinary.uploadImage).toHaveBeenCalled();
    expect(dataSource.transaction).toHaveBeenCalled();
    expect(result.biometricReviewStatus).toBe('pending_review');
    expect(result.faceProfileId).toBeDefined();

    const audit = insertCalls.find((c) => 'actionType' in c);
    expect(audit?.actionType).toBe('biometric.upload');
  });

  it('reupload sau rejected → pending_review + audit biometric.reupload (AC-005)', async () => {
    faceProfileRepo.find.mockResolvedValue([{ id: 'old', status: 'rejected' }]);
    const result = await service.submit('u1', makeFile(), true);

    expect(result.biometricReviewStatus).toBe('pending_review');
    const audit = insertCalls.find((c) => 'actionType' in c);
    expect(audit?.actionType).toBe('biometric.reupload');
  });

  it('replace khi approved (row active) → tạo row mới pending, audit biometric.reupload (AC-006b)', async () => {
    faceProfileRepo.find.mockResolvedValue([{ id: 'old', status: 'active' }]);
    const result = await service.submit('u1', makeFile(), true);

    expect(result.biometricReviewStatus).toBe('pending_review');
    const audit = insertCalls.find((c) => 'actionType' in c);
    expect(audit?.actionType).toBe('biometric.reupload');
    // không touch users.avatar_url (service không gọi userRepo.update/save)
    expect((userRepo as Record<string, unknown>).update).toBeUndefined();
  });

  it('đang pending_review → 409, KHÔNG gọi Cloudinary (AC-013)', async () => {
    faceProfileRepo.find.mockResolvedValue([
      { id: 'p', status: 'pending_review' },
    ]);
    await expect(service.submit('u1', makeFile(), true)).rejects.toBeInstanceOf(
      ConflictException,
    );
    expect(cloudinary.uploadImage).not.toHaveBeenCalled();
  });

  it('thiếu file → BIOMETRIC_FILE_REQUIRED (AC-007)', async () => {
    await expect(service.submit('u1', undefined, true)).rejects.toMatchObject({
      response: { code: 'BIOMETRIC_FILE_REQUIRED' },
    });
    expect(cloudinary.uploadImage).not.toHaveBeenCalled();
  });

  it('magic bytes sai (PDF) → BIOMETRIC_FILE_TYPE_INVALID (AC-008)', async () => {
    const pdf = makeFile({ buffer: Buffer.from('%PDF-1.7', 'ascii') });
    await expect(service.submit('u1', pdf, true)).rejects.toMatchObject({
      response: { code: 'BIOMETRIC_FILE_TYPE_INVALID' },
    });
  });

  it('file quá lớn → BIOMETRIC_FILE_TOO_LARGE (AC-009)', async () => {
    configService.get.mockReturnValue(5 * 1024 * 1024);
    const big = makeFile({ size: 8 * 1024 * 1024 });
    await expect(service.submit('u1', big, true)).rejects.toMatchObject({
      response: { code: 'BIOMETRIC_FILE_TOO_LARGE' },
    });
  });

  it('consent false → BIOMETRIC_CONSENT_REQUIRED, không upload (AC-010)', async () => {
    await expect(service.submit('u1', makeFile(), false)).rejects.toMatchObject(
      { response: { code: 'BIOMETRIC_CONSENT_REQUIRED' } },
    );
    expect(cloudinary.uploadImage).not.toHaveBeenCalled();
  });

  it('consent "true" (string) → hợp lệ (AC-010b)', async () => {
    const result = await service.submit('u1', makeFile(), 'true');
    expect(result.biometricReviewStatus).toBe('pending_review');
  });

  it('account không active → ACCOUNT_NOT_ACTIVE, không upload (AC-014)', async () => {
    userRepo.findOne.mockResolvedValue({ id: 'u1', accountStatus: 'locked' });
    await expect(service.submit('u1', makeFile(), true)).rejects.toBeInstanceOf(
      ForbiddenException,
    );
    expect(cloudinary.uploadImage).not.toHaveBeenCalled();
  });

  it('user không tồn tại → USER_NOT_FOUND', async () => {
    userRepo.findOne.mockResolvedValue(null);
    await expect(service.submit('u1', makeFile(), true)).rejects.toBeInstanceOf(
      NotFoundException,
    );
  });

  it('Cloudinary upload lỗi → BIOMETRIC_STORAGE_FAILED, không mở transaction (ERR-009)', async () => {
    cloudinary.uploadImage.mockRejectedValue(new Error('cloudinary down'));
    await expect(service.submit('u1', makeFile(), true)).rejects.toBeInstanceOf(
      BadGatewayException,
    );
    expect(dataSource.transaction).not.toHaveBeenCalled();
  });

  it('transaction lỗi thường → cleanup Cloudinary + BIOMETRIC_UPLOAD_FAILED (EC-004)', async () => {
    dataSource.transaction.mockRejectedValue(new Error('db write failed'));
    await expect(service.submit('u1', makeFile(), true)).rejects.toBeInstanceOf(
      InternalServerErrorException,
    );
    expect(cloudinary.deleteImage).toHaveBeenCalledWith('biometrics/x');
  });

  it('transaction unique violation → BIOMETRIC_ALREADY_PENDING_REVIEW, KHÔNG cleanup (EC-003)', async () => {
    const err = new QueryFailedError('q', [], {
      code: '23505',
      constraint: 'ux_face_profiles_user_pending',
    } as never);
    dataSource.transaction.mockRejectedValue(err);

    await expect(service.submit('u1', makeFile(), true)).rejects.toMatchObject({
      response: { code: 'BIOMETRIC_ALREADY_PENDING_REVIEW' },
    });
    expect(cloudinary.deleteImage).not.toHaveBeenCalled();
  });
});
