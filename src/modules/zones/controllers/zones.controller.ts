import {
  Body,
  Controller,
  Delete,
  HttpCode,
  HttpStatus,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  UseGuards,
  UsePipes,
  ValidationPipe,
} from '@nestjs/common';
import { JwtAuthGuard } from '../../auth/guards/jwt-auth.guard.js';
import { PermissionsGuard } from '../../auth/guards/permissions.guard.js';
import { RequirePermissions } from '../../auth/decorators/require-permissions.decorator.js';
import { CurrentUser } from '../../auth/decorators/current-user.decorator.js';
import { ZonesService } from '../services/zones.service.js';
import { CreateZoneDto } from '../dto/create-zone.dto.js';
import { UpdateZoneDto } from '../dto/update-zone.dto.js';
import { toZoneResponse } from '../dto/zone-response.dto.js';

// Repo KHÔNG có global ValidationPipe (main.ts) ⇒ phải khai tường minh ở controller.
const ZONE_PIPE = new ValidationPipe({ whitelist: true, transform: true });

/**
 * ZonesController (ZNC-001 / UC-90 + ZNU-001 / UC-91) — tạo và cập nhật khu vực.
 *
 * 2 route (prefix `api/v1` set ở main.ts):
 * - POST  /api/v1/zones      — tạo khu vực (UC-90).
 * - PATCH /api/v1/zones/:id  — cập nhật khu vực, GỘP cả `status` (UC-91, OQ-3).
 * List/detail (UC-93) và xóa (UC-92) KHÔNG làm ở đây.
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
  async create(
    @CurrentUser() user: { userId: string },
    @Body() dto: CreateZoneDto,
  ) {
    const entity = await this.zonesService.create(dto, user.userId);

    return {
      success: true,
      message: 'Zone created successfully',
      data: toZoneResponse(entity),
    };
  }

  /**
   * UC-91 (ZNU-001): cập nhật khu vực. KHÔNG `@HttpCode` — PATCH mặc định 200, kể cả khi
   * service trả no-op (không có field nào đổi giá trị thật).
   */
  @Patch(':id')
  @UseGuards(JwtAuthGuard, PermissionsGuard)
  @RequirePermissions('zones.zone.update')
  @UsePipes(ZONE_PIPE)
  async update(
    @CurrentUser() user: { userId: string },
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdateZoneDto,
  ) {
    const entity = await this.zonesService.update(id, dto, user.userId);

    return {
      success: true,
      message: 'Zone updated successfully',
      data: toZoneResponse(entity),
    };
  }

  /**
   * UC-92 (ZND-001): xoá mềm khu vực. KHÔNG `@HttpCode` — DELETE mặc định 200 (OQ-3:
   * trả envelope với `data: null`, KHÔNG dùng 204). KHÔNG `ZONE_PIPE` vì không có body/query.
   */
  @Delete(':id')
  @UseGuards(JwtAuthGuard, PermissionsGuard)
  @RequirePermissions('zones.zone.delete')
  async remove(
    @CurrentUser() user: { userId: string },
    @Param('id', ParseUUIDPipe) id: string,
  ) {
    await this.zonesService.remove(id, user.userId);

    return {
      success: true,
      message: 'Zone deleted successfully',
      data: null,
    };
  }
}
