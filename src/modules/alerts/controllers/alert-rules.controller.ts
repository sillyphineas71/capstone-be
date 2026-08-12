import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  Query,
  UseGuards,
  UsePipes,
  ValidationPipe,
} from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { JwtAuthGuard } from '../../auth/guards/jwt-auth.guard.js';
import { PermissionsGuard } from '../../auth/guards/permissions.guard.js';
import { RequirePermissions } from '../../auth/decorators/require-permissions.decorator.js';
import { CurrentUser } from '../../auth/decorators/current-user.decorator.js';
import { AlertRulesService } from '../services/alert-rules.service.js';
import { CreateAlertRuleDto } from '../dto/create-alert-rule.dto.js';
import { UpdateAlertRuleDto } from '../dto/update-alert-rule.dto.js';
import { QueryAlertRulesDto } from '../dto/query-alert-rules.dto.js';
import { toAlertRuleResponse } from '../dto/alert-rule-response.dto.js';

const ALERT_RULE_PIPE = new ValidationPipe({
  whitelist: true,
  transform: true,
});

/**
 * AlertRulesController (ARL-001 / UC-122) — CRUD `alert_rules`. Toàn bộ route
 * admin/security-gated (mirror `VehicleControlListController`), KHÔNG route self-service.
 */
@ApiTags('Alerts - Alert Rules')
@Controller('alert-rules')
@UseGuards(JwtAuthGuard, PermissionsGuard)
export class AlertRulesController {
  constructor(private readonly alertRulesService: AlertRulesService) {}

  @Post()
  @HttpCode(HttpStatus.CREATED)
  @RequirePermissions('alert_rules.create')
  @UsePipes(ALERT_RULE_PIPE)
  @ApiOperation({ summary: 'Tạo mới 1 quy tắc cảnh báo (alert rule)' })
  async create(
    @CurrentUser() user: { userId: string },
    @Body() dto: CreateAlertRuleDto,
  ) {
    const entity = await this.alertRulesService.create(dto, user.userId);
    return {
      success: true,
      message: 'Alert rule created successfully',
      data: toAlertRuleResponse(entity),
    };
  }

  @Get()
  @RequirePermissions('alert_rules.read')
  @UsePipes(ALERT_RULE_PIPE)
  @ApiOperation({
    summary: 'Xem danh sách quy tắc cảnh báo, có phân trang + lọc',
  })
  async list(@Query() query: QueryAlertRulesDto) {
    const { items, meta } = await this.alertRulesService.list(query);
    return {
      success: true,
      message: 'Alert rules retrieved successfully',
      data: items.map(toAlertRuleResponse),
      meta,
    };
  }

  @Get(':id')
  @RequirePermissions('alert_rules.read')
  @ApiOperation({ summary: 'Xem chi tiết 1 quy tắc cảnh báo theo ID' })
  async detail(@Param('id', ParseUUIDPipe) id: string) {
    const entity = await this.alertRulesService.findOne(id);
    return {
      success: true,
      message: 'Alert rule retrieved successfully',
      data: toAlertRuleResponse(entity),
    };
  }

  @Patch(':id')
  @RequirePermissions('alert_rules.update')
  @UsePipes(ALERT_RULE_PIPE)
  @ApiOperation({ summary: 'Cập nhật 1 quy tắc cảnh báo đã có' })
  async update(
    @CurrentUser() user: { userId: string },
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdateAlertRuleDto,
  ) {
    const entity = await this.alertRulesService.update(id, dto, user.userId);
    return {
      success: true,
      message: 'Alert rule updated successfully',
      data: toAlertRuleResponse(entity),
    };
  }

  @Delete(':id')
  @RequirePermissions('alert_rules.delete')
  @ApiOperation({ summary: 'Xóa 1 quy tắc cảnh báo' })
  async remove(
    @CurrentUser() user: { userId: string },
    @Param('id', ParseUUIDPipe) id: string,
  ) {
    await this.alertRulesService.remove(id, user.userId);
    return {
      success: true,
      message: 'Alert rule deleted successfully',
      data: null,
    };
  }
}
