/* eslint-disable @typescript-eslint/no-unsafe-member-access, @typescript-eslint/no-unsafe-assignment */
import {
  Controller,
  Get,
  Post,
  Body,
  Query,
  Req,
  HttpCode,
  UseGuards,
  UsePipes,
  ValidationPipe,
} from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { JwtAuthGuard } from '../../auth/guards/jwt-auth.guard.js';
import { PermissionsGuard } from '../../auth/guards/permissions.guard.js';
import { RequirePermissions } from '../../auth/decorators/require-permissions.decorator.js';
import { UnmappedReviewService } from '../services/unmapped-review.service.js';
import { ListUnmappedQueryDto } from '../dto/list-unmapped.query.dto.js';
import { MapUnmappedDto } from '../dto/map-unmapped.dto.js';

/**
 * UnmappedReviewController (UMR-001 / #50) — admin xử lý verify không khớp mapping.
 * SEC-02: admin-only (JwtAuthGuard + PermissionsGuard).
 */
@ApiTags('Face Access - Unmapped Verifies')
@Controller('face-access/unmapped-verifies')
export class UnmappedReviewController {
  constructor(private readonly unmappedReviewService: UnmappedReviewService) {}

  // UMR-001: danh sách verify gần đây không khớp mapping còn sống.
  @Get()
  @UseGuards(JwtAuthGuard, PermissionsGuard)
  @RequirePermissions('face.unmapped.read')
  @UsePipes(new ValidationPipe({ whitelist: true, transform: true }))
  @ApiOperation({
    summary: 'Admin xem danh sách verify khuôn mặt gần đây chưa khớp mapping person↔user',
  })
  async list(@Query() query: ListUnmappedQueryDto) {
    const result = await this.unmappedReviewService.list(query);
    return {
      success: true,
      message: 'Unmapped verifies retrieved',
      data: result.data,
      meta: result.meta,
    };
  }

  // UMR-001: map thủ công person → user cho meeting (tạo mapping synced, KHÔNG đẩy thiết bị).
  @Post('map')
  @HttpCode(201)
  @UseGuards(JwtAuthGuard, PermissionsGuard)
  @RequirePermissions('face.unmapped.map')
  @UsePipes(new ValidationPipe({ whitelist: true, transform: true }))
  @ApiOperation({
    summary: 'Admin gán thủ công 1 person (verify chưa khớp) vào 1 user cho cuộc họp — tạo mapping synced, KHÔNG đẩy xuống thiết bị',
  })
  async map(@Body() dto: MapUnmappedDto, @Req() req: any) {
    const adminId = req.user?.userId || req.user?.sub || req.user?.id || null;
    const data = await this.unmappedReviewService.map(dto, adminId);
    return {
      success: true,
      message: 'Unmapped person mapped',
      data,
    };
  }
}
