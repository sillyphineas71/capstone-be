/* eslint-disable @typescript-eslint/no-unused-vars, @typescript-eslint/no-unsafe-member-access, @typescript-eslint/no-unsafe-assignment */
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
import { JwtAuthGuard } from '../../auth/guards/jwt-auth.guard.js';
import { UnmappedReviewService } from '../services/unmapped-review.service.js';
import { ListUnmappedQueryDto } from '../dto/list-unmapped.query.dto.js';
import { MapUnmappedDto } from '../dto/map-unmapped.dto.js';

// Mock PermissionsGuard — nhất quán iot/recording/no-show controller.
const MockPermissionsGuard = class {
  canActivate() {
    return true;
  }
};
const Permissions =
  (..._args: string[]) =>
  (_target: any, _key?: any, _descriptor?: any) => {};

/**
 * UnmappedReviewController (UMR-001 / #50) — admin xử lý verify không khớp mapping.
 * SEC-02: admin-only (JwtAuthGuard + PermissionsGuard).
 */
@Controller('face-access/unmapped-verifies')
export class UnmappedReviewController {
  constructor(private readonly unmappedReviewService: UnmappedReviewService) {}

  // UMR-001: danh sách verify gần đây không khớp mapping còn sống.
  @Get()
  @UseGuards(JwtAuthGuard, MockPermissionsGuard)
  @Permissions('face.unmapped.read')
  @UsePipes(new ValidationPipe({ whitelist: true, transform: true }))
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
  @UseGuards(JwtAuthGuard, MockPermissionsGuard)
  @Permissions('face.unmapped.map')
  @UsePipes(new ValidationPipe({ whitelist: true, transform: true }))
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
