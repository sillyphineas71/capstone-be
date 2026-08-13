import {
  Controller,
  Get,
  Put,
  Body,
  HttpCode,
  UseGuards,
  UsePipes,
  ValidationPipe,
} from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { SecurityAlertConfigService } from '../services/security-alert-config.service.js';
import { UpdateSecurityAlertConfigDto } from '../dto/update-security-alert-config.dto.js';
import { JwtAuthGuard } from '../../auth/guards/jwt-auth.guard.js';
import { PermissionsGuard } from '../../auth/guards/permissions.guard.js';
import { RequirePermissions } from '../../auth/decorators/require-permissions.decorator.js';
import { CurrentUser } from '../../auth/decorators/current-user.decorator.js';

/**
 * SecurityAlertConfigController — SysAdmin đọc/ghi ngưỡng auto-resolve
 * security_alerts. Permission riêng security_alerts.configure (SYSTEM_ADMIN
 * only — hẹp hơn alert_rules.update vốn còn cấp cho BUSINESS_ADMIN).
 */
@ApiTags('Alerts - Security Alert Config')
@Controller('security-alerts-config')
@UseGuards(JwtAuthGuard, PermissionsGuard)
export class SecurityAlertConfigController {
  constructor(
    private readonly securityAlertConfigService: SecurityAlertConfigService,
  ) {}

  @Get()
  @RequirePermissions('security_alerts.configure')
  @ApiOperation({
    summary:
      'SysAdmin xem toàn bộ ngưỡng cấu hình auto-resolve của security_alerts',
  })
  async get() {
    const data = await this.securityAlertConfigService.getAll();
    return {
      success: true,
      message: 'Security alert config retrieved',
      data,
    };
  }

  @Put()
  @HttpCode(200)
  @RequirePermissions('security_alerts.configure')
  @UsePipes(
    new ValidationPipe({
      whitelist: true,
      forbidNonWhitelisted: true,
      transform: true,
    }),
  )
  @ApiOperation({
    summary:
      'SysAdmin cập nhật ngưỡng cấu hình auto-resolve của security_alerts (≥1 field)',
  })
  async update(
    @Body() dto: UpdateSecurityAlertConfigDto,
    @CurrentUser() user: { userId: string },
  ) {
    const data = await this.securityAlertConfigService.update(
      dto,
      user?.userId ?? null,
    );
    return {
      success: true,
      message: 'Security alert config updated',
      data,
    };
  }
}
