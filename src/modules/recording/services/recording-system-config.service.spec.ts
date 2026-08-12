/* eslint-disable @typescript-eslint/no-unsafe-member-access, @typescript-eslint/no-unsafe-assignment, @typescript-eslint/no-unsafe-call, @typescript-eslint/no-unsafe-return */
import { Test, TestingModule } from '@nestjs/testing';
import { DataSource } from 'typeorm';
import { ConfigService } from '@nestjs/config';
import { RecordingSystemConfigService } from './recording-system-config.service.js';

/**
 * [FIX 2026-08-12, R9 — Lớp 2] Mirror security-alert-config.service.spec.ts — verify
 * precedence system_configs → env → default cho recording.max_duration_hours.
 */
describe('RecordingSystemConfigService (R9 max-duration)', () => {
  let service: RecordingSystemConfigService;
  let repoMock: any;
  let dsMock: any;
  let cfg: Record<string, unknown>;

  const build = async () => {
    repoMock = { findOne: jest.fn().mockResolvedValue(null) };
    dsMock = { getRepository: jest.fn(() => repoMock) };
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        RecordingSystemConfigService,
        { provide: DataSource, useValue: dsMock },
        {
          provide: ConfigService,
          useValue: { get: (k: string, d?: unknown) => cfg[k] ?? d },
        },
      ],
    }).compile();
    service = module.get(RecordingSystemConfigService);
  };

  beforeEach(async () => {
    cfg = {};
    await build();
  });

  it('source=system_configs khi có row hợp lệ', async () => {
    repoMock.findOne.mockResolvedValue({ configValue: '10' });
    const r = await service.getEffectiveMaxDurationHours();
    expect(r).toEqual({ value: 10, source: 'system_configs' });
  });

  it('source=env khi không có row nhưng env hợp lệ', async () => {
    repoMock.findOne.mockResolvedValue(null);
    cfg = { RECORDING_MAX_DURATION_HOURS: 8 };
    const r = await service.getEffectiveMaxDurationHours();
    expect(r).toEqual({ value: 8, source: 'env' });
  });

  it('source=default (6 giờ) khi không row + không env', async () => {
    repoMock.findOne.mockResolvedValue(null);
    const r = await service.getEffectiveMaxDurationHours();
    expect(r).toEqual({ value: 6, source: 'default' });
  });

  it('row value < min (1) → bỏ qua, fallback default', async () => {
    repoMock.findOne.mockResolvedValue({ configValue: '0' });
    const r = await service.getEffectiveMaxDurationHours();
    expect(r).toEqual({ value: 6, source: 'default' });
  });

  it('getMaxDurationHours() trả gọn số giờ hiệu lực (cron dùng)', async () => {
    repoMock.findOne.mockResolvedValue({ configValue: '4' });
    const n = await service.getMaxDurationHours();
    expect(n).toBe(4);
  });
});
