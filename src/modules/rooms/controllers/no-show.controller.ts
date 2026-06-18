import {
  Controller,
  Post,
  Patch,
  Body,
  Param,
  Req,
  Res,
  HttpCode,
  UseGuards,
  UsePipes,
  ValidationPipe,
  ParseUUIDPipe,
} from '@nestjs/common';
import type { Response } from 'express';
import { NoShowService } from '../services/no-show.service.js';
import { CreateNoShowDto } from '../dto/create-no-show.dto.js';
import { UpdateNoShowDto } from '../dto/update-no-show.dto.js';
import { InternalTokenGuard } from '../guards/internal-token.guard.js';
import { JwtAuthGuard } from '../../auth/guards/jwt-auth.guard.js';

// Mock PermissionsGuard — nhất quán recording/iot controller.
const MockPermissionsGuard = class {
  canActivate() {
    return true;
  }
};
const Permissions =
  (...args: string[]) =>
  (target: any, key?: any, descriptor?: any) => {};

@Controller()
export class NoShowController {
  constructor(private readonly noShowService: NoShowService) {}

  // UC-41 (internal): tạo no-show case (token-gated, idempotent → 201/200).
  @Post('internal/no-show-cases')
  @UseGuards(InternalTokenGuard)
  @UsePipes(new ValidationPipe({ whitelist: true, transform: true }))
  async createInternal(
    @Body() dto: CreateNoShowDto,
    @Res({ passthrough: true }) res: Response,
  ) {
    const { case: c, created } = await this.noShowService.create(dto);
    res.status(created ? 201 : 200);
    return {
      success: true,
      message: created
        ? 'No-show case created'
        : 'No-show case already exists',
      data: {
        noShowCaseId: c.id,
        bookingId: c.booking_id,
        detectionStatus: c.detection_status,
        detectedAt: c.detected_at,
      },
    };
  }

  // UC-42: cập nhật no-show case (user).
  @Patch('no-show-cases/:id')
  @HttpCode(200)
  @UseGuards(JwtAuthGuard, MockPermissionsGuard)
  @Permissions('room.noshow.update')
  @UsePipes(new ValidationPipe({ whitelist: true, transform: true }))
  async update(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdateNoShowDto,
    @Req() req: any,
  ) {
    const userId = req.user?.userId || req.user?.sub || req.user?.id || null;
    const data = await this.noShowService.update(id, dto, userId);
    return {
      success: true,
      message: 'No-show case updated',
      data,
    };
  }
}
