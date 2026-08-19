import { UserAuditLogQueryService } from '../services/user-audit-log-query.service.js';
import type { UserAuditLogRow } from '../repositories/audit-log-query.repository.js';

/**
 * Unit test cho UserAuditLogQueryService — tập trung vào logic map row giàu
 * field sang response FE: status (từ severity), description (từ action code
 * thật của BE), payload (ưu tiên new_value → metadata → old_value), phân trang.
 */
describe('UserAuditLogQueryService', () => {
  const baseRow: UserAuditLogRow = {
    id: 'log-1',
    created_at: new Date('2026-08-10T08:32:15.000Z'),
    user_id: 'actor-1',
    action_type: 'ACCOUNT_LOCK',
    entity_type: 'users',
    entity_id: 'target-1',
    severity: 'warning',
    ip_address: '192.168.1.15',
    new_value_json: null,
    metadata_json: { reason: 'Vi phạm quy định' },
    old_value_json: { email: 'a@co.com' },
    user_full_name: 'Nguyễn Văn Admin',
    user_email: 'admin@company.com',
  };

  function makeService(rows: UserAuditLogRow[], total: number) {
    const repo = {
      findUserAuditLogs: jest.fn().mockResolvedValue(rows),
      countUserAuditLogs: jest.fn().mockResolvedValue(total),
    };

    const service = new UserAuditLogQueryService(repo as any);
    return { service, repo };
  }

  it('maps a lock row to the FE-facing shape', async () => {
    const { service } = makeService([baseRow], 1);
    const res = await service.listUserAuditLogs('target-1', {});
    const item = res.data[0];

    expect(item).toEqual({
      id: 'log-1',
      timestamp: baseRow.created_at,
      actorName: 'Nguyễn Văn Admin',
      actorEmail: 'admin@company.com',
      action: 'ACCOUNT_LOCK',
      entity: 'users',
      status: 'success', // warning => success
      description: 'Khóa tài khoản',
      ipAddress: '192.168.1.15',
      payload: { reason: 'Vi phạm quy định' }, // metadata khi new_value null
    });
    expect(res.meta).toEqual({ page: 1, limit: 10, total: 1, totalPages: 1 });
  });

  it('derives status=failed for error/critical severity', async () => {
    const { service } = makeService(
      [{ ...baseRow, severity: 'error', action_type: 'ACCOUNT_UPDATE' }],
      1,
    );
    const res = await service.listUserAuditLogs('target-1', {});
    expect(res.data[0].status).toBe('failed');
    expect(res.data[0].description).toBe('Cập nhật tài khoản');
  });

  it('prefers new_value_json for payload, falls back to old_value_json', async () => {
    const withNew = { ...baseRow, new_value_json: { fullName: 'B' } };
    const { service: s1 } = makeService([withNew], 1);
    expect((await s1.listUserAuditLogs('t', {})).data[0].payload).toEqual({
      fullName: 'B',
    });

    const noneButOld = {
      ...baseRow,
      new_value_json: null,
      metadata_json: null,
    };
    const { service: s2 } = makeService([noneButOld], 1);
    expect((await s2.listUserAuditLogs('t', {})).data[0].payload).toEqual({
      email: 'a@co.com',
    });
  });

  it('labels system actor and unknown action code falls back to raw', async () => {
    const sysRow = {
      ...baseRow,
      user_id: null,
      user_full_name: null,
      user_email: null,
      action_type: 'SOME_UNMAPPED_CODE',
    };
    const { service } = makeService([sysRow], 1);
    const item = (await service.listUserAuditLogs('t', {})).data[0];
    expect(item.actorName).toBe('Hệ thống');
    expect(item.actorEmail).toBeNull();
    expect(item.description).toBe('SOME_UNMAPPED_CODE');
  });

  it('computes totalPages from total and limit', async () => {
    const { service } = makeService([baseRow], 25);
    const res = await service.listUserAuditLogs('t', { page: 2, limit: 10 });
    expect(res.meta).toEqual({ page: 2, limit: 10, total: 25, totalPages: 3 });
  });
});
