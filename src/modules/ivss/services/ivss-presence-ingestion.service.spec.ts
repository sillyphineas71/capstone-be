/* eslint-disable @typescript-eslint/no-unsafe-member-access, @typescript-eslint/no-unsafe-assignment, @typescript-eslint/no-unsafe-call, @typescript-eslint/no-unsafe-return, @typescript-eslint/no-unsafe-argument */
import { Test, TestingModule } from '@nestjs/testing';
import { ConfigService } from '@nestjs/config';
import { DataSource } from 'typeorm';
import { IvssPresenceIngestionService } from './ivss-presence-ingestion.service.js';
import { WebsocketService } from '../../websocket/websocket.service.js';
import { ZonePresenceWriterService } from '../../zones/services/zone-presence-writer.service.js';
import { StorageService } from '../../storage/storage.service.js';

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
  let writerMock: any;
  let storageMock: any;
  let captured: Array<{ sql: string; params: any[] }>;
  const AREA_UUID = '33333333-3333-3333-3333-333333333333';

  const wire = (
    over: {
      bridge?: any[];
      user?: any[];
      channelMap?: Record<string, unknown> | null;
      meeting?: any[];
      participant?: any[];
      insertThrows?: boolean;
      fullName?: any[];
      fullNameThrows?: boolean;
      directionMap?: Record<string, unknown> | null;
      directionMapThrows?: boolean;
      presenceMap?: Record<string, unknown> | null; // ZPW-001 channel_presence_zone_map
      mediaFileId?: string | null; // id RETURNING của INSERT INTO media_files (snapshot)
      mediaFileInsertThrows?: boolean;
    } = {},
  ) => {
    captured = [];
    dsMock.manager.query.mockImplementation((sql: string, params: any[]) => {
      captured.push({ sql, params });
      if (sql.includes('FROM iot_devices WHERE device_code'))
        return Promise.resolve(over.bridge ?? [{ id: 'bridge1' }]);
      // Nợ #3: participant check — default LÀ participant ([{id}]); over.participant=[] → ngoài họp.
      if (sql.includes('FROM meeting_participants'))
        return Promise.resolve(over.participant ?? [{ id: 'p1' }]);
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
      // ZPW-001: channel_presence_zone_map (parameterized config_key = $1).
      if (params?.[0] === 'ivss.channel_presence_zone_map')
        return Promise.resolve([{ config_json: over.presenceMap ?? null }]);
      if (sql.includes('FROM meetings'))
        return Promise.resolve(over.meeting ?? [{ id: MEETING_UUID }]);
      if (sql.includes('FROM users WHERE id')) {
        if (over.fullNameThrows)
          return Promise.reject(new Error('users query boom'));
        return Promise.resolve(over.fullName ?? [{ full_name: 'Alice' }]);
      }
      // saveEventSnapshot() INSERT vào media_files (RETURNING id).
      if (sql.includes('INSERT INTO media_files')) {
        if (over.mediaFileInsertThrows)
          return Promise.reject(new Error('media_files boom'));
        return Promise.resolve([{ id: over.mediaFileId ?? 'media1' }]);
      }
      if (sql.includes('INSERT INTO iot_device_events')) {
        if (over.insertThrows) return Promise.reject(new Error('db boom'));
        return Promise.resolve([{ id: 'evt1' }]); // QĐ-4: RETURNING id
      }
      return Promise.resolve(undefined);
    });
  };

  const insert = () =>
    captured.find((c) => c.sql.includes('INSERT INTO iot_device_events'));
  const payloadOf = () => JSON.parse(insert()!.params[4]);
  const snapshotFileIdOf = () => insert()!.params[6];

  // IRP-001 (#40): build service với gate realtime ON/OFF (B1 — mirror configService.get bool).
  const build = async (realtime = false) => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        IvssPresenceIngestionService,
        { provide: DataSource, useValue: dsMock },
        { provide: WebsocketService, useValue: wsMock },
        { provide: ZonePresenceWriterService, useValue: writerMock },
        { provide: StorageService, useValue: storageMock },
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
    writerMock = {
      resolvePresenceZone: jest.fn().mockResolvedValue({ valid: true }),
      writeAppearEvent: jest.fn().mockResolvedValue({ presenceId: 'zpe1' }),
    };
    storageMock = {
      saveFile: jest.fn().mockResolvedValue({
        storageKey: 'stranger-snapshots/x.jpg',
        publicUrl: 'http://localhost:3000/uploads/stranger-snapshots/x.jpg',
        sizeBytes: 123,
      }),
      getDriver: jest.fn().mockReturnValue('local'),
    };
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

  // ── snapshot: lưu ảnh cho MỌI matchState có imageBase64 (quyết định 2026-08-07,
  // thay thế gate cũ F-B unmatched-only + F-C zone-violation-only) ──
  describe('snapshot (mọi matchState có ảnh)', () => {
    const AREA = AREA_UUID;
    const withImage = (over: any = {}) =>
      evt({
        imageBase64: 'data:image/jpeg;base64,SGVsbG8=',
        ...over,
      });

    it('matched + có ảnh → lưu snapshot, snapshot_file_id khác null (đảo ngược hành vi cũ)', async () => {
      wire();
      await service.onFaceEvent(withImage());
      expect(payloadOf().matchState).toBe('matched');
      expect(storageMock.saveFile).toHaveBeenCalledTimes(1);
      expect(storageMock.saveFile.mock.calls[0][0]).toMatchObject({
        folder: 'stranger-snapshots',
      });
      expect(snapshotFileIdOf()).toBe('media1');
    });

    it('unmatched_identity (szUid lạ) + có ảnh → lưu snapshot', async () => {
      wire({ user: [] });
      await service.onFaceEvent(withImage());
      expect(payloadOf().matchState).toBe('unmatched_identity');
      expect(snapshotFileIdOf()).toBe('media1');
    });

    it('unmatched_both (szUid lạ + channel lạ) + có ảnh → lưu snapshot', async () => {
      wire({ user: [], channelMap: {} });
      await service.onFaceEvent(withImage());
      expect(payloadOf().matchState).toBe('unmatched_both');
      expect(snapshotFileIdOf()).toBe('media1');
    });

    it('unmatched_location + có ảnh → GIỜ CŨNG lưu snapshot (trước đây không)', async () => {
      wire({ channelMap: {} }); // user OK, channel lạ → unmatched_location
      await service.onFaceEvent(withImage());
      expect(payloadOf().matchState).toBe('unmatched_location');
      expect(snapshotFileIdOf()).toBe('media1');
    });

    it('không có ảnh (mọi matchState) → KHÔNG gọi storage, snapshot null', async () => {
      wire();
      await service.onFaceEvent(evt());
      expect(storageMock.saveFile).not.toHaveBeenCalled();
      expect(snapshotFileIdOf()).toBeNull();
    });

    it('storage.saveFile lỗi → KHÔNG throw, raw event vẫn persist, snapshot_file_id null', async () => {
      wire();
      storageMock.saveFile.mockRejectedValueOnce(new Error('disk full'));
      await expect(service.onFaceEvent(withImage())).resolves.toBeUndefined();
      expect(insert()).toBeDefined();
      expect(snapshotFileIdOf()).toBeNull();
    });

    it('INSERT media_files lỗi → KHÔNG throw, snapshot_file_id null, raw event vẫn persist', async () => {
      wire({ mediaFileInsertThrows: true });
      await expect(service.onFaceEvent(withImage())).resolves.toBeUndefined();
      expect(insert()).toBeDefined();
      expect(snapshotFileIdOf()).toBeNull();
    });

    it('SEC-01 vẫn giữ nguyên: payload_json KHÔNG chứa base64 dù đã lưu snapshot', async () => {
      wire();
      await service.onFaceEvent(withImage());
      const rawPayload = insert()!.params[4];
      expect(rawPayload).not.toContain('base64');
      expect(rawPayload).not.toContain('SGVsbG8');
      expect(snapshotFileIdOf()).toBe('media1');
    });

    it('zone appear (presence-map có zone) + có ảnh → chỉ lưu 1 lần, KHÔNG double-save', async () => {
      wire({ presenceMap: { '5': AREA } });
      await service.onFaceEvent(withImage({ utc: new Date().toISOString() }));
      expect(writerMock.writeAppearEvent).toHaveBeenCalledTimes(1);
      expect(storageMock.saveFile).toHaveBeenCalledTimes(1);
      expect(snapshotFileIdOf()).toBe('media1');
    });

    it('alert_rules KHÔNG còn được tra khi lưu snapshot (gate zone-violation đã bỏ)', async () => {
      wire({ presenceMap: { '5': AREA } });
      await service.onFaceEvent(withImage());
      expect(captured.some((c) => c.sql.includes('FROM alert_rules'))).toBe(
        false,
      );
      expect(snapshotFileIdOf()).toBe('media1');
    });
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

  // ── Nợ #3: matched YÊU CẦU là participant của meeting đang diễn ra ──
  // Test cũ "room OK + KHÔNG meeting active → vẫn matched" đã VIẾT LẠI: hành vi đó
  // cho phép điểm danh khi không có họp nào — chính là lỗ hổng Nợ #3 cần bịt.
  it('Nợ #3: room OK nhưng KHÔNG có meeting active → meetingId null → unmatched_identity', async () => {
    wire({ meeting: [] });
    await service.onFaceEvent(evt());
    const p = payloadOf();
    expect(p.matchState).toBe('unmatched_identity');
    expect(p.meetingId).toBeNull();
    expect(insert()!.params[5]).toBe('unmatched');
    // Không có meetingId → KHÔNG tốn query participant.
    expect(
      captured.some((c) => c.sql.includes('FROM meeting_participants')),
    ).toBe(false);
  });

  it('Nợ #3: user nhận diện được + có meeting active nhưng KHÔNG phải participant → unmatched_identity + processed_status unmatched', async () => {
    wire({ participant: [] }); // meeting m=MEETING_UUID active, user u1 KHÔNG trong danh sách
    await service.onFaceEvent(evt());
    const p = payloadOf();
    expect(p.matchState).toBe('unmatched_identity');
    expect(insert()!.params[5]).toBe('unmatched'); // KHÔNG được điểm danh
    // Vẫn persist đủ ngữ cảnh để truy vết (OQ-5): biết là ai, ở đâu, họp nào.
    expect(p.userId).toBe('u1');
    expect(p.roomId).toBe(ROOM_UUID);
    expect(p.meetingId).toBe(MEETING_UUID);
    // Query participant bind đúng tham số (SEC-03).
    const pq = captured.find((c) =>
      c.sql.includes('FROM meeting_participants'),
    );
    expect(pq).toBeDefined();
    expect(pq!.params).toEqual([MEETING_UUID, 'u1']);
  });

  it('Nợ #3: user LÀ participant của meeting active → matched + processed', async () => {
    wire({ participant: [{ id: 'p1' }] });
    await service.onFaceEvent(evt());
    const p = payloadOf();
    expect(p.matchState).toBe('matched');
    expect(p.meetingId).toBe(MEETING_UUID);
    expect(insert()!.params[5]).toBe('processed');
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

  // ── ZPW-001 (UC-109 B4): writer appear ──
  describe('zone presence writer (ZPW-001)', () => {
    const nowIso = () => new Date().toISOString();
    const AREA = AREA_UUID;

    // T4.1 — AC-BACKCOMPAT: presence-map trống = hiện trạng hôm nay.
    it('AC-BACKCOMPAT: presence-map trống → KHÔNG writeAppearEvent, điểm danh giữ nguyên, không ném', async () => {
      wire(); // KHÔNG presenceMap → zone_unmapped
      await expect(service.onFaceEvent(evt())).resolves.toBeUndefined();
      expect(writerMock.writeAppearEvent).not.toHaveBeenCalled();
      expect(payloadOf()).toMatchObject({
        szUid: 'SZ1',
        userId: 'u1',
        channelId: 5,
        roomId: ROOM_UUID,
        matchState: 'matched',
      });
      expect(insert()!.sql).toContain('RETURNING id');
      expect(payloadOf().presenceSkipped).toBe('zone_unmapped');
    });

    it('unmatched_identity: userId NULL → payload skip, KHÔNG writeAppearEvent', async () => {
      wire({ presenceMap: { '5': AREA }, user: [] });
      await service.onFaceEvent(evt({ utc: nowIso() }));
      expect(payloadOf().presenceSkipped).toBe('unmatched_identity');
      expect(writerMock.writeAppearEvent).not.toHaveBeenCalled();
    });

    it('bad_utc: utcFallback → payload skip, KHÔNG writeAppearEvent (KHÔNG now())', async () => {
      wire({ presenceMap: { '5': AREA } });
      await service.onFaceEvent(evt({ utc: 'not-a-date' }));
      expect(payloadOf().presenceSkipped).toBe('bad_utc');
      expect(writerMock.writeAppearEvent).not.toHaveBeenCalled();
    });

    it('zone_wrong_type: resolvePresenceZone {valid:false} → payload skip, KHÔNG writeAppearEvent', async () => {
      writerMock.resolvePresenceZone.mockResolvedValue({
        valid: false,
        reason: 'zone_wrong_type',
      });
      wire({ presenceMap: { '5': AREA } });
      await service.onFaceEvent(evt({ utc: nowIso() }));
      expect(payloadOf().presenceSkipped).toBe('zone_wrong_type');
      expect(writerMock.writeAppearEvent).not.toHaveBeenCalled();
    });

    it('ghi appear thành công: writeAppearEvent 1 lần, metadata {channelId,szUid,similarity,sourceEventId} KHÔNG name; payload.presenceSkipped null', async () => {
      const iso = nowIso();
      wire({ presenceMap: { '5': AREA } });
      await service.onFaceEvent(evt({ utc: iso, similarity: 88 }));
      expect(writerMock.writeAppearEvent).toHaveBeenCalledTimes(1);
      const arg = writerMock.writeAppearEvent.mock.calls[0][0];
      expect(arg.zoneId).toBe(AREA);
      expect(arg.userId).toBe('u1');
      expect(arg.eventTime.toISOString()).toBe(iso); // từ utc, KHÔNG now()
      expect(arg.metadata).toEqual({
        channelId: 5,
        szUid: 'SZ1',
        similarity: 88,
        sourceEventId: 'evt1',
      });
      expect(arg.metadata.name).toBeUndefined();
      expect(payloadOf().presenceSkipped).toBeNull();
    });

    it('A.2 WARN: channel có KEY trong CẢ room_map lẫn presence_map → logger.warn', async () => {
      const warnSpy = jest.spyOn((service as any).logger, 'warn');
      wire({ presenceMap: { '5': AREA } }); // room_map mặc định cũng có key '5'
      await service.onFaceEvent(evt({ utc: nowIso() }));
      const warned = warnSpy.mock.calls.some((c) =>
        String(c[0]).includes('CẢ room_map lẫn presence_zone_map'),
      );
      expect(warned).toBe(true);
      // vẫn ghi appear.
      expect(writerMock.writeAppearEvent).toHaveBeenCalledTimes(1);
    });

    it('writeAppearEvent ném → onFaceEvent KHÔNG ném, raw event vẫn ghi', async () => {
      writerMock.writeAppearEvent.mockRejectedValue(new Error('zpe boom'));
      wire({ presenceMap: { '5': AREA } });
      await expect(
        service.onFaceEvent(evt({ utc: nowIso() })),
      ).resolves.toBeUndefined();
      expect(insert()).toBeDefined();
    });
  });

  // ── ZPW-001 (UC-109): reader channel_presence_zone_map ──
  describe('getChannelPresenceZoneMap (ZPW-001)', () => {
    const AREA = 'aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee';

    it('chỉ giữ entry value là UUID hợp lệ', async () => {
      dsMock.manager.query.mockResolvedValueOnce([
        { config_json: { '7': AREA, '8': 'not-uuid', '9': 42 } },
      ]);
      const map = await (service as any).getChannelPresenceZoneMap();
      expect(map).toEqual({ '7': AREA });
    });

    it('config trống/thiếu → {}', async () => {
      dsMock.manager.query.mockResolvedValueOnce([]);
      expect(await (service as any).getChannelPresenceZoneMap()).toEqual({});
    });

    it('query ném → {} (KHÔNG throw)', async () => {
      dsMock.manager.query.mockRejectedValueOnce(new Error('cfg down'));
      expect(await (service as any).getChannelPresenceZoneMap()).toEqual({});
    });
  });

  // ── F-B (MST-001): resolveMeeting nhận cả scheduled ──────────────────────
  describe('resolveMeeting (F-B)', () => {
    // utc phải nằm trong ±1h (SKEW) nếu không parseUtc rơi vào nhánh fallback.
    const nowIso = () => new Date().toISOString();

    it('nhận CẢ scheduled lẫn in_progress — bịt khe cron chưa kịp lật đầu giờ', async () => {
      wire();
      await service.onFaceEvent(evt({ utc: nowIso() }));
      const q = captured.find((c) => c.sql.includes('FROM meetings'))!;
      expect(q.sql).toContain("status IN ('scheduled', 'in_progress')");
      // Chặn hồi quy: KHÔNG quay lại lọc cứng 1 trạng thái.
      expect(q.sql).not.toMatch(/status\s*=\s*'in_progress'/);
    });

    it('vẫn chốt theo cửa sổ thời gian + loại soft-delete', async () => {
      wire();
      await service.onFaceEvent(evt({ utc: nowIso() }));
      const q = captured.find((c) => c.sql.includes('FROM meetings'))!;
      expect(q.sql).toContain('BETWEEN start_time AND end_time');
      expect(q.sql).toContain('deleted_at IS NULL');
    });

    it('KHÔNG nhận cancelled/completed/draft/pending_approval', async () => {
      wire();
      await service.onFaceEvent(evt({ utc: nowIso() }));
      const q = captured.find((c) => c.sql.includes('FROM meetings'))!;
      for (const s of ['cancelled', 'completed', 'draft', 'pending_approval']) {
        expect(q.sql).not.toContain(s);
      }
    });

    it('họp scheduled trong giờ → trả meetingId (matched, không còn unmatched)', async () => {
      wire({ meeting: [{ id: MEETING_UUID }] });
      await service.onFaceEvent(evt({ utc: nowIso() }));
      expect(payloadOf().meetingId).toBe(MEETING_UUID);
    });

    it('không có họp nào trong giờ → meetingId null (giữ nguyên hành vi cũ)', async () => {
      wire({ meeting: [] });
      await service.onFaceEvent(evt({ utc: nowIso() }));
      expect(payloadOf().meetingId).toBeNull();
    });
  });

  // ── resolveUser đọc CẢ 2 nguồn mapping (group "1" = ivss, group "USERS" = portrait) ──
  describe('resolveUser: ivss + portrait', () => {
    it('user chỉ có mapping source=portrait → vẫn resolve ra userId', async () => {
      wire();
      // Mô phỏng DB: chỉ tồn tại hàng source='portrait' → chỉ trả row nếu SQL nhận 'portrait'.
      const base = dsMock.manager.query.getMockImplementation();
      dsMock.manager.query.mockImplementation((sql: string, params: any[]) => {
        if (sql.includes('FROM device_user_mappings')) {
          captured.push({ sql, params });
          return Promise.resolve(
            sql.includes("'portrait'") ? [{ user_id: 'u-portrait' }] : [],
          );
        }
        return base(sql, params);
      });

      await service.onFaceEvent(evt());

      expect(payloadOf().userId).toBe('u-portrait');
      const q = captured.find((c) =>
        c.sql.includes('FROM device_user_mappings'),
      )!;
      expect(q.sql).toContain(
        "metadata_json->>'source' IN ('ivss', 'portrait')",
      );
      // Xác định thứ tự khi 1 user có cả 2 nguồn (không phụ thuộc thứ tự vật lý).
      expect(q.sql).toContain('ORDER BY last_synced_at DESC NULLS LAST');
    });
  });
});
