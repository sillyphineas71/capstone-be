import { Reflector } from '@nestjs/core';
import { GUARDS_METADATA } from '@nestjs/common/constants';
import { IvssZoneAccessController } from './ivss-zone-access.controller.js';
import { JwtAuthGuard } from '../../auth/guards/jwt-auth.guard.js';
import { PermissionsGuard } from '../../auth/guards/permissions.guard.js';
import { PERMISSIONS_KEY } from '../../auth/decorators/require-permissions.decorator.js';

/**
 * RBAC metadata (Zone Access Log — đường B, FIX 2026-08-11) — mirror
 * ivss-room-access.rbac.spec.ts. Xác nhận route access-log zone gắn đúng guard THẬT
 * (JwtAuthGuard + PermissionsGuard) và TÁI DÙNG permission `ivss.access_log.read`
 * (KHÔNG tạo permission mới) — user thiếu quyền này bị PermissionsGuard chặn 403.
 */
describe('IvssZoneAccessController — RBAC metadata (Zone Access Log)', () => {
  const reflector = new Reflector();

  it('permission cấp class = ivss.access_log.read (TÁI DÙNG, KHÔNG tạo permission mới)', () => {
    const perms = reflector.get<string[]>(
      PERMISSIONS_KEY,
      IvssZoneAccessController,
    );
    expect(perms).toEqual(['ivss.access_log.read']);
  });

  it('gắn guard thật JwtAuthGuard + PermissionsGuard ở cấp class', () => {
    const guards = (Reflect.getMetadata(
      GUARDS_METADATA,
      IvssZoneAccessController,
    ) ?? []) as unknown[];
    expect(guards).toEqual(
      expect.arrayContaining([JwtAuthGuard, PermissionsGuard]),
    );
  });

  it('accessLog: không tự đặt permission riêng đè lên class (tránh nới quyền ngoài ý muốn)', () => {
    const handler = IvssZoneAccessController.prototype.accessLog;
    expect(handler).toBeDefined();
    const perms = reflector.get<string[]>(PERMISSIONS_KEY, handler);
    // undefined ⇒ kế thừa class ⇒ vẫn là ivss.access_log.read.
    expect(perms).toBeUndefined();
  });
});
