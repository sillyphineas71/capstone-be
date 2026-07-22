/* eslint-disable @typescript-eslint/no-unsafe-member-access, @typescript-eslint/no-unsafe-assignment, @typescript-eslint/no-unsafe-argument, @typescript-eslint/unbound-method */
import { JwtAuthGuard } from '../../auth/guards/jwt-auth.guard.js';
import { PermissionsGuard } from '../../auth/guards/permissions.guard.js';
import { PERMISSIONS_KEY } from '../../auth/decorators/require-permissions.decorator.js';
import { VehicleControlListController } from './vehicle-control-list.controller.js';

describe('VehicleControlListController (VCL-001 / UC8)', () => {
  let controller: VehicleControlListController;
  let service: any;

  const entity = {
    id: 'cl1',
    plateNumber: '30A12345',
    plateRaw: '30A-123.45',
    listType: 'blocklist',
    reason: 'stolen',
    active: true,
    createdBy: 'admin1',
    createdAt: new Date('2026-07-22T00:00:00Z'),
    updatedAt: new Date('2026-07-22T00:00:00Z'),
  };

  beforeEach(() => {
    service = {
      create: jest.fn().mockResolvedValue(entity),
      list: jest.fn(),
      getDetail: jest.fn().mockResolvedValue(entity),
      update: jest.fn().mockResolvedValue(entity),
      softDelete: jest.fn().mockResolvedValue(undefined),
    };
    controller = new VehicleControlListController(service);
  });

  it('cả 5 route admin-gated: class-level JwtAuthGuard + PermissionsGuard (KHÔNG route self-service)', () => {
    const guards =
      Reflect.getMetadata('__guards__', VehicleControlListController) ?? [];
    expect(guards).toContain(JwtAuthGuard);
    expect(guards).toContain(PermissionsGuard);
  });

  it('POST create → service.create(@CurrentUser().userId, dto) — createdBy KHÔNG từ body, envelope 201-shape', async () => {
    const dto = {
      plateRaw: '30A-123.45',
      listType: 'blocklist',
      reason: 'stolen',
    };
    const r = await controller.create({ userId: 'admin1' }, dto as any);
    expect(service.create).toHaveBeenCalledWith('admin1', dto);
    expect(r.success).toBe(true);
    expect(r.message).toBe('Control list entry created successfully');
    expect(r.data).toMatchObject({
      id: 'cl1',
      plate_number: '30A12345',
      list_type: 'blocklist',
      created_by: 'admin1',
    });
  });

  it('create route permission = vehicle_control.create', () => {
    const perms = Reflect.getMetadata(PERMISSIONS_KEY, controller.create);
    expect(perms).toEqual(['vehicle_control.create']);
  });

  it('GET list → service.list(query), map mapper + meta', async () => {
    const meta = { page: 1, limit: 20, total: 1, totalPages: 1 };
    service.list = jest.fn().mockResolvedValue({ items: [entity], meta });
    const query = { page: 1, limit: 20 } as any;
    const r = await controller.list(query);
    expect(service.list).toHaveBeenCalledWith(query);
    expect(r.data).toHaveLength(1);
    expect(r.data[0]).toMatchObject({ id: 'cl1', plate_number: '30A12345' });
    expect(r.meta).toEqual(meta);
    expect(r.message).toBe('Control list retrieved successfully');
  });

  it('list/detail route permission = vehicle_control.read', () => {
    expect(Reflect.getMetadata(PERMISSIONS_KEY, controller.list)).toEqual([
      'vehicle_control.read',
    ]);
    expect(Reflect.getMetadata(PERMISSIONS_KEY, controller.detail)).toEqual([
      'vehicle_control.read',
    ]);
  });

  it('GET detail → service.getDetail(id) + mapper', async () => {
    const r = await controller.detail('cl1');
    expect(service.getDetail).toHaveBeenCalledWith('cl1');
    expect(r.data).toMatchObject({ id: 'cl1' });
    expect(r.message).toBe('Control list entry retrieved successfully');
  });

  it('PATCH update → service.update(id, dto) + mapper', async () => {
    const dto = { reason: 'no longer valid', active: false };
    const r = await controller.update('cl1', dto);
    expect(service.update).toHaveBeenCalledWith('cl1', dto);
    expect(r.message).toBe('Control list entry updated successfully');
    expect(r.data).toMatchObject({ id: 'cl1' });
  });

  it('update route permission = vehicle_control.update', () => {
    const perms = Reflect.getMetadata(PERMISSIONS_KEY, controller.update);
    expect(perms).toEqual(['vehicle_control.update']);
  });

  it('DELETE → service.softDelete(id) + trả data:null', async () => {
    const r = await controller.remove('cl1');
    expect(service.softDelete).toHaveBeenCalledWith('cl1');
    expect(r).toEqual({
      success: true,
      message: 'Control list entry deleted successfully',
      data: null,
    });
  });

  it('delete route permission = vehicle_control.delete', () => {
    const perms = Reflect.getMetadata(PERMISSIONS_KEY, controller.remove);
    expect(perms).toEqual(['vehicle_control.delete']);
  });
});
