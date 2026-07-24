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
import { CreateVehicleExportDto } from '../dto/create-vehicle-export.dto.js';
import { VehicleReportService } from '../services/vehicle-report.service.js';

/**
 * VehicleReportController — UC-128.
 *
 * POST /api/v1/reports/vehicle/exports
 *   Tạo job bất đồng bộ xuất báo cáo phương tiện (danh sách đăng ký / thống kê
 *   lưu lượng / cả hai) ra PDF hoặc XLSX.
 */
@Controller('reports/vehicle')
@UseGuards(JwtAuthGuard, PermissionsGuard)
@RequirePermissions('report.vehicle.export')
export class VehicleReportController {
  constructor(private readonly vehicleReportService: VehicleReportService) {}

  @Post('exports')
  @HttpCode(HttpStatus.ACCEPTED)
  async createExport(
    @Body() dto: CreateVehicleExportDto,
    @CurrentUser() currentUser: { userId: string; email: string; sub?: string },
  ) {
    const data = await this.vehicleReportService.createExportJob(
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
