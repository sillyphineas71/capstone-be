/* eslint-disable @typescript-eslint/no-unsafe-member-access, @typescript-eslint/no-unsafe-assignment, @typescript-eslint/no-unsafe-argument, @typescript-eslint/unbound-method */
import { JwtAuthGuard } from '../../auth/guards/jwt-auth.guard.js';
import { PermissionsGuard } from '../../auth/guards/permissions.guard.js';
import { PERMISSIONS_KEY } from '../../auth/decorators/require-permissions.decorator.js';
import { BusinessAdminSummaryController } from './business-admin-summary.controller.js';

describe('BusinessAdminSummaryController (CDB-RS-001)', () => {
  let controller: BusinessAdminSummaryController;
  let service: any;

  beforeEach(() => {
    service = {
      getSummary: jest.fn().mockResolvedValue({
        gateTrafficToday: { entriesToday: 0, exitsToday: 0 },
        securityAlertsBySeverity: { low: 0, medium: 0, high: 0, critical: 0 },
        zoneOccupancy: {
          totalCount: 0,
          zonesWithDataCount: 0,
          totalZoneCount: 0,
        },
        vehicleControlHitsToday: 0,
      }),
    };
    controller = new BusinessAdminSummaryController(service);
  });

  it('route được bảo vệ bởi JwtAuthGuard + PermissionsGuard + permission BUSINESS_ADMIN/SYSTEM_ADMIN-only', () => {
    const guards =
      Reflect.getMetadata('__guards__', controller.getBusinessAdminSummary) ??
      [];
    expect(guards).toContain(JwtAuthGuard);
    expect(guards).toContain(PermissionsGuard);
    expect(
      Reflect.getMetadata(PERMISSIONS_KEY, controller.getBusinessAdminSummary),
    ).toEqual(['campus_dashboard.business_admin_summary.read']);
  });

  it('GET business-admin-summary → gọi service.getSummary() (không tham số) + trả envelope chuẩn', async () => {
    const result = await controller.getBusinessAdminSummary();
    expect(service.getSummary).toHaveBeenCalledWith();
    expect(result.success).toBe(true);
    expect(result.message).toBe(
      'Business admin summary retrieved successfully',
    );
  });
});
