/* eslint-disable @typescript-eslint/no-unsafe-member-access, @typescript-eslint/no-unsafe-assignment, @typescript-eslint/no-unsafe-call, @typescript-eslint/no-unsafe-return, @typescript-eslint/no-unsafe-argument */
import { Test, TestingModule } from '@nestjs/testing';
import { DataSource } from 'typeorm';
import { BadRequestException } from '@nestjs/common';
import { OccupancyPersistenceService } from './occupancy-persistence.service.js';
import { WebsocketService } from '../../websocket/websocket.service.js';
import { NoShowConfigService } from '../../rooms/services/no-show-config.service.js';

describe('OccupancyPersistenceService (OCC-001 refactor)', () => {
  let service: OccupancyPersistenceService;
  let dataSourceMock: any;
  let qr: any;
  let wsMock: any;
  let noShowConfigMock: any;
  let bookingRows: any[];
  let roomUpdateRows: any[];
  let usageRows: any[];
  // [FIX 2026-08-13, R12b] computeConfirmedSegment() trả { seg_start, is_active } (không
  // còn { streak_start } của bản R12 đầu) — mảng rỗng = chưa có đoạn nào đủ ngưỡng.
  let segmentRows: any[];
  // [FIX 2026-08-13, R13] Kết quả RETURNING của upsertPresenceConfirmation() (INSERT ...
  // ON CONFLICT ... RETURNING id) — mảng có 1 dòng = "vừa xác nhận thật" (fresh insert HOẶC
  // conflict rơi vào nhánh UPDATE vì first_presence_at cũ đang NULL); mảng rỗng = conflict
  // bị chặn bởi "WHERE first_presence_at IS NULL" (đã confirm từ trước, không ghi gì thêm).
  let upsertUsageRows: any[];
  let noShowValues: any;

  const RESERVED_START = new Date('2026-06-30T08:00:00.000Z');
  const RESERVED_END = new Date('2026-06-30T10:00:00.000Z');

  const input = (over: any = {}) => ({
    roomId: 'room-1',
    meetingId: null,
    occupancyCount: 5,
    confidence: null,
    eventTime: new Date('2026-06-30T09:00:00.000Z'),
    ...over,
  });

  const qrCalled = (needle: string) =>
    qr.query.mock.calls.some((c: any[]) => String(c[0]).includes(needle));

  const findCall = (needle: string) =>
    qr.query.mock.calls.find((c: any[]) => String(c[0]).includes(needle));

  beforeEach(async () => {
    bookingRows = [
      {
        booking_id: 'bk-1',
        meeting_id: 'mt-1',
        reserved_start_time: RESERVED_START,
        reserved_end_time: RESERVED_END,
      },
    ];
    roomUpdateRows = [[{ id: 'room-1' }], 1]; // status đổi.
    // Mặc định: chưa từng confirm (first_presence_at NULL), CHƯA có đoạn nào đủ ngưỡng —
    // mọi test KHÔNG khai báo riêng sẽ rơi vào nhánh "chưa đủ ngưỡng" (an toàn, không âm
    // thầm confirm ngoài ý muốn của từng test case).
    usageRows = [{ first_presence_at: null }];
    segmentRows = [];
    // Mặc định: INSERT ... ON CONFLICT ... RETURNING trả về 1 dòng (xác nhận thành công) —
    // test nào cần mô phỏng "đã confirm từ trước, conflict bị chặn" tự set = [] riêng.
    upsertUsageRows = [{ id: 'usage-new' }];
    noShowValues = {
      thresholdMinutes: 15,
      warningGraceMinutes: 0,
      autoReleaseGraceMinutes: 5,
      presenceConfirmSeconds: 30,
      presenceNoiseToleranceSeconds: 3,
      autoReleaseEnabled: true,
    };

    qr = {
      connect: jest.fn().mockResolvedValue(undefined),
      startTransaction: jest.fn().mockResolvedValue(undefined),
      query: jest.fn().mockImplementation((sql: string) => {
        if (sql.includes('FROM room_bookings'))
          return Promise.resolve(bookingRows);
        if (sql.includes('SELECT first_presence_at FROM room_booking_usages'))
          return Promise.resolve(usageRows);
        if (sql.includes('real_departures'))
          return Promise.resolve(segmentRows);
        // [FIX 2026-08-13, R13] upsertPresenceConfirmation() — phải check TRƯỚC
        // 'UPDATE room_booking_usages' vì câu SQL mới bắt đầu bằng INSERT.
        if (sql.includes('INSERT INTO room_booking_usages'))
          return Promise.resolve([upsertUsageRows, upsertUsageRows.length]);
        if (sql.includes('UPDATE room_booking_usages'))
          return Promise.resolve(undefined); // nhánh alreadyConfirmed (COALESCE), không cần rows-affected.
        if (sql.includes('UPDATE rooms'))
          return Promise.resolve(roomUpdateRows);
        return Promise.resolve(undefined);
      }),
      commitTransaction: jest.fn().mockResolvedValue(undefined),
      rollbackTransaction: jest.fn().mockResolvedValue(undefined),
      release: jest.fn().mockResolvedValue(undefined),
    };
    dataSourceMock = { createQueryRunner: jest.fn().mockReturnValue(qr) };
    wsMock = { emitToRoom: jest.fn() };
    noShowConfigMock = {
      getValues: jest
        .fn()
        .mockImplementation(() => Promise.resolve(noShowValues)),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        OccupancyPersistenceService,
        { provide: DataSource, useValue: dataSourceMock },
        { provide: WebsocketService, useValue: wsMock },
        { provide: NoShowConfigService, useValue: noShowConfigMock },
      ],
    }).compile();
    service = module.get(OccupancyPersistenceService);
  });

  afterEach(() => jest.clearAllMocks());

  it('AC-06: count>0 + status đổi (KHÔNG booking) → room_events + UPDATE rooms + WS occupancy + status; statusChanged=true', async () => {
    bookingRows = [];
    const r = await service.persist(input({ occupancyCount: 5 }));
    expect(r).toEqual({ statusChanged: true });
    expect(qrCalled('INSERT INTO room_events')).toBe(true);
    expect(qrCalled('UPDATE rooms')).toBe(true);
    expect(qr.commitTransaction).toHaveBeenCalledTimes(1);
    expect(wsMock.emitToRoom).toHaveBeenCalledWith(
      'room:room-1',
      'room.occupancy.updated',
      expect.objectContaining({ roomId: 'room-1', occupancyCount: 5 }),
    );
    expect(wsMock.emitToRoom).toHaveBeenCalledWith(
      'room:room-1',
      'room.status.updated',
      expect.objectContaining({ status: 'occupied' }),
    );
  });

  it('AC-06b: status KHÔNG đổi (UPDATE trả []) → KHÔNG emit status.updated, vẫn emit occupancy', async () => {
    bookingRows = [];
    roomUpdateRows = [[], 0];
    const r = await service.persist(input());
    expect(r).toEqual({ statusChanged: false });
    const statusEmits = wsMock.emitToRoom.mock.calls.filter(
      (c: any[]) => c[1] === 'room.status.updated',
    );
    expect(statusEmits).toHaveLength(0);
    expect(qrCalled('UPDATE rooms')).toBe(true);
  });

  it('AC-07: count==0 (KHÔNG booking) → room_events ghi, KHÔNG UPDATE rooms', async () => {
    bookingRows = [];
    await service.persist(input({ occupancyCount: 0 }));
    expect(qrCalled('INSERT INTO room_events')).toBe(true);
    expect(qrCalled('UPDATE rooms')).toBe(false);
  });

  it('AC-08: có booking ĐÃ confirmed trước (first_presence_at có giá trị) → giữ NGUYÊN hành vi cũ, KHÔNG áp lại streak-check', async () => {
    usageRows = [{ first_presence_at: new Date('2026-06-30T08:30:00.000Z') }];
    await service.persist(input());
    expect(qrCalled('INSERT INTO presence_snapshots')).toBe(true);
    expect(qrCalled('UPDATE room_booking_usages')).toBe(true);
    expect(qrCalled('real_departures')).toBe(false); // KHÔNG chạy streak query nữa.
    expect(qrCalled('UPDATE rooms')).toBe(true); // mirror hành vi cũ: flip ngay theo count>0.
  });

  // [FIX 2026-08-13, R13] Test bắt buộc theo yêu cầu: "gọi lại persist() lần 2 với event
  // mới → KHÔNG ghi đè first_presence_at đã có, nhưng last_presence_at vẫn cập nhật."
  // Luồng THẬT: lần 1 (booking chưa có usages) đi qua nhánh upsertPresenceConfirmation()
  // (test riêng ở Phần 3). Lần 2 — vì lần 1 đã tạo dòng với first_presence_at khác NULL —
  // đi qua nhánh KHÁC HẲN (if (alreadyConfirmed), dòng 156 phía trên) — nhánh này KHÔNG bị
  // đổi bởi fix R13, đã dùng COALESCE + luôn update last_presence_at từ trước. Test này
  // xác nhận rõ ràng bằng SQL thật (không suy đoán) hành vi đó vẫn đúng sau fix.
  it('R13 — gọi persist() LẦN 2 sau khi ĐÃ confirm (mô phỏng: usages giờ đã có first_presence_at=T1 do lần 1 tạo) → COALESCE giữ NGUYÊN first_presence_at=T1, last_presence_at cập nhật sang T2', async () => {
    const t1 = new Date('2026-06-30T09:00:00.000Z'); // mốc xác nhận lần đầu (từ lần gọi 1)
    const t2 = new Date('2026-06-30T09:05:00.000Z'); // event mới, 5 phút sau
    usageRows = [{ first_presence_at: t1 }]; // trạng thái DB sau lần gọi 1 thành công

    await service.persist(input({ eventTime: t2 }));

    const usageCall = findCall('UPDATE room_booking_usages');
    expect(usageCall).toBeDefined();
    expect(usageCall[0]).toContain(
      'first_presence_at = COALESCE(first_presence_at, $2)',
    );
    // Params thật của nhánh alreadyConfirmed: [booking_id, eventTime(=$2, dùng cho CẢ
    // COALESCE lẫn last_presence_at), occupancyCount]. COALESCE ở SQL tự giữ nguyên t1 nếu
    // cột đã có giá trị — KHÔNG cần (và KHÔNG thể) mock giả lập Postgres thật ở đây; hành vi
    // COALESCE đã verify RIÊNG bằng Postgres thật (xem báo cáo, mục race/COALESCE thật).
    expect(usageCall[1]).toEqual(['bk-1', t2, 5]);
    // last_presence_at LUÔN được set = eventTime mới (t2) — KHÔNG bị chặn như nhánh upsert
    // mới (nhánh này không có WHERE first_presence_at IS NULL, luôn chạy).
    expect(usageCall[0]).toContain('last_presence_at = $2');
  });

  it('AC-09: không booking → chỉ room_events (KHÔNG presence/usage)', async () => {
    bookingRows = [];
    await service.persist(input());
    expect(qrCalled('INSERT INTO room_events')).toBe(true);
    expect(qrCalled('INSERT INTO presence_snapshots')).toBe(false);
    expect(qrCalled('UPDATE room_booking_usages')).toBe(false);
  });

  it('AC-15: WS lỗi → persist KHÔNG vỡ, transaction đã commit', async () => {
    wsMock.emitToRoom.mockImplementation(() => {
      throw new Error('ws down');
    });
    const r = await service.persist(input());
    expect(r.statusChanged).toBeDefined();
    expect(qr.commitTransaction).toHaveBeenCalledTimes(1);
  });

  it('LOCKED-A: count âm → BadRequest TRƯỚC transaction (startTransaction KHÔNG gọi)', async () => {
    await expect(
      service.persist(input({ occupancyCount: -1 })),
    ).rejects.toThrow(BadRequestException);
    expect(qr.startTransaction).not.toHaveBeenCalled();
  });

  it('LOCKED-A: count > MAX (1001) → BadRequest', async () => {
    await expect(
      service.persist(input({ occupancyCount: 1001 })),
    ).rejects.toThrow(BadRequestException);
    expect(qr.startTransaction).not.toHaveBeenCalled();
  });

  it('transaction lỗi → rollback + ném', async () => {
    qr.query.mockImplementation((sql: string) => {
      if (sql.includes('INSERT INTO room_events'))
        return Promise.reject(new Error('db boom'));
      return Promise.resolve(undefined);
    });
    await expect(service.persist(input())).rejects.toThrow('db boom');
    expect(qr.rollbackTransaction).toHaveBeenCalledTimes(1);
  });

  // [FIX 2026-08-09, Phần 1] off-by-one 2 booking liền kề — reserved_end_time đổi
  // inclusive (>=) → exclusive (>): event ĐÚNG giây chuyển giao phải thuộc booking
  // SẮP BẮT ĐẦU, không phải booking sắp kết thúc.
  it('Phần 1: SQL resolve booking dùng reserved_end_time > $2 (exclusive), KHÔNG còn >=', async () => {
    await service.persist(input());
    const call = findCall('FROM room_bookings');
    expect(call[0]).toContain('reserved_end_time > $2');
    expect(call[0]).not.toContain('reserved_end_time >= $2');
    expect(call[0]).toContain('reserved_start_time <= $2');
  });

  // ══ Phần 3 — segment-based presence confirmation (R12b: xét CẢ đoạn đã đóng) ══
  describe('Phần 3 — segment-based presence confirmation', () => {
    it('R3.2: SELECT booking đã mở rộng thêm reserved_start_time/reserved_end_time', async () => {
      await service.persist(input());
      const call = findCall('FROM room_bookings');
      expect(call[0]).toContain('reserved_start_time');
      expect(call[0]).toContain('reserved_end_time');
    });

    it('đọc config presenceConfirmSeconds/presenceNoiseToleranceSeconds ĐÚNG 1 LẦN mỗi persist()', async () => {
      await service.persist(input());
      expect(noShowConfigMock.getValues).toHaveBeenCalledTimes(1);
    });

    it('(a) chưa có đoạn nào đủ ngưỡng (SQL trả rỗng) → KHÔNG insert/update room_booking_usages, KHÔNG update rooms', async () => {
      segmentRows = []; // SQL tự lọc theo presenceConfirmSeconds — rỗng nghĩa là chưa đủ.
      const r = await service.persist(input());
      expect(qrCalled('INSERT INTO room_booking_usages')).toBe(false);
      expect(qrCalled('UPDATE room_booking_usages')).toBe(false);
      expect(qrCalled('UPDATE rooms')).toBe(false);
      expect(r.statusChanged).toBe(false);
    });

    it('(b) đoạn CÒN ĐANG MỞ đủ ngưỡng → confirm: first_presence_at = seg_start, rooms.current_status flip ĐỒNG THỜI (isActive=true)', async () => {
      const eventTime = new Date('2026-06-30T09:00:26.000Z');
      const segStart = new Date(eventTime.getTime() - 30_000);
      segmentRows = [{ seg_start: segStart, is_active: true }];

      const r = await service.persist(input({ eventTime }));

      const usageCall = findCall('INSERT INTO room_booking_usages');
      expect(usageCall).toBeDefined();
      expect(usageCall[0]).toContain('ON CONFLICT (booking_id) DO UPDATE');
      // params: [booking_id, meeting_id, room_id, reserved_start_time, reserved_end_time,
      //          first_presence_at, last_presence_at] — lấy sẵn từ booking đã SELECT, KHÔNG
      // query thêm.
      expect(usageCall[1]).toEqual([
        'bk-1',
        'mt-1',
        'room-1',
        RESERVED_START,
        RESERVED_END,
        segStart,
        eventTime,
      ]);
      expect(qrCalled('UPDATE rooms')).toBe(true);
      expect(r.statusChanged).toBe(true);
    });

    // [FIX 2026-08-13, R12] Bug thực tế #1: cảm biến báo-khi-chuyển-trạng-thái chỉ gửi 1
    // event lúc vào rồi im lặng (không gửi liên tục khi đứng yên) — khoảng lặng dài giữa 2
    // event dương, KHÔNG có event=0 nào ở giữa, KHÔNG được coi là rời đi.
    it('(c) [R12] im lặng dài (40s) giữa 2 event dương, KHÔNG có event=0 ở giữa → đoạn KHÔNG gãy, seg_start = event dương đầu tiên', async () => {
      const firstPositive = new Date('2026-06-30T09:00:00.000Z');
      const eventTime = new Date('2026-06-30T09:00:40.000Z'); // 40s sau, im lặng hoàn toàn ở giữa
      segmentRows = [{ seg_start: firstPositive, is_active: true }];
      noShowValues = { ...noShowValues, presenceConfirmSeconds: 30 };

      const r = await service.persist(input({ eventTime }));
      const usageCall = findCall('INSERT INTO room_booking_usages');
      expect(usageCall[1]).toEqual([
        'bk-1',
        'mt-1',
        'room-1',
        RESERVED_START,
        RESERVED_END,
        firstPositive,
        eventTime,
      ]); // 40s >= 30s → confirm
      expect(r.statusChanged).toBe(true);
    });

    // [FIX 2026-08-13, R12b] Bug thực tế #2 (bug MỚI, phát hiện SAU khi sửa #1): đứng đủ
    // ngưỡng RỒI MỚI rời khung (event=0 tới đúng lúc đánh giá) — bản R12 đầu chỉ xét đoạn
    // ĐANG HOẠT ĐỘNG nên bỏ sót đoạn ĐÃ ĐÓNG này. Đây chính là ca "3x giây rồi rời khung vẫn
    // bị báo no-show" người dùng gặp phải sau fix #1.
    it('(e) [R12b] đứng đủ ngưỡng (35s) RỒI MỚI rời khung (chính event=0 kích hoạt persist() lần này) → VẪN confirm, first_presence_at = seg_start, nhưng KHÔNG flip rooms.current_status (isActive=false, họ vừa rời đi)', async () => {
      const segStart = new Date('2026-06-30T09:00:00.000Z');
      const exitEventTime = new Date('2026-06-30T09:00:35.000Z'); // chính event=0 này
      segmentRows = [{ seg_start: segStart, is_active: false }]; // đoạn ĐÃ ĐÓNG (đã rời đi)

      const r = await service.persist(
        input({ occupancyCount: 0, eventTime: exitEventTime }),
      );

      const usageCall = findCall('INSERT INTO room_booking_usages');
      expect(usageCall).toBeDefined(); // TRƯỚC fix R12b: nhánh count==0 luôn no-op, test này sẽ fail.
      expect(usageCall[1]).toEqual([
        'bk-1',
        'mt-1',
        'room-1',
        RESERVED_START,
        RESERVED_END,
        segStart,
        exitEventTime,
      ]);
      expect(qrCalled('UPDATE rooms')).toBe(false); // isActive=false → KHÔNG được báo đang occupied.
      expect(r.statusChanged).toBe(false);
    });

    it('(f) đoạn ĐÃ ĐÓNG (rời đi rồi mới xác nhận) nhưng CHƯA đủ ngưỡng → KHÔNG confirm', async () => {
      segmentRows = []; // SQL đã tự lọc theo ngưỡng — không có đoạn nào đủ → rỗng.
      const r = await service.persist(
        input({
          occupancyCount: 0,
          eventTime: new Date('2026-06-30T09:00:05.000Z'),
        }),
      );
      expect(qrCalled('INSERT INTO room_booking_usages')).toBe(false);
      expect(qrCalled('UPDATE room_booking_usages')).toBe(false);
      expect(qrCalled('UPDATE rooms')).toBe(false);
      expect(r.statusChanged).toBe(false);
    });

    it('(g) event ở biên booking liền kề → streak query bind ĐÚNG reserved_start_time/upperBound (min(eventTime, reserved_end_time)) của booking đã resolve (chống leak sang booking khác)', async () => {
      const bookingAStart = new Date('2026-06-30T08:00:00.000Z');
      const bookingAEnd = new Date('2026-06-30T09:00:00.000Z'); // booking A: 08:00-09:00
      bookingRows = [
        {
          booking_id: 'bk-A',
          meeting_id: 'mt-A',
          reserved_start_time: bookingAStart,
          reserved_end_time: bookingAEnd,
        },
      ];
      const eventTime = new Date('2026-06-30T08:59:00.000Z');
      segmentRows = [];

      await service.persist(input({ eventTime }));

      const streakCall = qr.query.mock.calls.find((c: any[]) =>
        String(c[0]).includes('real_departures'),
      );
      expect(streakCall).toBeDefined();
      // params thứ tự: [roomId, boundStart, upperBound, tolerance, presenceConfirmSeconds].
      expect(streakCall[1]).toEqual([
        'room-1',
        bookingAStart,
        eventTime, // eventTime (08:59) < reserved_end_time (09:00) → upperBound = eventTime
        noShowValues.presenceNoiseToleranceSeconds,
        noShowValues.presenceConfirmSeconds,
      ]);
      // KHÔNG có window/booking nào khác (vd 09:00-10:00 của booking B) lọt vào bound —
      // đúng cửa sổ CHÍNH booking A đã resolve, không phải khoảng cố định/toàn cục.
      expect(streakCall[1]).not.toContain(new Date('2026-06-30T10:00:00.000Z'));
    });
  });

  // ══ R12 phần 2 — reconcilePendingConfirmations (xác nhận theo đồng hồ thực) ══════
  describe('reconcilePendingConfirmations (R12 phần 2)', () => {
    let dsManagerQueryMock: jest.Mock;

    beforeEach(() => {
      dsManagerQueryMock = jest.fn();
      dataSourceMock.manager = { query: dsManagerQueryMock };
    });

    it('không có booking nào đang chờ xác nhận → scanned=0, confirmed=0, KHÔNG mở transaction', async () => {
      dsManagerQueryMock.mockResolvedValue([]);
      const r = await service.reconcilePendingConfirmations();
      expect(r).toEqual({ scanned: 0, confirmed: 0 });
      expect(dataSourceMock.createQueryRunner).not.toHaveBeenCalled();
    });

    // [FIX 2026-08-13, R13] Trước đây câu SELECT ứng viên dùng INNER JOIN
    // room_booking_usages — loại bỏ HẲN mọi booking CHƯA CÓ dòng usages (đúng root cause
    // đêm nay: 118/129 booking thật trên production). Xác nhận: query giờ dùng LEFT JOIN +
    // điều kiện "first_presence_at IS NULL OR u.id IS NULL", và SELECT có thêm meeting_id
    // (cần cho upsertPresenceConfirmation()).
    it('R13: câu SELECT ứng viên dùng LEFT JOIN (không phải INNER JOIN) + có SELECT b.meeting_id', async () => {
      dsManagerQueryMock.mockResolvedValue([]);
      await service.reconcilePendingConfirmations();
      const call = dsManagerQueryMock.mock.calls.find((c: any[]) =>
        String(c[0]).includes('FROM room_bookings'),
      );
      expect(call).toBeDefined();
      expect(call[0]).toContain('LEFT JOIN room_booking_usages');
      expect(call[0]).not.toMatch(/(?<!LEFT )JOIN room_booking_usages/);
      expect(call[0]).toContain('u.first_presence_at IS NULL OR u.id IS NULL');
      expect(call[0]).toContain('b.meeting_id');
    });

    it('có booking chờ xác nhận, đoạn ĐANG MỞ đã đủ ngưỡng theo now() → INSERT (upsert) room_booking_usages + UPDATE rooms, confirmed=1', async () => {
      const candidate = {
        booking_id: 'bk-9',
        meeting_id: 'mt-9',
        room_id: 'room-9',
        reserved_start_time: new Date('2026-08-13T01:00:00.000Z'),
        reserved_end_time: new Date('2026-08-13T02:00:00.000Z'),
      };
      const segStart = new Date(Date.now() - 40_000); // 40s trước "now" thật của test
      dsManagerQueryMock.mockImplementation((sql: string) => {
        if (sql.includes('FROM room_bookings'))
          return Promise.resolve([candidate]);
        if (sql.includes('real_departures'))
          return Promise.resolve([{ seg_start: segStart, is_active: true }]);
        return Promise.resolve(undefined);
      });
      qr.query.mockImplementation((sql: string) => {
        if (sql.includes('INSERT INTO room_booking_usages'))
          return Promise.resolve([[{ id: 'usage-1' }], 1]);
        if (sql.includes('UPDATE rooms'))
          return Promise.resolve([[{ id: 'room-9' }], 1]);
        return Promise.resolve(undefined);
      });

      const r = await service.reconcilePendingConfirmations();
      expect(r).toEqual({ scanned: 1, confirmed: 1 });
      expect(qr.commitTransaction).toHaveBeenCalledTimes(1);
      const usageCall = qr.query.mock.calls.find((c: any[]) =>
        String(c[0]).includes('INSERT INTO room_booking_usages'),
      );
      // params: [booking_id, meeting_id, room_id, reserved_start_time, reserved_end_time,
      //          first_presence_at, last_presence_at] — reconcile không có "eventTime" thật
      // nên last_presence_at = chính seg_start (mốc hợp lý nhất hiện có).
      expect(usageCall[1]).toEqual([
        'bk-9',
        'mt-9',
        'room-9',
        candidate.reserved_start_time,
        candidate.reserved_end_time,
        segStart,
        segStart,
      ]);
      expect(qrCalled('UPDATE rooms')).toBe(true);
    });

    // [FIX 2026-08-13, R13] Test QUAN TRỌNG NHẤT — xác nhận đúng phát hiện JOIN sai đã tìm
    // ra: booking CHƯA CÓ dòng room_booking_usages nào (mô phỏng bằng candidate không có
    // usages đi kèm — đúng thực tế vì query LEFT JOIN giờ đã trả về được các booking này),
    // KHÔNG có event mới nào tới (hàm này chạy độc lập theo cron, không phụ thuộc event) →
    // vẫn phải TỰ TẠO dòng usages mới (INSERT, không phải UPDATE).
    it('booking CHƯA CÓ dòng usages nào (LEFT JOIN mới trả về được) + không có event mới → TỰ TẠO dòng mới qua reconcile, KHÔNG cần persist()', async () => {
      const candidate = {
        booking_id: 'bk-no-usages',
        meeting_id: 'mt-no-usages',
        room_id: 'room-no-usages',
        reserved_start_time: new Date('2026-08-13T01:00:00.000Z'),
        reserved_end_time: new Date('2026-08-13T02:00:00.000Z'),
      };
      const segStart = new Date(Date.now() - 45_000); // đứng im lặng 45s, không event mới nào tới thêm
      dsManagerQueryMock.mockImplementation((sql: string) => {
        if (sql.includes('FROM room_bookings'))
          return Promise.resolve([candidate]);
        if (sql.includes('real_departures'))
          return Promise.resolve([{ seg_start: segStart, is_active: true }]);
        return Promise.resolve(undefined);
      });
      let insertCallCount = 0;
      qr.query.mockImplementation((sql: string) => {
        if (sql.includes('INSERT INTO room_booking_usages')) {
          insertCallCount++;
          return Promise.resolve([[{ id: 'usage-fresh' }], 1]);
        }
        if (sql.includes('UPDATE rooms'))
          return Promise.resolve([[{ id: 'room-no-usages' }], 1]);
        return Promise.resolve(undefined);
      });

      const r = await service.reconcilePendingConfirmations();
      expect(r).toEqual({ scanned: 1, confirmed: 1 });
      expect(insertCallCount).toBe(1); // đúng 1 lần INSERT (upsert), không phải UPDATE.
      const usageCall = qr.query.mock.calls.find((c: any[]) =>
        String(c[0]).includes('INSERT INTO room_booking_usages'),
      );
      expect(usageCall[0]).toContain('ON CONFLICT (booking_id) DO UPDATE');
      expect(usageCall[1][0]).toBe('bk-no-usages');
      expect(usageCall[1][1]).toBe('mt-no-usages');
      expect(usageCall[1][2]).toBe('room-no-usages');
    });

    // [FIX 2026-08-13, R12b] Ca chính xác người dùng gặp phải: đứng đủ 30+s trong khung rồi
    // rời đi TRƯỚC KHI cron tick kịp chạy — tới lúc reconcile chạy, đoạn đã ĐÓNG (is_active
    // =false). Vẫn phải confirm (đã đủ ngưỡng thật), nhưng KHÔNG được flip rooms.current_status
    // vì họ không còn trong phòng.
    it('đoạn ĐÃ ĐÓNG (rời đi trước khi cron kịp chạy) nhưng đã từng đủ ngưỡng → vẫn confirm, KHÔNG flip rooms.current_status', async () => {
      const candidate = {
        booking_id: 'bk-9',
        meeting_id: 'mt-9',
        room_id: 'room-9',
        reserved_start_time: new Date('2026-08-13T01:00:00.000Z'),
        reserved_end_time: new Date('2026-08-13T02:00:00.000Z'),
      };
      const segStart = new Date(Date.now() - 60_000);
      dsManagerQueryMock.mockImplementation((sql: string) => {
        if (sql.includes('FROM room_bookings'))
          return Promise.resolve([candidate]);
        if (sql.includes('real_departures'))
          return Promise.resolve([{ seg_start: segStart, is_active: false }]);
        return Promise.resolve(undefined);
      });
      qr.query.mockImplementation((sql: string) => {
        if (sql.includes('INSERT INTO room_booking_usages'))
          return Promise.resolve([[{ id: 'usage-1' }], 1]);
        return Promise.resolve(undefined);
      });

      const r = await service.reconcilePendingConfirmations();
      expect(r).toEqual({ scanned: 1, confirmed: 1 });
      expect(qrCalled('UPDATE rooms')).toBe(false); // isActive=false → không flip occupied.
    });

    it('chưa có đoạn nào đủ ngưỡng (SQL trả rỗng) → KHÔNG mở transaction, confirmed=0', async () => {
      const candidate = {
        booking_id: 'bk-9',
        meeting_id: 'mt-9',
        room_id: 'room-9',
        reserved_start_time: new Date('2026-08-13T01:00:00.000Z'),
        reserved_end_time: new Date('2026-08-13T02:00:00.000Z'),
      };
      dsManagerQueryMock.mockImplementation((sql: string) => {
        if (sql.includes('FROM room_bookings'))
          return Promise.resolve([candidate]);
        if (sql.includes('real_departures')) return Promise.resolve([]);
        return Promise.resolve(undefined);
      });

      const r = await service.reconcilePendingConfirmations();
      expect(r).toEqual({ scanned: 1, confirmed: 0 });
      expect(dataSourceMock.createQueryRunner).not.toHaveBeenCalled();
    });

    // [FIX 2026-08-13, R13] Race: 2 lần gọi upsert cho CÙNG booking_id (persist() và
    // reconcilePendingConfirmations() cùng lúc, hoặc reconcile chạy 2 tick sát nhau trước
    // khi transaction đầu commit xong) — RETURNING rỗng ở lần 2 (WHERE first_presence_at IS
    // NULL không còn đúng sau lần 1) → confirmed=false, KHÔNG lỗi constraint, KHÔNG đếm
    // trùng. Mô phỏng bằng cách gọi reconcilePendingConfirmations() 2 lần liên tiếp, lần 2
    // trả về 0 dòng RETURNING (giống hệt Postgres thật sẽ làm — đã verify riêng bằng SQL
    // thật, xem báo cáo).
    it('race: gọi reconcilePendingConfirmations() 2 lần liên tiếp cho cùng booking → lần 2 KHÔNG lỗi, KHÔNG đếm trùng (RETURNING rỗng vì đã confirm ở lần 1)', async () => {
      const candidate = {
        booking_id: 'bk-race',
        meeting_id: 'mt-race',
        room_id: 'room-race',
        reserved_start_time: new Date('2026-08-13T01:00:00.000Z'),
        reserved_end_time: new Date('2026-08-13T02:00:00.000Z'),
      };
      const segStart = new Date(Date.now() - 40_000);
      dsManagerQueryMock.mockImplementation((sql: string) => {
        if (sql.includes('FROM room_bookings'))
          return Promise.resolve([candidate]);
        if (sql.includes('real_departures'))
          return Promise.resolve([{ seg_start: segStart, is_active: true }]);
        return Promise.resolve(undefined);
      });
      let insertAttempt = 0;
      qr.query.mockImplementation((sql: string) => {
        if (sql.includes('INSERT INTO room_booking_usages')) {
          insertAttempt++;
          // Lần 1: chưa có dòng nào -> insert thật, RETURNING 1 dòng.
          // Lần 2: dòng đã tồn tại + first_presence_at đã set -> WHERE chặn -> RETURNING rỗng.
          return Promise.resolve(
            insertAttempt === 1 ? [[{ id: 'usage-race' }], 1] : [[], 0],
          );
        }
        if (sql.includes('UPDATE rooms'))
          return Promise.resolve([[{ id: 'room-race' }], 1]);
        return Promise.resolve(undefined);
      });

      const r1 = await service.reconcilePendingConfirmations();
      const r2 = await service.reconcilePendingConfirmations();
      expect(r1).toEqual({ scanned: 1, confirmed: 1 });
      expect(r2).toEqual({ scanned: 1, confirmed: 0 }); // KHÔNG đếm trùng, KHÔNG throw.
      expect(insertAttempt).toBe(2); // cả 2 lần đều thử INSERT...ON CONFLICT — không lỗi.
    });

    it('1 booking lỗi giữa chừng KHÔNG làm hỏng cả batch — lỗi được log, các booking khác vẫn xử lý', async () => {
      const candidates = [
        {
          booking_id: 'bk-err',
          meeting_id: 'mt-err',
          room_id: 'room-err',
          reserved_start_time: new Date('2026-08-13T01:00:00.000Z'),
          reserved_end_time: new Date('2026-08-13T02:00:00.000Z'),
        },
        {
          booking_id: 'bk-ok',
          meeting_id: 'mt-ok',
          room_id: 'room-ok',
          reserved_start_time: new Date('2026-08-13T01:00:00.000Z'),
          reserved_end_time: new Date('2026-08-13T02:00:00.000Z'),
        },
      ];
      const segStart = new Date(Date.now() - 40_000);
      dsManagerQueryMock.mockImplementation((sql: string) => {
        if (sql.includes('FROM room_bookings'))
          return Promise.resolve(candidates);
        if (sql.includes('real_departures')) {
          return dsManagerQueryMock.mock.calls.filter((c: any[]) =>
            String(c[0]).includes('real_departures'),
          ).length === 1
            ? Promise.reject(new Error('db boom'))
            : Promise.resolve([{ seg_start: segStart, is_active: true }]);
        }
        return Promise.resolve(undefined);
      });
      qr.query.mockImplementation((sql: string) => {
        if (sql.includes('INSERT INTO room_booking_usages'))
          return Promise.resolve([[{ id: 'usage-ok' }], 1]);
        if (sql.includes('UPDATE rooms'))
          return Promise.resolve([[{ id: 'room-ok' }], 1]);
        return Promise.resolve(undefined);
      });

      const r = await service.reconcilePendingConfirmations();
      expect(r).toEqual({ scanned: 2, confirmed: 1 });
    });
  });

  // ══ R13 — tái hiện CHÍNH XÁC dữ liệu thật đêm nay (root cause: thiếu room_booking_usages) ══
  describe('Tái hiện dữ liệu thật (R13 — booking 8812c4b2, room 097cf988)', () => {
    // 6 event THẬT, y hệt đã cung cấp:
    // 19:28:44.027 count=1 | 19:28:50.259 count=0 | 19:28:51.259 count=0 |
    // 19:28:51.936 count=1 | 19:29:36.876 count=0 | 19:29:37.874 count=0
    // reserved_start_time=19:28:00 (KHÔNG cắt event nào — đã bác bỏ giả thuyết R2 cũ).
    // computeConfirmedSegment() với 6 event này (đã verify bằng SQL thật trên Postgres,
    // xem báo cáo) trả về seg_start=19:28:44.027, is_active=false — segment đầu tiên khớp
    // đúng đoạn 19:28:44.027 → 19:29:36.876 (52.849s ≥ 30s).
    it('booking KHÔNG có usages, streak thật đủ ngưỡng, event=0 cuối (19:29:37.874) kích hoạt persist() → first_presence_at ĐƯỢC TẠO ĐÚNG = 19:28:44.027 (KHÔNG bị no-show oan)', async () => {
      const meetingId = 'bb163e69-1351-4dd5-b5c2-297fb8d9cdf3';
      const bookingId = '8812c4b2-fd97-4b9b-8a98-3738511d6fa8';
      const roomId = '097cf988-8976-42d9-a83d-e5a0013022d9';
      const reservedStart = new Date('2026-08-12T19:28:00.000Z');
      const reservedEnd = new Date('2026-08-12T20:28:00.000Z');
      const expectedFirstPresenceAt = new Date('2026-08-12T19:28:44.027Z');
      const lastEventTime = new Date('2026-08-12T19:29:37.874Z');

      bookingRows = [
        {
          booking_id: bookingId,
          meeting_id: meetingId,
          reserved_start_time: reservedStart,
          reserved_end_time: reservedEnd,
        },
      ];
      // Root cause thật đêm nay: KHÔNG CÓ dòng room_booking_usages nào cho booking này —
      // mô phỏng đúng bằng SELECT rỗng (KHÔNG phải [{first_presence_at: null}]).
      usageRows = [];
      // Kết quả THẬT của computeConfirmedSegment() với 6 event thật (verify qua psql thật,
      // xem báo cáo) — KHÔNG suy đoán lại thuật toán streak (đã xác nhận đúng, không đụng).
      segmentRows = [{ seg_start: expectedFirstPresenceAt, is_active: false }];

      const r = await service.persist(
        input({
          roomId,
          meetingId, // payload thô từ camera — KHÔNG dùng để resolve booking (R4, vô hại).
          occupancyCount: 0,
          eventTime: lastEventTime,
        }),
      );

      const usageCall = findCall('INSERT INTO room_booking_usages');
      expect(usageCall).toBeDefined(); // TRƯỚC fix R13: KHÔNG có call nào cả (UPDATE khớp 0 dòng, im lặng).
      expect(usageCall[1]).toEqual([
        bookingId,
        meetingId,
        roomId,
        reservedStart,
        reservedEnd,
        expectedFirstPresenceAt,
        lastEventTime,
      ]);
      expect(r.statusChanged).toBe(false); // event cuối count=0 + isActive=false → không flip occupied, đúng.

      // Hệ quả logic (KHÔNG re-test NoShowDetectionService ở đây — thuộc service khác,
      // Phần 2 chưa đụng tới): detect() dùng `LEFT JOIN room_booking_usages u ... WHERE
      // u.first_presence_at IS NULL` — sau fix này, dòng vừa tạo có first_presence_at =
      // 2026-08-12T19:28:44.027Z (KHÔNG NULL) → điều kiện WHERE của detect() sai → booking
      // này KHÔNG còn là ứng viên no-show nữa. Xác nhận trực tiếp giá trị vừa ghi KHÔNG NULL:
      expect(usageCall[1][5]).not.toBeNull();
    });
  });
});
