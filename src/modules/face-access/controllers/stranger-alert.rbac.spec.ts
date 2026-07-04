import { Reflector } from '@nestjs/core';
import { GUARDS_METADATA } from '@nestjs/common/constants';
import { StrangerAlertController } from './stranger-alert.controller.js';
import { JwtAuthGuard } from '../../auth/guards/jwt-auth.guard.js';
import { PermissionsGuard } from '../../auth/guards/permissions.guard.js';
import { PERMISSIONS_KEY } from '../../auth/decorators/require-permissions.decorator.js';

/**
 * RBAC metadata (PROMPT 1): sau khi gỡ MockPermissionsGuard, xác nhận mỗi route
 * gắn đúng guard THẬT (JwtAuthGuard + PermissionsGuard) và đúng permission code.
 * Đọc metadata trực tiếp trên prototype method — không cần dựng DI.
 * Mirror departments.controller.spec.ts (khối "RBAC metadata").
 */
describe('StrangerAlertController — RBAC metadata (PROMPT 1)', () => {
  const reflector = new Reflector();

  const cases: Array<[string, string]> = [['list', 'face.stranger.read']];

  it.each(cases)('%s: @RequirePermissions = %s', (method, code) => {
    const handler = (
      StrangerAlertController.prototype as Record<string, unknown>
    )[method] as (...args: unknown[]) => unknown;
    const perms = reflector.get<string[]>(PERMISSIONS_KEY, handler);
    expect(perms).toEqual([code]);
  });

  it.each(cases)(
    '%s: gắn guard thật JwtAuthGuard + PermissionsGuard (không còn Mock)',
    (method) => {
      const handler = (
        StrangerAlertController.prototype as Record<string, unknown>
      )[method] as (...args: unknown[]) => unknown;
      const guards = (Reflect.getMetadata(GUARDS_METADATA, handler) ??
        []) as unknown[];
      expect(guards).toEqual(
        expect.arrayContaining([JwtAuthGuard, PermissionsGuard]),
      );
    },
  );
});
