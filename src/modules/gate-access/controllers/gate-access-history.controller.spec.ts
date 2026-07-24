/* eslint-disable @typescript-eslint/no-unsafe-member-access, @typescript-eslint/no-unsafe-assignment, @typescript-eslint/no-unsafe-argument, @typescript-eslint/unbound-method */
import { JwtAuthGuard } from '../../auth/guards/jwt-auth.guard.js';
import { PermissionsGuard } from '../../auth/guards/permissions.guard.js';
import { PERMISSIONS_KEY } from '../../auth/decorators/require-permissions.decorator.js';
import { GateAccessHistoryController } from './gate-access-history.controller.js';

describe('GateAccessHistoryController (GAH-001 / UC-117)', () => {
  let controller: GateAccessHistoryController;
  let service: any;

  const item = {
    id: 'in1',
    zone_id: 'z1',
    zone_code: 'GATE-A',
    zone_name: 'Cổng A',
    check_in_time: new Date('2026-07-23T08:00:00Z'),
    check_out_time: new Date('2026-07-23T17:00:00Z'),
    duration_seconds: 32400,
    plate_number: '30A12345',
    session_status: 'completed',
  };
  const detail = { ...item, image_url: 'https://example.com/img.jpg' };
  const meta = { page: 1, limit: 20, total: 1, totalPages: 1 };

  beforeEach(() => {
    service = {
      listForUser: jest.fn().mockResolvedValue({ items: [item], meta }),
      listAll: jest
        .fn()
        .mockResolvedValue({ items: [{ ...item, user_id: 'u1' }], meta }),
      getDetailForUser: jest.fn().mockResolvedValue(detail),
      getDetailAny: jest.fn().mockResolvedValue({ ...detail, user_id: 'u1' }),
    };
    controller = new GateAccessHistoryController(service);
  });

  it('listOwn: CHỈ JwtAuthGuard (KHÔNG PermissionsGuard)', () => {
    const guards = Reflect.getMetadata('__guards__', controller.listOwn) ?? [];
    expect(guards).toContain(JwtAuthGuard);
    expect(guards).not.toContain(PermissionsGuard);
  });

  it('GET history → service.listForUser(userId từ CurrentUser, query)', async () => {
    const query = { page: 1, limit: 20 } as any;
    const r = await controller.listOwn({ userId: 'u1' }, query);
    expect(service.listForUser).toHaveBeenCalledWith('u1', query);
    expect(r.success).toBe(true);
    expect(r.data).toEqual([item]);
    expect(r.meta).toEqual(meta);
  });

  it('detailOwn: CHỈ JwtAuthGuard', () => {
    const guards =
      Reflect.getMetadata('__guards__', controller.detailOwn) ?? [];
    expect(guards).toContain(JwtAuthGuard);
    expect(guards).not.toContain(PermissionsGuard);
  });

  it('GET history/:id → service.getDetailForUser(id, userId)', async () => {
    const r = await controller.detailOwn({ userId: 'u1' }, 'in1');
    expect(service.getDetailForUser).toHaveBeenCalledWith('in1', 'u1');
    expect(r.data).toEqual(detail);
  });

  it('listAll: JwtAuthGuard + PermissionsGuard + permission gate_access.history.read_all', () => {
    const guards = Reflect.getMetadata('__guards__', controller.listAll) ?? [];
    expect(guards).toContain(JwtAuthGuard);
    expect(guards).toContain(PermissionsGuard);
    const perms = Reflect.getMetadata(PERMISSIONS_KEY, controller.listAll);
    expect(perms).toEqual(['gate_access.history.read_all']);
  });

  it('GET admin/history → service.listAll(query), output CÓ user_id', async () => {
    const query = { page: 1, limit: 20, departmentId: 'd1' } as any;
    const r = await controller.listAll(query);
    expect(service.listAll).toHaveBeenCalledWith(query);
    expect(r.data[0].user_id).toBe('u1');
  });

  it('detailAny: JwtAuthGuard + PermissionsGuard + permission gate_access.history.read_all', () => {
    const guards =
      Reflect.getMetadata('__guards__', controller.detailAny) ?? [];
    expect(guards).toContain(JwtAuthGuard);
    expect(guards).toContain(PermissionsGuard);
    const perms = Reflect.getMetadata(PERMISSIONS_KEY, controller.detailAny);
    expect(perms).toEqual(['gate_access.history.read_all']);
  });

  it('GET admin/history/:id → service.getDetailAny(id), output CÓ user_id', async () => {
    const r = await controller.detailAny('in1');
    expect(service.getDetailAny).toHaveBeenCalledWith('in1');
    expect(r.data.user_id).toBe('u1');
  });
});
