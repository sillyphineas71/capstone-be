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
import { CreateRoomUtilizationExportDto } from '../dto/create-room-utilization-export.dto.js';
import { RoomUtilizationReportService } from '../services/room-utilization-report.service.js';

/**
 * RoomUtilizationReportController — UC-RUM-16.
 *
 * POST /api/v1/reports/room-utilization/exports
 *   Tạo job bất đồng bộ xuất báo cáo sử dụng phòng họp (PDF/XLSX/CSV).
 *   Trả 202 Accepted + jobId để client poll qua GET /api/v1/background-jobs/:id.
 *
 * Permission chỉ seed cho BUSINESS_ADMIN/SYSTEM_ADMIN (§0.5 spec.md — khác
 * UC-AA-12, KHÔNG có MANAGER).
 *
 * NOTE: @CurrentUser() trả về đúng { userId: string; ... } theo JwtAuthGuard
 * thật (xem jwt-auth.guard.ts) — KHÔNG dùng `.id` như bug đã phát hiện và
 * tách task riêng ở meeting-activity-report.controller.ts.
 */
@Controller('reports/room-utilization')
@UseGuards(JwtAuthGuard, PermissionsGuard)
@RequirePermissions('report.room_utilization.export')
export class RoomUtilizationReportController {
  constructor(
    private readonly roomUtilizationReportService: RoomUtilizationReportService,
  ) {}

  @Post('exports')
  @HttpCode(HttpStatus.ACCEPTED)
  async createExport(
    @Body() dto: CreateRoomUtilizationExportDto,
    @CurrentUser() currentUser: { userId: string; email: string },
  ) {
    const data = await this.roomUtilizationReportService.createExportJob(
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
