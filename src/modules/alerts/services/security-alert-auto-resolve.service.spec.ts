/* eslint-disable @typescript-eslint/no-unsafe-member-access, @typescript-eslint/no-unsafe-assignment, @typescript-eslint/no-unsafe-call */
import { Test, TestingModule } from '@nestjs/testing';
import { DataSource } from 'typeorm';
import { SecurityAlertAutoResolveService } from './security-alert-auto-resolve.service.js';
import { SecurityAlertConfigService } from './security-alert-config.service.js';

// Shape helpers: UPDATE…RETURNING → [rows,count]; SELECT/INSERT → rows.
const ret = (rows: any[]) => [rows, rows.length];

describe('SecurityAlertAutoResolveService (ASC-001 auto-resolve timeout)', () => {
  let service: SecurityAlertAutoResolveService;
  let dsMock: any;
  let configMock: any;

  const build = async () => {
    dsMock = { manager: { query: jest.fn() } };
    configMock = { getTimeoutMinutes: jest.fn().mockResolvedValue(15) };
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        SecurityAlertAutoResolveService,
        { provide: DataSource, useValue: dsMock },
        { provide: SecurityAlertConfigService, useValue: configMock },
      ],
    }).compile();
    service = module.get(SecurityAlertAutoResolveService);
  };

  beforeEach(async () => {
    await build();
  });

  it('alert không tái phát 15+ phút → resolved (count từ RETURNING)', async () => {
    dsMock.manager.query.mockResolvedValueOnce(
      ret([{ id: 'a1' }, { id: 'a2' }]),
    );
    const r = await service.autoResolveExpired();
    expect(r).toEqual({ scanned: 2, resolved: 2 });
  });

  it('không có alert quá hạn → scanned=0 resolved=0', async () => {
    dsMock.manager.query.mockResolvedValueOnce(ret([]));
    const r = await service.autoResolveExpired();
    expect(r).toEqual({ scanned: 0, resolved: 0 });
  });

  it('dùng đúng ngưỡng N phút đọc từ SecurityAlertConfigService (không hardcode)', async () => {
    configMock.getTimeoutMinutes.mockResolvedValue(30);
    dsMock.manager.query.mockResolvedValueOnce(ret([]));
    await service.autoResolveExpired();
    expect(configMock.getTimeoutMinutes).toHaveBeenCalledTimes(1);
    const params = dsMock.manager.query.mock.calls[0][1];
    expect(params).toEqual([30]);
  });

  it('query lọc status <> resolved và dùng COALESCE(last_seen_at, triggered_at) — KHÔNG dùng updated_at', async () => {
    dsMock.manager.query.mockResolvedValueOnce(ret([]));
    await service.autoResolveExpired();
    const sql = dsMock.manager.query.mock.calls[0][0];
    expect(sql).toContain("status <> 'resolved'");
    expect(sql).toContain('COALESCE(last_seen_at, triggered_at)');
    expect(sql).not.toContain('updated_at');
    expect(sql).toContain("status = 'resolved'");
    expect(sql).toContain('resolution_note');
  });
});
