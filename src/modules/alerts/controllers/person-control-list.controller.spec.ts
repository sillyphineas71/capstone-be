/* eslint-disable @typescript-eslint/no-unsafe-member-access, @typescript-eslint/no-unsafe-assignment, @typescript-eslint/no-unsafe-argument, @typescript-eslint/unbound-method */
import { JwtAuthGuard } from '../../auth/guards/jwt-auth.guard.js';
import { PermissionsGuard } from '../../auth/guards/permissions.guard.js';
import { PERMISSIONS_KEY } from '../../auth/decorators/require-permissions.decorator.js';
import { PersonControlListController } from './person-control-list.controller.js';

describe('PersonControlListController (PWL-001 / UC-125)', () => {
  let controller: PersonControlListController;
  let service: any;

  const entity = {
    id: 'p1',
    userId: 'user-1',
    faceProfileId: null,
    displayName: 'Nguyễn Văn A',
    photoMediaFileId: null,
    listType: 'watchlist',
    reason: 'theo dõi đặc biệt',
    priority: 'medium',
    active: true,
    createdBy: 'admin1',
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
    controller = new PersonControlListController(service);
  });

  it('cả 5 route admin-gated: class-level JwtAuthGuard + PermissionsGuard', () => {
    const guards =
      Reflect.getMetadata('__guards__', PersonControlListController) ?? [];
    expect(guards).toContain(JwtAuthGuard);
    expect(guards).toContain(PermissionsGuard);
  });

  it('POST create → service.create(dto, userId), envelope 201-shape', async () => {
    const dto = { userId: 'user-1', displayName: 'Nguyễn Văn A' };
    const r = await controller.create({ userId: 'admin1' }, dto);
    expect(service.create).toHaveBeenCalledWith(dto, 'admin1');
    expect(r.success).toBe(true);
    expect(r.data).toMatchObject({ id: 'p1', user_id: 'user-1' });
  });

  it('create route permission = person_control_list.create', () => {
    const perms = Reflect.getMetadata(PERMISSIONS_KEY, controller.create);
    expect(perms).toEqual(['person_control_list.create']);
  });

  it('GET list → service.list(query), map mapper + meta', async () => {
    const meta = { page: 1, limit: 20, total: 1, totalPages: 1 };
    service.list = jest.fn().mockResolvedValue({ items: [entity], meta });
    const r = await controller.list({ page: 1, limit: 20 });
    expect(r.data).toHaveLength(1);
    expect(r.meta).toEqual(meta);
  });

  it('list/detail route permission = person_control_list.read', () => {
    expect(Reflect.getMetadata(PERMISSIONS_KEY, controller.list)).toEqual([
      'person_control_list.read',
    ]);
    expect(Reflect.getMetadata(PERMISSIONS_KEY, controller.detail)).toEqual([
      'person_control_list.read',
    ]);
  });

  it('GET detail → service.findOne(id) + mapper', async () => {
    const r = await controller.detail('p1');
    expect(service.findOne).toHaveBeenCalledWith('p1');
    expect(r.data).toMatchObject({ id: 'p1' });
  });

  it('PATCH update → service.update(id, dto) + mapper (KHÔNG có actorUserId — mirror vehicle-control-list, đúng spec)', async () => {
    const dto = { priority: 'high' };
    const r = await controller.update('p1', dto as any);
    expect(service.update).toHaveBeenCalledWith('p1', dto);
    expect(r.message).toBe('Person control list entry updated successfully');
  });

  it('update route permission = person_control_list.update', () => {
    const perms = Reflect.getMetadata(PERMISSIONS_KEY, controller.update);
    expect(perms).toEqual(['person_control_list.update']);
  });

  it('DELETE → service.remove(id) + trả data:null', async () => {
    const r = await controller.remove('p1');
    expect(service.remove).toHaveBeenCalledWith('p1');
    expect(r).toEqual({
      success: true,
      message: 'Person control list entry deleted successfully',
      data: null,
    });
  });

  it('delete route permission = person_control_list.delete', () => {
    const perms = Reflect.getMetadata(PERMISSIONS_KEY, controller.remove);
    expect(perms).toEqual(['person_control_list.delete']);
  });
});
