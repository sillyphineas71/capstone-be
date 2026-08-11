import { Reflector } from '@nestjs/core';
import { GUARDS_METADATA } from '@nestjs/common/constants';
import { NoShowController } from './no-show.controller.js';
import { JwtAuthGuard } from '../../auth/guards/jwt-auth.guard.js';
import { PermissionsGuard } from '../../auth/guards/permissions.guard.js';
import { PERMISSIONS_KEY } from '../../auth/decorators/require-permissions.decorator.js';

/**
 * RBAC metadata (PROMPT 1): sau khi gỡ MockPermissionsGuard, xác nhận mỗi route
 * gắn đúng guard THẬT (JwtAuthGuard + PermissionsGuard) và đúng permission code.
 * Đọc metadata trực tiếp trên prototype method — không cần dựng DI.
 * Mirror departments.controller.spec.ts (khối "RBAC metadata").
 *
 * [FIX 2026-08-09, Phần 5] `update` KHÔNG còn PermissionsGuard/@RequirePermissions —
 * authorization (permission cũ HOẶC dismiss+ownership mới) đã chuyển vào
 * NoShowService.update() — xem no-show.controller.ts + no-show.service.ts. `list`/
 * `release` GIỮ NGUYÊN 100% — chỉ `update` thay đổi.
 */
describe('NoShowController — RBAC metadata (PROMPT 1)', () => {
  const reflector = new Reflector();

  const guardedCases: Array<[string, string]> = [
    ['list', 'room.noshow.read'],
    ['release', 'room.noshow.release'],
  ];

  it.each(guardedCases)('%s: @RequirePermissions = %s', (method, code) => {
    const handler = (NoShowController.prototype as Record<string, unknown>)[
      method
    ] as (...args: unknown[]) => unknown;
    const perms = reflector.get<string[]>(PERMISSIONS_KEY, handler);
    expect(perms).toEqual([code]);
  });

  it.each(guardedCases)(
    '%s: gắn guard thật JwtAuthGuard + PermissionsGuard (không còn Mock)',
    (method) => {
      const handler = (NoShowController.prototype as Record<string, unknown>)[
        method
      ] as (...args: unknown[]) => unknown;
      const guards = (Reflect.getMetadata(GUARDS_METADATA, handler) ??
        []) as unknown[];
      expect(guards).toEqual(
        expect.arrayContaining([JwtAuthGuard, PermissionsGuard]),
      );
    },
  );

  // ══ Phần 5 — `update` KHÔNG còn PermissionsGuard/@RequirePermissions ══════════
  describe('update (Phần 5 — authorization chuyển vào service)', () => {
    const handler = (NoShowController.prototype as Record<string, unknown>)[
      'update'
    ] as (...args: unknown[]) => unknown;

    it('KHÔNG còn @RequirePermissions (metadata undefined)', () => {
      const perms = reflector.get<string[]>(PERMISSIONS_KEY, handler);
      expect(perms).toBeUndefined();
    });

    it('CHỈ còn JwtAuthGuard, KHÔNG còn PermissionsGuard', () => {
      const guards = (Reflect.getMetadata(GUARDS_METADATA, handler) ??
        []) as unknown[];
      expect(guards).toEqual([JwtAuthGuard]);
      expect(guards).not.toContain(PermissionsGuard);
    });
  });
});
