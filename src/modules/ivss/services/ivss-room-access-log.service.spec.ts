/* eslint-disable @typescript-eslint/no-unsafe-member-access, @typescript-eslint/no-unsafe-assignment, @typescript-eslint/no-unsafe-call, @typescript-eslint/no-unsafe-return, @typescript-eslint/no-unsafe-argument */
import { readFileSync } from 'fs';
import { join } from 'path';
import { Test, TestingModule } from '@nestjs/testing';
import { DataSource } from 'typeorm';
import { NotFoundException } from '@nestjs/common';
import { IvssRoomAccessLogService } from './ivss-room-access-log.service.js';

const ROOM_ID = '097cf988-8976-42d9-a83d-e5a0013022d9';

describe('IvssRoomAccessLogService (RAL-001 / Màn 2)', () => {
  let service: IvssRoomAccessLogService;
  let dsMock: any;
  let captured: Array<{ sql: string; params: any[] }>;

  /** Mock 2 query: rooms (kiểm tồn tại) + iot_device_events (log). */
  const wire = (over: { room?: any[]; events?: any[] } = {}): void => {
    captured = [];
    dsMock.manager.query.mockImplementation((sql: string, params: any[]) => {
      captured.push({ sql, params });
      if (sql.includes('FROM rooms'))
        return Promise.resolve(over.room ?? [{ room_name: 'Phòng A102' }]);
      if (sql.includes('FROM iot_device_events'))
        return Promise.resolve(over.events ?? []);
      return Promise.resolve([]);
    });
  };

  const evt = (over: any = {}) => ({
    id: 'e1',
    event_time: '2026-07-28T10:45:21.000Z',
    user_id: 'u1',
    full_name: 'Bui Van Long',
    direction: 'enter',
    match_state: 'matched',
    similarity: '0.98',
    meeting_id: 'mt1',
    ...over,
  });

  beforeEach(async () => {
    dsMock = { manager: { query: jest.fn() } };
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        IvssRoomAccessLogService,
        { provide: DataSource, useValue: dsMock },
      ],
    }).compile();
    service = module.get(IvssRoomAccessLogService);
  });

  afterEach(() => jest.clearAllMocks());

  it('phòng không tồn tại / đã soft-delete → 404 ROOM_NOT_FOUND', async () => {
    wire({ room: [] });
    await expect(
      service.getRoomAccessLog(ROOM_ID, '2026-07-28'),
    ).rejects.toThrow(NotFoundException);
  });

  it('map đúng field camelCase + roomName + date', async () => {
    wire({ events: [evt()] });
    const r = await service.getRoomAccessLog(ROOM_ID, '2026-07-28');
    expect(r.roomId).toBe(ROOM_ID);
    expect(r.roomName).toBe('Phòng A102');
    expect(r.date).toBe('2026-07-28');
    expect(r.events[0]).toEqual({
      id: 'e1',
      eventTime: '2026-07-28T10:45:21.000Z',
      userId: 'u1',
      fullName: 'Bui Van Long',
      direction: 'enter',
      matchState: 'matched',
      similarity: 0.98, // string từ jsonb → number
      meetingId: 'mt1',
      isStranger: false,
    });
  });

  it('đếm matched/unmatched + isStranger đúng theo matchState', async () => {
    wire({
      events: [
        evt({ id: 'e1', match_state: 'matched' }),
        evt({ id: 'e2', match_state: 'matched', direction: 'leave' }),
        evt({ id: 'e3', match_state: 'unmatched_location' }),
        evt({ id: 'e4', match_state: 'unmatched_identity' }),
      ],
    });
    const r = await service.getRoomAccessLog(ROOM_ID, '2026-07-28');
    expect(r.totalEvents).toBe(4);
    expect(r.matchedCount).toBe(2);
    expect(r.unmatchedCount).toBe(2);
    expect(r.events.map((e) => e.isStranger)).toEqual([
      false,
      false,
      true,
      true,
    ]);
  });

  it('event chưa khớp danh tính (userId/full_name null) VẪN được trả, không loại', async () => {
    wire({
      events: [
        evt({
          id: 'e9',
          user_id: null,
          full_name: null,
          match_state: 'unmatched_identity',
          similarity: null,
        }),
      ],
    });
    const r = await service.getRoomAccessLog(ROOM_ID, '2026-07-28');
    expect(r.totalEvents).toBe(1);
    expect(r.events[0].userId).toBeNull();
    expect(r.events[0].fullName).toBeNull();
    expect(r.events[0].similarity).toBeNull();
    expect(r.events[0].isStranger).toBe(true);
  });

  it('SQL: lọc đúng event_type/room_id + biên ngày [date, date+1) THEO GIỜ VN', async () => {
    wire();
    await service.getRoomAccessLog(ROOM_ID, '2026-07-28');
    const q = captured.find((c) => c.sql.includes('FROM iot_device_events'))!;
    // ⚠ RDS chạy UTC — biên ngày PHẢI ép Asia/Ho_Chi_Minh, nếu không event buổi tối
    // giờ VN rơi nhầm sang ngày hôm sau.
    expect(q.sql).toContain(
      "e.event_time >= ($2::date::timestamp AT TIME ZONE 'Asia/Ho_Chi_Minh')",
    );
    expect(q.sql).toContain(
      "(($2::date + interval '1 day')::timestamp AT TIME ZONE 'Asia/Ho_Chi_Minh')",
    );
    // Chặn hồi quy 1: KHÔNG quay lại $2::date trần (phụ thuộc TZ phiên DB).
    expect(q.sql).not.toMatch(/event_time\s*>=\s*\$2::date\s/);
    // Chặn hồi quy 2: KHÔNG bỏ ::timestamp. Thiếu nó, Postgres ép date→timestamptz
    // rồi AT TIME ZONE chạy ngược chiều → biên lệch +7h SAI HƯỚNG (đã kiểm bằng psql).
    expect(q.sql).not.toMatch(/\$2::date AT TIME ZONE/);
    expect(q.sql).toContain('LEFT JOIN users u');
    expect(q.params).toEqual([ROOM_ID, '2026-07-28', 'ivss_face_event']);
  });

  it('thiếu date → tự dùng hôm nay (YYYY-MM-DD)', async () => {
    wire();
    const r = await service.getRoomAccessLog(ROOM_ID);
    expect(r.date).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    const q = captured.find((c) => c.sql.includes('FROM iot_device_events'))!;
    expect(q.params[1]).toBe(r.date);
  });

  // ── Timezone của mặc định "hôm nay" (EC2 chạy UTC) ────────────────────────
  describe('todayStr() theo giờ VN', () => {
    afterEach(() => jest.useRealTimers());

    it('02:00 giờ VN (=19:00 UTC hôm trước) → trả NGÀY HÔM NAY theo VN, KHÔNG phải hôm qua', async () => {
      // 2026-07-28 19:00 UTC === 2026-07-29 02:00 giờ VN.
      jest.useFakeTimers().setSystemTime(new Date('2026-07-28T19:00:00Z'));
      wire();
      const r = await service.getRoomAccessLog(ROOM_ID);
      expect(r.date).toBe('2026-07-29'); // bản cũ (theo UTC) sẽ trả '2026-07-28'
    });

    it('23:00 giờ VN (=16:00 UTC cùng ngày) → vẫn đúng ngày VN', async () => {
      // 2026-07-29 16:00 UTC === 2026-07-29 23:00 giờ VN.
      jest.useFakeTimers().setSystemTime(new Date('2026-07-29T16:00:00Z'));
      wire();
      const r = await service.getRoomAccessLog(ROOM_ID);
      expect(r.date).toBe('2026-07-29');
    });

    it('chặn hồi quy: KHÔNG dùng getFullYear/getMonth/getDate theo giờ process', () => {
      // Đọc thẳng source: 3 hàm này lấy theo timezone TIẾN TRÌNH → sai trên EC2 UTC.
      const src = readFileSync(
        join(__dirname, 'ivss-room-access-log.service.ts'),
        'utf8',
      );
      expect(src).not.toMatch(/getFullYear\(\)/);
      expect(src).not.toMatch(/getMonth\(\)/);
      expect(src).not.toMatch(/getDate\(\)/);
      expect(src).toContain("Intl.DateTimeFormat('en-CA'");
      expect(src).toContain('timeZone: BUSINESS_TIMEZONE');
    });
  });

  it('ngày không có dữ liệu → mảng rỗng, các count = 0 (KHÔNG lỗi)', async () => {
    wire({ events: [] });
    const r = await service.getRoomAccessLog(ROOM_ID, '2026-01-01');
    expect(r.events).toEqual([]);
    expect(r.totalEvents).toBe(0);
    expect(r.matchedCount).toBe(0);
    expect(r.unmatchedCount).toBe(0);
  });
});
