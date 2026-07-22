import {
  Body,
  Controller,
  HttpCode,
  HttpStatus,
  Post,
  UseGuards,
  UsePipes,
  ValidationPipe,
} from '@nestjs/common';
import { JwtAuthGuard } from '../../auth/guards/jwt-auth.guard.js';
import { PermissionsGuard } from '../../auth/guards/permissions.guard.js';
import { RequirePermissions } from '../../auth/decorators/require-permissions.decorator.js';
import { ZonesService } from '../services/zones.service.js';
import { CreateZoneDto } from '../dto/create-zone.dto.js';
import { toZoneResponse } from '../dto/zone-response.dto.js';

// Repo KHÔNG có global ValidationPipe (main.ts) ⇒ phải khai tường minh ở controller.
const ZONE_PIPE = new ValidationPipe({ whitelist: true, transform: true });

/**
 * ZonesController (ZNC-001 / UC-90) — tạo khu vực.
 *
 * Đúng 1 route: POST /api/v1/zones (prefix `api/v1` set ở main.ts). List/detail/sửa/xóa
 * là UC-91→93, KHÔNG làm ở đây.
 *
 * ⚠ `@RequirePermissions` là BẮT BUỘC: `PermissionsGuard` trả `true` khi handler không có
 * metadata (permissions.guard.ts) ⇒ thiếu decorator = endpoint hở im lặng, không lỗi nào báo.
 */
@Controller('zones')
export class ZonesController {
  constructor(private readonly zonesService: ZonesService) {}

  @Post()
  @HttpCode(HttpStatus.CREATED)
  @UseGuards(JwtAuthGuard, PermissionsGuard)
  @RequirePermissions('zones.zone.create')
  @UsePipes(ZONE_PIPE)
  async create(@Body() dto: CreateZoneDto) {
    const entity = await this.zonesService.create(dto);

    return {
      success: true,
      message: 'Zone created successfully',
      data: toZoneResponse(entity),
    };
  }
}
