import {
  Controller,
  Get,
  Param,
  ParseUUIDPipe,
  Query,
  UseGuards,
  UsePipes,
  ValidationPipe,
} from '@nestjs/common';
import { JwtAuthGuard } from '../../auth/guards/jwt-auth.guard.js';
import { PermissionsGuard } from '../../auth/guards/permissions.guard.js';
import { RequirePermissions } from '../../auth/decorators/require-permissions.decorator.js';
import { CurrentUser } from '../../auth/decorators/current-user.decorator.js';
import { GateAccessHistoryService } from '../services/gate-access-history.service.js';
import { ListGateAccessHistoryQueryDto } from '../dto/list-gate-access-history-query.dto.js';
import { ListGateAccessHistoryAdminQueryDto } from '../dto/list-gate-access-history-admin-query.dto.js';

const HISTORY_PIPE = new ValidationPipe({ whitelist: true, transform: true });

/**
 * GateAccessHistoryController (GAH-001 / UC-117) — tra cứu lịch sử ra/vào cổng.
 *
 * 2 route own (CHỈ `JwtAuthGuard`, mirror UC7 `vehicle-history`) + 2 route admin
 * (`PermissionsGuard` + `@RequirePermissions('gate_access.history.read_all')`, BR1 SRS).
 * Route cố định đặt TRƯỚC route `:id` theo thứ tự khai báo chuẩn.
 */
@Controller('gate-access')
export class GateAccessHistoryController {
  constructor(
    private readonly gateAccessHistoryService: GateAccessHistoryService,
  ) {}

  @Get('history')
  @UseGuards(JwtAuthGuard)
  @UsePipes(HISTORY_PIPE)
  async listOwn(
    @CurrentUser() user: { userId: string },
    @Query() query: ListGateAccessHistoryQueryDto,
  ) {
    const { items, meta } = await this.gateAccessHistoryService.listForUser(
      user.userId,
      query,
    );
    return {
      success: true,
      message: 'Gate access history retrieved successfully',
      data: items,
      meta,
    };
  }

  @Get('admin/history')
  @UseGuards(JwtAuthGuard, PermissionsGuard)
  @RequirePermissions('gate_access.history.read_all')
  @UsePipes(HISTORY_PIPE)
  async listAll(@Query() query: ListGateAccessHistoryAdminQueryDto) {
    const { items, meta } = await this.gateAccessHistoryService.listAll(query);
    return {
      success: true,
      message: 'Gate access history retrieved successfully',
      data: items,
      meta,
    };
  }

  @Get('history/:id')
  @UseGuards(JwtAuthGuard)
  async detailOwn(
    @CurrentUser() user: { userId: string },
    @Param('id', ParseUUIDPipe) id: string,
  ) {
    const entity = await this.gateAccessHistoryService.getDetailForUser(
      id,
      user.userId,
    );
    return {
      success: true,
      message: 'Gate access history detail retrieved successfully',
      data: entity,
    };
  }

  @Get('admin/history/:id')
  @UseGuards(JwtAuthGuard, PermissionsGuard)
  @RequirePermissions('gate_access.history.read_all')
  async detailAny(@Param('id', ParseUUIDPipe) id: string) {
    const entity = await this.gateAccessHistoryService.getDetailAny(id);
    return {
      success: true,
      message: 'Gate access history detail retrieved successfully',
      data: entity,
    };
  }
}
