import {
  Controller,
  Post,
  Body,
  HttpCode,
  HttpStatus,
  UseGuards,
} from '@nestjs/common';
import { JwtAuthGuard } from '../../auth/guards/jwt-auth.guard.js';
import { PermissionsGuard } from '../../auth/guards/permissions.guard.js';
import { RequirePermissions } from '../../auth/decorators/require-permissions.decorator.js';
import { CurrentUser } from '../../auth/decorators/current-user.decorator.js';
import { CreateSecurityAlertExportDto } from '../dto/create-security-alert-export.dto.js';
import { SecurityAlertReportService } from '../services/security-alert-report.service.js';

/**
 * SecurityAlertReportController — UC-129.
 *
 * POST /api/v1/reports/security-alert/exports
 *   Tạo job bất đồng bộ xuất báo cáo sự kiện an ninh (PDF hoặc XLSX), nguồn
 *   `security_alerts` (Bước 3 SAVP).
 */
@Controller('reports/security-alert')
@UseGuards(JwtAuthGuard, PermissionsGuard)
@RequirePermissions('report.security_alert.export')
export class SecurityAlertReportController {
  constructor(
    private readonly securityAlertReportService: SecurityAlertReportService,
  ) {}

  @Post('exports')
  @HttpCode(HttpStatus.ACCEPTED)
  async createExport(
    @Body() dto: CreateSecurityAlertExportDto,
    @CurrentUser() currentUser: { userId: string; email: string; sub?: string },
  ) {
    const data = await this.securityAlertReportService.createExportJob(
      currentUser,
      dto,
    );
    return {
      success: true,
      message: 'Export job đã được tạo và đang xử lý.',
      data,
      meta: {},
    };
  }
}
