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
import { CreateGateAccessExportDto } from '../dto/create-gate-access-export.dto.js';
import { GateAccessReportService } from '../services/gate-access-report.service.js';

/**
 * GateAccessReportController — UC-127.
 *
 * POST /api/v1/reports/gate-access/exports
 *   Tạo job bất đồng bộ xuất báo cáo ra/vào khuôn viên (PDF hoặc XLSX).
 *   Trả 202 Accepted + jobId để client poll via GET /api/v1/background-jobs/:id.
 */
@Controller('reports/gate-access')
@UseGuards(JwtAuthGuard, PermissionsGuard)
@RequirePermissions('report.gate_access.export')
export class GateAccessReportController {
  constructor(
    private readonly gateAccessReportService: GateAccessReportService,
  ) {}

  @Post('exports')
  @HttpCode(HttpStatus.ACCEPTED)
  async createExport(
    @Body() dto: CreateGateAccessExportDto,
    @CurrentUser() currentUser: { userId: string; email: string; sub?: string },
  ) {
    const data = await this.gateAccessReportService.createExportJob(
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
