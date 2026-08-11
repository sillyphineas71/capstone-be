/* eslint-disable @typescript-eslint/no-unsafe-member-access, @typescript-eslint/no-unsafe-assignment, @typescript-eslint/no-unsafe-call, @typescript-eslint/no-unsafe-return */
import { Test, TestingModule } from '@nestjs/testing';
import { DataSource } from 'typeorm';
import { ConfigService } from '@nestjs/config';
import { NoShowDetectionService } from './no-show-detection.service.js';
import { NoShowService } from './no-show.service.js';
import { NoShowConfigService } from './no-show-config.service.js';

const PRESENCE_CONFIRM_SECONDS = 30;

describe('NoShowDetectionService (NSC-001)', () => {
  let service: NoShowDetectionService;
  let dsMock: any;
  let configMock: any;
  let noShowServiceMock: any;
  let noShowConfigMock: any;
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
    noShowConfigMock = {
      getValues: jest.fn().mockResolvedValue({
        thresholdMinutes: 15,
        warningGraceMinutes: 0,
        autoReleaseGraceMinutes: 5,
        presenceConfirmSeconds: PRESENCE_CONFIRM_SECONDS,
        presenceNoiseToleranceSeconds: 3,
        autoReleaseEnabled: true,
      }),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        NoShowDetectionService,
        { provide: DataSource, useValue: dsMock },
        { provide: ConfigService, useValue: configMock },
        { provide: NoShowService, useValue: noShowServiceMock },
        { provide: NoShowConfigService, useValue: noShowConfigMock },
      ],
    }).compile();
    service = module.get(NoShowDetectionService);
  });

  afterEach(() => jest.clearAllMocks());

  const candCall = (): any[] =>
    dsMock.manager.query.mock.calls.find((c: any[]) =>
      String(c[0]).includes('FROM room_bookings'),
    );

  it('threshold từ system_configs (10) → candidate query bind [10, presenceConfirmSeconds]; create mỗi candidate', async () => {
    const r = await service.detect();
    expect(r.scanned).toBe(2);
    expect(r.created).toBe(2);
    expect(noShowServiceMock.create).toHaveBeenCalledTimes(2);
    expect(candCall()[1]).toEqual([10, PRESENCE_CONFIRM_SECONDS]);
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
    expect(candCall()[1]).toEqual([15, PRESENCE_CONFIRM_SECONDS]);
  });

  it('threshold config_value không hợp lệ → fallback env', async () => {
    configRows = [{ config_value: 'abc' }];
    await service.detect();
    expect(configMock.get).toHaveBeenCalledWith(
      'NO_SHOW_THRESHOLD_MINUTES',
      15,
    );
    expect(candCall()[1]).toEqual([15, PRESENCE_CONFIRM_SECONDS]);
  });

  it('threshold config_value null → fallback env', async () => {
    configRows = [{ config_value: null }];
    await service.detect();
    expect(candCall()[1]).toEqual([15, PRESENCE_CONFIRM_SECONDS]);
  });

  it('threshold config_value <= 0 → fallback env', async () => {
    configRows = [{ config_value: '0' }];
    await service.detect();
    expect(candCall()[1]).toEqual([15, PRESENCE_CONFIRM_SECONDS]);
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
    expect(candCall()[1]).toEqual([15, PRESENCE_CONFIRM_SECONDS]);
  });

  it('candidate query: LEFT JOIN usage + NOT EXISTS + bind interval (SEC-03)', async () => {
    await service.detect();
    const sql = String(candCall()[0]);
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

  // ══ Phần 4 (R11) — false-positive tại ranh giới threshold ══════════════════════
  describe('Phần 4: loại trừ event count>0 vừa tới trong presenceConfirmSeconds giây', () => {
    it('đọc presenceConfirmSeconds qua NoShowConfigService.getValues() đúng 1 lần/đợt (NC-2)', async () => {
      await service.detect();
      expect(noShowConfigMock.getValues).toHaveBeenCalledTimes(1);
    });

    it('SQL candidate có thêm NOT EXISTS room_events count>0 trong vòng presenceConfirmSeconds giây, bind $2', async () => {
      await service.detect();
      const sql = String(candCall()[0]);
      expect(sql).toContain('FROM room_events re');
      expect(sql).toContain("re.event_type = 'occupancy_detected'");
      expect(sql).toContain('re.occupancy_count > 0');
      expect(sql).toContain(
        "re.event_time >= now() - ($2::int * interval '1 second')",
      );
      expect(candCall()[1][1]).toBe(PRESENCE_CONFIRM_SECONDS);
    });

    it('event count>0 vừa tới trong vòng presenceConfirmSeconds giây → detect() KHÔNG tạo case (SQL NOT EXISTS tự loại candidate, mock giả lập DB trả rỗng)', async () => {
      // NOT EXISTS chạy Ở TẦNG SQL thật (đã xác nhận cấu trúc câu lệnh ở test trên) —
      // ở tầng mock, mô phỏng hiệu ứng: candidate này bị DB tự loại khỏi kết quả trả về.
      dsMock.manager.query.mockImplementation((sql: string) => {
        if (sql.includes('system_configs')) return Promise.resolve(configRows);
        if (sql.includes('FROM room_bookings')) return Promise.resolve([]); // rỗng — bị NOT EXISTS loại
        return Promise.resolve([]);
      });
      const r = await service.detect();
      expect(r.scanned).toBe(0);
      expect(r.created).toBe(0);
      expect(noShowServiceMock.create).not.toHaveBeenCalled();
    });

    it('event count>0 đã lâu hơn presenceConfirmSeconds giây → detect() tạo case bình thường như cũ (SQL trả candidate, NOT EXISTS không loại)', async () => {
      // Event cũ hơn ngưỡng → NOT EXISTS đúng nghĩa TRUE (không có event mới nào) → DB
      // vẫn trả candidate như luồng cũ, không bị loại — mock giữ nguyên candidateRows mặc định.
      const r = await service.detect();
      expect(r.scanned).toBe(2);
      expect(r.created).toBe(2);
      expect(noShowServiceMock.create).toHaveBeenCalledTimes(2);
    });
  });
});
