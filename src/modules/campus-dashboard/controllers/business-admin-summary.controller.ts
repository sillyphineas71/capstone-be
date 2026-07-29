import { Controller, Get, UseGuards } from '@nestjs/common';
import { JwtAuthGuard } from '../../auth/guards/jwt-auth.guard.js';
import { PermissionsGuard } from '../../auth/guards/permissions.guard.js';
import { RequirePermissions } from '../../auth/decorators/require-permissions.decorator.js';
import { BusinessAdminSummaryService } from '../services/business-admin-summary.service.js';

/**
 * BusinessAdminSummaryController (CDB-RS-001) — `GET /api/v1/campus-dashboard/business-admin-summary`.
 * Permission `campus_dashboard.business_admin_summary.read` — CHỈ BUSINESS_ADMIN/SYSTEM_ADMIN
 * (dữ liệu toàn tổ chức, KHÔNG MANAGER).
 */
@Controller('campus-dashboard')
export class BusinessAdminSummaryController {
  constructor(private readonly service: BusinessAdminSummaryService) {}

  @Get('business-admin-summary')
  @UseGuards(JwtAuthGuard, PermissionsGuard)
  @RequirePermissions('campus_dashboard.business_admin_summary.read')
  async getBusinessAdminSummary() {
    const data = await this.service.getSummary();

    return {
      success: true,
      message: 'Business admin summary retrieved successfully',
      data,
    };
  }
}
