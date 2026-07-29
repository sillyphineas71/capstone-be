/* eslint-disable @typescript-eslint/no-unsafe-member-access, @typescript-eslint/no-unsafe-assignment, @typescript-eslint/no-unsafe-call, @typescript-eslint/no-unsafe-return, @typescript-eslint/no-unsafe-argument */
import { Test, TestingModule } from '@nestjs/testing';
import { DataSource } from 'typeorm';
import { UserJourneyService } from './user-journey.service.js';

const USER_ID = '39c920cd-bd08-4ab0-8139-8edb746d93ca';

describe('UserJourneyService (UJN-001)', () => {
  let service: UserJourneyService;
  let dsMock: any;
  let captured: Array<{ sql: string; params: any[] }>;

  /** Mock 4 query: users + 3 nguồn. */
  const wire = (
    over: { user?: any[]; gate?: any[]; meeting?: any[]; zone?: any[] } = {},
  ): void => {
    captured = [];
    dsMock.manager.query.mockImplementation((sql: string, params: any[]) => {
      captured.push({ sql, params });
      if (sql.includes('FROM users'))
        return Promise.resolve(over.user ?? [{ full_name: 'Bui Van Long' }]);
      if (sql.includes('FROM gate_access_logs'))
        return Promise.resolve(over.gate ?? []);
      if (sql.includes('FROM iot_device_events'))
        return Promise.resolve(over.meeting ?? []);
      if (sql.includes('FROM zone_presence_events'))
        return Promise.resolve(over.zone ?? []);
      return Promise.resolve([]);
    });
  };

  const sqlOf = (frag: string) => captured.find((c) => c.sql.includes(frag))!;

  beforeEach(async () => {
    dsMock = { manager: { query: jest.fn() } };
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        UserJourneyService,
        { provide: DataSource, useValue: dsMock },
      ],
    }).compile();
    service = module.get(UserJourneyService);
  });

  afterEach(() => {
    jest.clearAllMocks();
    jest.useRealTimers();
  });

  it('gộp 3 nguồn và SORT theo thời gian tăng dần', async () => {
    wire({
      // cố tình đưa vào lệch thứ tự để chắc chắn sort thật sự chạy
      zone: [
        {
          event_time: '2026-07-29T05:00:00.000Z',
          event_type: 'appear',
          zone_name: 'Hành lang A',
        },
      ],
      gate: [
        {
          access_time: '2026-07-29T01:00:00.000Z',
          direction: 'enter',
          plate_number: '30G69946',
          zone_name: 'Cổng Test',
        },
      ],
      meeting: [
        {
          event_time: '2026-07-29T03:00:00.000Z',
          direction: 'enter',
          room_name: 'Phòng A102',
          meeting_id: 'mt1',
        },
      ],
    });

    const r = await service.getUserJourney(USER_ID, '2026-07-29');

    expect(r.events.map((e) => e.type)).toEqual(['gate', 'meeting', 'zone']);
    expect(r.events.map((e) => e.time)).toEqual([
      '2026-07-29T01:00:00.000Z',
      '2026-07-29T03:00:00.000Z',
      '2026-07-29T05:00:00.000Z',
    ]);
    expect(r.gateCount).toBe(1);
    expect(r.meetingCount).toBe(1);
    expect(r.zoneCount).toBe(1);
    expect(r.fullName).toBe('Bui Van Long');
    expect(r.date).toBe('2026-07-29');
  });

  it('map đúng field theo từng type (gate có plate, meeting có room+meetingId, zone có zoneName)', async () => {
    wire({
      gate: [
        {
          access_time: '2026-07-29T01:00:00.000Z',
          direction: 'leave',
          plate_number: '30G69946',
          zone_name: 'Cổng Test',
        },
      ],
      meeting: [
        {
          event_time: '2026-07-29T02:00:00.000Z',
          direction: 'enter',
          room_name: 'Phòng A102',
          meeting_id: 'mt1',
        },
      ],
      zone: [
        {
          event_time: '2026-07-29T03:00:00.000Z',
          event_type: 'disappear',
          zone_name: 'Hành lang A',
        },
      ],
    });

    const [gate, meeting, zone] = (
      await service.getUserJourney(USER_ID, '2026-07-29')
    ).events;

    expect(gate).toMatchObject({
      type: 'gate',
      direction: 'leave',
      plateNumber: '30G69946',
      zoneName: 'Cổng Test',
      roomName: null,
      meetingId: null,
    });
    expect(gate.detail).toContain('30G69946');

    expect(meeting).toMatchObject({
      type: 'meeting',
      roomName: 'Phòng A102',
      meetingId: 'mt1',
      zoneName: null,
      plateNumber: null,
    });

    expect(zone).toMatchObject({
      type: 'zone',
      direction: 'disappear',
      zoneName: 'Hành lang A',
      plateNumber: null,
      roomName: null,
    });
  });

  it('nguồn 3 rỗng (chưa lắp cam zone) → zoneCount=0, vẫn trả gate+meeting', async () => {
    wire({
      gate: [
        {
          access_time: '2026-07-29T01:00:00.000Z',
          direction: 'enter',
          plate_number: '30G69946',
          zone_name: 'Cổng Test',
        },
      ],
      meeting: [
        {
          event_time: '2026-07-29T02:00:00.000Z',
          direction: 'enter',
          room_name: 'Phòng A102',
          meeting_id: null,
        },
      ],
      zone: [],
    });
    const r = await service.getUserJourney(USER_ID, '2026-07-29');
    expect(r.zoneCount).toBe(0);
    expect(r.events).toHaveLength(2);
    expect(r.gateCount).toBe(1);
    expect(r.meetingCount).toBe(1);
  });

  it('user không hoạt động → events rỗng, mọi count = 0 (KHÔNG lỗi)', async () => {
    wire({ gate: [], meeting: [], zone: [] });
    const r = await service.getUserJourney(USER_ID, '2026-07-29');
    expect(r.events).toEqual([]);
    expect(r.gateCount).toBe(0);
    expect(r.meetingCount).toBe(0);
    expect(r.zoneCount).toBe(0);
  });

  it('field null (biển/phòng/zone/direction) → không crash, detail vẫn đọc được', async () => {
    wire({
      user: [],
      gate: [
        {
          access_time: '2026-07-29T01:00:00.000Z',
          direction: null,
          plate_number: null,
          zone_name: null,
        },
      ],
      meeting: [
        {
          event_time: '2026-07-29T02:00:00.000Z',
          direction: null,
          room_name: null,
          meeting_id: null,
        },
      ],
    });
    const r = await service.getUserJourney(USER_ID, '2026-07-29');
    expect(r.fullName).toBeNull();
    expect(r.events[0].detail).toContain('không rõ biển');
    expect(r.events[1].detail).toContain('phòng không rõ');
  });

  // ── Nguyên tắc mở rộng: nguồn 3 KHÔNG hard-code zone ──
  it('nguồn 3 lọc theo user_id, KHÔNG hard-code zone_id (thêm cam zone mới tự vào)', async () => {
    wire();
    await service.getUserJourney(USER_ID, '2026-07-29');
    const q = sqlOf('FROM zone_presence_events');
    expect(q.sql).toContain('p.user_id = $1');
    // Không được có điều kiện khoá cứng zone cụ thể.
    expect(q.sql).not.toMatch(/p\.zone_id\s*=\s*'/);
    expect(q.sql).not.toMatch(/p\.zone_id\s*IN\s*\(/);
  });

  // ── Timezone: biên ngày giờ VN ──
  it('cả 3 nguồn dùng biên ngày giờ VN có ::timestamp cast', async () => {
    wire();
    await service.getUserJourney(USER_ID, '2026-07-29');
    for (const frag of [
      'FROM gate_access_logs',
      'FROM iot_device_events',
      'FROM zone_presence_events',
    ]) {
      const q = sqlOf(frag);
      expect(q.sql).toContain(
        "($2::date::timestamp AT TIME ZONE 'Asia/Ho_Chi_Minh')",
      );
      expect(q.sql).toContain(
        "(($2::date + interval '1 day')::timestamp AT TIME ZONE 'Asia/Ho_Chi_Minh')",
      );
      // Chặn hồi quy: thiếu ::timestamp thì biên lệch +7h SAI HƯỚNG.
      expect(q.sql).not.toMatch(/\$2::date AT TIME ZONE/);
      expect(q.params[0]).toBe(USER_ID);
      expect(q.params[1]).toBe('2026-07-29');
    }
  });

  it('thiếu date → hôm nay THEO GIỜ VN (19:00 UTC 28/7 = 02:00 VN 29/7 → 2026-07-29)', async () => {
    jest.useFakeTimers().setSystemTime(new Date('2026-07-28T19:00:00Z'));
    wire();
    const r = await service.getUserJourney(USER_ID);
    expect(r.date).toBe('2026-07-29');
    expect(sqlOf('FROM gate_access_logs').params[1]).toBe('2026-07-29');
  });

  it('chỉ lấy gate log CÓ user_id (hành trình theo NGƯỜI, bỏ xe unmatched)', async () => {
    wire();
    await service.getUserJourney(USER_ID, '2026-07-29');
    expect(sqlOf('FROM gate_access_logs').sql).toContain('g.user_id = $1');
  });

  it('nguồn 2 lọc đúng event_type face + userId trong payload', async () => {
    wire();
    await service.getUserJourney(USER_ID, '2026-07-29');
    const q = sqlOf('FROM iot_device_events');
    expect(q.sql).toContain("e.payload_json->>'userId' = $1");
    expect(q.params[2]).toBe('ivss_face_event');
  });
});
