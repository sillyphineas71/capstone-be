import {
  Controller,
  Get,
  Post,
  Patch,
  Body,
  Param,
  Query,
  Req,
  Res,
  HttpCode,
  UseGuards,
  UsePipes,
  ValidationPipe,
  ParseUUIDPipe,
} from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import type { Response } from 'express';
import { NoShowService } from '../services/no-show.service.js';
import { NoShowLifecycleService } from '../services/no-show-lifecycle.service.js';
import { CreateNoShowDto } from '../dto/create-no-show.dto.js';
import { UpdateNoShowDto } from '../dto/update-no-show.dto.js';
import { ReleaseNoShowDto } from '../dto/release-no-show.dto.js';
import { ListNoShowCasesQueryDto } from '../dto/list-no-show-cases-query.dto.js';
import { InternalTokenGuard } from '../guards/internal-token.guard.js';
import { JwtAuthGuard } from '../../auth/guards/jwt-auth.guard.js';
import { PermissionsGuard } from '../../auth/guards/permissions.guard.js';
import { RequirePermissions } from '../../auth/decorators/require-permissions.decorator.js';

@ApiTags('Rooms - No-Show')
@Controller()
export class NoShowController {
  constructor(
    private readonly noShowService: NoShowService,
    private readonly noShowLifecycleService: NoShowLifecycleService,
  ) {}

  // UC-41 (internal): tạo no-show case (token-gated, idempotent → 201/200).
  @Post('internal/no-show-cases')
  @UseGuards(InternalTokenGuard)
  @UsePipes(new ValidationPipe({ whitelist: true, transform: true }))
  @ApiOperation({
    summary:
      '[NỘI BỘ — token-gated, gọi bởi job phát hiện no-show, không phải endpoint public] Tạo mới 1 case no-show (idempotent — trả 201 nếu tạo mới, 200 nếu đã tồn tại)',
  })
  async createInternal(
    @Body() dto: CreateNoShowDto,
    @Res({ passthrough: true }) res: Response,
  ) {
    const { case: c, created } = await this.noShowService.create(dto);
    res.status(created ? 201 : 200);
    return {
      success: true,
      message: created ? 'No-show case created' : 'No-show case already exists',
      data: {
        noShowCaseId: c.id,
        bookingId: c.booking_id,
        detectionStatus: c.detection_status,
        detectedAt: c.detected_at,
      },
    };
  }

  // GET list no-show cases (bảng giám sát phòng) — phân trang + lọc status/roomId.
  @Get('no-show-cases')
  @UseGuards(JwtAuthGuard, PermissionsGuard)
  @RequirePermissions('room.noshow.read')
  @UsePipes(new ValidationPipe({ whitelist: true, transform: true }))
  @ApiOperation({ summary: 'Xem danh sách case no-show (bảng giám sát phòng), có phân trang + lọc theo trạng thái/phòng' })
  async list(@Query() query: ListNoShowCasesQueryDto) {
    const { items, meta } = await this.noShowService.list(query);
    return {
      success: true,
      message: 'No-show cases retrieved successfully',
      data: items,
      meta,
    };
  }

  // UC-42: cập nhật no-show case (user).
  @Patch('no-show-cases/:id')
  @HttpCode(200)
  @UseGuards(JwtAuthGuard, PermissionsGuard)
  @RequirePermissions('room.noshow.update')
  @UsePipes(new ValidationPipe({ whitelist: true, transform: true }))
  @ApiOperation({ summary: 'Cập nhật 1 case no-show (user xử lý)' })
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

  // UC-45 (#33b): admin giải phóng phòng thủ công cho no-show case.
  // Mã trả (A): 404 not-found · 400 dismissed/resolved · 200 released/no-op · 409 booking_changed.
  @Post('no-show-cases/:id/release')
  @HttpCode(200)
  @UseGuards(JwtAuthGuard, PermissionsGuard)
  @RequirePermissions('room.noshow.release')
  @UsePipes(new ValidationPipe({ whitelist: true, transform: true }))
  @ApiOperation({ summary: 'Admin giải phóng phòng thủ công cho 1 case no-show' })
  async release(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: ReleaseNoShowDto,
    @Req() req: any,
  ) {
    const userId = req.user?.userId || req.user?.sub || req.user?.id || null;
    const data = await this.noShowLifecycleService.manualRelease(
      id,
      dto.reason,
      userId,
    );
    return {
      success: true,
      message: 'No-show case released',
      data,
    };
  }
}
