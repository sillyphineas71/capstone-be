import { Reflector } from '@nestjs/core';
import { GUARDS_METADATA } from '@nestjs/common/constants';
import { FaceProfileController } from './face-profile.controller.js';
import { JwtAuthGuard } from '../../auth/guards/jwt-auth.guard.js';
import { PermissionsGuard } from '../../auth/guards/permissions.guard.js';
import { PERMISSIONS_KEY } from '../../auth/decorators/require-permissions.decorator.js';

/**
 * RBAC metadata: sau khi gỡ MockPermissionsGuard (lỗ hổng cho phép bất kỳ user
 * đăng nhập nào enroll khuôn mặt hộ userId bất kỳ), xác nhận route gắn đúng
 * guard THẬT (JwtAuthGuard + PermissionsGuard) và đúng permission code
 * `account.face.register` (khớp docs/API_CONTRACT_v1.0_with_system_roles.md dòng 862).
 * Mirror iot-devices.rbac.spec.ts / recording-config.rbac.spec.ts.
 */
describe('FaceProfileController — RBAC metadata', () => {
  const reflector = new Reflector();

  const cases: Array<[string, string]> = [['enroll', 'account.face.register']];

  it.each(cases)('%s: @RequirePermissions = %s', (method, code) => {
    const handler = (
      FaceProfileController.prototype as unknown as Record<string, unknown>
    )[method] as (...args: unknown[]) => unknown;
    const perms = reflector.get<string[]>(PERMISSIONS_KEY, handler);
    expect(perms).toEqual([code]);
  });

  it.each(cases)(
    '%s: gắn guard thật JwtAuthGuard + PermissionsGuard (không còn Mock)',
    (method) => {
      const handler = (
        FaceProfileController.prototype as unknown as Record<string, unknown>
      )[method] as (...args: unknown[]) => unknown;
      const guards = (Reflect.getMetadata(GUARDS_METADATA, handler) ??
        []) as unknown[];
      expect(guards).toEqual(
        expect.arrayContaining([JwtAuthGuard, PermissionsGuard]),
      );
    },
  );
});
