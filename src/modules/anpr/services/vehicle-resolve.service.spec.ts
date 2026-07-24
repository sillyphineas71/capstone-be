/* eslint-disable @typescript-eslint/no-unsafe-member-access, @typescript-eslint/no-unsafe-assignment, @typescript-eslint/no-unsafe-call, @typescript-eslint/no-unsafe-argument, @typescript-eslint/no-unsafe-return */
import { DataSource } from 'typeorm';
import { VehicleResolveService } from './vehicle-resolve.service.js';

const evt = (over: any = {}) => ({
  plateRaw: '30A-123.45',
  plateNumber: '30A12345',
  channelId: 5,
  utc: '2026-06-24T09:00:00.000Z',
  eventAction: 'in',
  ...over,
});

describe('VehicleResolveService (VRE-001 / UC5)', () => {
  let service: VehicleResolveService;
  let dsMock: any;
  let alertMock: any;
  let gateMock: any;
  let pairMock: any;
  let captured: Array<{ sql: string; params: any[] }>;

  const wire = (
    over: {
      bridge?: any[];
      user?: any[];
      insertThrows?: boolean;
      zoneMap?: Record<string, string>; // channel → zone_uuid (config_json)
      dirMap?: Record<string, string>; // channel → enter/leave/seen
    } = {},
  ) => {
    captured = [];
    dsMock.manager.query.mockImplementation((sql: string, params: any[]) => {
      captured.push({ sql, params });
      if (sql.includes('FROM iot_devices WHERE device_code'))
        return Promise.resolve(over.bridge ?? [{ id: 'bridge1' }]);
      if (sql.includes('FROM vehicle_registrations'))
        return Promise.resolve(over.user ?? [{ id: 'reg1', user_id: 'u1' }]);
      if (sql.includes('FROM system_configs')) {
        const key = params?.[0];
        if (key === 'ivss.channel_zone_map')
          return Promise.resolve(
            over.zoneMap ? [{ config_json: over.zoneMap }] : [],
          );
        if (key === 'ivss.channel_direction_map')
          return Promise.resolve(
            over.dirMap ? [{ config_json: over.dirMap }] : [],
          );
        return Promise.resolve([]);
      }
      if (sql.includes('INSERT INTO iot_device_events')) {
        if (over.insertThrows) return Promise.reject(new Error('db boom'));
        return Promise.resolve([{ id: 'evt1' }]); // QĐ-6: RETURNING id
      }
      if (sql.includes('UPDATE iot_device_events'))
        return Promise.resolve(undefined);
      return Promise.resolve(undefined);
    });
  };

  const insert = () =>
    captured.find((c) => c.sql.includes('INSERT INTO iot_device_events'));
  const update = () =>
    captured.find((c) => c.sql.includes('UPDATE iot_device_events'));
  const payloadOf = () => JSON.parse(insert()!.params[2]);
  // channel mặc định 5 map sang zone gate + direction (dùng cho test có ghi gate log).
  const GATE = {
    zoneMap: { '5': 'aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee' },
    dirMap: { '5': 'enter' },
  };

  beforeEach(() => {
    dsMock = { manager: { query: jest.fn() } };
    alertMock = { evaluate: jest.fn().mockResolvedValue(undefined) };
    gateMock = {
      writeGateLog: jest
        .fn()
        .mockResolvedValue({ written: true, logId: 'gl1' }),
    };
    pairMock = {
      pairForLeaveLog: jest.fn().mockResolvedValue('skipped'),
    };
    service = new VehicleResolveService(
      dsMock as DataSource,
      alertMock,
      gateMock,
      pairMock,
    );
  });

  it('matched: biển active → INSERT processed + payload.userId set', async () => {
    wire();
    await service.onVehicleEvent(evt());
    const ins = insert();
    expect(ins).toBeDefined();
    expect(ins!.params[3]).toBe('processed'); // processed_status
    const p = payloadOf();
    expect(p.matchState).toBe('matched');
    expect(p.userId).toBe('u1');
    expect(p.plateNumber).toBe('30A12345');
    expect(p.plateRaw).toBe('30A-123.45');
  });

  it('unmatched: biển không có/disabled/đã-xóa (resolve null) → INSERT unmatched + userId null', async () => {
    wire({ user: [] });
    await service.onVehicleEvent(evt());
    expect(insert()!.params[3]).toBe('unmatched');
    const p = payloadOf();
    expect(p.matchState).toBe('unmatched');
    expect(p.userId).toBeNull();
  });

  it('C1-isolation: INSERT event_type=ivss_vehicle_event (KHÔNG ivss_face_event)', async () => {
    wire();
    await service.onVehicleEvent(evt());
    expect(insert()!.sql).toContain("'ivss_vehicle_event'");
    expect(insert()!.sql).not.toContain('ivss_face_event');
  });

  it('room/meeting NULL: INSERT literal NULL cho room_id/meeting_id', async () => {
    wire();
    await service.onVehicleEvent(evt());
    // VALUES ($1, NULL, NULL, 'ivss_vehicle_event', ...) — 4 bind params (KHÔNG có room/meeting).
    expect(insert()!.sql).toMatch(/VALUES \(\$1, NULL, NULL,/);
    expect(insert()!.params).toHaveLength(4);
  });

  it('resolve query: plate_number + status active + deleted_at IS NULL', async () => {
    wire();
    await service.onVehicleEvent(evt());
    const q = captured.find((c) =>
      c.sql.includes('FROM vehicle_registrations'),
    );
    expect(String(q?.sql)).toContain("status = 'active'");
    expect(String(q?.sql)).toContain('deleted_at IS NULL');
    expect(q?.params).toEqual(['30A12345']); // DATA-03: dùng plateNumber đã chuẩn
  });

  it('direction: in→enter, out→leave, absent/lạ→seen', async () => {
    for (const [action, dir] of [
      ['in', 'enter'],
      ['entry', 'enter'],
      ['out', 'leave'],
      ['exit', 'leave'],
      ['weird', 'seen'],
      [undefined, 'seen'],
    ] as Array<[string | undefined, string]>) {
      wire();
      await service.onVehicleEvent(evt({ eventAction: action }));
      expect(payloadOf().direction).toBe(dir);
    }
  });

  it('parseUtc: utc rác → eventTime = Date now (không NaN)', async () => {
    wire();
    await service.onVehicleEvent(evt({ utc: 'not-a-date' }));
    expect(insert()!.params[1] instanceof Date).toBe(true);
    expect(Number.isNaN((insert()!.params[1] as Date).getTime())).toBe(false);
  });

  it('parseUtc: utc lệch xa (>1h) → fallback now', async () => {
    wire();
    await service.onVehicleEvent(evt({ utc: '2000-01-01T00:00:00.000Z' }));
    const t = insert()!.params[1] as Date;
    expect(Math.abs(Date.now() - t.getTime())).toBeLessThan(60_000);
  });

  it('NotThrow: INSERT ném lỗi → onVehicleEvent KHÔNG ném', async () => {
    wire({ insertThrows: true });
    await expect(service.onVehicleEvent(evt())).resolves.toBeUndefined();
  });

  it('device chưa seed: resolveBridgeDeviceId [] → KHÔNG INSERT, log+return', async () => {
    wire({ bridge: [] });
    await service.onVehicleEvent(evt());
    expect(insert()).toBeUndefined();
  });

  it('SEC-01: payload (param) KHÔNG chứa imageBase64 dù evt có', async () => {
    wire();
    await service.onVehicleEvent(
      evt({ imageBase64: 'data:image/jpeg;base64,SECRETB64DATA' }),
    );
    const raw = insert()!.params[2];
    expect(raw).not.toContain('imageBase64');
    expect(raw).not.toContain('SECRETB64DATA');
  });

  it('optional fields (plateColor/vehicleType) vào payload khi có', async () => {
    wire();
    await service.onVehicleEvent(
      evt({ plateColor: 'white', vehicleType: 'car' }),
    );
    const p = payloadOf();
    expect(p.plateColor).toBe('white');
    expect(p.vehicleType).toBe('car');
  });

  // ── UC9 (VCC-001): wiring VehicleControlAlertService.evaluate ──
  describe('UC9 control-list alert wiring', () => {
    it('matched: evaluate được gọi với (plateNumber, {channelId, direction})', async () => {
      wire();
      await service.onVehicleEvent(evt({ eventAction: 'in' }));
      expect(alertMock.evaluate).toHaveBeenCalledWith('30A12345', {
        channelId: 5,
        direction: 'enter',
      });
    });

    it('unmatched: evaluate VẪN được gọi (độc lập matchState)', async () => {
      wire({ user: [] });
      await service.onVehicleEvent(evt());
      expect(alertMock.evaluate).toHaveBeenCalledTimes(1);
    });

    it('NotThrow: alertMock.evaluate reject → onVehicleEvent KHÔNG throw', async () => {
      wire();
      alertMock.evaluate.mockRejectedValue(new Error('alert boom'));
      await expect(service.onVehicleEvent(evt())).resolves.toBeUndefined();
    });
  });

  // ── B3 (GAW-001): readers channel_zone/direction_map + resolveUserByPlate mở rộng ──
  describe('channel maps readers (GAW-001)', () => {
    const UUID = 'aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee';

    it('getChannelZoneMap: chỉ giữ entry value là UUID hợp lệ', async () => {
      dsMock.manager.query.mockResolvedValueOnce([
        { config_json: { '3': UUID, '4': 'not-a-uuid', '5': 123 } },
      ]);
      const map = await (service as any).getChannelZoneMap();
      expect(map).toEqual({ '3': UUID });
    });

    it('getChannelZoneMap: config trống/thiếu → {}', async () => {
      dsMock.manager.query.mockResolvedValueOnce([]);
      expect(await (service as any).getChannelZoneMap()).toEqual({});
    });

    it('getChannelZoneMap: query ném → {} (KHÔNG throw)', async () => {
      dsMock.manager.query.mockRejectedValueOnce(new Error('cfg down'));
      expect(await (service as any).getChannelZoneMap()).toEqual({});
    });

    it('getChannelDirectionMap: chỉ nhận enter/leave/seen, bỏ value lạ', async () => {
      dsMock.manager.query.mockResolvedValueOnce([
        { config_json: { '3': 'enter', '4': 'leave', '5': 'seen', '6': 'up' } },
      ]);
      const map = await (service as any).getChannelDirectionMap();
      expect(map).toEqual({ '3': 'enter', '4': 'leave', '5': 'seen' });
    });

    it('getChannelDirectionMap: query ném → {} (KHÔNG throw)', async () => {
      dsMock.manager.query.mockRejectedValueOnce(new Error('cfg down'));
      expect(await (service as any).getChannelDirectionMap()).toEqual({});
    });
  });

  describe('resolveUserByPlate mở rộng (QC-7)', () => {
    it('matched → {userId, vehicleRegistrationId} (một query SELECT id, user_id)', async () => {
      dsMock.manager.query.mockResolvedValueOnce([
        { id: 'reg-9', user_id: 'u9' },
      ]);
      const r = await (service as any).resolveUserByPlate('30A12345');
      expect(r).toEqual({ userId: 'u9', vehicleRegistrationId: 'reg-9' });
      const sql = String(dsMock.manager.query.mock.calls[0][0]);
      expect(sql).toContain('SELECT id, user_id');
    });

    it('không match → null', async () => {
      dsMock.manager.query.mockResolvedValueOnce([]);
      expect(await (service as any).resolveUserByPlate('X')).toBeNull();
    });
  });

  // ── B4 (GAW-001 / UC-105): writer gate log ──
  describe('gate log writer (GAW-001)', () => {
    // utc gần "now" để parseUtc KHÔNG fallback (utcFallback=false).
    const nowIso = () => new Date().toISOString();

    // T4.1 — AC-BACKCOMPAT (characterization): channel_zone_map trống = hiện trạng hôm nay.
    it('AC-BACKCOMPAT: map trống → KHÔNG writeGateLog, INSERT giữ trường/giá trị cũ, không ném', async () => {
      wire(); // KHÔNG zoneMap → zone_unmapped
      await expect(
        service.onVehicleEvent(evt({ utc: nowIso() })),
      ).resolves.toBeUndefined();
      expect(gateMock.writeGateLog).not.toHaveBeenCalled();
      // CHỨA các khoá cũ với giá trị cũ (toMatchObject — KHÔNG toEqual cả payload).
      expect(payloadOf()).toMatchObject({
        plateNumber: '30A12345',
        plateRaw: '30A-123.45',
        userId: 'u1',
        matchState: 'matched',
        direction: 'enter',
        channelId: 5,
      });
      expect(insert()!.params).toHaveLength(4);
      expect(insert()!.sql).toContain('RETURNING id');
    });

    it('T4.3: map trống → gateLogSkipped=zone_unmapped trong payload', async () => {
      wire();
      await service.onVehicleEvent(evt({ utc: nowIso() }));
      expect(payloadOf().gateLogSkipped).toBe('zone_unmapped');
      expect(gateMock.writeGateLog).not.toHaveBeenCalled();
    });

    it('direction_seen: zone mapped nhưng direction resolve = seen → KHÔNG ghi', async () => {
      wire({ zoneMap: GATE.zoneMap }); // KHÔNG dirMap + eventAction lạ → seen
      await service.onVehicleEvent(
        evt({ eventAction: 'weird', utc: nowIso() }),
      );
      expect(payloadOf().gateLogSkipped).toBe('direction_seen');
      expect(gateMock.writeGateLog).not.toHaveBeenCalled();
    });

    it('plate_too_long: biển >16 ký tự → KHÔNG ghi', async () => {
      wire(GATE);
      await service.onVehicleEvent(
        evt({ plateNumber: 'A'.repeat(17), utc: nowIso() }),
      );
      expect(payloadOf().gateLogSkipped).toBe('plate_too_long');
      expect(gateMock.writeGateLog).not.toHaveBeenCalled();
    });

    it('bad_utc (ISO hỏng): utcFallback → KHÔNG ghi, KHÔNG dùng now()', async () => {
      wire(GATE);
      await service.onVehicleEvent(evt({ utc: 'not-a-date' }));
      expect(payloadOf().gateLogSkipped).toBe('bad_utc');
      expect(gateMock.writeGateLog).not.toHaveBeenCalled();
    });

    it('bad_utc (lệch >1h): utc quá xa → KHÔNG ghi', async () => {
      wire(GATE);
      await service.onVehicleEvent(evt({ utc: '2000-01-01T00:00:00.000Z' }));
      expect(payloadOf().gateLogSkipped).toBe('bad_utc');
      expect(gateMock.writeGateLog).not.toHaveBeenCalled();
    });

    it('zone_not_gate: writeGateLog trả zone_not_gate → UPDATE payload, KHÔNG pairing', async () => {
      gateMock.writeGateLog.mockResolvedValue({
        written: false,
        skipReason: 'zone_not_gate',
      });
      wire(GATE);
      await service.onVehicleEvent(evt({ utc: nowIso() }));
      expect(gateMock.writeGateLog).toHaveBeenCalledTimes(1);
      const upd = update();
      expect(upd).toBeDefined();
      expect(upd!.params[0]).toBe('zone_not_gate');
      expect(pairMock.pairForLeaveLog).not.toHaveBeenCalled();
    });

    it('duplicate: writeGateLog trả duplicate → UPDATE gateLogSkipped=duplicate, KHÔNG pairing', async () => {
      gateMock.writeGateLog.mockResolvedValue({
        written: false,
        skipReason: 'duplicate',
      });
      wire({ zoneMap: GATE.zoneMap, dirMap: { '5': 'leave' } });
      await service.onVehicleEvent(evt({ utc: nowIso() }));
      expect(update()!.params[0]).toBe('duplicate');
      expect(pairMock.pairForLeaveLog).not.toHaveBeenCalled();
    });

    it('QĐ-6 + QC-8 + QC-5: eventId, accessTime=utc (KHÔNG now), metadata truyền đúng', async () => {
      const iso = nowIso();
      wire(GATE);
      await service.onVehicleEvent(evt({ utc: iso }));
      const arg = gateMock.writeGateLog.mock.calls[0][0];
      expect(arg.eventId).toBe('evt1'); // QĐ-6: từ RETURNING id
      expect(arg.accessTime.toISOString()).toBe(iso); // QC-8: từ evt.utc, KHÔNG now()
      expect(arg.metadata).toEqual({ channelId: 5, plateRaw: '30A-123.45' }); // QC-5
      expect(arg.userId).toBe('u1');
      expect(arg.vehicleRegistrationId).toBe('reg1'); // QC-7
      expect(arg.direction).toBe('enter');
    });

    it('A.5 biển rỗng → writeGateLog nhận plateNumber=null, VẪN ghi', async () => {
      wire(GATE);
      await service.onVehicleEvent(evt({ plateNumber: '', utc: nowIso() }));
      expect(gateMock.writeGateLog).toHaveBeenCalledTimes(1);
      expect(gateMock.writeGateLog.mock.calls[0][0].plateNumber).toBeNull();
    });

    it('leave → pairForLeaveLog(logId); enter → KHÔNG pairing (FR-07)', async () => {
      // leave
      wire({ zoneMap: GATE.zoneMap, dirMap: { '5': 'leave' } });
      await service.onVehicleEvent(evt({ utc: nowIso() }));
      expect(pairMock.pairForLeaveLog).toHaveBeenCalledWith('gl1');
      // enter
      pairMock.pairForLeaveLog.mockClear();
      wire(GATE); // dirMap ch5=enter
      await service.onVehicleEvent(evt({ utc: nowIso() }));
      expect(pairMock.pairForLeaveLog).not.toHaveBeenCalled();
    });

    it('QĐ-8: pairForLeaveLog ném → onVehicleEvent KHÔNG ném, writeGateLog vẫn đã gọi', async () => {
      wire({ zoneMap: GATE.zoneMap, dirMap: { '5': 'leave' } });
      pairMock.pairForLeaveLog.mockRejectedValue(new Error('pair boom'));
      await expect(
        service.onVehicleEvent(evt({ utc: nowIso() })),
      ).resolves.toBeUndefined();
      expect(gateMock.writeGateLog).toHaveBeenCalledTimes(1);
    });

    it('writeGateLog ném lỗi THƯỜNG → KHÔNG ném, INSERT còn, KHÔNG pairing (spec §8.1)', async () => {
      wire(GATE);
      gateMock.writeGateLog.mockRejectedValue(new Error('conn lost'));
      await expect(
        service.onVehicleEvent(evt({ utc: nowIso() })),
      ).resolves.toBeUndefined();
      expect(insert()).toBeDefined();
      expect(pairMock.pairForLeaveLog).not.toHaveBeenCalled();
    });

    it('gateDirection từ channel_direction_map (QĐ-3) ưu tiên hơn eventAction', async () => {
      // eventAction 'in' (→enter) nhưng dirMap ch5='leave' → gate ghi leave.
      wire({ zoneMap: GATE.zoneMap, dirMap: { '5': 'leave' } });
      await service.onVehicleEvent(evt({ eventAction: 'in', utc: nowIso() }));
      expect(gateMock.writeGateLog.mock.calls[0][0].direction).toBe('leave');
      // payload.direction (raw) GIỮ eventAction-based = enter (AC-BACKCOMPAT).
      expect(payloadOf().direction).toBe('enter');
    });

    // ⭐ CRUX camera ANPR IPC thật: TRAFFICJUNCTION 0x17 → bridge hard-code eventAction='seen'.
    // channel_direction_map PHẢI cứu (QĐ-3): 'seen' đơn độc sẽ skip direction_seen, nhưng
    // dirMap='enter' → gateDirection='enter' → VẪN ghi gate log. KHÔNG có test này thì lỗi
    // "không dòng gate log nào lúc cắm camera thật" quay lại âm thầm.
    it('IPC: eventAction=seen NHƯNG channel_direction_map=enter → PHẢI ghi enter, KHÔNG skip', async () => {
      wire({ zoneMap: GATE.zoneMap, dirMap: { '5': 'enter' } });
      await service.onVehicleEvent(evt({ eventAction: 'seen', utc: nowIso() }));
      expect(payloadOf().gateLogSkipped).toBeNull();
      expect(gateMock.writeGateLog).toHaveBeenCalledTimes(1);
      expect(gateMock.writeGateLog.mock.calls[0][0].direction).toBe('enter');
    });

    it('evaluate() (điểm chèn 1) vẫn được gọi trước INSERT dù có writer', async () => {
      wire(GATE);
      await service.onVehicleEvent(evt({ utc: nowIso() }));
      expect(alertMock.evaluate).toHaveBeenCalledTimes(1);
    });
  });
});
