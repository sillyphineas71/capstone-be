import { Reflector } from '@nestjs/core';
import { GUARDS_METADATA } from '@nestjs/common/constants';
import { AttendanceController } from './attendance.controller.js';
import { JwtAuthGuard } from '../../auth/guards/jwt-auth.guard.js';
import { PermissionsGuard } from '../../auth/guards/permissions.guard.js';
import { PERMISSIONS_KEY } from '../../auth/decorators/require-permissions.decorator.js';

/**
 * RBAC metadata: GET meetings/:meetingId/attendance được bảo vệ bằng guard THẬT.
 * JwtAuthGuard ở class-level, PermissionsGuard + attendance.read ở method-level.
 * Mirror departments.controller.spec.ts (khối "RBAC metadata").
 */
describe('AttendanceController — RBAC metadata', () => {
  const reflector = new Reflector();

  it('class-level gắn JwtAuthGuard', () => {
    const guards = (Reflect.getMetadata(
      GUARDS_METADATA,
      AttendanceController,
    ) ?? []) as unknown[];
    expect(guards).toEqual(expect.arrayContaining([JwtAuthGuard]));
  });

  it('getAttendanceList: @RequirePermissions = attendance.read', () => {
    const handler = (AttendanceController.prototype as Record<string, unknown>)[
      'getAttendanceList'
    ] as (...args: unknown[]) => unknown;
    const perms = reflector.get<string[]>(PERMISSIONS_KEY, handler);
    expect(perms).toEqual(['attendance.read']);
  });

  it('getAttendanceList: method-level gắn PermissionsGuard thật', () => {
    const handler = (AttendanceController.prototype as Record<string, unknown>)[
      'getAttendanceList'
    ] as (...args: unknown[]) => unknown;
    const guards = (Reflect.getMetadata(GUARDS_METADATA, handler) ??
      []) as unknown[];
    expect(guards).toEqual(expect.arrayContaining([PermissionsGuard]));
  });
});
