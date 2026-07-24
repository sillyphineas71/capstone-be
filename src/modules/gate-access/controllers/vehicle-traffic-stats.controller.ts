import {
  Controller,
  Get,
  Query,
  UseGuards,
  UsePipes,
  ValidationPipe,
} from '@nestjs/common';
import { JwtAuthGuard } from '../../auth/guards/jwt-auth.guard.js';
import { PermissionsGuard } from '../../auth/guards/permissions.guard.js';
import { RequirePermissions } from '../../auth/decorators/require-permissions.decorator.js';
import { VehicleTrafficStatsService } from '../services/vehicle-traffic-stats.service.js';
import { VehicleTrafficStatsQueryDto } from '../dto/vehicle-traffic-stats-query.dto.js';

const STATS_PIPE = new ValidationPipe({ whitelist: true, transform: true });

/**
 * VehicleTrafficStatsController (VTS-001 / UC-114) — thống kê lưu lượng phương tiện.
 * Admin/Manager only (SRS Primary Actor "System Admin / Manager"), KHÔNG route self-service.
 */
@Controller('gate-access/admin')
@UseGuards(JwtAuthGuard, PermissionsGuard)
export class VehicleTrafficStatsController {
  constructor(
    private readonly vehicleTrafficStatsService: VehicleTrafficStatsService,
  ) {}

  @Get('vehicle-traffic-stats')
  @RequirePermissions('gate_access.stats.read')
  @UsePipes(STATS_PIPE)
  async getStats(@Query() query: VehicleTrafficStatsQueryDto) {
    const data = await this.vehicleTrafficStatsService.getStats(query);
    return {
      success: true,
      message: 'Vehicle traffic statistics retrieved successfully',
      data,
    };
  }
}
