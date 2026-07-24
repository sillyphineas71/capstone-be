/* eslint-disable @typescript-eslint/no-unsafe-member-access, @typescript-eslint/no-unsafe-assignment, @typescript-eslint/no-unsafe-argument, @typescript-eslint/unbound-method */
import { JwtAuthGuard } from '../../auth/guards/jwt-auth.guard.js';
import { PermissionsGuard } from '../../auth/guards/permissions.guard.js';
import { PERMISSIONS_KEY } from '../../auth/decorators/require-permissions.decorator.js';
import { DashboardOverviewController } from './dashboard-overview.controller.js';

describe('DashboardOverviewController (CDB-001 / UC-126)', () => {
  let controller: DashboardOverviewController;
  let service: any;

  beforeEach(() => {
    service = {
      getOverview: jest
        .fn()
        .mockResolvedValue({ generatedAt: 'x', buildings: [] }),
    };
    controller = new DashboardOverviewController(service);
  });

  it('route được bảo vệ bởi JwtAuthGuard + PermissionsGuard + permission đúng', () => {
    const guards =
      Reflect.getMetadata('__guards__', controller.getOverview) ?? [];
    expect(guards).toContain(JwtAuthGuard);
    expect(guards).toContain(PermissionsGuard);
    expect(
      Reflect.getMetadata(PERMISSIONS_KEY, controller.getOverview),
    ).toEqual(['campus_dashboard.overview.read']);
  });

  it('GET overview → gọi service + trả envelope chuẩn', async () => {
    const result = await controller.getOverview({});
    expect(service.getOverview).toHaveBeenCalledWith({});
    expect(result).toEqual({
      success: true,
      message: 'Campus dashboard overview retrieved successfully',
      data: { generatedAt: 'x', buildings: [] },
    });
  });
});
