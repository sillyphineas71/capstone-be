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
