import {
  Controller,
  Get,
  Query,
  UseGuards,
  ValidationPipe,
  HttpException,
  InternalServerErrorException,
} from '@nestjs/common';
import {
  ApiBearerAuth,
  ApiOperation,
  ApiResponse,
  ApiTags,
} from '@nestjs/swagger';

import { JwtAuthGuard } from '../../auth/guards/jwt-auth.guard.js';
import { PermissionsGuard } from '../../auth/guards/permissions.guard.js';
import { RequirePermissions } from '../../auth/decorators/require-permissions.decorator.js';
import { CurrentUser } from '../../auth/decorators/current-user.decorator.js';

import { AuditActivityHourlyService } from '../services/audit-activity-hourly.service.js';
import { QueryAuditActivityHourlyDto } from '../dto/query-audit-activity-hourly.dto.js';
import { AuditActivityHourlyResponseDto } from '../dto/audit-activity-hourly-response.dto.js';

/**
 * AuditActivityHourlyController (AA-DASHBOARD-CHARTS-001).
 *
 * Route: GET /api/v1/analytics/audit-activity/hourly
 * Permission: analytics.audit_activity.read (chi SYSTEM_ADMIN)
 * Read-only: khong ghi/sua/xoa audit_logs.
 */
@ApiTags('Analytics Dashboard Charts')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, PermissionsGuard)
@RequirePermissions('analytics.audit_activity.read')
@Controller('analytics/audit-activity')
export class AuditActivityHourlyController {
  constructor(private readonly service: AuditActivityHourlyService) {}

  @Get('hourly')
  @ApiOperation({
    summary: 'Hoat dong audit log theo gio (Dashboard SysAdmin)',
    description:
      'Tra ve so luong ban ghi audit_logs theo tung gio trong 1 ngay cu the (24 bucket).',
  })
  @ApiResponse({
    status: 200,
    description: 'Hoat dong audit log theo gio duoc truy xuat thanh cong',
    type: AuditActivityHourlyResponseDto,
  })
  @ApiResponse({ status: 400, description: 'VALIDATION_ERROR' })
  @ApiResponse({ status: 401, description: 'Chua dang nhap' })
  @ApiResponse({ status: 403, description: 'PERMISSION_DENIED' })
  @ApiResponse({ status: 500, description: 'INTERNAL_ERROR' })
  async getHourlyActivity(
    @Query(new ValidationPipe({ transform: true, whitelist: true }))
    query: QueryAuditActivityHourlyDto,
    @CurrentUser() currentUser: { userId: string },
  ): Promise<{
    success: boolean;
    message: string;
    data: AuditActivityHourlyResponseDto;
    meta: Record<string, any>;
  }> {
    try {
      const { data, message } = await this.service.getHourlyActivity(
        currentUser,
        query,
      );
      return { success: true, message, data, meta: {} };
    } catch (error: unknown) {
      if (error instanceof HttpException) {
        throw error;
      }
      throw new InternalServerErrorException({
        success: false,
        message: 'Internal server error',
        error: { code: 'INTERNAL_ERROR', details: {} },
      });
    }
  }
}
