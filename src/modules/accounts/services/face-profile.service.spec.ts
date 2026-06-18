/* eslint-disable @typescript-eslint/no-unsafe-member-access, @typescript-eslint/no-unsafe-assignment, @typescript-eslint/no-unsafe-call, @typescript-eslint/no-unsafe-return */
import { Test, TestingModule } from '@nestjs/testing';
import { DataSource } from 'typeorm';
import { getRepositoryToken } from '@nestjs/typeorm';
import { ConfigService } from '@nestjs/config';
import { BadRequestException } from '@nestjs/common';
import { FaceProfileService } from './face-profile.service.js';
import { FaceProfileEntity } from '../entities/face-profile.entity.js';
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

  afterEach(() => jest.clearAllMocks());

  // ── enrollPortrait ──
  it('happy: saveFile → media_files → tạo face_profiles (pending_review)', async () => {
    const r = await service.enrollPortrait('u1', file(), 'admin');
    expect(storageMock.saveFile).toHaveBeenCalled();
    const insertSql = String(dsMock.manager.query.mock.calls[0][0]);
    expect(insertSql).toContain('INSERT INTO media_files');
    expect(insertSql).toContain("'image'");
    expect(repoMock.save).toHaveBeenCalled();
    expect(r).toEqual({
      faceProfileId: 'fp-1',
      mediaFileId: 'media-1',
      status: 'pending_review',
    });
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

  // ── getPortraitBytes ──
  it('getPortraitBytes: có profile+ảnh local → Buffer', async () => {
    repoMock.findOne.mockResolvedValue({ primaryImageFileId: 'media-1' });
    dsMock.manager.query.mockResolvedValue([
      { storage_key: 'face-profiles/x.jpg', storage_provider: 'local' },
    ]);
    const buf = await service.getPortraitBytes('u1');
    expect(buf?.toString()).toBe('PORTRAIT');
    expect(storageMock.getFile).toHaveBeenCalledWith('face-profiles/x.jpg');
  });

  it('getPortraitBytes: không có profile → null', async () => {
    repoMock.findOne.mockResolvedValue(null);
    expect(await service.getPortraitBytes('u1')).toBeNull();
  });

  it('getPortraitBytes: profile không có ảnh → null', async () => {
    repoMock.findOne.mockResolvedValue({ primaryImageFileId: null });
    expect(await service.getPortraitBytes('u1')).toBeNull();
  });

  it('getPortraitBytes: media non-local → null', async () => {
    repoMock.findOne.mockResolvedValue({ primaryImageFileId: 'media-1' });
    dsMock.manager.query.mockResolvedValue([
      { storage_key: 's3/x.jpg', storage_provider: 's3' },
    ]);
    expect(await service.getPortraitBytes('u1')).toBeNull();
  });
});
