import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Patch,
  UseGuards,
  UsePipes,
  ValidationPipe,
} from '@nestjs/common';
import {
  ApiBearerAuth,
  ApiBody,
  ApiOperation,
  ApiResponse,
  ApiTags,
} from '@nestjs/swagger';
import { JwtAuthGuard } from '../../auth/guards/jwt-auth.guard.js';
import { PermissionsGuard } from '../../auth/guards/permissions.guard.js';
import { RequirePermissions } from '../../auth/decorators/require-permissions.decorator.js';
import { CurrentUser } from '../../auth/decorators/current-user.decorator.js';
import { SystemConfigService } from '../services/system-config.service.js';
import { UpdateSystemConfigDto } from '../dto/update-system-config.dto.js';
import { SystemConfigResponseDto } from '../dto/system-config-response.dto.js';

/**
 * SystemConfigController (BE-09) — `GET/PATCH /api/v1/system-configurations`.
 *
 * [Đính chính CLAUDE.md §22.13, 2026-07-27] Tài liệu hướng dẫn ghi
 * `GET /api/v1/system-configs` + `PATCH /system-configs/:key` — path THẬT là
 * `/system-configurations`, body PATCH là `{key, value}` (không phải `:key` trên URL) —
 * khớp đúng `SystemSettings.jsx:49-58,177`.
 */
@ApiTags('Administration')
@Controller('system-configurations')
@UseGuards(JwtAuthGuard, PermissionsGuard)
@RequirePermissions('admin.manage_config')
@ApiBearerAuth()
@UsePipes(
  new ValidationPipe({
    whitelist: true,
    transform: true,
    forbidNonWhitelisted: true,
  }),
)
export class SystemConfigController {
  constructor(private readonly systemConfigService: SystemConfigService) {}

  @Get()
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'Xem cấu hình hệ thống (9 key allowlist)',
    description:
      'Trả 9 key cấu hình mà System Admin quản trị qua SystemSettings — không trả key ngoài allowlist.',
  })
  @ApiResponse({
    status: HttpStatus.OK,
    description: 'Danh sách cấu hình.',
    type: [SystemConfigResponseDto],
  })
  async list(): Promise<{
    success: boolean;
    message: string;
    data: SystemConfigResponseDto[];
  }> {
    const data = await this.systemConfigService.list();
    return {
      success: true,
      message: 'Lấy cấu hình hệ thống thành công',
      data,
    };
  }

  @Patch()
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'Cập nhật 1 cấu hình hệ thống',
    description:
      'Body {key, value} — key phải nằm trong allowlist 9 key, value luôn là string.',
  })
  @ApiBody({ type: UpdateSystemConfigDto })
  @ApiResponse({
    status: HttpStatus.OK,
    description: 'Cấu hình được cập nhật thành công.',
    type: SystemConfigResponseDto,
  })
  @ApiResponse({
    status: HttpStatus.BAD_REQUEST,
    description: 'Key ngoài allowlist hoặc value sai kiểu/ngoài biên hợp lệ.',
  })
  async update(
    @Body() dto: UpdateSystemConfigDto,
    @CurrentUser() user: { userId: string } | undefined,
  ): Promise<{
    success: boolean;
    message: string;
    data: SystemConfigResponseDto;
  }> {
    const data = await this.systemConfigService.upsert(
      dto.key,
      dto.value,
      user?.userId,
    );
    return {
      success: true,
      message: 'Cập nhật cấu hình hệ thống thành công',
      data,
    };
  }
}
