/* eslint-disable @typescript-eslint/no-unsafe-member-access, @typescript-eslint/no-unsafe-assignment, @typescript-eslint/no-unsafe-argument, @typescript-eslint/unbound-method */
import { JwtAuthGuard } from '../../auth/guards/jwt-auth.guard.js';
import { PermissionsGuard } from '../../auth/guards/permissions.guard.js';
import { PERMISSIONS_KEY } from '../../auth/decorators/require-permissions.decorator.js';
import { VehicleRegistrationController } from './vehicle-registration.controller.js';

describe('VehicleRegistrationController (VPR-001 / UC1)', () => {
  let controller: VehicleRegistrationController;
  let service: any;

  const entity = {
    id: 'veh1',
    userId: 'u1',
    plateRaw: '30A-123.45',
    plateNumber: '30A12345',
    vehicleType: 'car',
    note: null,
    status: 'active',
    createdAt: new Date('2026-06-24T00:00:00Z'),
    updatedAt: new Date('2026-06-24T00:00:00Z'),
  };

  beforeEach(() => {
    service = { register: jest.fn().mockResolvedValue(entity) };
    controller = new VehicleRegistrationController(service);
  });

  it('USER route: register với @CurrentUser().userId (KHÔNG body user_id) + envelope 201 shape', async () => {
    const r = await controller.registerOwn(
      { userId: 'u-jwt' },
      { plateRaw: '30A-123.45' },
    );
    expect(service.register).toHaveBeenCalledWith('u-jwt', {
      plateRaw: '30A-123.45',
    });
    expect(r.success).toBe(true);
    expect(r.message).toBe('Vehicle registered successfully');
    expect(r.data).toMatchObject({
      id: 'veh1',
      user_id: 'u1',
      plate_number: '30A12345',
      status: 'active',
    });
  });

  it('ADMIN route: register với dto.userId (từ body) + cùng mapper/envelope', async () => {
    const r = await controller.registerForUser({
      userId: 'target-user',
      plateRaw: '30A-123.45',
    });
    expect(service.register).toHaveBeenCalledWith('target-user', {
      userId: 'target-user',
      plateRaw: '30A-123.45',
    });
    expect(r.data).toMatchObject({ plate_number: '30A12345' });
    expect(r.message).toBe('Vehicle registered successfully');
  });

  it('USER route guard = chỉ JwtAuthGuard (KHÔNG PermissionsGuard)', () => {
    const guards =
      Reflect.getMetadata('__guards__', controller.registerOwn) ?? [];
    expect(guards).toContain(JwtAuthGuard);
    expect(guards).not.toContain(PermissionsGuard);
  });

  it('ADMIN route gate THẬT: JwtAuthGuard + PermissionsGuard + @RequirePermissions', () => {
    const guards =
      Reflect.getMetadata('__guards__', controller.registerForUser) ?? [];
    expect(guards).toContain(JwtAuthGuard);
    expect(guards).toContain(PermissionsGuard);
    const perms = Reflect.getMetadata(
      PERMISSIONS_KEY,
      controller.registerForUser,
    );
    expect(perms).toEqual(['anpr.vehicle.admin_register']);
  });

  // ── UC2 (VPM-001): sửa / status / xóa-mềm ──
  describe('UC2 routes', () => {
    beforeEach(() => {
      service.updateMetadata = jest.fn().mockResolvedValue(entity);
      service.setStatus = jest.fn().mockResolvedValue(entity);
      service.softDeleteOwned = jest.fn().mockResolvedValue(undefined);
    });

    it('PATCH update → service.updateMetadata(id, @CurrentUser().userId, dto), envelope + mapper', async () => {
      const r = await controller.update({ userId: 'u-jwt' }, 'veh1', {
        note: 'x',
      });
      expect(service.updateMetadata).toHaveBeenCalledWith('veh1', 'u-jwt', {
        note: 'x',
      });
      expect(r.message).toBe('Vehicle updated successfully');
      expect(r.data).toMatchObject({ id: 'veh1', plate_number: '30A12345' });
    });

    it('PATCH status → service.setStatus(id, userId, dto.status)', async () => {
      const r = await controller.updateStatus({ userId: 'u-jwt' }, 'veh1', {
        status: 'disabled',
      });
      expect(service.setStatus).toHaveBeenCalledWith(
        'veh1',
        'u-jwt',
        'disabled',
      );
      expect(r.message).toBe('Vehicle status updated successfully');
    });

    it('DELETE → service.softDeleteOwned(id, userId) + trả data:null', async () => {
      const r = await controller.remove({ userId: 'u-jwt' }, 'veh1');
      expect(service.softDeleteOwned).toHaveBeenCalledWith('veh1', 'u-jwt');
      expect(r).toEqual({
        success: true,
        message: 'Vehicle deleted successfully',
        data: null,
      });
    });

    it('cả 3 route UC2 guard = JwtAuthGuard (KHÔNG PermissionsGuard)', () => {
      for (const h of [
        controller.update,
        controller.updateStatus,
        controller.remove,
      ]) {
        const guards = Reflect.getMetadata('__guards__', h) ?? [];
        expect(guards).toContain(JwtAuthGuard);
        expect(guards).not.toContain(PermissionsGuard);
      }
    });
  });

  // ── UC3 (VPL-001): list + detail ──
  describe('UC3 routes', () => {
    const meta = { page: 1, limit: 20, total: 1, totalPages: 1 };
    beforeEach(() => {
      service.list = jest.fn().mockResolvedValue({ items: [entity], meta });
      service.getDetail = jest.fn().mockResolvedValue(entity);
    });

    it('GET list → service.list(@CurrentUser().userId, query), map mapper + meta', async () => {
      const r = await controller.list(
        { userId: 'u-jwt' },
        { page: 1, limit: 20 },
      );
      expect(service.list).toHaveBeenCalledWith('u-jwt', {
        page: 1,
        limit: 20,
      });
      expect(r.data).toHaveLength(1);
      expect(r.data[0]).toMatchObject({ id: 'veh1', plate_number: '30A12345' });
      expect(r.meta).toEqual(meta);
      expect(r.message).toBe('Vehicle registrations retrieved');
    });

    it('GET detail → service.getDetail(id, userId) + mapper', async () => {
      const r = await controller.detail({ userId: 'u-jwt' }, 'veh1');
      expect(service.getDetail).toHaveBeenCalledWith('veh1', 'u-jwt');
      expect(r.data).toMatchObject({ id: 'veh1' });
      expect(r.message).toBe('Vehicle registration retrieved');
    });

    it('userId từ @CurrentUser (KHÔNG query/body); guard list = JwtAuthGuard', () => {
      const guards = Reflect.getMetadata('__guards__', controller.list) ?? [];
      expect(guards).toContain(JwtAuthGuard);
      expect(guards).not.toContain(PermissionsGuard);
    });
  });
});
