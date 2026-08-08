import {
  Controller,
  Get,
  Query,
  UseGuards,
  UsePipes,
  ValidationPipe,
} from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { JwtAuthGuard } from '../../auth/guards/jwt-auth.guard.js';
import { PermissionsGuard } from '../../auth/guards/permissions.guard.js';
import { RequirePermissions } from '../../auth/decorators/require-permissions.decorator.js';
import { StrangerAlertService } from '../services/stranger-alert.service.js';
import { ListStrangerAlertsQueryDto } from '../dto/list-stranger-alerts.query.dto.js';

/**
 * StrangerAlertController (SAL-001 / #20) — admin xem stranger gần đây.
 * SEC-02: admin-only (JwtAuthGuard + PermissionsGuard). KHÔNG lộ payload/base64.
 */
@ApiTags('Face Access - Stranger Alerts')
@Controller('face-access/stranger-alerts')
export class StrangerAlertController {
  constructor(private readonly strangerAlertService: StrangerAlertService) {}

  @Get()
  @UseGuards(JwtAuthGuard, PermissionsGuard)
  @RequirePermissions('face.stranger.read')
  @UsePipes(new ValidationPipe({ whitelist: true, transform: true }))
  @ApiOperation({
    summary: 'Admin xem danh sách cảnh báo người lạ (stranger) gần đây, có phân trang',
  })
  async list(@Query() query: ListStrangerAlertsQueryDto) {
    const result = await this.strangerAlertService.list(query);
    return {
      success: true,
      message: 'Stranger alerts retrieved',
      data: result.data,
      meta: result.meta,
    };
  }
}
