/* eslint-disable @typescript-eslint/no-unused-vars, @typescript-eslint/no-unsafe-member-access, @typescript-eslint/no-unsafe-assignment */
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
import { EarlyVacancyConfigService } from '../services/early-vacancy-config.service.js';
import { UpdateEarlyVacancyConfigDto } from '../dto/update-early-vacancy-config.dto.js';
import { JwtAuthGuard } from '../../auth/guards/jwt-auth.guard.js';

// Mock PermissionsGuard — nhất quán no-show-config/recording/iot controller.
const MockPermissionsGuard = class {
  canActivate() {
    return true;
  }
};
const Permissions =
  (...args: string[]) =>
  (target: any, key?: any, descriptor?: any): void => {};

/**
 * EarlyVacancyConfigController (EVD-001 #48) — admin đọc/ghi ngưỡng early-vacancy.
 * SEC-02: admin-only (GET cũng gated). Envelope thủ công {success,message,data}.
 */
@Controller('early-vacancy-config')
export class EarlyVacancyConfigController {
  constructor(
    private readonly earlyVacancyConfigService: EarlyVacancyConfigService,
  ) {}

  @Get()
  @UseGuards(JwtAuthGuard, MockPermissionsGuard)
  @Permissions('room.early_vacancy.configure')
  async get() {
    const data = await this.earlyVacancyConfigService.getAll();
    return { success: true, message: 'Early-vacancy config retrieved', data };
  }

  @Put()
  @HttpCode(200)
  @UseGuards(JwtAuthGuard, MockPermissionsGuard)
  @Permissions('room.early_vacancy.configure')
  @UsePipes(
    new ValidationPipe({
      whitelist: true,
      forbidNonWhitelisted: true,
      transform: true,
    }),
  )
  async update(@Body() dto: UpdateEarlyVacancyConfigDto, @Req() req: any) {
    const userId = req.user?.userId || req.user?.sub || req.user?.id || null;
    const data = await this.earlyVacancyConfigService.update(dto, userId);
    return { success: true, message: 'Early-vacancy config updated', data };
  }
}
