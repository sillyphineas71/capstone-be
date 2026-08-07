/* eslint-disable @typescript-eslint/no-unsafe-member-access, @typescript-eslint/no-unsafe-call, @typescript-eslint/no-unsafe-argument, @typescript-eslint/no-unsafe-return */
import { DataSource } from 'typeorm';
import { VehicleHistoryService } from './vehicle-history.service.js';

const row = (over: any = {}) => ({
  id: 'evt-1',
  plate_number: '30A12345',
  channel_id: 5,
  direction: 'enter',
  match_state: 'matched',
  event_time: new Date('2026-06-25T09:00:00.000Z'),
  utc: '2026-06-25T09:00:00.000Z',
  user_id: 'u1',
  ...over,
});

describe('VehicleHistoryService (VHI-001 / UC7)', () => {
  let service: VehicleHistoryService;
  let dsMock: any;
  let captured: Array<{ sql: string; params: any[] }>;

  const wire = (rows: any[] = [row()], total = 1) => {
    captured = [];
    dsMock.manager.query.mockImplementation((sql: string, params: any[]) => {
      captured.push({ sql, params });
      if (sql.includes('COUNT(*)')) return Promise.resolve([{ total }]);
      return Promise.resolve(rows);
    });
  };
  const countCall = () => captured.find((c) => c.sql.includes('COUNT(*)'));
  const rowsCall = () =>
    captured.find((c) => c.sql.includes('ORDER BY event_time DESC'));
  const q = (over: any = {}) => ({ page: 1, limit: 20, ...over });

  beforeEach(() => {
    dsMock = { manager: { query: jest.fn() } };
    service = new VehicleHistoryService(dsMock as DataSource);
  });

  // ── user-scope ──
  it("listForUser: WHERE payload_json->>'userId' = $1 (param u1); output KHÔNG userId", async () => {
    wire();
    const r = await service.listForUser('u1', q());
    const sql = rowsCall()!.sql;
    expect(sql).toContain("payload_json->>'userId' = $1");
    expect(rowsCall()!.params[0]).toBe('u1');
    // SELECT KHÔNG có user_id column → item không có userId.
    expect(sql).not.toContain('AS user_id');
    expect(r.items[0]).not.toHaveProperty('userId');
  });

  it('listAll: WHERE chỉ event_type; output CÓ userId', async () => {
    wire();
    const r = await service.listAll(q());
    const sql = rowsCall()!.sql;
    expect(sql).toContain("event_type = 'ivss_vehicle_event'");
    expect(sql).not.toContain("payload_json->>'userId' = $");
    expect(sql).toContain("payload_json->>'userId' AS user_id");
    expect(r.items[0].userId).toBe('u1');
  });

  it('C1-isolation: event_type=ivss_vehicle_event (KHÔNG face)', async () => {
    wire();
    await service.listAll(q());
    const sql = rowsCall()!.sql;
    expect(sql).toContain("event_type = 'ivss_vehicle_event'");
    expect(sql).not.toContain('face_verify');
    expect(sql).not.toContain('face_stranger');
  });

  it('channelId cast ::int + output map đúng field', async () => {
    wire();
    const r = await service.listAll(q());
    expect(rowsCall()!.sql).toContain("(payload_json->>'channelId')::int");
    expect(r.items[0]).toMatchObject({
      id: 'evt-1',
      plateNumber: '30A12345',
      channelId: 5,
      direction: 'enter',
      matchState: 'matched',
      utc: '2026-06-25T09:00:00.000Z',
    });
  });

  // ── id (F-F fix): FE dùng để gọi GET ivss/device-events/:id/snapshot ──
  it('id: SELECT có cột id + output item.id khớp đúng iot_device_events.id', async () => {
    wire([row({ id: 'a1b2c3d4-1111-2222-3333-444455556666' })]);
    const r = await service.listAll(q());
    expect(rowsCall()!.sql).toMatch(/SELECT id,/);
    expect(r.items[0].id).toBe('a1b2c3d4-1111-2222-3333-444455556666');
  });

  it('id: listForUser cũng trả đúng id (KHÔNG chỉ listAll)', async () => {
    wire([row({ id: 'evt-user-1' })]);
    const r = await service.listForUser('u1', q());
    expect(r.items[0].id).toBe('evt-user-1');
  });

  // ── ràng buộc: plate filter normalize ──
  it('plate filter normalize (cứng): "30A-123.45" → bind param "30A12345"', async () => {
    wire();
    await service.listAll(q({ plateNumber: '30A-123.45' }));
    const c = rowsCall()!;
    expect(c.sql).toContain("payload_json->>'plateNumber' = $");
    expect(c.params).toContain('30A12345');
    expect(c.params).not.toContain('30A-123.45');
  });

  it("admin matchState filter → payload_json->>'matchState' = $", async () => {
    wire();
    await service.listAll(q({ matchState: 'unmatched' }));
    const c = rowsCall()!;
    expect(c.sql).toContain("payload_json->>'matchState' = $1");
    expect(c.params[0]).toBe('unmatched');
  });

  // ── bind index liên tục, CẢ 2 method ──
  it('bind index listForUser: userId=$1, from=$2, direction=$3, plate=$4, LIMIT $5 OFFSET $6', async () => {
    wire();
    await service.listForUser(
      'u1',
      q({
        from: '2026-06-01T00:00:00.000Z',
        direction: 'enter',
        plateNumber: '30A-123.45',
      }),
    );
    const c = rowsCall()!;
    expect(c.sql).toContain("payload_json->>'userId' = $1");
    expect(c.sql).toContain('event_time >= $2');
    expect(c.sql).toContain("payload_json->>'direction' = $3");
    expect(c.sql).toContain("payload_json->>'plateNumber' = $4");
    expect(c.sql).toContain('LIMIT $5 OFFSET $6');
    expect(c.params).toEqual([
      'u1',
      '2026-06-01T00:00:00.000Z',
      'enter',
      '30A12345',
      20,
      0,
    ]);
    // COUNT cùng filter params (KHÔNG limit/offset).
    expect(countCall()!.params).toEqual([
      'u1',
      '2026-06-01T00:00:00.000Z',
      'enter',
      '30A12345',
    ]);
  });

  it('bind index listAll: matchState=$1, from=$2, LIMIT $3 OFFSET $4 (không lệch)', async () => {
    wire();
    await service.listAll(
      q({ matchState: 'matched', from: '2026-06-01T00:00:00.000Z' }),
    );
    const c = rowsCall()!;
    expect(c.sql).toContain("payload_json->>'matchState' = $1");
    expect(c.sql).toContain('event_time >= $2');
    expect(c.sql).toContain('LIMIT $3 OFFSET $4');
    expect(c.params).toEqual(['matched', '2026-06-01T00:00:00.000Z', 20, 0]);
  });

  it('to filter → event_time <= $n', async () => {
    wire();
    await service.listAll(q({ to: '2026-06-30T00:00:00.000Z' }));
    expect(rowsCall()!.sql).toContain('event_time <= $1');
  });

  it('meta total (COUNT, total=25 limit=20 → totalPages=2)', async () => {
    wire([row()], 25);
    const r = await service.listForUser('u1', q());
    expect(r.meta).toEqual({ page: 1, limit: 20, total: 25, totalPages: 2 });
  });

  it('pagination: page=2 limit=20 → LIMIT 20 OFFSET 20', async () => {
    wire();
    await service.listForUser('u1', q({ page: 2, limit: 20 }));
    expect(rowsCall()!.params.slice(-2)).toEqual([20, 20]);
  });

  it('list rỗng: COUNT 0 + rows [] → data:[], total 0, totalPages 0', async () => {
    wire([], 0);
    const r = await service.listAll(q());
    expect(r.items).toEqual([]);
    expect(r.meta.total).toBe(0);
    expect(r.meta.totalPages).toBe(0);
  });

  it('query rỗng → default page/limit; COUNT [] → total 0; user_id null → userId null', async () => {
    dsMock.manager.query.mockImplementation((sql: string) => {
      if (sql.includes('COUNT(*)')) return Promise.resolve([]); // → ?? 0
      return Promise.resolve([row({ user_id: null })]);
    });
    const r = await service.listAll({} as any);
    expect(r.meta.page).toBe(1);
    expect(r.meta.limit).toBe(20);
    expect(r.meta.total).toBe(0);
    expect(r.items[0].userId).toBeNull();
  });

  it('SEC-03/read-only: chỉ SELECT/COUNT, giá trị qua bind (KHÔNG nối chuỗi)', async () => {
    wire();
    await service.listForUser('u1', q({ from: '2026-06-01T00:00:00.000Z' }));
    for (const c of captured) {
      expect(c.sql).toMatch(/^\s*SELECT/);
      expect(c.sql).not.toMatch(/INSERT|UPDATE|DELETE/i);
      expect(c.sql).not.toContain('2026-06-01');
      expect(c.sql).not.toContain('u1'); // userId qua param, không nối chuỗi
    }
  });
});
