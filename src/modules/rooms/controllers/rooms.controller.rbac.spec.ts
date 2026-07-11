import { Reflector } from '@nestjs/core';
import { GUARDS_METADATA } from '@nestjs/common/constants';
import { RoomsController } from './rooms.controller.js';
import { JwtAuthGuard } from '../../auth/guards/jwt-auth.guard.js';
import { PermissionsGuard } from '../../auth/guards/permissions.guard.js';
import { PERMISSIONS_KEY } from '../../auth/decorators/require-permissions.decorator.js';

/**
 * RBAC metadata: sau khi gỡ MockPermissionsGuard khỏi rooms.controller, xác nhận
 * mỗi route gắn guard THẬT + đúng permission code.
 * RoomsController đặt JwtAuthGuard ở class-level và PermissionsGuard ở method-level.
 * Mirror departments.controller.spec.ts (khối "RBAC metadata").
 */
describe('RoomsController — RBAC metadata', () => {
  const reflector = new Reflector();

  const cases: Array<[string, string]> = [
    ['create', 'room.create'],
    ['update', 'room.update'],
    ['deletionImpact', 'room.delete'],
    ['deleteRoom', 'room.delete'],
    ['realtimeStatus', 'room.utilization.read'],
    ['roomStatus', 'room.utilization.read'],
  ];

  it('class-level gắn JwtAuthGuard', () => {
    const guards = (Reflect.getMetadata(GUARDS_METADATA, RoomsController) ??
      []) as unknown[];
    expect(guards).toEqual(expect.arrayContaining([JwtAuthGuard]));
  });

  it('search (UC-ROOM-04): KHÔNG gắn PermissionsGuard/permission riêng — chỉ cần JwtAuthGuard class-level', () => {
    const handler = (RoomsController.prototype as Record<string, unknown>)[
      'search'
    ] as (...args: unknown[]) => unknown;
    const guards = (Reflect.getMetadata(GUARDS_METADATA, handler) ??
      []) as unknown[];
    expect(guards).not.toEqual(expect.arrayContaining([PermissionsGuard]));
    const perms = reflector.get<string[]>(PERMISSIONS_KEY, handler);
    expect(perms).toBeUndefined();
  });

  it.each(cases)('%s: @RequirePermissions = %s', (method, code) => {
    const handler = (RoomsController.prototype as Record<string, unknown>)[
      method
    ] as (...args: unknown[]) => unknown;
    const perms = reflector.get<string[]>(PERMISSIONS_KEY, handler);
    expect(perms).toEqual([code]);
  });

  it.each(cases)(
    '%s: method-level gắn PermissionsGuard thật (không còn Mock)',
    (method) => {
      const handler = (RoomsController.prototype as Record<string, unknown>)[
        method
      ] as (...args: unknown[]) => unknown;
      const guards = (Reflect.getMetadata(GUARDS_METADATA, handler) ??
        []) as unknown[];
      expect(guards).toEqual(expect.arrayContaining([PermissionsGuard]));
    },
  );
});
