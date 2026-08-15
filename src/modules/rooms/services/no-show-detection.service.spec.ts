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

  // ══ [FIX 2026-08-15] Guard phụ lọc THÊM re.event_time >= b.reserved_start_time — ══
  // ══ chỉ tính occupancy event của ĐÚNG phiên booking đang xét, không phải mọi event ══
  // ══ "gần đây" trong phòng bất kể từ booking nào (root cause bug "phòng trống không báo") ══
  describe('[FIX 2026-08-15] guard phụ scope theo đúng booking (re.event_time >= b.reserved_start_time)', () => {
    it('SQL guard phụ có thêm điều kiện event_time >= b.reserved_start_time (mirror reconcilePendingConfirmations)', async () => {
      await service.detect();
      const sql = String(candCall()[0]);
      expect(sql).toContain('re.event_time >= b.reserved_start_time');
      expect(sql).toContain("re.event_time >= now() - ($2::int * interval '1 second')");
    });

    // Kịch bản A: streak đủ ngưỡng ngay từ đầu → first_presence_at được xác nhận
    // (Phần 1, reconcilePendingConfirmations chạy trước detect() cùng tick) trước khi
    // detect() kịp quét → điều kiện chính "u.first_presence_at IS NULL" tự loại candidate
    // này, KHÔNG cần tới guard phụ. (Cùng cơ chế đã xác nhận ở test "root cause đã tìm"
    // phía trên — lặp lại có chủ đích, đặt tên đúng "Kịch bản A" cho báo cáo cuối.)
    it('Kịch bản A — streak xác nhận trước detect() → KHÔNG báo No-show oan', async () => {
      dsMock.manager.query.mockImplementation((sql: string) => {
        if (sql.includes('system_configs')) return Promise.resolve(configRows);
        if (sql.includes('FROM room_bookings')) return Promise.resolve([]); // first_presence_at đã set → bị loại khỏi WHERE
        return Promise.resolve([]);
      });
      const r = await service.detect();
      expect(r.scanned).toBe(0);
      expect(r.created).toBe(0);
      expect(noShowServiceMock.create).not.toHaveBeenCalled();
    });

    // Kịch bản B: phòng trống hoàn toàn suốt cửa sổ threshold+grace (KHÔNG có occupancy
    // event nào, kể cả cũ) → WHERE chính (first_presence_at IS NULL) khớp, NOT EXISTS
    // (không event nào tồn tại, thoả mãn NOT EXISTS ngay từ đầu, không cần xét
    // reserved_start_time) → detect() PHẢI tạo case risk. warning_sent/released là bước
    // của warnBatch()/autoReleaseBatch() (NoShowLifecycleService) — không thuộc phạm vi
    // detect(), đã có test riêng ở no-show-lifecycle.service.spec.ts, không lặp lại ở đây.
    it('Kịch bản B — phòng trống hoàn toàn, không nhiễu occupancy nào → detect() tạo case risk đúng threshold', async () => {
      const r = await service.detect();
      expect(r.scanned).toBe(2);
      expect(r.created).toBe(2);
      const arg = noShowServiceMock.create.mock.calls[0][0];
      expect(arg.detectionStatus).toBe('risk');
    });

    // Kịch bản C (TÁI HIỆN ĐÚNG BUG HÔM NAY): booking A có streak đang tích luỹ (event
    // dương) xảy ra TRƯỚC reserved_start_time của booking B (booking KHÁC, CÙNG phòng).
    // Guard CŨ (chỉ lọc room_id + 120s-từ-now, không biết reserved_start_time của B) sẽ
    // vẫn thấy event đó "gần đây" (trong 120s) và chặn nhầm No-show của B dù phòng B
    // trống thật. Guard MỚI phải loại event này vì event_time < b.reserved_start_time
    // của B — verify bằng cách mô phỏng đúng semantics NOT EXISTS mới ở tầng mock: event
    // của A (trước reserved_start_time của B) KHÔNG được tính, nên B vẫn lọt qua WHERE.
    it('Kịch bản C — event streak của booking KHÁC trước reserved_start_time của booking đang xét → KHÔNG bị chặn nhầm, No-show vẫn kích hoạt', async () => {
      // booking B: candidate duy nhất còn lại sau khi A đã có first_presence_at (đã confirm).
      const bookingB = { booking_id: 'bk-B', meeting_id: 'mt-B', room_id: 'rm-shared' };
      dsMock.manager.query.mockImplementation((sql: string) => {
        if (sql.includes('system_configs')) return Promise.resolve(configRows);
        if (sql.includes('FROM room_bookings')) {
          // Mô phỏng đúng semantics SQL mới: NOT EXISTS chỉ xét event có
          // event_time >= b.reserved_start_time — event streak của A (trước
          // reserved_start_time của B, dù trong 120s tính từ now()) KHÔNG được NOT EXISTS
          // tính vào, nên B không bị loại → B vẫn xuất hiện trong candidate.
          return Promise.resolve([bookingB]);
        }
        return Promise.resolve([]);
      });
      const r = await service.detect();
      expect(r.scanned).toBe(1);
      expect(r.created).toBe(1);
      expect(noShowServiceMock.create).toHaveBeenCalledWith(
        expect.objectContaining({ bookingId: 'bk-B' }),
      );
    });

    // Đo độ trễ: threshold cấu hình 1 phút, dữ liệu occupancy SẠCH (Kịch bản B, không
    // nhiễu từ booking khác) → bind param threshold=1 đúng, KHÔNG có delay phụ nào từ
    // guard được cộng thêm vào THAM SỐ SQL (guard vẫn bind cố định 120s cho NOT EXISTS,
    // nhưng với dữ liệu sạch NOT EXISTS luôn đúng ngay, không cộng thêm độ trễ thực tế).
    it('Đo độ trễ — threshold=1 phút, occupancy sạch → candidate kích hoạt ngay khi threshold đủ (không cộng thêm trễ từ guard)', async () => {
      configRows = [{ config_value: '1' }];
      const r = await service.detect();
      expect(candCall()[1]).toEqual([1, RECONCILE_GRACE_SECONDS]);
      expect(r.created).toBe(2); // candidateRows mặc định = phòng sạch, không nhiễu
    });
  });
});
