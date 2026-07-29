import { Controller, Get, UseGuards } from '@nestjs/common';
import { JwtAuthGuard } from '../../auth/guards/jwt-auth.guard.js';
import { PermissionsGuard } from '../../auth/guards/permissions.guard.js';
import { RequirePermissions } from '../../auth/decorators/require-permissions.decorator.js';
import { CurrentUser } from '../../auth/decorators/current-user.decorator.js';
import { ManagerSummaryService } from '../services/manager-summary.service.js';

/**
 * ManagerSummaryController (CDB-RS-001) — `GET /api/v1/campus-dashboard/manager-summary`.
 * Permission `campus_dashboard.manager_summary.read` — CHỈ role MANAGER (spec §2.1: endpoint
 * tự-scope theo `req.user.id`, không có tham số `managerId`, không admin-bypass).
 */
@Controller('campus-dashboard')
export class ManagerSummaryController {
  constructor(private readonly service: ManagerSummaryService) {}

  @Get('manager-summary')
  @UseGuards(JwtAuthGuard, PermissionsGuard)
  @RequirePermissions('campus_dashboard.manager_summary.read')
  async getManagerSummary(@CurrentUser() user: { userId: string }) {
    const data = await this.service.getSummary(user.userId);

    return {
      success: true,
      message: 'Manager summary retrieved successfully',
      data,
    };
  }
}
