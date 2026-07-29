import {
  Controller,
  Get,
  Param,
  ParseUUIDPipe,
  Query,
  UseGuards,
  UsePipes,
  ValidationPipe,
} from '@nestjs/common';
import { JwtAuthGuard } from '../../auth/guards/jwt-auth.guard.js';
import { PermissionsGuard } from '../../auth/guards/permissions.guard.js';
import { RequirePermissions } from '../../auth/decorators/require-permissions.decorator.js';
import { IvssRoomAccessLogService } from '../services/ivss-room-access-log.service.js';
import { QueryRoomAccessLogDto } from '../dto/query-room-access-log.dto.js';

/**
 * IvssRoomAccessController (RAL-001 / Màn 2) — nhật ký ra/vào theo PHÒNG + NGÀY.
 *
 * Controller RIÊNG (prefix `ivss/rooms`) để KHÔNG đụng `ivss-presence.controller.ts`
 * (prefix `ivss/meetings` — Màn 1, góc nhìn theo cuộc họp).
 * SEC-02: admin-gated, tái dùng permission `ivss.presence.read` như Màn 1. READ-ONLY.
 */
@Controller('ivss/rooms')
export class IvssRoomAccessController {
  constructor(
    private readonly roomAccessLogService: IvssRoomAccessLogService,
  ) {}

  @Get(':roomId/access-log')
  @UseGuards(JwtAuthGuard, PermissionsGuard)
  @RequirePermissions('ivss.presence.read')
  @UsePipes(new ValidationPipe({ whitelist: true, transform: true }))
  async accessLog(
    @Param('roomId', ParseUUIDPipe) roomId: string,
    @Query() query: QueryRoomAccessLogDto,
  ) {
    const data = await this.roomAccessLogService.getRoomAccessLog(
      roomId,
      query.date,
    );
    return { success: true, message: 'Room access log retrieved', data };
  }
}
