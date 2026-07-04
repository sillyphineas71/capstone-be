/* eslint-disable @typescript-eslint/no-unsafe-member-access, @typescript-eslint/no-unsafe-assignment */
import {
  Controller,
  Get,
  Put,
  Body,
  Req,
  HttpCode,
  UseGuards,
  UsePipes,
  ValidationPipe,
} from '@nestjs/common';
import { NoShowConfigService } from '../services/no-show-config.service.js';
import { UpdateNoShowConfigDto } from '../dto/update-no-show-config.dto.js';
import { JwtAuthGuard } from '../../auth/guards/jwt-auth.guard.js';
import { PermissionsGuard } from '../../auth/guards/permissions.guard.js';
import { RequirePermissions } from '../../auth/decorators/require-permissions.decorator.js';

/**
 * NoShowConfigController (NSL-001 #35) — admin đọc/ghi ngưỡng no-show.
 * SEC-02: admin-only (R4 — GET cũng gated). Envelope thủ công {success,message,data}.
 */
@Controller('no-show-config')
export class NoShowConfigController {
  constructor(private readonly noShowConfigService: NoShowConfigService) {}

  @Get()
  @UseGuards(JwtAuthGuard, PermissionsGuard)
  @RequirePermissions('room.noshow.configure')
  async get() {
    const data = await this.noShowConfigService.getAll();
    return { success: true, message: 'No-show config retrieved', data };
  }

  @Put()
  @HttpCode(200)
  @UseGuards(JwtAuthGuard, PermissionsGuard)
  @RequirePermissions('room.noshow.configure')
  @UsePipes(
    new ValidationPipe({
      whitelist: true,
      forbidNonWhitelisted: true,
      transform: true,
    }),
  )
  async update(@Body() dto: UpdateNoShowConfigDto, @Req() req: any) {
    const userId = req.user?.userId || req.user?.sub || req.user?.id || null;
    const data = await this.noShowConfigService.update(dto, userId);
    return { success: true, message: 'No-show config updated', data };
  }
}
