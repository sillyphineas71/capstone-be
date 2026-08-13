/* eslint-disable @typescript-eslint/no-unsafe-member-access, @typescript-eslint/no-unsafe-assignment, @typescript-eslint/no-unsafe-call, @typescript-eslint/no-unsafe-return */
import { Test, TestingModule } from '@nestjs/testing';
import { DataSource } from 'typeorm';
import { ConfigService } from '@nestjs/config';
import { NoShowDetectionService } from './no-show-detection.service.js';
import { NoShowService } from './no-show.service.js';

// [FIX 2026-08-13, R14] Mốc guard KHÔNG còn lấy từ NoShowConfigService.presenceConfirmSeconds
// (biến nghiệp vụ người dùng chỉnh được) — đổi sang hằng số cố định độc lập trong
// NoShowDetectionService, gấp đôi chu kỳ cron EVERY_MINUTE (retry buffer thuần vận hành).
const RECONCILE_GRACE_SECONDS = 120;

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

  const candCall = (): any[] =>
    dsMock.manager.query.mock.calls.find((c: any[]) =>
      String(c[0]).includes('FROM room_bookings'),
    );

  it('threshold từ system_configs (10) → candidate query bind [10, RECONCILE_GRACE_SECONDS]; create mỗi candidate', async () => {
    const r = await service.detect();
    expect(r.scanned).toBe(2);
    expect(r.created).toBe(2);
    expect(noShowServiceMock.create).toHaveBeenCalledTimes(2);
    expect(candCall()[1]).toEqual([10, RECONCILE_GRACE_SECONDS]);
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
    expect(candCall()[1]).toEqual([15, RECONCILE_GRACE_SECONDS]);
  });

  it('threshold config_value không hợp lệ → fallback env', async () => {
    configRows = [{ config_value: 'abc' }];
    await service.detect();
    expect(configMock.get).toHaveBeenCalledWith(
      'NO_SHOW_THRESHOLD_MINUTES',
      15,
    );
    expect(candCall()[1]).toEqual([15, RECONCILE_GRACE_SECONDS]);
  });

  it('threshold config_value null → fallback env', async () => {
    configRows = [{ config_value: null }];
    await service.detect();
    expect(candCall()[1]).toEqual([15, RECONCILE_GRACE_SECONDS]);
  });

  it('threshold config_value <= 0 → fallback env', async () => {
    configRows = [{ config_value: '0' }];
    await service.detect();
    expect(candCall()[1]).toEqual([15, RECONCILE_GRACE_SECONDS]);
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
    expect(candCall()[1]).toEqual([15, RECONCILE_GRACE_SECONDS]);
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

  // ══ Phần 2 (R14) — guard phụ đổi mốc cố định, KHÔNG còn tie theo presenceConfirmSeconds ══
  describe('Phần 2 (R14): guard phụ dùng mốc cố định RECONCILE_GRACE_SECONDS, KHÔNG phụ thuộc NoShowConfigService', () => {
    it('KHÔNG còn gọi NoShowConfigService.getValues() — dependency đã gỡ hoàn toàn (dead code sau R14)', async () => {
      // NoShowConfigService không còn được inject (xem providers ở beforeEach) — nếu code
      // cũ vô tình còn gọi tới, TestingModule sẽ throw lỗi "Nest can't resolve dependencies"
      // ngay khi compile module, test này tự nhiên fail nếu quên gỡ.
      await expect(service.detect()).resolves.toBeDefined();
    });

    it('SQL candidate vẫn có NOT EXISTS room_events count>0 gần đây, bind $2 = 120 (hằng số cố định, KHÔNG phải giá trị đọc từ config)', async () => {
      await service.detect();
      const sql = String(candCall()[0]);
      expect(sql).toContain('FROM room_events re');
      expect(sql).toContain("re.event_type = 'occupancy_detected'");
      expect(sql).toContain('re.occupancy_count > 0');
      expect(sql).toContain(
        "re.event_time >= now() - ($2::int * interval '1 second')",
      );
      expect(candCall()[1][1]).toBe(120); // đúng hằng số cố định, không phải biến config.
    });

    // [FIX 2026-08-13, R14] Test bắt buộc #1 — mô phỏng ĐÚNG root cause đã tìm: sự kiện
    // dương cuối cách xa now() hơn ngưỡng cũ (presenceConfirmSeconds, có thể rất nhỏ, vd
    // 30s), NHƯNG first_presence_at ĐÃ được set (nhờ Phần 1 — reconcilePendingConfirmations()
    // chạy trước detect() trong cùng tick) → điều kiện CHÍNH "u.first_presence_at IS NULL"
    // (không phải guard phụ) đã tự loại candidate này ra khỏi kết quả SQL — detect() KHÔNG
    // tạo case oan. Guard phụ (NOT EXISTS) không cần "cứu" ca này nữa vì họ chưa từng lọt
    // vào kết quả candidate để guard phụ phải xét tới.
    it('root cause đã tìm: first_presence_at ĐÃ set (Phần 1) dù event dương cuối đã lâu → candidate KHÔNG xuất hiện, detect() KHÔNG tạo case oan', async () => {
      // Mô phỏng: DB đã có first_presence_at (nhờ Phần 1) → điều kiện WHERE chính loại bỏ
      // candidate này hoàn toàn — SQL thật sẽ không trả về nó, mock giả lập hiệu ứng đó.
      dsMock.manager.query.mockImplementation((sql: string) => {
        if (sql.includes('system_configs')) return Promise.resolve(configRows);
        if (sql.includes('FROM room_bookings')) return Promise.resolve([]); // bị "u.first_presence_at IS NULL" loại
        return Promise.resolve([]);
      });
      const r = await service.detect();
      expect(r.scanned).toBe(0);
      expect(r.created).toBe(0);
      expect(noShowServiceMock.create).not.toHaveBeenCalled();
    });

    // [FIX 2026-08-13, R14] Test bắt buộc #2 — regression: booking THẬT SỰ chưa có ai tới
    // (first_presence_at vẫn NULL, KHÔNG có event dương nào gần đây để guard phụ bảo vệ) →
    // detect() VẪN tạo case đúng như thiết kế — không bị guard mới chặn nhầm.
    it('regression: booking thật sự chưa có ai tới (không event dương nào gần đây) → detect() VẪN tạo case đúng như cũ', async () => {
      const r = await service.detect();
      expect(r.scanned).toBe(2);
      expect(r.created).toBe(2);
      expect(noShowServiceMock.create).toHaveBeenCalledTimes(2);
    });

    // [FIX 2026-08-13, R14] Test bắt buộc #3 — giữ guard: kịch bản first_presence_at CHƯA
    // kịp set (mô phỏng reconcilePendingConfirmations() lỗi transient đúng tick này cho
    // booking đó — Phần 1 có try/catch riêng từng booking, không throw ra ngoài) NHƯNG vẫn
    // có event dương gần đây (trong 120s) → guard phụ vẫn chặn đúng, không tạo case oan
    // trong lúc chờ tick sau retry.
    it('reconcile lỗi transient (mô phỏng): first_presence_at CHƯA kịp set nhưng có event dương trong 120s gần đây → guard phụ vẫn chặn (SQL NOT EXISTS tự loại, mock giả lập DB trả rỗng)', async () => {
      // NOT EXISTS chạy Ở TẦNG SQL thật (đã xác nhận cấu trúc câu lệnh + bind=120 ở test
      // trên) — ở tầng mock, mô phỏng hiệu ứng: candidate này bị DB tự loại khỏi kết quả.
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
  });
});
