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
  let captured: Array<{ sql: string; params: any[] }>;

  const wire = (
    over: { bridge?: any[]; user?: any[]; insertThrows?: boolean } = {},
  ) => {
    captured = [];
    dsMock.manager.query.mockImplementation((sql: string, params: any[]) => {
      captured.push({ sql, params });
      if (sql.includes('FROM iot_devices WHERE device_code'))
        return Promise.resolve(over.bridge ?? [{ id: 'bridge1' }]);
      if (sql.includes('FROM vehicle_registrations'))
        return Promise.resolve(over.user ?? [{ user_id: 'u1' }]);
      if (sql.includes('INSERT INTO iot_device_events')) {
        if (over.insertThrows) return Promise.reject(new Error('db boom'));
        return Promise.resolve(undefined);
      }
      return Promise.resolve(undefined);
    });
  };

  const insert = () =>
    captured.find((c) => c.sql.includes('INSERT INTO iot_device_events'));
  const payloadOf = () => JSON.parse(insert()!.params[2]);

  beforeEach(() => {
    dsMock = { manager: { query: jest.fn() } };
    service = new VehicleResolveService(dsMock as DataSource);
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
});
