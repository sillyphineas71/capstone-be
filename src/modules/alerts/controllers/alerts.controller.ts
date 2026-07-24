import {
  Body,
  Controller,
  Get,
  Param,
  ParseUUIDPipe,
  Post,
  Query,
  UseGuards,
  UsePipes,
  ValidationPipe,
} from '@nestjs/common';
import { JwtAuthGuard } from '../../auth/guards/jwt-auth.guard.js';
import { PermissionsGuard } from '../../auth/guards/permissions.guard.js';
import { RequirePermissions } from '../../auth/decorators/require-permissions.decorator.js';
import { CurrentUser } from '../../auth/decorators/current-user.decorator.js';
import { AlertsService } from '../services/alerts.service.js';
import { QuerySecurityAlertsDto } from '../dto/query-security-alerts.dto.js';
import { ResolveSecurityAlertDto } from '../dto/resolve-security-alert.dto.js';
import { BulkAcknowledgeSecurityAlertsDto } from '../dto/bulk-acknowledge-security-alerts.dto.js';
import {
  toSecurityAlertResponse,
  toZoneSummary,
} from '../dto/security-alert-response.dto.js';

const SECURITY_ALERT_PIPE = new ValidationPipe({
  whitelist: true,
  transform: true,
});

/**
 * AlertsController (ASC-001 / UC-123) — Trung tâm cảnh báo an ninh: list/detail/
 * acknowledge/resolve/bulk-acknowledge. Toàn bộ route admin/security-gated.
 */
@Controller('security-alerts')
@UseGuards(JwtAuthGuard, PermissionsGuard)
export class AlertsController {
  constructor(private readonly alertsService: AlertsService) {}

  @Get()
  @RequirePermissions('security_alert.read')
  @UsePipes(SECURITY_ALERT_PIPE)
  async list(@Query() query: QuerySecurityAlertsDto) {
    const { items, meta } = await this.alertsService.list(query);
    return {
      success: true,
      message: 'Security alerts retrieved successfully',
      data: items.map(toSecurityAlertResponse),
      meta,
    };
  }

  @Get(':id')
  @RequirePermissions('security_alert.read')
  async detail(@Param('id', ParseUUIDPipe) id: string) {
    const { alert, zone, history } = await this.alertsService.findDetail(id);
    return {
      success: true,
      message: 'Security alert retrieved successfully',
      data: {
        ...toSecurityAlertResponse(alert),
        zone: toZoneSummary(zone),
        history: history.map(toSecurityAlertResponse),
      },
    };
  }

  @Post(':id/acknowledge')
  @RequirePermissions('security_alert.acknowledge')
  async acknowledge(
    @CurrentUser() user: { userId: string },
    @Param('id', ParseUUIDPipe) id: string,
  ) {
    const entity = await this.alertsService.acknowledge(id, user.userId);
    return {
      success: true,
      message: 'Security alert acknowledged successfully',
      data: toSecurityAlertResponse(entity),
    };
  }

  @Post(':id/resolve')
  @RequirePermissions('security_alert.resolve')
  @UsePipes(SECURITY_ALERT_PIPE)
  async resolve(
    @CurrentUser() user: { userId: string },
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: ResolveSecurityAlertDto,
  ) {
    const entity = await this.alertsService.resolve(id, dto, user.userId);
    return {
      success: true,
      message: 'Security alert resolved successfully',
      data: toSecurityAlertResponse(entity),
    };
  }

  @Post('bulk-acknowledge')
  @RequirePermissions('security_alert.acknowledge')
  @UsePipes(SECURITY_ALERT_PIPE)
  async bulkAcknowledge(
    @CurrentUser() user: { userId: string },
    @Body() dto: BulkAcknowledgeSecurityAlertsDto,
  ) {
    const result = await this.alertsService.bulkAcknowledge(
      dto.ids,
      user.userId,
    );
    return {
      success: true,
      message: 'Bulk acknowledge processed',
      data: result,
    };
  }
}
