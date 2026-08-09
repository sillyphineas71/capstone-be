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

import { SecurityAlertsDailyTrendService } from '../services/security-alerts-daily-trend.service.js';
import { QuerySecurityAlertsDailyTrendDto } from '../dto/query-security-alerts-daily-trend.dto.js';
import { SecurityAlertsDailyTrendResponseDto } from '../dto/security-alerts-daily-trend-response.dto.js';

/**
 * SecurityAlertsDailyTrendController (AA-DASHBOARD-CHARTS-001).
 *
 * Route: GET /api/v1/analytics/security-alerts/daily-trend
 * Permission: analytics.security_alerts.read (BUSINESS_ADMIN, SYSTEM_ADMIN)
 * Read-only: khong ghi/sua/xoa security_alerts.
 */
@ApiTags('Analytics Dashboard Charts')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, PermissionsGuard)
@RequirePermissions('analytics.security_alerts.read')
@Controller('analytics/security-alerts')
export class SecurityAlertsDailyTrendController {
  constructor(private readonly service: SecurityAlertsDailyTrendService) {}

  @Get('daily-trend')
  @ApiOperation({
    summary: 'Xu huong canh bao an ninh theo ngay (Dashboard SysAdmin)',
    description:
      'Tra ve so luong canh bao an ninh moi ngay trong N ngay gan nhat, phan theo loai canh bao.',
  })
  @ApiResponse({
    status: 200,
    description: 'Xu huong canh bao an ninh duoc truy xuat thanh cong',
    type: SecurityAlertsDailyTrendResponseDto,
  })
  @ApiResponse({ status: 400, description: 'VALIDATION_ERROR' })
  @ApiResponse({ status: 401, description: 'Chua dang nhap' })
  @ApiResponse({ status: 403, description: 'PERMISSION_DENIED' })
  @ApiResponse({ status: 500, description: 'INTERNAL_ERROR' })
  async getDailyTrend(
    @Query(new ValidationPipe({ transform: true, whitelist: true }))
    query: QuerySecurityAlertsDailyTrendDto,
    @CurrentUser() currentUser: { userId: string },
  ): Promise<{
    success: boolean;
    message: string;
    data: SecurityAlertsDailyTrendResponseDto;
    meta: Record<string, any>;
  }> {
    try {
      const { data, message } = await this.service.getDailyTrend(
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
