/* eslint-disable @typescript-eslint/no-unsafe-member-access, @typescript-eslint/no-unsafe-assignment, @typescript-eslint/no-unsafe-call, @typescript-eslint/no-unsafe-return */
import { Test, TestingModule } from '@nestjs/testing';
import { DataSource } from 'typeorm';
import { ConfigService } from '@nestjs/config';
import { NotFoundException, ConflictException } from '@nestjs/common';
import { UnmappedReviewService } from './unmapped-review.service.js';

const calls = (mock: jest.Mock, needle: string) =>
  mock.mock.calls.filter((c: any[]) => String(c[0]).includes(needle));

describe('UnmappedReviewService (UMR-001)', () => {
  let service: UnmappedReviewService;
  let dsMock: any;

  beforeEach(async () => {
    dsMock = { manager: { query: jest.fn() } };
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        UnmappedReviewService,
        { provide: DataSource, useValue: dsMock },
        {
          provide: ConfigService,
          useValue: { get: (_k: string, d?: unknown) => d },
        },
      ],
    }).compile();
    service = module.get(UnmappedReviewService);
  });

  afterEach(() => jest.clearAllMocks());

  // ── list ──
  it('list: trả person unmapped, map field SEC-02; SQL có guard mapping sống + window', async () => {
    dsMock.manager.query.mockResolvedValueOnce([
      {
        device_id: 'dev1',
        person_id: '70',
        last_seen: '2026-06-18T09:00:00Z',
        hit_count: 3,
        person_name: 'abc',
        room_id: 'room1',
      },
    ]);
    const r = await service.list({ page: 1, limit: 20 });
    expect(r.data).toEqual([
      {
        deviceId: 'dev1',
        personId: '70',
        personName: 'abc',
        roomId: 'room1',
        lastSeen: '2026-06-18T09:00:00Z',
        hitCount: 3,
      },
    ]);
    expect(r.meta).toEqual({ page: 1, limit: 20 });
    const sql = String(dsMock.manager.query.mock.calls[0][0]);
    expect(sql).toContain('NOT EXISTS');
    expect(sql).toContain("sync_status = 'synced'");
    expect(sql).toContain('deleted_at IS NULL');
    expect(sql).toContain('created_at >= now() - ($1');
    expect(sql).toContain("->>'person_id' IS NOT NULL");
    expect(sql).toContain('GROUP BY e.device_id, person_id');
    // params: [window, limit, offset]
    expect(dsMock.manager.query.mock.calls[0][1]).toEqual([1440, 20, 0]);
  });

  it('list: windowMinutes override env', async () => {
    dsMock.manager.query.mockResolvedValueOnce([]);
    await service.list({ page: 1, limit: 20, windowMinutes: 999 });
    expect(dsMock.manager.query.mock.calls[0][1][0]).toBe(999);
  });

  it('list: phân trang → offset đúng', async () => {
    dsMock.manager.query.mockResolvedValueOnce([]);
    await service.list({ page: 3, limit: 10 });
    expect(dsMock.manager.query.mock.calls[0][1]).toEqual([1440, 10, 20]);
  });

  it('list: rỗng → data []', async () => {
    dsMock.manager.query.mockResolvedValueOnce([]);
    const r = await service.list({ page: 1, limit: 20 });
    expect(r.data).toEqual([]);
  });

  // ── map ──
  const dto = (over: any = {}) => ({
    deviceId: 'dev1',
    personId: '70',
    userId: 'u1',
    meetingId: 'm1',
    ...over,
  });

  const mapRouter =
    (
      over: {
        device?: any[];
        user?: any[];
        meeting?: any[];
        byPerson?: any[];
        byUser?: any[];
      } = {},
    ) =>
    (sql: string) => {
      if (sql.includes('FROM iot_devices WHERE id'))
        return Promise.resolve(
          over.device ?? [{ id: 'dev1', device_type: 'face_server' }],
        );
      if (sql.includes('FROM users WHERE id'))
        return Promise.resolve(over.user ?? [{ id: 'u1' }]);
      if (sql.includes('FROM meetings WHERE id'))
        return Promise.resolve(over.meeting ?? [{ id: 'm1' }]);
      if (sql.includes("->>'person_name'"))
        return Promise.resolve([{ person_name: 'abc' }]);
      if (sql.includes('device_person_id = $2 AND deleted_at IS NULL'))
        return Promise.resolve(over.byPerson ?? []);
      if (sql.includes('user_id = $2 AND deleted_at IS NULL'))
        return Promise.resolve(over.byUser ?? []);
      if (sql.includes('INSERT INTO device_user_mappings'))
        return Promise.resolve([{ id: 'map1' }]);
      return Promise.resolve(undefined);
    };

  it('map happy (chưa có slot sống) → INSERT synced + audit; KHÔNG đẩy thiết bị', async () => {
    dsMock.manager.query.mockImplementation(mapRouter());
    const r = await service.map(dto(), 'admin1');
    expect(r).toEqual({
      mappingId: 'map1',
      deviceId: 'dev1',
      personId: '70',
      userId: 'u1',
      meetingId: 'm1',
      syncStatus: 'synced',
    });
    const ins = calls(dsMock.manager.query, 'INSERT INTO device_user_mappings');
    expect(ins.length).toBe(1);
    expect(String(ins[0][0])).toContain("'synced'");
    expect(String(ins[0][1][5])).toContain('manual_map');
    expect(String(ins[0][1][5])).toContain('m1');
    expect(calls(dsMock.manager.query, 'INSERT INTO audit_logs').length).toBe(
      1,
    );
    expect(calls(dsMock.manager.query, 'webs/').length).toBe(0);
  });

  it('revive: row sống cùng (device,person,user) — kể cả vừa deprovision (sync_status=deleted, deleted_at NULL) → UPDATE, KHÔNG INSERT', async () => {
    dsMock.manager.query.mockImplementation(
      mapRouter({ byPerson: [{ id: 'old-map', user_id: 'u1' }] }),
    );
    const r = await service.map(dto(), 'admin1');
    expect(r.mappingId).toBe('old-map');
    expect(
      calls(dsMock.manager.query, 'INSERT INTO device_user_mappings').length,
    ).toBe(0);
    const upd = calls(dsMock.manager.query, 'UPDATE device_user_mappings');
    expect(upd.length).toBe(1);
    expect(String(upd[0][0])).toContain("sync_status = 'synced'");
    expect(String(upd[0][0])).toContain('deleted_at = NULL');
  });

  it('repoint: user đã có slot sống (device,user) cho person khác → UPDATE slot đó (constraint (device,user))', async () => {
    dsMock.manager.query.mockImplementation(
      mapRouter({ byPerson: [], byUser: [{ id: 'slot1' }] }),
    );
    const r = await service.map(dto(), 'admin1');
    expect(r.mappingId).toBe('slot1');
    expect(
      calls(dsMock.manager.query, 'INSERT INTO device_user_mappings').length,
    ).toBe(0);
    expect(
      calls(dsMock.manager.query, 'UPDATE device_user_mappings').length,
    ).toBe(1);
  });

  it('conflict: (device,person) sống thuộc user KHÁC → 409, không ghi', async () => {
    dsMock.manager.query.mockImplementation(
      mapRouter({ byPerson: [{ id: 'x', user_id: 'other' }] }),
    );
    await expect(service.map(dto(), 'admin1')).rejects.toBeInstanceOf(
      ConflictException,
    );
    expect(
      calls(dsMock.manager.query, 'INSERT INTO device_user_mappings').length,
    ).toBe(0);
    expect(
      calls(dsMock.manager.query, 'UPDATE device_user_mappings').length,
    ).toBe(0);
  });

  it('map: device không tồn tại → NotFound', async () => {
    dsMock.manager.query.mockImplementation(mapRouter({ device: [] }));
    await expect(service.map(dto(), 'admin1')).rejects.toBeInstanceOf(
      NotFoundException,
    );
  });

  it('map: device không phải face_server → Conflict', async () => {
    dsMock.manager.query.mockImplementation(
      mapRouter({ device: [{ id: 'dev1', device_type: 'ip_camera' }] }),
    );
    await expect(service.map(dto(), 'admin1')).rejects.toBeInstanceOf(
      ConflictException,
    );
  });

  it('map: user không tồn tại → NotFound', async () => {
    dsMock.manager.query.mockImplementation(mapRouter({ user: [] }));
    await expect(service.map(dto(), 'admin1')).rejects.toBeInstanceOf(
      NotFoundException,
    );
  });

  it('map: meeting không tồn tại → NotFound', async () => {
    dsMock.manager.query.mockImplementation(mapRouter({ meeting: [] }));
    await expect(service.map(dto(), 'admin1')).rejects.toBeInstanceOf(
      NotFoundException,
    );
  });
});
