/* eslint-disable @typescript-eslint/no-unsafe-member-access, @typescript-eslint/no-unsafe-assignment, @typescript-eslint/no-unsafe-argument, @typescript-eslint/unbound-method */
import { JwtAuthGuard } from '../../auth/guards/jwt-auth.guard.js';
import { PermissionsGuard } from '../../auth/guards/permissions.guard.js';
import { PERMISSIONS_KEY } from '../../auth/decorators/require-permissions.decorator.js';
import { EmployeeSummaryController } from './employee-summary.controller.js';

describe('EmployeeSummaryController (CDB-RS-001)', () => {
  let controller: EmployeeSummaryController;
  let service: any;

  beforeEach(() => {
    service = {
      getSummary: jest.fn().mockResolvedValue({
        gateAccessToday: [],
        vehicleStatus: null,
        meetingsToday: 0,
      }),
    };
    controller = new EmployeeSummaryController(service);
  });

  it('route được bảo vệ bởi JwtAuthGuard + PermissionsGuard + permission mọi role', () => {
    const guards =
      Reflect.getMetadata('__guards__', controller.getEmployeeSummary) ?? [];
    expect(guards).toContain(JwtAuthGuard);
    expect(guards).toContain(PermissionsGuard);
    expect(
      Reflect.getMetadata(PERMISSIONS_KEY, controller.getEmployeeSummary),
    ).toEqual(['campus_dashboard.employee_summary.read']);
  });

  it('GET employee-summary → gọi service.getSummary với userId từ CurrentUser + trả envelope chuẩn', async () => {
    const result = await controller.getEmployeeSummary({ userId: 'user-1' });
    expect(service.getSummary).toHaveBeenCalledWith('user-1');
    expect(result.success).toBe(true);
    expect(result.message).toBe('Employee summary retrieved successfully');
    expect(result.data.vehicleStatus).toBeNull();
  });
});
