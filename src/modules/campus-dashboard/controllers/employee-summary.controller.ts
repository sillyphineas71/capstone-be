import { Controller, Get, UseGuards } from '@nestjs/common';
import { JwtAuthGuard } from '../../auth/guards/jwt-auth.guard.js';
import { PermissionsGuard } from '../../auth/guards/permissions.guard.js';
import { RequirePermissions } from '../../auth/decorators/require-permissions.decorator.js';
import { CurrentUser } from '../../auth/decorators/current-user.decorator.js';
import { EmployeeSummaryService } from '../services/employee-summary.service.js';

/**
 * EmployeeSummaryController (CDB-RS-001) — `GET /api/v1/campus-dashboard/employee-summary`.
 * Permission `campus_dashboard.employee_summary.read` — cả 4 role (dữ liệu "của chính người
 * gọi", mirror convention `notification.read.self`/`schedule.read.self`).
 */
@Controller('campus-dashboard')
export class EmployeeSummaryController {
  constructor(private readonly service: EmployeeSummaryService) {}

  @Get('employee-summary')
  @UseGuards(JwtAuthGuard, PermissionsGuard)
  @RequirePermissions('campus_dashboard.employee_summary.read')
  async getEmployeeSummary(@CurrentUser() user: { userId: string }) {
    const data = await this.service.getSummary(user.userId);

    return {
      success: true,
      message: 'Employee summary retrieved successfully',
      data,
    };
  }
}
