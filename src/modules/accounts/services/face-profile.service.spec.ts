/* eslint-disable @typescript-eslint/no-unsafe-member-access, @typescript-eslint/no-unsafe-assignment, @typescript-eslint/no-unsafe-call, @typescript-eslint/no-unsafe-return */
import { Test, TestingModule } from '@nestjs/testing';
import { DataSource } from 'typeorm';
import { getRepositoryToken } from '@nestjs/typeorm';
import { ConfigService } from '@nestjs/config';
import { BadRequestException } from '@nestjs/common';
import { FaceProfileService } from './face-profile.service.js';
import {
  FaceProfileEntity,
  FaceProfileStatus,
} from '../entities/face-profile.entity.js';
import { StorageService } from '../../storage/storage.service.js';

const file = (over: any = {}) => ({
  buffer: Buffer.from('JPEG'),
  originalname: 'me.jpg',
  mimetype: 'image/jpeg',
  size: 1024,
  ...over,
});

describe('FaceProfileService (FPE-001 / UC-17)', () => {
  let service: FaceProfileService;
  let repoMock: any;
  let dsMock: any;
  let storageMock: any;

  beforeEach(async () => {
    repoMock = {
      findOne: jest.fn().mockResolvedValue(null),
      update: jest.fn().mockResolvedValue(undefined),
      create: jest.fn((o: any) => o),
      save: jest.fn((o: any) => Promise.resolve({ id: 'fp-1', ...o })),
    };
    dsMock = {
      manager: {
        query: jest.fn().mockResolvedValue([{ id: 'media-1' }]),
      },
    };
    storageMock = {
      saveFile: jest
        .fn()
        .mockResolvedValue({ storageKey: 'face-profiles/x.jpg' }),
      getFile: jest.fn().mockReturnValue(Buffer.from('PORTRAIT')),
      getDriver: jest.fn().mockReturnValue('local'),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        FaceProfileService,
        { provide: getRepositoryToken(FaceProfileEntity), useValue: repoMock },
        { provide: DataSource, useValue: dsMock },
        { provide: StorageService, useValue: storageMock },
        {
          provide: ConfigService,
          useValue: { get: (_k: string, d?: unknown) => d },
        },
      ],
    }).compile();
    service = module.get(FaceProfileService);
  });

  afterEach(() => {
    jest.clearAllMocks();
    delete (global as { fetch?: unknown }).fetch;
  });

  // ── enrollPortrait ──
  it('happy: saveFile → media_files → tạo face_profiles (pending_review)', async () => {
    const r = await service.enrollPortrait('u1', file(), 'admin');
    expect(storageMock.saveFile).toHaveBeenCalled();
    const insertSql = String(dsMock.manager.query.mock.calls[0][0]);
    expect(insertSql).toContain('INSERT INTO media_files');
    expect(insertSql).toContain("'image'");
    expect(repoMock.save).toHaveBeenCalled();
    // BR-PROFILE-CODE: profile_code dùng generator chung (FP- + 32 hex uppercase)
    expect(repoMock.create).toHaveBeenCalledWith(
      expect.objectContaining({
        profileCode: expect.stringMatching(/^FP-[0-9A-F]{32}$/),
      }),
    );
    expect(r).toEqual({
      faceProfileId: 'fp-1',
      mediaFileId: 'media-1',
      status: 'pending_review',
    });
  });

  it('driver s3 → storage_provider lưu DB là s3, không hardcode local', async () => {
    storageMock.getDriver.mockReturnValue('s3');
    await service.enrollPortrait('u1', file(), 'admin');
    const insertSql = String(dsMock.manager.query.mock.calls[0][0]);
    const insertParams = dsMock.manager.query.mock.calls[0][1];
    expect(insertSql).not.toContain("'local'");
    expect(insertParams).toContain('s3');
  });

  it('mime sai → 400 INVALID_FILE_TYPE, KHÔNG saveFile', async () => {
    await expect(
      service.enrollPortrait('u1', file({ mimetype: 'application/pdf' }), 'a'),
    ).rejects.toMatchObject({ response: { code: 'INVALID_FILE_TYPE' } });
    expect(storageMock.saveFile).not.toHaveBeenCalled();
  });

  it('size vượt giới hạn → 400 FILE_TOO_LARGE', async () => {
    await expect(
      service.enrollPortrait('u1', file({ size: 99 * 1024 * 1024 }), 'a'),
    ).rejects.toMatchObject({ response: { code: 'FILE_TOO_LARGE' } });
  });

  it('thiếu file → 400 VALIDATION_ERROR', async () => {
    await expect(service.enrollPortrait('u1', undefined, 'a')).rejects.toThrow(
      BadRequestException,
    );
  });

  it('upsert: user đã có face_profile → UPDATE (sampleCount+1), KHÔNG tạo mới', async () => {
    repoMock.findOne.mockResolvedValue({ id: 'fp-existing', sampleCount: 2 });
    const r = await service.enrollPortrait('u1', file(), 'admin');
    expect(repoMock.update).toHaveBeenCalledWith(
      'fp-existing',
      expect.objectContaining({
        primaryImageFileId: 'media-1',
        sampleCount: 3,
      }),
    );
    expect(repoMock.save).not.toHaveBeenCalled();
    expect(r.faceProfileId).toBe('fp-existing');
  });

  // ── getPortraitBytes (FPB-001) ──
  // T1: local provider → getFile → Buffer (+ chỉ query profile ACTIVE).
  it('getPortraitBytes: profile ACTIVE + ảnh local → Buffer; findOne lọc status ACTIVE', async () => {
    repoMock.findOne.mockResolvedValue({ primaryImageFileId: 'media-1' });
    dsMock.manager.query.mockResolvedValue([
      {
        storage_key: 'face-profiles/x.jpg',
        storage_provider: 'local',
        file_url: null,
      },
    ]);
    const buf = await service.getPortraitBytes('u1');
    expect(buf?.toString()).toBe('PORTRAIT');
    expect(storageMock.getFile).toHaveBeenCalledWith('face-profiles/x.jpg');
    // VAL-01: where lọc status=ACTIVE.
    expect(repoMock.findOne).toHaveBeenCalledWith({
      where: { userId: 'u1', status: FaceProfileStatus.ACTIVE },
    });
  });

  // T2: không có profile ACTIVE (pending/rejected/không có) → null.
  it('getPortraitBytes: KHÔNG có profile ACTIVE → null', async () => {
    repoMock.findOne.mockResolvedValue(null);
    expect(await service.getPortraitBytes('u1')).toBeNull();
  });

  it('getPortraitBytes: profile ACTIVE nhưng không có ảnh → null', async () => {
    repoMock.findOne.mockResolvedValue({ primaryImageFileId: null });
    expect(await service.getPortraitBytes('u1')).toBeNull();
  });

  // T3: cloud_provider + fetch ok → Buffer (tải từ file_url https).
  it('getPortraitBytes: cloud_provider + fetch ok → Buffer', async () => {
    repoMock.findOne.mockResolvedValue({ primaryImageFileId: 'media-1' });
    dsMock.manager.query.mockResolvedValue([
      {
        storage_key: 'pubId',
        storage_provider: 'cloud_provider',
        file_url: 'https://res.cloudinary.com/x/img.jpg',
      },
    ]);
    const ab = new TextEncoder().encode('CLOUDIMG');
    global.fetch = jest.fn().mockResolvedValue({
      ok: true,
      arrayBuffer: jest.fn().mockResolvedValue(ab.buffer),
    });
    const buf = await service.getPortraitBytes('u1');
    expect(buf?.toString()).toBe('CLOUDIMG');
    expect(global.fetch).toHaveBeenCalledWith(
      'https://res.cloudinary.com/x/img.jpg',
    );
    expect(storageMock.getFile).not.toHaveBeenCalled();
  });

  // T4: cloud_provider + fetch !ok (404) → null, KHÔNG throw.
  it('getPortraitBytes: cloud_provider + fetch 404 → null (KHÔNG throw)', async () => {
    repoMock.findOne.mockResolvedValue({ primaryImageFileId: 'media-1' });
    dsMock.manager.query.mockResolvedValue([
      {
        storage_key: 'pubId',
        storage_provider: 'cloud_provider',
        file_url: 'https://res.cloudinary.com/x/missing.jpg',
      },
    ]);
    global.fetch = jest.fn().mockResolvedValue({ ok: false, status: 404 });
    await expect(service.getPortraitBytes('u1')).resolves.toBeNull();
  });

  // T4b: cloud_provider + fetch reject → null, KHÔNG throw.
  it('getPortraitBytes: cloud_provider + fetch reject → null (KHÔNG throw)', async () => {
    repoMock.findOne.mockResolvedValue({ primaryImageFileId: 'media-1' });
    dsMock.manager.query.mockResolvedValue([
      {
        storage_key: 'pubId',
        storage_provider: 'cloud_provider',
        file_url: 'https://res.cloudinary.com/x/err.jpg',
      },
    ]);
    global.fetch = jest.fn().mockRejectedValue(new Error('network'));
    await expect(service.getPortraitBytes('u1')).resolves.toBeNull();
  });

  // T5: cloud_provider + file_url null → null.
  it('getPortraitBytes: cloud_provider + file_url null → null', async () => {
    repoMock.findOne.mockResolvedValue({ primaryImageFileId: 'media-1' });
    dsMock.manager.query.mockResolvedValue([
      {
        storage_key: 'pubId',
        storage_provider: 'cloud_provider',
        file_url: null,
      },
    ]);
    expect(await service.getPortraitBytes('u1')).toBeNull();
  });

  it('getPortraitBytes: provider lạ (s3) → null', async () => {
    repoMock.findOne.mockResolvedValue({ primaryImageFileId: 'media-1' });
    dsMock.manager.query.mockResolvedValue([
      { storage_key: 's3/x.jpg', storage_provider: 's3', file_url: null },
    ]);
    expect(await service.getPortraitBytes('u1')).toBeNull();
  });
});
