/* eslint-disable @typescript-eslint/no-unsafe-member-access, @typescript-eslint/no-unsafe-assignment, @typescript-eslint/no-unsafe-call, @typescript-eslint/no-unsafe-return */
import { Test, TestingModule } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import { ConfigService } from '@nestjs/config';
import { NotFoundException } from '@nestjs/common';
import * as path from 'path';
import * as fs from 'fs';
import { MediaFilesService } from './media-files.service.js';
import { MediaFileEntity } from '../entities/media-file.entity.js';
import { StorageService } from '../../storage/storage.service.js';

jest.mock('fs');
const fsMock = fs as jest.Mocked<typeof fs>;

const BASE = path.resolve('storage', 'recordings');

describe('MediaFilesService (REC-006)', () => {
  let service: MediaFilesService;
  let repoMock: any;
  let qbMock: any;

  const baseRow = (over: any = {}) => ({
    id: 'f1',
    fileCode: null,
    fileName: 'f1.mp4',
    fileType: 'video',
    mimeType: 'video/mp4',
    storageProvider: 'local',
    storageBucket: null,
    storageKey: path.join(BASE, 'f1.mp4'),
    fileSizeBytes: '1048576',
    durationSeconds: 81,
    checksum: 'sha-x',
    versionNo: 1,
    visibilityLevel: 'internal',
    isActive: true,
    relatedEntityType: null,
    relatedEntityId: null,
    recordingSessionId: 'sess-1',
    channelUserId: null,
    uploadedAt: new Date('2026-06-16T10:00:00Z'),
    metadataJson: { probe: { durationSeconds: 81, source: 'ffprobe' } },
    ...over,
  });

  let storageServiceMock: any;

  beforeEach(async () => {
    qbMock = {
      where: jest.fn().mockReturnThis(),
      andWhere: jest.fn().mockReturnThis(),
      orderBy: jest.fn().mockReturnThis(),
      skip: jest.fn().mockReturnThis(),
      take: jest.fn().mockReturnThis(),
      getManyAndCount: jest.fn(),
    };
    repoMock = {
      createQueryBuilder: jest.fn().mockReturnValue(qbMock),
      findOne: jest.fn(),
      update: jest.fn().mockResolvedValue(undefined),
      softDelete: jest.fn().mockResolvedValue(undefined),
    };
    fsMock.realpathSync.mockReturnValue(BASE);
    fsMock.existsSync.mockReturnValue(true);
    fsMock.statSync.mockReturnValue({ size: 1048576 } as any);

    storageServiceMock = {
      generateSignedDownloadToken: jest.fn().mockReturnValue({
        token: 'signed-token',
        expiresAt: '2026-06-16T10:10:00.000Z',
      }),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        MediaFilesService,
        { provide: getRepositoryToken(MediaFileEntity), useValue: repoMock },
        {
          provide: ConfigService,
          useValue: {
            get: (key: string, defaultValue?: unknown) => {
              if (key === 'API_PUBLIC_BASE_URL') return 'http://localhost:3000';
              if (key === 'MEDIA_DOWNLOAD_TOKEN_TTL_SECONDS') return 600;
              return defaultValue ?? 'storage/recordings';
            },
          },
        },
        { provide: StorageService, useValue: storageServiceMock },
      ],
    }).compile();
    service = module.get(MediaFilesService);
  });

  afterEach(() => jest.clearAllMocks());

  // ─── LIST ───
  it('list: filter deleted (WHERE) + paginate + meta', async () => {
    qbMock.getManyAndCount.mockResolvedValue([
      [baseRow(), baseRow({ id: 'f2' })],
      5,
    ]);
    const r = await service.list('m1', { page: 2, limit: 2 });
    expect(qbMock.where).toHaveBeenCalledWith('m.meetingId = :meetingId', {
      meetingId: 'm1',
    });
    expect(qbMock.andWhere).toHaveBeenCalledWith('m.deletedAt IS NULL');
    expect(qbMock.skip).toHaveBeenCalledWith(2); // (2-1)*2
    expect(qbMock.take).toHaveBeenCalledWith(2);
    expect(r.items).toHaveLength(2);
    expect(r.meta).toEqual({ page: 2, limit: 2, total: 5, totalPages: 3 });
    // summary chỉ field gọn
    expect(r.items[0]).toHaveProperty('fileSizeBytes', '1048576');
    expect(r.items[0]).not.toHaveProperty('checksum');
    // recordingSessionId/channelUserId cần thiết để FE lọc theo session và
    // biết ai đã upload track nào (channel_zone progress UI).
    expect(r.items[0]).toHaveProperty('recordingSessionId', 'sess-1');
    expect(r.items[0]).toHaveProperty('channelUserId', null);
  });

  it('list: channelUserId trả đúng khi track thuộc về 1 participant cụ thể', async () => {
    qbMock.getManyAndCount.mockResolvedValue([
      [baseRow({ channelUserId: 'user-a' })],
      1,
    ]);
    const r = await service.list('m1', {});
    expect(r.items[0].channelUserId).toBe('user-a');
  });

  it('list: fileType csv → IN', async () => {
    qbMock.getManyAndCount.mockResolvedValue([[], 0]);
    await service.list('m1', { fileType: 'video, audio' });
    expect(qbMock.andWhere).toHaveBeenCalledWith('m.fileType IN (:...types)', {
      types: ['video', 'audio'],
    });
  });

  it('list: default page/limit + clamp limit ≤100', async () => {
    qbMock.getManyAndCount.mockResolvedValue([[], 0]);
    const r = await service.list('m1', { limit: 999 });
    expect(qbMock.take).toHaveBeenCalledWith(100);
    expect(r.meta.page).toBe(1);
  });

  // ─── DETAIL ───
  it('detail: full + metadataJson.probe', async () => {
    repoMock.findOne.mockResolvedValue(baseRow());
    const r = await service.detail('f1');
    expect(r.checksum).toBe('sha-x');
    expect(r.recordingSessionId).toBe('sess-1');
    expect((r.metadataJson as any).probe.source).toBe('ffprobe');
  });

  it('detail: 404 nếu thiếu/đã xóa', async () => {
    repoMock.findOne.mockResolvedValue(null);
    await expect(service.detail('f1')).rejects.toThrow(NotFoundException);
  });

  it('detail: local storage → downloadUrl chứa signed token (UC-140)', async () => {
    repoMock.findOne.mockResolvedValue(baseRow({ storageProvider: 'local' }));
    const r = await service.detail('f1');
    expect(storageServiceMock.generateSignedDownloadToken).toHaveBeenCalledWith(
      'f1',
      600,
    );
    expect(r.downloadUrl).toContain('/media-files/f1/secure-download?token=');
  });

  it('detail: cloud_provider storage → downloadUrl = fileUrl công khai', async () => {
    repoMock.findOne.mockResolvedValue(
      baseRow({ storageProvider: 'cloud_provider', fileUrl: 'https://cdn/x.pdf' }),
    );
    const r = await service.detail('f1');
    expect(r.downloadUrl).toBe('https://cdn/x.pdf');
    expect(storageServiceMock.generateSignedDownloadToken).not.toHaveBeenCalled();
  });

  it('detail: signed token generation lỗi → downloadUrl null, không throw', async () => {
    storageServiceMock.generateSignedDownloadToken.mockImplementation(() => {
      throw new Error('boom');
    });
    repoMock.findOne.mockResolvedValue(baseRow({ storageProvider: 'local' }));
    const r = await service.detail('f1');
    expect(r.downloadUrl).toBeNull();
  });

  // ─── PLAYBACK resolve ───
  it('resolvePlayback: ok → path/size/mime', async () => {
    repoMock.findOne.mockResolvedValue(baseRow());
    const r = await service.resolvePlayback('f1');
    expect(r.path).toBe(path.join(BASE, 'f1.mp4'));
    expect(r.size).toBe(1048576);
    expect(r.mimeType).toBe('video/mp4');
  });

  it('resolvePlayback: 404 non-local', async () => {
    repoMock.findOne.mockResolvedValue(baseRow({ storageProvider: 's3' }));
    await expect(service.resolvePlayback('f1')).rejects.toThrow(
      NotFoundException,
    );
    expect(fsMock.existsSync).not.toHaveBeenCalled();
  });

  it('resolvePlayback: 404 storage_key null', async () => {
    repoMock.findOne.mockResolvedValue(baseRow({ storageKey: null }));
    await expect(service.resolvePlayback('f1')).rejects.toThrow(
      NotFoundException,
    );
  });

  it('resolvePlayback: SEC path traversal → 404, KHÔNG đọc file', async () => {
    repoMock.findOne.mockResolvedValue(
      baseRow({ storageKey: path.join(BASE, '..', '..', 'etc', 'passwd') }),
    );
    await expect(service.resolvePlayback('f1')).rejects.toThrow(
      NotFoundException,
    );
    expect(fsMock.existsSync).not.toHaveBeenCalled();
    expect(fsMock.statSync).not.toHaveBeenCalled();
  });

  it('resolvePlayback: 404 file mất trên đĩa', async () => {
    repoMock.findOne.mockResolvedValue(baseRow());
    fsMock.existsSync.mockReturnValue(false);
    await expect(service.resolvePlayback('f1')).rejects.toThrow(
      NotFoundException,
    );
  });

  // ─── VISIBILITY ───
  it('visibility hide → is_active=false', async () => {
    repoMock.findOne.mockResolvedValue(baseRow());
    const r = await service.setVisibility('f1', { action: 'hide' });
    expect(repoMock.update).toHaveBeenCalledWith('f1', { isActive: false });
    expect(r.isActive).toBe(false);
  });

  it('visibility soft_delete → softDelete', async () => {
    repoMock.findOne.mockResolvedValue(baseRow());
    await service.setVisibility('f1', { action: 'soft_delete' });
    expect(repoMock.softDelete).toHaveBeenCalledWith('f1');
  });

  it('visibility 404 (đã xóa → idempotent)', async () => {
    repoMock.findOne.mockResolvedValue(null);
    await expect(
      service.setVisibility('f1', { action: 'soft_delete' }),
    ).rejects.toThrow(NotFoundException);
  });
});
