import {
  Controller,
  Get,
  Query,
  UseGuards,
  UsePipes,
  ValidationPipe,
} from '@nestjs/common';
import { JwtAuthGuard } from '../../auth/guards/jwt-auth.guard.js';
import { PermissionsGuard } from '../../auth/guards/permissions.guard.js';
import { RequirePermissions } from '../../auth/decorators/require-permissions.decorator.js';
import { DashboardOverviewService } from '../services/dashboard-overview.service.js';
import { QueryDashboardOverviewDto } from '../dto/query-dashboard-overview.dto.js';

// Repo KHÔNG có global ValidationPipe (main.ts) ⇒ phải khai tường minh ở controller.
const CAMPUS_DASHBOARD_PIPE = new ValidationPipe({
  whitelist: true,
  transform: true,
});

/**
 * DashboardOverviewController (CDB-001 / UC-126) — `GET /api/v1/campus-dashboard/overview`.
 */
@Controller('campus-dashboard')
export class DashboardOverviewController {
  constructor(private readonly service: DashboardOverviewService) {}

  @Get('overview')
  @UseGuards(JwtAuthGuard, PermissionsGuard)
  @RequirePermissions('campus_dashboard.overview.read')
  @UsePipes(CAMPUS_DASHBOARD_PIPE)
  async getOverview(@Query() query: QueryDashboardOverviewDto) {
    const data = await this.service.getOverview(query);

    return {
      success: true,
      message: 'Campus dashboard overview retrieved successfully',
      data,
    };
  }
}
