/* eslint-disable @typescript-eslint/no-unsafe-member-access, @typescript-eslint/no-unsafe-assignment, @typescript-eslint/no-unsafe-call */
import { Test, TestingModule } from '@nestjs/testing';
import { DataSource } from 'typeorm';
import { ConfigService } from '@nestjs/config';
import { NoShowDetectionService } from './no-show-detection.service.js';
import { NoShowService } from './no-show.service.js';

describe('NoShowDetectionService (NSC-001)', () => {
  let service: NoShowDetectionService;
  let dsMock: any;
  let configMock: any;
  let noShowServiceMock: any;
  let configRows: any[];
  let candidateRows: any[];

  beforeEach(async () => {
    configRows = [{ config_value: '10' }];
    candidateRows = [
      { booking_id: 'bk-1', meeting_id: 'mt-1', room_id: 'rm-1' },
      { booking_id: 'bk-2', meeting_id: 'mt-2', room_id: 'rm-2' },
    ];
    dsMock = {
      manager: {
        query: jest.fn().mockImplementation((sql: string) => {
          if (sql.includes('system_configs'))
            return Promise.resolve(configRows);
          if (sql.includes('FROM room_bookings'))
            return Promise.resolve(candidateRows);
          return Promise.resolve([]);
        }),
      },
    };
    configMock = { get: jest.fn().mockReturnValue(15) };
    noShowServiceMock = {
      create: jest.fn().mockResolvedValue({ case: { id: 'x' }, created: true }),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        NoShowDetectionService,
        { provide: DataSource, useValue: dsMock },
        { provide: ConfigService, useValue: configMock },
        { provide: NoShowService, useValue: noShowServiceMock },
      ],
    }).compile();
    service = module.get(NoShowDetectionService);
  });

  afterEach(() => jest.clearAllMocks());

  it('threshold từ system_configs (10) → candidate query bind 10; create mỗi candidate', async () => {
    const r = await service.detect();
    expect(r.scanned).toBe(2);
    expect(r.created).toBe(2);
    expect(noShowServiceMock.create).toHaveBeenCalledTimes(2);
    // candidate query bind threshold = 10 (param $1)
    const candCall = dsMock.manager.query.mock.calls.find((c: any[]) =>
      String(c[0]).includes('FROM room_bookings'),
    );
    expect(candCall[1]).toEqual([10]);
    // create detectionStatus='risk' + evidence threshold
    const arg = noShowServiceMock.create.mock.calls[0][0];
    expect(arg.detectionStatus).toBe('risk');
    expect(arg.evidenceJson.threshold).toBe(10);
  });

  it('threshold default từ env khi system_configs trống', async () => {
    configRows = [];
    await service.detect();
    expect(configMock.get).toHaveBeenCalledWith(
      'NO_SHOW_THRESHOLD_MINUTES',
      15,
    );
    const candCall = dsMock.manager.query.mock.calls.find((c: any[]) =>
      String(c[0]).includes('FROM room_bookings'),
    );
    expect(candCall[1]).toEqual([15]);
  });

  it('threshold config_value không hợp lệ → fallback env', async () => {
    configRows = [{ config_value: 'abc' }];
    await service.detect();
    expect(configMock.get).toHaveBeenCalledWith(
      'NO_SHOW_THRESHOLD_MINUTES',
      15,
    );
    const candCall = dsMock.manager.query.mock.calls.find((c: any[]) =>
      String(c[0]).includes('FROM room_bookings'),
    );
    expect(candCall[1]).toEqual([15]);
  });

  it('threshold config_value null → fallback env', async () => {
    configRows = [{ config_value: null }];
    await service.detect();
    const candCall = dsMock.manager.query.mock.calls.find((c: any[]) =>
      String(c[0]).includes('FROM room_bookings'),
    );
    expect(candCall[1]).toEqual([15]);
  });

  it('threshold config_value <= 0 → fallback env', async () => {
    configRows = [{ config_value: '0' }];
    await service.detect();
    const candCall = dsMock.manager.query.mock.calls.find((c: any[]) =>
      String(c[0]).includes('FROM room_bookings'),
    );
    expect(candCall[1]).toEqual([15]);
  });

  it('system_configs query lỗi → catch → fallback env (không throw)', async () => {
    dsMock.manager.query.mockImplementation((sql: string) => {
      if (sql.includes('system_configs'))
        return Promise.reject(new Error('db down'));
      if (sql.includes('FROM room_bookings'))
        return Promise.resolve(candidateRows);
      return Promise.resolve([]);
    });
    const r = await service.detect();
    expect(r.scanned).toBe(2);
    const candCall = dsMock.manager.query.mock.calls.find((c: any[]) =>
      String(c[0]).includes('FROM room_bookings'),
    );
    expect(candCall[1]).toEqual([15]);
  });

  it('candidate query: LEFT JOIN usage + NOT EXISTS + bind interval (SEC-03)', async () => {
    await service.detect();
    const sql = String(
      dsMock.manager.query.mock.calls.find((c: any[]) =>
        String(c[0]).includes('FROM room_bookings'),
      )[0],
    );
    expect(sql).toContain('LEFT JOIN room_booking_usages');
    expect(sql).toContain('u.first_presence_at IS NULL');
    expect(sql).toContain('NOT EXISTS');
    expect(sql).toContain("$1::int * interval '1 minute'");
  });

  it('candidate đã có case (create created=false) → scanned tăng, created=0', async () => {
    noShowServiceMock.create.mockResolvedValue({
      case: { id: 'z' },
      created: false,
    });
    const r = await service.detect();
    expect(r.scanned).toBe(2);
    expect(r.created).toBe(0);
  });

  it('isolation: create reject non-Error → catch (unknown), batch vẫn tiếp', async () => {
    noShowServiceMock.create.mockRejectedValue('weird-non-error');
    const r = await service.detect();
    expect(r.scanned).toBe(2);
    expect(r.created).toBe(0);
  });

  it('isolation: create ném lỗi 1 booking → booking khác vẫn xử lý', async () => {
    noShowServiceMock.create
      .mockRejectedValueOnce(new Error('boom'))
      .mockResolvedValueOnce({ case: { id: 'y' }, created: true });
    const r = await service.detect();
    expect(noShowServiceMock.create).toHaveBeenCalledTimes(2);
    expect(r.created).toBe(1); // chỉ booking thứ 2 thành công
  });
});
