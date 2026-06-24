/* eslint-disable @typescript-eslint/no-unsafe-member-access, @typescript-eslint/no-unsafe-assignment, @typescript-eslint/no-unsafe-call, @typescript-eslint/no-unsafe-return, @typescript-eslint/no-unsafe-argument */
import { Test, TestingModule } from '@nestjs/testing';
import { ConfigService } from '@nestjs/config';
import { DataSource } from 'typeorm';
import { IvssPresenceIngestionService } from './ivss-presence-ingestion.service.js';
import { WebsocketService } from '../../websocket/websocket.service.js';

const ROOM_UUID = '11111111-1111-1111-1111-111111111111';
const MEETING_UUID = '22222222-2222-2222-2222-222222222222';

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
  let wsMock: { emitToRoom: jest.Mock };
  let captured: Array<{ sql: string; params: any[] }>;

  const wire = (
    over: {
      bridge?: any[];
      user?: any[];
      channelMap?: Record<string, unknown> | null;
      meeting?: any[];
      insertThrows?: boolean;
      fullName?: any[];
      fullNameThrows?: boolean;
      directionMap?: Record<string, unknown> | null;
      directionMapThrows?: boolean;
    } = {},
  ) => {
    captured = [];
    dsMock.manager.query.mockImplementation((sql: string, params: any[]) => {
      captured.push({ sql, params });
      if (sql.includes('FROM iot_devices WHERE device_code'))
        return Promise.resolve(over.bridge ?? [{ id: 'bridge1' }]);
      if (sql.includes('FROM device_user_mappings'))
        return Promise.resolve(over.user ?? [{ user_id: 'u1' }]);
      if (sql.includes("config_key = 'ivss.channel_direction_map'")) {
        if (over.directionMapThrows)
          return Promise.reject(new Error('config boom'));
        return Promise.resolve([{ config_json: over.directionMap ?? null }]);
      }
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
        return Promise.resolve(over.meeting ?? [{ id: MEETING_UUID }]);
      if (sql.includes('FROM users WHERE id')) {
        if (over.fullNameThrows)
          return Promise.reject(new Error('users query boom'));
        return Promise.resolve(over.fullName ?? [{ full_name: 'Alice' }]);
      }
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

  // IRP-001 (#40): build service với gate realtime ON/OFF (B1 — mirror configService.get bool).
  const build = async (realtime = false) => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        IvssPresenceIngestionService,
        { provide: DataSource, useValue: dsMock },
        { provide: WebsocketService, useValue: wsMock },
        {
          provide: ConfigService,
          useValue: {
            get: (key: string, def: unknown) =>
              key === 'IVSS_REALTIME_ENABLED' ? realtime : def,
          },
        },
      ],
    }).compile();
    return module.get(IvssPresenceIngestionService);
  };

  beforeEach(async () => {
    dsMock = { manager: { query: jest.fn() } };
    wsMock = { emitToRoom: jest.fn() };
    service = await build(false);
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
    expect(p.meetingId).toBe(MEETING_UUID);
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

  // ── IRP-001 (#40): broadcast realtime presence ──
  describe('IRP-001 broadcast realtime presence', () => {
    const room = `ivss:meeting:${MEETING_UUID}`;

    it('gate ON + matched + meetingId → emitToRoom đúng room + payload (KHÔNG persist-store đổi)', async () => {
      wire();
      service = await build(true);
      await service.onFaceEvent(evt());
      expect(wsMock.emitToRoom).toHaveBeenCalledTimes(1);
      const [r, ev, payload] = wsMock.emitToRoom.mock.calls[0];
      expect(r).toBe(room);
      expect(ev).toBe('ivss.presence');
      expect(payload).toEqual({
        meetingId: MEETING_UUID,
        roomId: ROOM_UUID,
        userId: 'u1',
        fullName: 'Alice',
        direction: 'enter',
        matchState: 'matched',
        at: expect.any(String),
      });
    });

    it('C4/SEC-01: payload KHÔNG szUid/imageBase64/similarity', async () => {
      wire();
      service = await build(true);
      await service.onFaceEvent(
        evt({ similarity: 0.97, imageBase64: 'data:image/jpeg;base64,SECRET' }),
      );
      const raw = JSON.stringify(wsMock.emitToRoom.mock.calls[0][2]);
      expect(raw).not.toContain('szUid');
      expect(raw).not.toContain('SZ1');
      expect(raw).not.toContain('imageBase64');
      expect(raw).not.toContain('similarity');
      expect(raw).not.toContain('0.97');
    });

    it('gate OFF (default) → KHÔNG emit', async () => {
      wire();
      await service.onFaceEvent(evt()); // service = build(false) từ beforeEach
      expect(wsMock.emitToRoom).not.toHaveBeenCalled();
    });

    it('OQ-5: unmatched → KHÔNG emit (dù gate ON)', async () => {
      wire({ user: [] }); // unmatched_identity
      service = await build(true);
      await service.onFaceEvent(evt());
      expect(wsMock.emitToRoom).not.toHaveBeenCalled();
    });

    it('meetingId null (không có họp active) → KHÔNG emit', async () => {
      wire({ meeting: [] });
      service = await build(true);
      await service.onFaceEvent(evt());
      expect(wsMock.emitToRoom).not.toHaveBeenCalled();
    });

    it('OQ-7: INSERT fail → KHÔNG emit (broadcast sau persist)', async () => {
      wire({ insertThrows: true });
      service = await build(true);
      await service.onFaceEvent(evt());
      expect(wsMock.emitToRoom).not.toHaveBeenCalled();
    });

    it('C3: emit throw → KHÔNG vỡ ingest', async () => {
      wire();
      wsMock.emitToRoom.mockImplementation(() => {
        throw new Error('gateway down');
      });
      service = await build(true);
      await expect(service.onFaceEvent(evt())).resolves.toBeUndefined();
    });

    it('B2: query fullName throw → KHÔNG vỡ ingest + KHÔNG emit', async () => {
      wire({ fullNameThrows: true });
      service = await build(true);
      await expect(service.onFaceEvent(evt())).resolves.toBeUndefined();
      expect(wsMock.emitToRoom).not.toHaveBeenCalled();
    });

    it('fullName null (user không có tên) → vẫn emit, fullName:null', async () => {
      wire({ fullName: [{ full_name: null }] });
      service = await build(true);
      await service.onFaceEvent(evt());
      expect(wsMock.emitToRoom).toHaveBeenCalledTimes(1);
      expect(wsMock.emitToRoom.mock.calls[0][2].fullName).toBeNull();
    });
  });

  // ── Task B: direction suy từ channel-direction-map ──
  describe('Task B channel-direction-map', () => {
    it('map {"2":"enter"} + channel 2 + eventAction null → direction enter', async () => {
      wire({ directionMap: { '2': 'enter' } });
      await service.onFaceEvent(evt({ channelId: 2, eventAction: undefined }));
      expect(payloadOf().direction).toBe('enter');
    });

    it('map {"3":"leave"} + channel 3 → direction leave', async () => {
      wire({ directionMap: { '3': 'leave' } });
      await service.onFaceEvent(evt({ channelId: 3, eventAction: undefined }));
      expect(payloadOf().direction).toBe('leave');
    });

    it('number↔string key: channelId=2 (number) khớp key "2" (string)', async () => {
      wire({ directionMap: { '2': 'enter' } });
      await service.onFaceEvent(evt({ channelId: 2, eventAction: undefined }));
      expect(payloadOf().direction).toBe('enter');
    });

    it('KHÔNG map, eventAction "in" → enter (đường cũ nguyên)', async () => {
      wire({ directionMap: null });
      await service.onFaceEvent(evt({ channelId: 9, eventAction: 'in' }));
      expect(payloadOf().direction).toBe('enter');
    });

    it('KHÔNG map, eventAction null → seen', async () => {
      wire({ directionMap: null });
      await service.onFaceEvent(evt({ channelId: 9, eventAction: undefined }));
      expect(payloadOf().direction).toBe('seen');
    });

    it('channel ngoài map → rơi về eventAction/seen', async () => {
      wire({ directionMap: { '2': 'enter' } });
      await service.onFaceEvent(evt({ channelId: 7, eventAction: undefined }));
      expect(payloadOf().direction).toBe('seen');
    });

    it('value lạ trong map → bỏ entry → rơi về eventAction/seen', async () => {
      wire({ directionMap: { '2': 'weird' } });
      await service.onFaceEvent(evt({ channelId: 2, eventAction: undefined }));
      expect(payloadOf().direction).toBe('seen');
    });

    it('channel-map ưu tiên hơn eventAction (camera thắng)', async () => {
      wire({ directionMap: { '2': 'leave' } });
      await service.onFaceEvent(evt({ channelId: 2, eventAction: 'in' }));
      expect(payloadOf().direction).toBe('leave');
    });

    it('đọc config lỗi → fallback eventAction, KHÔNG vỡ ingest (vẫn persist)', async () => {
      wire({ directionMapThrows: true });
      await service.onFaceEvent(evt({ channelId: 2, eventAction: 'in' }));
      expect(insert()).toBeDefined();
      expect(payloadOf().direction).toBe('enter');
    });
  });
});
