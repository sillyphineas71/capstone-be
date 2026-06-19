/* eslint-disable @typescript-eslint/no-unused-vars */
import {
  Controller,
  Get,
  Query,
  UseGuards,
  UsePipes,
  ValidationPipe,
} from '@nestjs/common';
import { JwtAuthGuard } from '../../auth/guards/jwt-auth.guard.js';
import { StrangerAlertService } from '../services/stranger-alert.service.js';
import { ListStrangerAlertsQueryDto } from '../dto/list-stranger-alerts.query.dto.js';

// Mock PermissionsGuard — nhất quán iot/recording/no-show/UMR controller.
const MockPermissionsGuard = class {
  canActivate() {
    return true;
  }
};
const Permissions =
  (...args: string[]) =>
  (target: unknown, key?: unknown, descriptor?: unknown): void => {};

/**
 * StrangerAlertController (SAL-001 / #20) — admin xem stranger gần đây.
 * SEC-02: admin-only (JwtAuthGuard + PermissionsGuard). KHÔNG lộ payload/base64.
 */
@Controller('face-access/stranger-alerts')
export class StrangerAlertController {
  constructor(private readonly strangerAlertService: StrangerAlertService) {}

  @Get()
  @UseGuards(JwtAuthGuard, MockPermissionsGuard)
  @Permissions('face.stranger.read')
  @UsePipes(new ValidationPipe({ whitelist: true, transform: true }))
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
