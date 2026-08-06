import {
  Controller,
  Get,
  Param,
  ParseUUIDPipe,
  Res,
  UseGuards,
} from '@nestjs/common';
import type { Response } from 'express';
import { PermissionsGuard } from '../../auth/guards/permissions.guard.js';
import { JwtQueryOrHeaderAuthGuard } from '../../auth/guards/jwt-query-or-header-auth.guard.js';
import { RequirePermissions } from '../../auth/decorators/require-permissions.decorator.js';
import { DeviceEventSnapshotService } from '../services/device-event-snapshot.service.js';

/**
 * IvssDeviceEventSnapshotController (F-F fix) — TÁCH RIÊNG khỏi
 * IvssRoomAccessController để route ảnh snapshot dùng
 * JwtQueryOrHeaderAuthGuard (chấp nhận token qua `?token=` — `<img src>` không gắn
 * được header Authorization) mà KHÔNG đụng 2 route accessLogAll/accessLog (vẫn
 * JwtAuthGuard gốc, chỉ chấp header — 0 thay đổi, xem git diff
 * ivss-room-access.controller.ts).
 *
 * Cùng path (`ivss/device-events/:eventId/snapshot`) + cùng permission
 * `ivss.access_log.read` như bản gốc trong IvssRoomAccessController — FE KHÔNG cần
 * đổi URL, chỉ route bị dời sang controller khác.
 */
@Controller('ivss/device-events')
@UseGuards(JwtQueryOrHeaderAuthGuard, PermissionsGuard)
@RequirePermissions('ivss.access_log.read')
export class IvssDeviceEventSnapshotController {
  constructor(
    private readonly deviceEventSnapshotService: DeviceEventSnapshotService,
  ) {}

  @Get(':eventId/snapshot')
  async snapshot(
    @Param('eventId', ParseUUIDPipe) eventId: string,
    @Res() res: Response,
  ) {
    const snapshot = await this.deviceEventSnapshotService.getSnapshot(eventId);
    res.setHeader('Content-Type', snapshot.mimeType);
    res.setHeader(
      'Content-Disposition',
      `inline; filename="${snapshot.fileName}"`,
    );
    res.send(snapshot.buffer);
  }
}
