/* eslint-disable @typescript-eslint/no-unsafe-member-access, @typescript-eslint/no-unsafe-assignment, @typescript-eslint/no-unsafe-call, @typescript-eslint/no-unsafe-return, @typescript-eslint/no-unsafe-argument, @typescript-eslint/no-explicit-any */
import { Test, TestingModule } from '@nestjs/testing';
import { DataSource } from 'typeorm';
import { ConfigService } from '@nestjs/config';
import { BadRequestException } from '@nestjs/common';
import { EarlyVacancyConfigService } from './early-vacancy-config.service.js';
import { AuditLogsService } from '../../administration/services/audit-logs.service.js';

describe('EarlyVacancyConfigService (EVD-001 #48)', () => {
  let service: EarlyVacancyConfigService;
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
        EarlyVacancyConfigService,
        { provide: DataSource, useValue: dsMock },
        {
          provide: ConfigService,
          useValue: { get: (k: string, d?: unknown) => cfg[k] ?? d },
        },
        { provide: AuditLogsService, useValue: auditMock },
      ],
    }).compile();
    service = module.get(EarlyVacancyConfigService);
  };

  beforeEach(async () => {
    cfg = {};
    await build();
  });

  it('source=system_configs khi có row hợp lệ', async () => {
    repoMock.findOne.mockResolvedValue({ configValue: '8' });
    const r = await service.getEffectiveValue('emptyMinutes');
    expect(r).toEqual({ value: 8, source: 'system_configs' });
  });

  it('source=env khi không row nhưng env hợp lệ', async () => {
    cfg = { EARLY_VACANCY_EMPTY_MINUTES: 12 };
    const r = await service.getEffectiveValue('emptyMinutes');
    expect(r).toEqual({ value: 12, source: 'env' });
  });

  it('source=default khi không row + không env', async () => {
    const r = await service.getEffectiveValue('minRemainingMinutes');
    expect(r).toEqual({ value: 15, source: 'default' });
  });

  it('row value < min → fallback default', async () => {
    repoMock.findOne.mockResolvedValue({ configValue: '0' }); // empty min=1
    const r = await service.getEffectiveValue('emptyMinutes');
    expect(r.source).toBe('default');
    expect(r.value).toBe(10);
  });

  it('update: key chưa có → create version_no=1 + group room_utilization + number', async () => {
    repoMock.findOne.mockResolvedValue(null);
    await service.update({ emptyMinutes: 8 }, 'admin1');
    expect(repoMock.create).toHaveBeenCalledWith(
      expect.objectContaining({
        configKey: 'early_vacancy.empty_minutes',
        configValue: '8',
        valueType: 'number',
        configGroup: 'room_utilization',
        versionNo: 1,
        isSensitive: false,
        updatedBy: 'admin1',
      }),
    );
    expect(auditMock.logAction).toHaveBeenCalledTimes(1);
  });

  it('update: key đã có → version_no++', async () => {
    repoMock.findOne.mockResolvedValue({
      configKey: 'early_vacancy.empty_minutes',
      configValue: '10',
      versionNo: 4,
    });
    await service.update({ emptyMinutes: 6 }, 'admin1');
    const saved = repoMock.save.mock.calls[0][0];
    expect(saved.configValue).toBe('6');
    expect(saved.versionNo).toBe(5);
  });

  it('update: value < min → BadRequest', async () => {
    await expect(service.update({ emptyMinutes: 0 }, 'admin1')).rejects.toThrow(
      BadRequestException,
    );
  });

  it('update: không field → BadRequest', async () => {
    await expect(service.update({}, 'admin1')).rejects.toThrow(
      BadRequestException,
    );
  });

  it('getValues trả 3 number', async () => {
    const v = await service.getValues();
    expect(v).toEqual({
      emptyMinutes: 10,
      minRemainingMinutes: 15,
      minElapsedMinutes: 10,
    });
  });
});
