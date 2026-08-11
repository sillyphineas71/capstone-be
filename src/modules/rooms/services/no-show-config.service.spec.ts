/* eslint-disable @typescript-eslint/no-unsafe-member-access, @typescript-eslint/no-unsafe-assignment, @typescript-eslint/no-unsafe-call, @typescript-eslint/no-unsafe-return */
import { Test, TestingModule } from '@nestjs/testing';
import { DataSource } from 'typeorm';
import { ConfigService } from '@nestjs/config';
import { BadRequestException } from '@nestjs/common';
import { NoShowConfigService } from './no-show-config.service.js';
import { AuditLogsService } from '../../administration/services/audit-logs.service.js';

describe('NoShowConfigService (NSL-001 #35)', () => {
  let service: NoShowConfigService;
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
        NoShowConfigService,
        { provide: DataSource, useValue: dsMock },
        {
          provide: ConfigService,
          useValue: { get: (k: string, d?: unknown) => cfg[k] ?? d },
        },
        { provide: AuditLogsService, useValue: auditMock },
      ],
    }).compile();
    service = module.get(NoShowConfigService);
  };

  beforeEach(async () => {
    cfg = {};
    await build();
  });

  // ── getEffectiveValue precedence ──
  it('source=system_configs khi có row hợp lệ', async () => {
    repoMock.findOne.mockResolvedValue({ configValue: '20' });
    const r = await service.getEffectiveValue('thresholdMinutes');
    expect(r).toEqual({ value: 20, source: 'system_configs' });
  });

  it('source=env khi không có row nhưng env hợp lệ', async () => {
    repoMock.findOne.mockResolvedValue(null);
    cfg = { NO_SHOW_THRESHOLD_MINUTES: 30 };
    const r = await service.getEffectiveValue('thresholdMinutes');
    expect(r).toEqual({ value: 30, source: 'env' });
  });

  it('source=default khi không row + không env', async () => {
    repoMock.findOne.mockResolvedValue(null);
    const r = await service.getEffectiveValue('autoReleaseGraceMinutes');
    expect(r).toEqual({ value: 5, source: 'default' });
  });

  it('row value < min → bỏ qua, fallback default', async () => {
    repoMock.findOne.mockResolvedValue({ configValue: '0' }); // threshold min=1
    const r = await service.getEffectiveValue('thresholdMinutes');
    expect(r.source).toBe('default');
    expect(r.value).toBe(15);
  });

  // ── update upsert ──
  it('update: key chưa có → create version_no=1 + group no_show + value_type number', async () => {
    repoMock.findOne.mockResolvedValue(null);
    await service.update({ warningGraceMinutes: 3 }, 'admin1');
    expect(repoMock.create).toHaveBeenCalledWith(
      expect.objectContaining({
        configKey: 'no_show.warning_grace_minutes',
        configValue: '3',
        valueType: 'number',
        configGroup: 'no_show',
        versionNo: 1,
        isSensitive: false,
        updatedBy: 'admin1',
      }),
    );
    expect(auditMock.logAction).toHaveBeenCalledTimes(1);
  });

  it('update: key đã có → version_no++ + updatedBy', async () => {
    repoMock.findOne.mockResolvedValue({
      configKey: 'no_show.threshold_minutes',
      configValue: '15',
      versionNo: 2,
    });
    await service.update({ thresholdMinutes: 25 }, 'admin1');
    const saved = repoMock.save.mock.calls[0][0];
    expect(saved.configValue).toBe('25');
    expect(saved.versionNo).toBe(3);
    expect(saved.updatedBy).toBe('admin1');
  });

  it('update: value < min → BadRequestException', async () => {
    await expect(
      service.update({ thresholdMinutes: 0 }, 'admin1'),
    ).rejects.toThrow(BadRequestException);
  });

  it('update: không field nào → BadRequestException', async () => {
    await expect(service.update({}, 'admin1')).rejects.toThrow(
      BadRequestException,
    );
  });

  it('getAll trả 6 key (5 số + 1 bool) + source [FIX Phần 2: thêm presenceConfirmSeconds/presenceNoiseToleranceSeconds]', async () => {
    repoMock.findOne.mockResolvedValue(null);
    const all = await service.getAll();
    expect(Object.keys(all)).toEqual([
      'thresholdMinutes',
      'warningGraceMinutes',
      'autoReleaseGraceMinutes',
      'presenceConfirmSeconds',
      'presenceNoiseToleranceSeconds',
      'autoReleaseEnabled',
    ]);
    expect(all.warningGraceMinutes).toEqual({ value: 0, source: 'default' });
  });

  // ── Phần 2: presenceConfirmSeconds/presenceNoiseToleranceSeconds (đơn vị GIÂY) ──
  it('presenceConfirmSeconds: default=30s khi không row + không env', async () => {
    repoMock.findOne.mockResolvedValue(null);
    const r = await service.getEffectiveValue('presenceConfirmSeconds');
    expect(r).toEqual({ value: 30, source: 'default' });
  });

  it('presenceNoiseToleranceSeconds: default=3s khi không row + không env', async () => {
    repoMock.findOne.mockResolvedValue(null);
    const r = await service.getEffectiveValue('presenceNoiseToleranceSeconds');
    expect(r).toEqual({ value: 3, source: 'default' });
  });

  it('presenceNoiseToleranceSeconds: min=0 hợp lệ (khác 3 field cũ min=1)', async () => {
    repoMock.findOne.mockResolvedValue({ configValue: '0' });
    const r = await service.getEffectiveValue('presenceNoiseToleranceSeconds');
    expect(r).toEqual({ value: 0, source: 'system_configs' });
  });

  it('update: presenceConfirmSeconds → upsert key no_show.presence_confirm_seconds', async () => {
    repoMock.findOne.mockResolvedValue(null);
    await service.update({ presenceConfirmSeconds: 45 }, 'admin1');
    expect(repoMock.create).toHaveBeenCalledWith(
      expect.objectContaining({
        configKey: 'no_show.presence_confirm_seconds',
        configValue: '45',
        valueType: 'number',
        configGroup: 'no_show',
      }),
    );
  });

  it('update: presenceNoiseToleranceSeconds → upsert key no_show.presence_noise_tolerance_seconds', async () => {
    repoMock.findOne.mockResolvedValue(null);
    await service.update({ presenceNoiseToleranceSeconds: 5 }, 'admin1');
    expect(repoMock.create).toHaveBeenCalledWith(
      expect.objectContaining({
        configKey: 'no_show.presence_noise_tolerance_seconds',
        configValue: '5',
        valueType: 'number',
        configGroup: 'no_show',
      }),
    );
  });

  it('update: presenceConfirmSeconds < min(1) → BadRequestException', async () => {
    await expect(
      service.update({ presenceConfirmSeconds: 0 }, 'admin1'),
    ).rejects.toThrow(BadRequestException);
  });

  // ── autoReleaseEnabled (F1) ──
  it('autoReleaseEnabled: không row + không env → default true', async () => {
    repoMock.findOne.mockResolvedValue(null);
    const r = await service.getEffectiveBoolValue();
    expect(r).toEqual({ value: true, source: 'default' });
  });

  it('autoReleaseEnabled: row configValue="false" → source=system_configs', async () => {
    repoMock.findOne.mockResolvedValue({ configValue: 'false' });
    const r = await service.getEffectiveBoolValue();
    expect(r).toEqual({ value: false, source: 'system_configs' });
  });

  it('autoReleaseEnabled: row rỗng + env=false → source=env', async () => {
    repoMock.findOne.mockResolvedValue(null);
    cfg = { NO_SHOW_AUTO_RELEASE_ENABLED: false };
    const r = await service.getEffectiveBoolValue();
    expect(r).toEqual({ value: false, source: 'env' });
  });

  it('update: autoReleaseEnabled=false → upsert key no_show.auto_release_enabled, valueType boolean', async () => {
    repoMock.findOne.mockResolvedValue(null);
    await service.update({ autoReleaseEnabled: false }, 'admin1');
    expect(repoMock.create).toHaveBeenCalledWith(
      expect.objectContaining({
        configKey: 'no_show.auto_release_enabled',
        configValue: 'false',
        valueType: 'boolean',
        configGroup: 'no_show',
        versionNo: 1,
        updatedBy: 'admin1',
      }),
    );
  });

  it('update: chỉ autoReleaseEnabled (không field số nào) → KHÔNG ném NO_CONFIG_FIELDS', async () => {
    repoMock.findOne.mockResolvedValue(null);
    await expect(
      service.update({ autoReleaseEnabled: true }, 'admin1'),
    ).resolves.toBeDefined();
  });
});
