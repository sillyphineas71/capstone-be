/* eslint-disable @typescript-eslint/no-unsafe-member-access, @typescript-eslint/no-unsafe-assignment, @typescript-eslint/no-unsafe-call, @typescript-eslint/no-unsafe-return, @typescript-eslint/no-unsafe-argument, @typescript-eslint/no-explicit-any */
import { Test, TestingModule } from '@nestjs/testing';
import { DataSource } from 'typeorm';
import { IvssPresenceIngestionService } from './ivss-presence-ingestion.service.js';

const ROOM_UUID = '11111111-1111-1111-1111-111111111111';

const evt = (over: any = {}) => ({
  type: 'face_recognized',
  channelId: 5,
  personUid: 'SZ1',
  utc: '2026-06-23T09:00:00.000Z',
  eventAction: '1',
  ...over,
});

describe('IvssPresenceIngestionService (IPI-001 #38+#39)', () => {
  let service: IvssPresenceIngestionService;
  let dsMock: any;
  let captured: Array<{ sql: string; params: any[] }>;

  const wire = (
    over: {
      bridge?: any[];
      user?: any[];
      channelMap?: Record<string, unknown> | null;
      meeting?: any[];
      insertThrows?: boolean;
    } = {},
  ) => {
    captured = [];
    dsMock.manager.query.mockImplementation((sql: string, params: any[]) => {
      captured.push({ sql, params });
      if (sql.includes('FROM iot_devices WHERE device_code'))
        return Promise.resolve(over.bridge ?? [{ id: 'bridge1' }]);
      if (sql.includes('FROM device_user_mappings'))
        return Promise.resolve(over.user ?? [{ user_id: 'u1' }]);
      if (sql.includes("config_key = 'ivss.channel_room_map'"))
        return Promise.resolve([
          {
            config_json:
              over.channelMap === undefined
                ? { '5': ROOM_UUID }
                : over.channelMap,
          },
        ]);
      if (sql.includes('FROM meetings'))
        return Promise.resolve(over.meeting ?? [{ id: 'm1' }]);
      if (sql.includes('INSERT INTO iot_device_events')) {
        if (over.insertThrows) return Promise.reject(new Error('db boom'));
        return Promise.resolve(undefined);
      }
      return Promise.resolve(undefined);
    });
  };

  const insert = () =>
    captured.find((c) => c.sql.includes('INSERT INTO iot_device_events'));
  const payloadOf = () => JSON.parse(insert()!.params[4]);

  beforeEach(async () => {
    dsMock = { manager: { query: jest.fn() } };
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        IvssPresenceIngestionService,
        { provide: DataSource, useValue: dsMock },
      ],
    }).compile();
    service = module.get(IvssPresenceIngestionService);
  });

  // ── C5 matchState (4 trạng thái) ──
  it('matched (person + channel OK) → processed + payload userId/roomId/meetingId', async () => {
    wire();
    await service.onFaceEvent(evt());
    const ins = insert();
    expect(ins).toBeDefined();
    expect(ins!.params[5]).toBe('processed'); // processed_status
    const p = payloadOf();
    expect(p.matchState).toBe('matched');
    expect(p.userId).toBe('u1');
    expect(p.roomId).toBe(ROOM_UUID);
    expect(p.meetingId).toBe('m1');
  });

  it('C1: INSERT dùng event_type=ivss_face_event + source_protocol=ivss', async () => {
    wire();
    await service.onFaceEvent(evt());
    expect(insert()!.sql).toContain("'ivss_face_event'");
    expect(insert()!.sql).toContain("'ivss'");
  });

  it('unmatched_identity (szUid lạ + room OK) → unmatched, vẫn persist', async () => {
    wire({ user: [] });
    await service.onFaceEvent(evt());
    expect(insert()!.params[5]).toBe('unmatched');
    expect(payloadOf().matchState).toBe('unmatched_identity');
  });

  it('unmatched_location (user OK + channel lạ) → unmatched, vẫn persist', async () => {
    wire({ channelMap: {} }); // map rỗng → channel 5 không có
    await service.onFaceEvent(evt());
    expect(insert()!.params[5]).toBe('unmatched');
    expect(payloadOf().matchState).toBe('unmatched_location');
  });

  it('unmatched_both (szUid lạ + channel lạ) → unmatched_both', async () => {
    wire({ user: [], channelMap: {} });
    await service.onFaceEvent(evt());
    expect(payloadOf().matchState).toBe('unmatched_both');
  });

  // ── OQ-3 direction ĐỘC LẬP matchState (C5) ──
  it('direction độc lập: unmatched vẫn giữ direction theo eventAction (KHÔNG bị "unknown")', async () => {
    wire({ user: [] }); // unmatched_identity nhưng eventAction='1'
    await service.onFaceEvent(evt({ eventAction: '1' }));
    const p = payloadOf();
    expect(p.matchState).toBe('unmatched_identity');
    expect(p.direction).toBe('enter'); // KHÔNG ghi đè unknown
  });

  it('direction: eventAction 1→enter, 2→leave, lạ→seen, thiếu→seen', async () => {
    for (const [action, dir] of [
      ['1', 'enter'],
      ['enter', 'enter'],
      ['2', 'leave'],
      ['out', 'leave'],
      ['weird', 'seen'],
      [undefined, 'seen'],
    ] as Array<[string | undefined, string]>) {
      wire();
      await service.onFaceEvent(evt({ eventAction: action }));
      expect(payloadOf().direction).toBe(dir);
    }
  });

  // ── C3 utc fallback ──
  it('utc rác → eventTime fallback now + payload utcFallback:true', async () => {
    wire();
    await service.onFaceEvent(evt({ utc: 'not-a-date' }));
    const p = payloadOf();
    expect(p.utcFallback).toBe(true);
    // event_time (param[3]) là Date now (không NaN).
    expect(insert()!.params[3] instanceof Date).toBe(true);
  });

  it('utc lệch xa (>1h) → fallback', async () => {
    wire();
    await service.onFaceEvent(evt({ utc: '2000-01-01T00:00:00.000Z' }));
    expect(payloadOf().utcFallback).toBe(true);
  });

  // ── SEC-01 ──
  it('SEC-01: payload KHÔNG chứa imageBase64', async () => {
    wire();
    await service.onFaceEvent(
      evt({ imageBase64: 'data:image/jpeg;base64,SECRETBASE64DATA==' }),
    );
    const rawPayload = insert()!.params[4];
    expect(rawPayload).not.toContain('imageBase64');
    expect(rawPayload).not.toContain('SECRETBASE64DATA');
    expect(rawPayload).not.toContain('base64');
  });

  // ── defensive ──
  it('bridge device không tồn tại → skip (KHÔNG INSERT)', async () => {
    wire({ bridge: [] });
    await service.onFaceEvent(evt());
    expect(insert()).toBeUndefined();
  });

  it('DB lỗi (INSERT throw) → KHÔNG throw (webhook always-ack)', async () => {
    wire({ insertThrows: true });
    await expect(service.onFaceEvent(evt())).resolves.toBeUndefined();
  });

  it('channel-map: entry value KHÔNG phải uuid → bị bỏ (SEC-03 validate)', async () => {
    wire({ channelMap: { '5': 'not-a-uuid' } });
    await service.onFaceEvent(evt());
    // channel 5 map giá trị rác → bỏ → unmatched_location.
    expect(payloadOf().matchState).toBe('unmatched_location');
  });

  it('channel-map null (chưa config) → mọi channel unmatched_location', async () => {
    wire({ channelMap: null });
    await service.onFaceEvent(evt());
    expect(payloadOf().matchState).toBe('unmatched_location');
  });

  it('room OK nhưng KHÔNG có meeting active → meetingId null, vẫn matched', async () => {
    wire({ meeting: [] });
    await service.onFaceEvent(evt());
    const p = payloadOf();
    expect(p.matchState).toBe('matched');
    expect(p.meetingId).toBeNull();
  });
});
