import { Reflector } from '@nestjs/core';
import { GUARDS_METADATA } from '@nestjs/common/constants';
import { IvssDeviceEventSnapshotController } from './ivss-device-event-snapshot.controller.js';
import { JwtQueryOrHeaderAuthGuard } from '../../auth/guards/jwt-query-or-header-auth.guard.js';
import { JwtAuthGuard } from '../../auth/guards/jwt-auth.guard.js';
import { PermissionsGuard } from '../../auth/guards/permissions.guard.js';
import { PERMISSIONS_KEY } from '../../auth/decorators/require-permissions.decorator.js';

/**
 * RBAC metadata (F-F fix) — xác nhận route snapshot dùng ĐÚNG
 * JwtQueryOrHeaderAuthGuard (KHÔNG phải JwtAuthGuard gốc — đó là lý do tách
 * controller riêng) + cùng permission `ivss.access_log.read` như bản gốc.
 */
describe('IvssDeviceEventSnapshotController — RBAC metadata (F-F fix)', () => {
  const reflector = new Reflector();

  it('permission cấp class = ivss.access_log.read (giữ nguyên như bản gốc trong IvssRoomAccessController)', () => {
    const perms = reflector.get<string[]>(
      PERMISSIONS_KEY,
      IvssDeviceEventSnapshotController,
    );
    expect(perms).toEqual(['ivss.access_log.read']);
  });

  it('gắn JwtQueryOrHeaderAuthGuard (KHÔNG phải JwtAuthGuard gốc) + PermissionsGuard', () => {
    const guards = (Reflect.getMetadata(
      GUARDS_METADATA,
      IvssDeviceEventSnapshotController,
    ) ?? []) as unknown[];
    expect(guards).toEqual(
      expect.arrayContaining([JwtQueryOrHeaderAuthGuard, PermissionsGuard]),
    );
    // JwtAuthGuard gốc KHÔNG được gắn trực tiếp — chỉ subclass của nó.
    expect(guards).not.toContain(JwtAuthGuard);
  });

  it('snapshot: không tự đặt permission riêng đè lên class', () => {
    const handler = (
      IvssDeviceEventSnapshotController.prototype as Record<string, unknown>
    )['snapshot'] as (...args: unknown[]) => unknown;
    expect(handler).toBeDefined();
    const perms = reflector.get<string[]>(PERMISSIONS_KEY, handler);
    expect(perms).toBeUndefined();
  });
});
