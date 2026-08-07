/* eslint-disable @typescript-eslint/no-unsafe-member-access, @typescript-eslint/no-unsafe-assignment, @typescript-eslint/no-unsafe-call, @typescript-eslint/no-unsafe-return */
import { Test, TestingModule } from '@nestjs/testing';
import { DataSource } from 'typeorm';
import { ConfigService } from '@nestjs/config';
import { BadRequestException } from '@nestjs/common';
import { SecurityAlertConfigService } from './security-alert-config.service.js';
import { AuditLogsService } from '../../administration/services/audit-logs.service.js';

describe('SecurityAlertConfigService (ASC-001 auto-resolve timeout)', () => {
  let service: SecurityAlertConfigService;
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
        SecurityAlertConfigService,
        { provide: DataSource, useValue: dsMock },
        {
          provide: ConfigService,
          useValue: { get: (k: string, d?: unknown) => cfg[k] ?? d },
        },
        { provide: AuditLogsService, useValue: auditMock },
      ],
    }).compile();
    service = module.get(SecurityAlertConfigService);
  };

  beforeEach(async () => {
    cfg = {};
    await build();
  });

  it('source=system_configs khi có row hợp lệ', async () => {
    repoMock.findOne.mockResolvedValue({ configValue: '20' });
    const r = await service.getEffectiveTimeoutMinutes();
    expect(r).toEqual({ value: 20, source: 'system_configs' });
  });

  it('source=env khi không có row nhưng env hợp lệ', async () => {
    repoMock.findOne.mockResolvedValue(null);
    cfg = { SECURITY_ALERTS_AUTO_RESOLVE_TIMEOUT_MINUTES: 30 };
    const r = await service.getEffectiveTimeoutMinutes();
    expect(r).toEqual({ value: 30, source: 'env' });
  });

  it('source=default (15 phút) khi không row + không env', async () => {
    repoMock.findOne.mockResolvedValue(null);
    const r = await service.getEffectiveTimeoutMinutes();
    expect(r).toEqual({ value: 15, source: 'default' });
  });

  it('row value < min (1) → bỏ qua, fallback default', async () => {
    repoMock.findOne.mockResolvedValue({ configValue: '0' });
    const r = await service.getEffectiveTimeoutMinutes();
    expect(r).toEqual({ value: 15, source: 'default' });
  });

  it('getTimeoutMinutes trả gọn số phút hiệu lực', async () => {
    repoMock.findOne.mockResolvedValue({ configValue: '25' });
    const n = await service.getTimeoutMinutes();
    expect(n).toBe(25);
  });

  it('update: key chưa có → create version_no=1 + group security_alerts + value_type number', async () => {
    repoMock.findOne.mockResolvedValue(null);
    await service.update({ autoResolveTimeoutMinutes: 20 }, 'admin1');
    expect(repoMock.create).toHaveBeenCalledWith(
      expect.objectContaining({
        configKey: 'security_alerts.auto_resolve_timeout_minutes',
        configValue: '20',
        valueType: 'number',
        configGroup: 'security_alerts',
        versionNo: 1,
        isSensitive: false,
        updatedBy: 'admin1',
      }),
    );
    expect(auditMock.logAction).toHaveBeenCalledTimes(1);
  });

  it('update: key đã có → version_no++ + updatedBy', async () => {
    repoMock.findOne.mockResolvedValue({
      configKey: 'security_alerts.auto_resolve_timeout_minutes',
      configValue: '15',
      versionNo: 2,
    });
    await service.update({ autoResolveTimeoutMinutes: 30 }, 'admin1');
    const saved = repoMock.save.mock.calls[0][0];
    expect(saved.configValue).toBe('30');
    expect(saved.versionNo).toBe(3);
    expect(saved.updatedBy).toBe('admin1');
  });

  it('update: value < min → BadRequestException', async () => {
    await expect(
      service.update({ autoResolveTimeoutMinutes: 0 }, 'admin1'),
    ).rejects.toThrow(BadRequestException);
  });

  it('update: không truyền field → BadRequestException (NO_CONFIG_FIELDS)', async () => {
    await expect(service.update({}, 'admin1')).rejects.toThrow(
      BadRequestException,
    );
  });

  it('getAll trả đúng 1 key + source', async () => {
    repoMock.findOne.mockResolvedValue(null);
    const all = await service.getAll();
    expect(Object.keys(all)).toEqual(['autoResolveTimeoutMinutes']);
    expect(all.autoResolveTimeoutMinutes).toEqual({
      value: 15,
      source: 'default',
    });
  });
});
