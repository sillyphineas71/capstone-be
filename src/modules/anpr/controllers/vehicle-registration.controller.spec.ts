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
});
