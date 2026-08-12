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
  let streakRows: any[];
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
    // Mặc định: chưa từng confirm (first_presence_at NULL), streak chỉ có đúng 1 event
    // (chính event hiện tại) — mọi test KHÔNG khai báo riêng sẽ rơi vào nhánh "chưa đủ
    // ngưỡng" (an toàn, không âm thầm confirm ngoài ý muốn của từng test case).
    usageRows = [{ first_presence_at: null }];
    streakRows = [{ streak_start: input().eventTime }];
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
        if (sql.includes('real_departures')) return Promise.resolve(streakRows);
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

  // ══ Phần 3 — streak-based confirmation (R12: liên tục tới khi gặp event=0 thật) ══
  describe('Phần 3 — streak-based presence confirmation', () => {
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

    it('(a) 1 event count>0 duy nhất, dưới ngưỡng confirm (0s < 30s) → KHÔNG update room_booking_usages, KHÔNG update rooms', async () => {
      const eventTime = input().eventTime;
      // streak chỉ có đúng 1 event = chính event hiện tại → duration = 0.
      streakRows = [{ streak_start: eventTime }];
      const r = await service.persist(input({ eventTime }));
      expect(qrCalled('UPDATE room_booking_usages')).toBe(false);
      expect(qrCalled('UPDATE rooms')).toBe(false);
      expect(r.statusChanged).toBe(false);
    });

    it('(b) chuỗi liên tục đủ ngưỡng → confirm: first_presence_at = streak_start (thời điểm BẮT ĐẦU chuỗi, KHÔNG phải eventTime hiện tại), rooms.current_status flip ĐỒNG THỜI', async () => {
      const eventTime = new Date('2026-06-30T09:00:26.000Z');
      // presenceConfirmSeconds=30 (mặc định mock) → cần streak >= 30s. Đặt streak_start
      // cách eventTime đúng 30s để vừa đủ ngưỡng.
      const confirmedStreakStart = new Date(eventTime.getTime() - 30_000);
      streakRows = [{ streak_start: confirmedStreakStart }];

      const r = await service.persist(input({ eventTime }));

      const usageCall = findCall('UPDATE room_booking_usages');
      expect(usageCall).toBeDefined();
      expect(usageCall[0]).toContain('first_presence_at = $2');
      expect(usageCall[1]).toEqual(['bk-1', confirmedStreakStart, eventTime]);
      expect(qrCalled('UPDATE rooms')).toBe(true);
      expect(r.statusChanged).toBe(true);
    });

    // [FIX 2026-08-13, R12] Bug thực tế: cảm biến báo-khi-chuyển-trạng-thái chỉ gửi 1 event
    // lúc vào rồi im lặng (không gửi liên tục khi đứng yên) — khoảng lặng dài giữa 2 event
    // dương, KHÔNG có event=0 nào ở giữa, KHÔNG được coi là rời đi. streak vẫn phải tính từ
    // event dương ĐẦU TIÊN, bất kể khoảng cách sau đó bao xa.
    it('(c) [R12] im lặng dài (40s) giữa 2 event dương, KHÔNG có event=0 ở giữa → streak KHÔNG gãy, streak_start = event dương đầu tiên', async () => {
      const firstPositive = new Date('2026-06-30T09:00:00.000Z');
      const eventTime = new Date('2026-06-30T09:00:40.000Z'); // 40s sau, im lặng hoàn toàn ở giữa
      // Đây chính là điều service.computeStreakStart() phải trả về — mock trực tiếp kết quả
      // SQL (không mô phỏng bằng JS, vì công thức mới là 1 câu SQL đơn giản: MIN(event dương)
      // sau lần "rời đi thật" gần nhất — không có event=0 nào ⇒ streak_start = event đầu tiên).
      streakRows = [{ streak_start: firstPositive }];
      noShowValues = { ...noShowValues, presenceConfirmSeconds: 30 };

      const r = await service.persist(input({ eventTime }));
      const usageCall = findCall('UPDATE room_booking_usages');
      expect(usageCall[1]).toEqual(['bk-1', firstPositive, eventTime]); // 40s >= 30s → confirm
      expect(r.statusChanged).toBe(true);
    });

    it('(d) [R12] có event=0 THẬT (không có event dương nào theo sau trong tolerance) trước đó → streak tính lại từ event dương SAU lần rời đi đó, KHÔNG lùi về trước', async () => {
      // Người rời đi thật lúc 09:00:10, quay lại lúc 09:00:30 — streak phải tính từ 09:00:30,
      // KHÔNG được cộng gộp với lần có mặt trước đó lúc 09:00:00.
      const secondEntry = new Date('2026-06-30T09:00:30.000Z');
      const eventTime = new Date('2026-06-30T09:00:36.000Z');
      streakRows = [{ streak_start: secondEntry }];
      noShowValues = { ...noShowValues, presenceConfirmSeconds: 6 }; // 36-30=6s vừa đủ

      const r = await service.persist(input({ eventTime }));
      const usageCall = findCall('UPDATE room_booking_usages');
      expect(usageCall[1]).toEqual(['bk-1', secondEntry, eventTime]);
      expect(r.statusChanged).toBe(true);
    });

    it('(e) event ở biên booking liền kề → streak query bind ĐÚNG reserved_start_time/upperBound (min(eventTime, reserved_end_time)) của booking đã resolve (chống leak sang booking khác)', async () => {
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
      streakRows = [{ streak_start: eventTime }];

      await service.persist(input({ eventTime }));

      const streakCall = qr.query.mock.calls.find((c: any[]) =>
        String(c[0]).includes('real_departures'),
      );
      expect(streakCall).toBeDefined();
      // params thứ tự: [roomId, boundStart, upperBound, tolerance] — upperBound = min(eventTime, reserved_end_time).
      expect(streakCall[1]).toEqual([
        'room-1',
        bookingAStart,
        eventTime, // eventTime (08:59) < reserved_end_time (09:00) → upperBound = eventTime
        noShowValues.presenceNoiseToleranceSeconds,
      ]);
      // KHÔNG có window/booking nào khác (vd 09:00-10:00 của booking B) lọt vào bound —
      // đúng cửa sổ CHÍNH booking A đã resolve, không phải khoảng cố định/toàn cục.
      expect(streakCall[1]).not.toContain(new Date('2026-06-30T10:00:00.000Z'));
    });

    it('booking chưa confirm + occupancyCount==0 → KHÔNG chạm room_booking_usages (tránh bug cũ: count=0 vẫn set first_presence_at qua COALESCE)', async () => {
      const r = await service.persist(input({ occupancyCount: 0 }));
      expect(qrCalled('UPDATE room_booking_usages')).toBe(false);
      expect(qrCalled('real_departures')).toBe(false); // không cần tính streak khi count=0.
      expect(qrCalled('UPDATE rooms')).toBe(false);
      expect(r.statusChanged).toBe(false);
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

    it('có booking chờ xác nhận, streak đã đủ presenceConfirmSeconds theo now() → UPDATE room_booking_usages + rooms, confirmed=1', async () => {
      const candidate = {
        booking_id: 'bk-9',
        room_id: 'room-9',
        reserved_start_time: new Date('2026-08-13T01:00:00.000Z'),
        reserved_end_time: new Date('2026-08-13T02:00:00.000Z'),
      };
      const streakStart = new Date(Date.now() - 40_000); // 40s trước "now" thật của test
      dsManagerQueryMock.mockImplementation((sql: string) => {
        if (sql.includes('FROM room_bookings'))
          return Promise.resolve([candidate]);
        if (sql.includes('real_departures'))
          return Promise.resolve([{ streak_start: streakStart }]);
        return Promise.resolve(undefined);
      });
      qr.query.mockImplementation((sql: string) => {
        if (sql.includes('UPDATE room_booking_usages'))
          return Promise.resolve([[{ id: 'usage-1' }], 1]);
        if (sql.includes('UPDATE rooms'))
          return Promise.resolve([[{ id: 'room-9' }], 1]);
        return Promise.resolve(undefined);
      });

      const r = await service.reconcilePendingConfirmations();
      expect(r).toEqual({ scanned: 1, confirmed: 1 });
      expect(qr.commitTransaction).toHaveBeenCalledTimes(1);
      const usageCall = qr.query.mock.calls.find((c: any[]) =>
        String(c[0]).includes('UPDATE room_booking_usages'),
      );
      expect(usageCall[1]).toEqual(['bk-9', streakStart]);
    });

    it('streak CHƯA đủ ngưỡng → KHÔNG mở transaction, confirmed=0', async () => {
      const candidate = {
        booking_id: 'bk-9',
        room_id: 'room-9',
        reserved_start_time: new Date('2026-08-13T01:00:00.000Z'),
        reserved_end_time: new Date('2026-08-13T02:00:00.000Z'),
      };
      const streakStart = new Date(Date.now() - 5_000); // chỉ 5s, chưa đủ 30s mặc định
      dsManagerQueryMock.mockImplementation((sql: string) => {
        if (sql.includes('FROM room_bookings'))
          return Promise.resolve([candidate]);
        if (sql.includes('real_departures'))
          return Promise.resolve([{ streak_start: streakStart }]);
        return Promise.resolve(undefined);
      });

      const r = await service.reconcilePendingConfirmations();
      expect(r).toEqual({ scanned: 1, confirmed: 0 });
      expect(dataSourceMock.createQueryRunner).not.toHaveBeenCalled();
    });

    it('1 booking lỗi giữa chừng KHÔNG làm hỏng cả batch — lỗi được log, các booking khác vẫn xử lý', async () => {
      const candidates = [
        {
          booking_id: 'bk-err',
          room_id: 'room-err',
          reserved_start_time: new Date('2026-08-13T01:00:00.000Z'),
          reserved_end_time: new Date('2026-08-13T02:00:00.000Z'),
        },
        {
          booking_id: 'bk-ok',
          room_id: 'room-ok',
          reserved_start_time: new Date('2026-08-13T01:00:00.000Z'),
          reserved_end_time: new Date('2026-08-13T02:00:00.000Z'),
        },
      ];
      const streakStart = new Date(Date.now() - 40_000);
      dsManagerQueryMock.mockImplementation((sql: string) => {
        if (sql.includes('FROM room_bookings'))
          return Promise.resolve(candidates);
        if (sql.includes('real_departures')) {
          return dsManagerQueryMock.mock.calls.filter((c: any[]) =>
            String(c[0]).includes('real_departures'),
          ).length === 1
            ? Promise.reject(new Error('db boom'))
            : Promise.resolve([{ streak_start: streakStart }]);
        }
        return Promise.resolve(undefined);
      });
      qr.query.mockImplementation((sql: string) => {
        if (sql.includes('UPDATE room_booking_usages'))
          return Promise.resolve([[{ id: 'usage-ok' }], 1]);
        if (sql.includes('UPDATE rooms'))
          return Promise.resolve([[{ id: 'room-ok' }], 1]);
        return Promise.resolve(undefined);
      });

      const r = await service.reconcilePendingConfirmations();
      expect(r).toEqual({ scanned: 2, confirmed: 1 });
    });
  });
});
