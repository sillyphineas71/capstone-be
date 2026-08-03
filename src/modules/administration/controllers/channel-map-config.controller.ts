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
import { ChannelMapConfigService } from '../services/channel-map-config.service.js';
import { PatchChannelMapConfigDto } from '../dto/patch-channel-map-config.dto.js';
import { ChannelMapConfigItemDto } from '../dto/channel-map-config-response.dto.js';

/**
 * ChannelMapConfigController (F7, recon R4/R5) — `GET/PATCH
 * /api/v1/system-configurations/channel-maps`.
 *
 * TÁCH RIÊNG khỏi SystemConfigController (`/system-configurations`, allowlist 9 key
 * phẳng) — xem `constants/channel-map-config.constant.ts` để biết lý do không gộp.
 * Cùng quyền `admin.manage_config` (cùng nhóm admin quản trị cấu hình hệ thống).
 */
@ApiTags('Administration')
@Controller('system-configurations/channel-maps')
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
export class ChannelMapConfigController {
  constructor(
    private readonly channelMapConfigService: ChannelMapConfigService,
  ) {}

  @Get()
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'Xem 7 key channel-map/threshold (ivss/campus/attendance)',
    description:
      'Trả đủ 7 key: 4 channel-map (JSON) + 3 ngưỡng (number). value=null nếu key chưa từng được set.',
  })
  @ApiResponse({
    status: HttpStatus.OK,
    description: 'Danh sách 7 key.',
    type: [ChannelMapConfigItemDto],
  })
  async list(): Promise<{
    success: boolean;
    message: string;
    data: ChannelMapConfigItemDto[];
  }> {
    const data = await this.channelMapConfigService.list();
    return {
      success: true,
      message: 'Lấy channel-map config thành công',
      data,
    };
  }

  @Patch()
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'Cập nhật 1 channel-map/threshold key',
    description:
      'Body {key, value} — key phải nằm trong 7 key cho phép. value là object {"<channelId>": "<uuid|direction>"} cho 4 key map, hoặc số nguyên dương cho 3 key threshold.',
  })
  @ApiBody({ type: PatchChannelMapConfigDto })
  @ApiResponse({
    status: HttpStatus.OK,
    description: 'Cấu hình được cập nhật thành công.',
    type: ChannelMapConfigItemDto,
  })
  @ApiResponse({
    status: HttpStatus.BAD_REQUEST,
    description:
      'Key ngoài danh sách 7 key, hoặc value sai kiểu/tham chiếu room/zone không tồn tại.',
  })
  async update(
    @Body() dto: PatchChannelMapConfigDto,
    @CurrentUser() user: { userId: string } | undefined,
  ): Promise<{
    success: boolean;
    message: string;
    data: ChannelMapConfigItemDto;
  }> {
    const data = await this.channelMapConfigService.upsert(
      dto.key,
      dto.value,
      user?.userId,
    );
    return {
      success: true,
      message: 'Cập nhật channel-map config thành công',
      data,
    };
  }
}
