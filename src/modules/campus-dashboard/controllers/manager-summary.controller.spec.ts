/* eslint-disable @typescript-eslint/no-unsafe-member-access, @typescript-eslint/no-unsafe-assignment, @typescript-eslint/no-unsafe-argument, @typescript-eslint/unbound-method */
import { JwtAuthGuard } from '../../auth/guards/jwt-auth.guard.js';
import { PermissionsGuard } from '../../auth/guards/permissions.guard.js';
import { PERMISSIONS_KEY } from '../../auth/decorators/require-permissions.decorator.js';
import { ManagerSummaryController } from './manager-summary.controller.js';

describe('ManagerSummaryController (CDB-RS-001)', () => {
  let controller: ManagerSummaryController;
  let service: any;

  beforeEach(() => {
    service = {
      getSummary: jest.fn().mockResolvedValue({
        teamPresenceToday: { presentCount: 0, totalCount: 0 },
        pendingMeetingRequestsCount: 0,
        onTimeRateThisWeek: { rate: 0, sampleSize: 0 },
        teamZoneSecurityAlerts: { value: null, note: 'not_available' },
      }),
    };
    controller = new ManagerSummaryController(service);
  });

  it('route được bảo vệ bởi JwtAuthGuard + PermissionsGuard + permission MANAGER-only', () => {
    const guards =
      Reflect.getMetadata('__guards__', controller.getManagerSummary) ?? [];
    expect(guards).toContain(JwtAuthGuard);
    expect(guards).toContain(PermissionsGuard);
    expect(
      Reflect.getMetadata(PERMISSIONS_KEY, controller.getManagerSummary),
    ).toEqual(['campus_dashboard.manager_summary.read']);
  });

  it('GET manager-summary → gọi service.getSummary với userId từ CurrentUser + trả envelope chuẩn', async () => {
    const result = await controller.getManagerSummary({ userId: 'manager-1' });
    expect(service.getSummary).toHaveBeenCalledWith('manager-1');
    expect(result.success).toBe(true);
    expect(result.message).toBe('Manager summary retrieved successfully');
    expect(result.data.teamZoneSecurityAlerts).toEqual({
      value: null,
      note: 'not_available',
    });
  });
});
