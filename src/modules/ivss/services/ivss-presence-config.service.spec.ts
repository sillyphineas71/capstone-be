/* eslint-disable @typescript-eslint/no-unsafe-member-access, @typescript-eslint/no-unsafe-assignment, @typescript-eslint/no-unsafe-call, @typescript-eslint/no-unsafe-return */
import { Test, TestingModule } from '@nestjs/testing';
import { DataSource } from 'typeorm';
import { ConfigService } from '@nestjs/config';
import { BadRequestException } from '@nestjs/common';
import { IvssPresenceConfigService } from './ivss-presence-config.service.js';
import { AuditLogsService } from '../../administration/services/audit-logs.service.js';

describe('IvssPresenceConfigService (Phần B, Case 5)', () => {
  let service: IvssPresenceConfigService;
  let repoMock: any;
  let dsMock: any;
  let cfg: Record<string, unknown>;
  let auditMock: any;

  const build = async () => {
    repoMock = {
      findOne: jest.fn().mockResolvedValue(null),
      save: jest.fn((x: any) => Promise.resolve(x)),
      create: jest.fn((x: any) => x),
    };
    dsMock = { getRepository: jest.fn(() => repoMock) };
    auditMock = { logAction: jest.fn().mockResolvedValue(undefined) };
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        IvssPresenceConfigService,
        { provide: DataSource, useValue: dsMock },
        {
          provide: ConfigService,
          useValue: { get: (k: string, d?: unknown) => cfg[k] ?? d },
        },
        { provide: AuditLogsService, useValue: auditMock },
      ],
    }).compile();
    service = module.get(IvssPresenceConfigService);
  };

  beforeEach(async () => {
    cfg = {};
    await build();
  });

  // ── getEffectiveValue precedence ──
  it('source=system_configs khi có row hợp lệ (số thực)', async () => {
    repoMock.findOne.mockResolvedValue({ configValue: '0.85' });
    const r = await service.getEffectiveValue('minSimilarityThreshold');
    expect(r).toEqual({ value: 0.85, source: 'system_configs' });
  });

  it('source=env khi không có row nhưng env hợp lệ', async () => {
    repoMock.findOne.mockResolvedValue(null);
    cfg = { IVSS_MIN_SIMILARITY_THRESHOLD: '0.6' };
    const r = await service.getEffectiveValue('minSimilarityThreshold');
    expect(r).toEqual({ value: 0.6, source: 'env' });
  });

  it('source=default (0.7) khi không row + không env', async () => {
    repoMock.findOne.mockResolvedValue(null);
    const r = await service.getEffectiveValue('minSimilarityThreshold');
    expect(r).toEqual({ value: 0.7, source: 'default' });
  });

  it('row value > max(1) → bỏ qua, fallback default', async () => {
    repoMock.findOne.mockResolvedValue({ configValue: '1.5' });
    const r = await service.getEffectiveValue('minSimilarityThreshold');
    expect(r).toEqual({ value: 0.7, source: 'default' });
  });

  it('row value < min(0) → bỏ qua, fallback default', async () => {
    repoMock.findOne.mockResolvedValue({ configValue: '-0.1' });
    const r = await service.getEffectiveValue('minSimilarityThreshold');
    expect(r).toEqual({ value: 0.7, source: 'default' });
  });

  it('getValues() trả gọn number', async () => {
    repoMock.findOne.mockResolvedValue({ configValue: '0.9' });
    const v = await service.getValues();
    expect(v).toEqual({ minSimilarityThreshold: 0.9 });
  });

  it('getAll() trả đúng 1 key + source', async () => {
    repoMock.findOne.mockResolvedValue(null);
    const all = await service.getAll();
    expect(Object.keys(all)).toEqual(['minSimilarityThreshold']);
    expect(all.minSimilarityThreshold).toEqual({
      value: 0.7,
      source: 'default',
    });
  });

  // ── update upsert ──
  it('update: key chưa có → create version_no=1, configGroup=ivss_presence (TÁCH RIÊNG no_show)', async () => {
    repoMock.findOne.mockResolvedValue(null);
    await service.update({ minSimilarityThreshold: 0.8 }, 'admin1');
    expect(repoMock.create).toHaveBeenCalledWith(
      expect.objectContaining({
        configKey: 'ivss.min_similarity_threshold',
        configValue: '0.8',
        valueType: 'number',
        configGroup: 'ivss_presence',
        versionNo: 1,
        isSensitive: false,
        updatedBy: 'admin1',
      }),
    );
    expect(auditMock.logAction).toHaveBeenCalledTimes(1);
    expect(auditMock.logAction.mock.calls[0][0]).toMatchObject({
      actionType: 'ivss_presence_config_update',
    });
  });

  it('update: key đã có → version_no++ + updatedBy', async () => {
    repoMock.findOne.mockResolvedValue({
      configKey: 'ivss.min_similarity_threshold',
      configValue: '0.7',
      versionNo: 2,
    });
    await service.update({ minSimilarityThreshold: 0.6 }, 'admin1');
    const saved = repoMock.save.mock.calls[0][0];
    expect(saved.configValue).toBe('0.6');
    expect(saved.versionNo).toBe(3);
    expect(saved.updatedBy).toBe('admin1');
  });

  it('update: value > max(1) → BadRequestException', async () => {
    await expect(
      service.update({ minSimilarityThreshold: 1.2 }, 'admin1'),
    ).rejects.toThrow(BadRequestException);
  });

  it('update: value < min(0) → BadRequestException', async () => {
    await expect(
      service.update({ minSimilarityThreshold: -0.1 }, 'admin1'),
    ).rejects.toThrow(BadRequestException);
  });

  it('update: không field nào → BadRequestException', async () => {
    await expect(service.update({}, 'admin1')).rejects.toThrow(
      BadRequestException,
    );
  });
});
