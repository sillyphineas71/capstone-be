import { Reflector } from '@nestjs/core';
import { ExecutionContext, ForbiddenException } from '@nestjs/common';
import { PermissionsGuard } from '../../auth/guards/permissions.guard';
import { OnTimeRateController } from '../controllers/on-time-rate.controller';

/**
 * [FIX 2026-08-13, R2] Regression test cho cơ chế ghi đè permission trên /me.
 *
 * getPersonalStats() được gắn @RequirePermissions() (mảng rỗng) để PermissionsGuard coi
 * như "không yêu cầu permission" (permissions.guard.ts:25-27) — nhờ Reflector.getAllAndOverride
 * ưu tiên metadata ở HANDLER hơn class-level @RequirePermissions('analytics.attendance.read').
 * Test này chạy PermissionsGuard THẬT (không mock reflector/metadata) để xác nhận:
 *   1) /me KHÔNG bị chặn bởi permission cũ (EMPLOYEE, permissions=[] vẫn qua được).
 *   2) 3 route cũ (getOnTimeRate/getOnTimeRateByUsers/getLateHistory) VẪN bị chặn như trước —
 *      đảm bảo override ở /me không "rò rỉ" sang route khác trong cùng controller.
 */
describe('OnTimeRateController — PermissionsGuard override (R2 fix)', () => {
  let guard: PermissionsGuard;
  let mockAuthzRepo: { getEffectiveRolesAndPermissions: jest.Mock };

  const makeContext = (
    handlerName: keyof OnTimeRateController,
    userId = 'emp-1',
  ): ExecutionContext =>
    ({
      getHandler: () => OnTimeRateController.prototype[handlerName],
      getClass: () => OnTimeRateController,
      switchToHttp: () => ({
        getRequest: () => ({ user: { userId } }),
      }),
    }) as unknown as ExecutionContext;

  beforeEach(() => {
    mockAuthzRepo = { getEffectiveRolesAndPermissions: jest.fn() };
    guard = new PermissionsGuard(new Reflector(), mockAuthzRepo as any);
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  it('EMPLOYEE (không có analytics.attendance.read) gọi /me -> canActivate=true, KHÔNG cần truy vấn permission', async () => {
    const result = await guard.canActivate(makeContext('getPersonalStats'));
    expect(result).toBe(true);
    // requiredPermissions=[] -> early return true (permissions.guard.ts:25-27), không cần
    // gọi DB để tra permission -- xác nhận override thật sự có hiệu lực, không phải "pass vì có quyền".
    expect(mockAuthzRepo.getEffectiveRolesAndPermissions).not.toHaveBeenCalled();
  });

  it.each([
    ['getOnTimeRate' as const],
    ['getOnTimeRateByUsers' as const],
    ['getLateHistory' as const],
  ])(
    '%s (route cũ) — EMPLOYEE không có analytics.attendance.read -> vẫn bị ForbiddenException (regression, override /me không rò rỉ)',
    async (handlerName) => {
      mockAuthzRepo.getEffectiveRolesAndPermissions.mockResolvedValue({
        roles: ['EMPLOYEE'],
        permissions: [],
      });

      await expect(guard.canActivate(makeContext(handlerName))).rejects.toThrow(
        ForbiddenException,
      );
    },
  );

  it.each([
    ['getOnTimeRate' as const],
    ['getOnTimeRateByUsers' as const],
    ['getLateHistory' as const],
  ])(
    '%s (route cũ) — MANAGER có analytics.attendance.read -> vẫn pass như trước (không đổi hành vi)',
    async (handlerName) => {
      mockAuthzRepo.getEffectiveRolesAndPermissions.mockResolvedValue({
        roles: ['MANAGER'],
        permissions: ['analytics.attendance.read'],
      });

      await expect(
        guard.canActivate(makeContext(handlerName)),
      ).resolves.toBe(true);
    },
  );
});
