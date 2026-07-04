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
import { CreateMeetingActivityExportDto } from '../dto/create-meeting-activity-export.dto.js';
import { MeetingActivityReportService } from '../services/meeting-activity-report.service.js';

/**
 * MeetingActivityReportController — UC-AA-12 / UC-158.
 *
 * POST /api/v1/reports/meeting-activity/exports
 *   Tạo job bất đồng bộ xuất báo cáo tổng hợp hoạt động cuộc họp (PDF hoặc XLSX).
 *   Trả 202 Accepted + jobId để client poll via GET /api/v1/background-jobs/:id.
 *
 * FR-004: @RequirePermissions class-level.
 * OOS-003: KHÔNG có route mới cho polling/download — dùng 2 endpoint đã có sẵn.
 */
@Controller('reports/meeting-activity')
@UseGuards(JwtAuthGuard, PermissionsGuard)
@RequirePermissions('report.meeting_activity.export')
export class MeetingActivityReportController {
  constructor(
    private readonly meetingActivityReportService: MeetingActivityReportService,
  ) {}

  /**
   * POST /api/v1/reports/meeting-activity/exports
   * FR-001, FR-004, FR-005: Tạo export job, trả 202 + jobId.
   */
  @Post('exports')
  @HttpCode(HttpStatus.ACCEPTED)
  async createExport(
    @Body() dto: CreateMeetingActivityExportDto,
    @CurrentUser() currentUser: { id: string; email: string; roles?: string[] },
  ) {
    const data =
      await this.meetingActivityReportService.createExportJob(
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
