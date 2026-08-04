import { Reflector } from '@nestjs/core';
import { GUARDS_METADATA } from '@nestjs/common/constants';
import { IvssRoomAccessController } from './ivss-room-access.controller.js';
import { JwtAuthGuard } from '../../auth/guards/jwt-auth.guard.js';
import { PermissionsGuard } from '../../auth/guards/permissions.guard.js';
import { PERMISSIONS_KEY } from '../../auth/decorators/require-permissions.decorator.js';

/**
 * RBAC metadata (ALS-002) — xác nhận cả 2 route access-log gắn đúng guard THẬT
 * (JwtAuthGuard + PermissionsGuard) và đúng permission `ivss.access_log.read`.
 *
 * Khác ivss-presence.rbac.spec.ts: ở đây decorator đặt ở CẤP CLASS (mọi route trong
 * controller cùng quyền, fail-closed cho route thêm sau) — `PermissionsGuard` đọc bằng
 * `reflector.getAllAndOverride([getHandler(), getClass()])` (permissions.guard.ts:20-23)
 * nên metadata cấp class có hiệu lực runtime. Test đọc thẳng metadata trên class.
 */
describe('IvssRoomAccessController — RBAC metadata (ALS-002)', () => {
  const reflector = new Reflector();

  it('permission cấp class = ivss.access_log.read (KHÔNG tái dùng ivss.presence.read)', () => {
    const perms = reflector.get<string[]>(
      PERMISSIONS_KEY,
      IvssRoomAccessController,
    );
    expect(perms).toEqual(['ivss.access_log.read']);
  });

  it('gắn guard thật JwtAuthGuard + PermissionsGuard ở cấp class', () => {
    const guards = (Reflect.getMetadata(
      GUARDS_METADATA,
      IvssRoomAccessController,
    ) ?? []) as unknown[];
    expect(guards).toEqual(
      expect.arrayContaining([JwtAuthGuard, PermissionsGuard]),
    );
  });

  it.each([['accessLogAll'], ['accessLog']])(
    '%s: không tự đặt permission riêng đè lên class (tránh nới quyền ngoài ý muốn)',
    (method) => {
      const handler = (
        IvssRoomAccessController.prototype as Record<string, unknown>
      )[method] as (...args: unknown[]) => unknown;
      expect(handler).toBeDefined();
      const perms = reflector.get<string[]>(PERMISSIONS_KEY, handler);
      // undefined ⇒ kế thừa class ⇒ vẫn là ivss.access_log.read.
      expect(perms).toBeUndefined();
    },
  );
});
