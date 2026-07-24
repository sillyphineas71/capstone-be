/* eslint-disable @typescript-eslint/no-unsafe-member-access, @typescript-eslint/no-unsafe-assignment, @typescript-eslint/no-unsafe-argument, @typescript-eslint/unbound-method */
import { JwtAuthGuard } from '../../auth/guards/jwt-auth.guard.js';
import { PermissionsGuard } from '../../auth/guards/permissions.guard.js';
import { PERMISSIONS_KEY } from '../../auth/decorators/require-permissions.decorator.js';
import { AlertRulesController } from './alert-rules.controller.js';

describe('AlertRulesController (ARL-001 / UC-122)', () => {
  let controller: AlertRulesController;
  let service: any;

  const entity = {
    id: 'r1',
    alertType: 'crowd',
    zoneId: 'zone-1',
    threshold: 25,
    channels: ['in_app'],
    enabled: true,
    restrictedHoursJson: null,
    allowedPersonIdsJson: null,
    createdBy: 'admin1',
    updatedBy: 'admin1',
    createdAt: new Date('2026-07-23T00:00:00Z'),
    updatedAt: new Date('2026-07-23T00:00:00Z'),
  };

  beforeEach(() => {
    service = {
      create: jest.fn().mockResolvedValue(entity),
      list: jest.fn(),
      findOne: jest.fn().mockResolvedValue(entity),
      update: jest.fn().mockResolvedValue(entity),
      remove: jest.fn().mockResolvedValue(undefined),
    };
    controller = new AlertRulesController(service);
  });

  it('cả 5 route admin-gated: class-level JwtAuthGuard + PermissionsGuard', () => {
    const guards =
      Reflect.getMetadata('__guards__', AlertRulesController) ?? [];
    expect(guards).toContain(JwtAuthGuard);
    expect(guards).toContain(PermissionsGuard);
  });

  it('POST create → service.create(dto, userId), envelope 201-shape', async () => {
    const dto = {
      alertType: 'crowd',
      zoneId: 'zone-1',
      threshold: 25,
      channels: ['in_app'],
    };
    const r = await controller.create({ userId: 'admin1' }, dto as any);
    expect(service.create).toHaveBeenCalledWith(dto, 'admin1');
    expect(r.success).toBe(true);
    expect(r.message).toBe('Alert rule created successfully');
    expect(r.data).toMatchObject({
      id: 'r1',
      alert_type: 'crowd',
      zone_id: 'zone-1',
    });
  });

  it('create route permission = alert_rules.create', () => {
    const perms = Reflect.getMetadata(PERMISSIONS_KEY, controller.create);
    expect(perms).toEqual(['alert_rules.create']);
  });

  it('GET list → service.list(query), map mapper + meta', async () => {
    const meta = { page: 1, limit: 20, total: 1, totalPages: 1 };
    service.list = jest.fn().mockResolvedValue({ items: [entity], meta });
    const query = { page: 1, limit: 20 } as any;
    const r = await controller.list(query);
    expect(service.list).toHaveBeenCalledWith(query);
    expect(r.data).toHaveLength(1);
    expect(r.meta).toEqual(meta);
  });

  it('list/detail route permission = alert_rules.read', () => {
    expect(Reflect.getMetadata(PERMISSIONS_KEY, controller.list)).toEqual([
      'alert_rules.read',
    ]);
    expect(Reflect.getMetadata(PERMISSIONS_KEY, controller.detail)).toEqual([
      'alert_rules.read',
    ]);
  });

  it('GET detail → service.findOne(id) + mapper', async () => {
    const r = await controller.detail('r1');
    expect(service.findOne).toHaveBeenCalledWith('r1');
    expect(r.data).toMatchObject({ id: 'r1' });
  });

  it('PATCH update → service.update(id, dto, userId) + mapper', async () => {
    const dto = { threshold: 30 };
    const r = await controller.update({ userId: 'admin1' }, 'r1', dto);
    expect(service.update).toHaveBeenCalledWith('r1', dto, 'admin1');
    expect(r.message).toBe('Alert rule updated successfully');
  });

  it('update route permission = alert_rules.update', () => {
    const perms = Reflect.getMetadata(PERMISSIONS_KEY, controller.update);
    expect(perms).toEqual(['alert_rules.update']);
  });

  it('DELETE → service.remove(id, userId) + trả data:null', async () => {
    const r = await controller.remove({ userId: 'admin1' }, 'r1');
    expect(service.remove).toHaveBeenCalledWith('r1', 'admin1');
    expect(r).toEqual({
      success: true,
      message: 'Alert rule deleted successfully',
      data: null,
    });
  });

  it('delete route permission = alert_rules.delete', () => {
    const perms = Reflect.getMetadata(PERMISSIONS_KEY, controller.remove);
    expect(perms).toEqual(['alert_rules.delete']);
  });
});
