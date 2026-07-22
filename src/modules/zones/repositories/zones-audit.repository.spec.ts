/* eslint-disable @typescript-eslint/no-unsafe-member-access */
import { EntityManager } from 'typeorm';
import { ZonesAuditRepository } from './zones-audit.repository.js';

describe('ZonesAuditRepository (ZND-001 / UC-92)', () => {
  let repo: ZonesAuditRepository;
  let em: { query: jest.Mock };

  beforeEach(() => {
    repo = new ZonesAuditRepository();
    em = { query: jest.fn().mockResolvedValue(undefined) };
  });

  const callOf = () => ({
    sql: em.query.mock.calls[0][0] as string,
    params: em.query.mock.calls[0][1] as unknown[],
  });

  it('logZoneCreation → action_type=create, entity_type=zones, severity=info', async () => {
    await repo.logZoneCreation(em as unknown as EntityManager, {
      userId: 'u1',
      zoneId: 'z1',
      zoneCode: 'GATE-01',
      zoneType: 'gate',
    });

    expect(em.query).toHaveBeenCalledTimes(1);
    const { sql, params } = callOf();
    expect(sql).toContain('INSERT INTO audit_logs');
    expect(sql).toContain("'create'");
    expect(sql).toContain("'info'");
    expect(params[0]).toBe('u1');
    expect(params[1]).toBe('zones');
    expect(params[2]).toBe('z1');
    expect(JSON.parse(params[3] as string)).toEqual({
      zone_code: 'GATE-01',
      zone_type: 'gate',
    });
  });

  it('logZoneDeletion → action_type=delete, entity_type=zones', async () => {
    await repo.logZoneDeletion(em as unknown as EntityManager, {
      userId: 'u1',
      zoneId: 'z1',
      zoneCode: 'GATE-01',
      zoneType: 'gate',
    });

    const { sql, params } = callOf();
    expect(sql).toContain("'delete'");
    expect(params[1]).toBe('zones');
    expect(params[2]).toBe('z1');
  });

  it('logZoneUpdate → action_type=update + changed_fields', async () => {
    await repo.logZoneUpdate(em as unknown as EntityManager, {
      userId: 'u1',
      zoneId: 'z1',
      changes: { zoneName: { old: 'A', new: 'B' } },
    });

    const { sql, params } = callOf();
    expect(sql).toContain("'update'");
    expect(params[1]).toBe('zones');
    expect(JSON.parse(params[3] as string)).toEqual({
      changed_fields: { zoneName: { old: 'A', new: 'B' } },
    });
  });

  // SEC-01: nội dung metadata_json KHÔNG được đi vào audit_logs.
  it('SEC-01: logZoneUpdate che nội dung metadataJson, chỉ ghi cờ changed', async () => {
    await repo.logZoneUpdate(em as unknown as EntityManager, {
      userId: 'u1',
      zoneId: 'z1',
      changes: {
        zoneName: { old: 'A', new: 'B' },
        metadataJson: {
          old: { secret: 'old-token-value' },
          new: { secret: 'new-token-value' },
        },
      },
    });

    const { params } = callOf();
    const payload = params[3] as string;
    expect(payload).not.toContain('secret');
    expect(payload).not.toContain('old-token-value');
    expect(payload).not.toContain('new-token-value');
    expect(JSON.parse(payload)).toEqual({
      changed_fields: {
        zoneName: { old: 'A', new: 'B' },
        metadataJson: { changed: true },
      },
    });
  });

  // ── UC-94 (ZNA-001): gán / gỡ thiết bị ──

  it('logZoneAssignDevices → action_type=assign_device, entity_type=zones, đủ metadata', async () => {
    await repo.logZoneAssignDevices(em as unknown as EntityManager, {
      userId: 'u1',
      zoneId: 'z1',
      deviceIds: ['d1', 'd2'],
      oldZoneIds: { d1: null, d2: 'z-old' },
    });

    expect(em.query).toHaveBeenCalledTimes(1);
    const { sql, params } = callOf();
    expect(sql).toContain("'assign_device'");
    expect(sql).toContain("'info'");
    expect(params[0]).toBe('u1');
    expect(params[1]).toBe('zones');
    expect(params[2]).toBe('z1');
    expect(JSON.parse(params[3] as string)).toEqual({
      device_ids: ['d1', 'd2'],
      old_zone_ids: { d1: null, d2: 'z-old' },
      new_zone_id: 'z1',
    });
  });

  it('logZoneUnassignDevice → action_type=unassign_device, new_zone_id null', async () => {
    await repo.logZoneUnassignDevice(em as unknown as EntityManager, {
      userId: 'u1',
      zoneId: 'z1',
      deviceId: 'd1',
    });

    const { sql, params } = callOf();
    expect(sql).toContain("'unassign_device'");
    expect(params[1]).toBe('zones');
    expect(JSON.parse(params[3] as string)).toEqual({
      device_ids: ['d1'],
      old_zone_id: 'z1',
      new_zone_id: null,
    });
  });

  // SEC-01: audit của UC-94 chỉ chở id, không chở dữ liệu thiết bị.
  it('SEC-01: audit gán/gỡ KHÔNG chứa dữ liệu nhạy cảm của thiết bị', async () => {
    // Dữ liệu thừa giả lập: repository KHÔNG được ghi ra dù caller lỡ truyền kèm.
    const paramsWithExtra = {
      userId: 'u1',
      zoneId: 'z1',
      deviceIds: ['d1'],
      oldZoneIds: { d1: null },
      deviceMetadata: { rtsp_password: 'super-secret', ip: '10.0.0.9' },
    };

    await repo.logZoneAssignDevices(
      em as unknown as EntityManager,
      paramsWithExtra,
    );

    const payload = callOf().params[3] as string;
    expect(payload).not.toContain('rtsp_password');
    expect(payload).not.toContain('super-secret');
    expect(payload).not.toContain('10.0.0.9');
    expect(JSON.parse(payload)).toEqual({
      device_ids: ['d1'],
      old_zone_ids: { d1: null },
      new_zone_id: 'z1',
    });
  });

  it('SEC-03: mọi giá trị đi qua parameter binding ($1..$4), không nối chuỗi', async () => {
    await repo.logZoneCreation(em as unknown as EntityManager, {
      userId: "u1'; DROP TABLE zones; --",
      zoneId: 'z1',
      zoneCode: 'GATE-01',
      zoneType: 'gate',
    });

    const { sql, params } = callOf();
    expect(sql).toContain('$1');
    expect(sql).toContain('$4::jsonb');
    expect(sql).not.toContain('DROP TABLE');
    expect(params[0]).toBe("u1'; DROP TABLE zones; --");
  });
});
