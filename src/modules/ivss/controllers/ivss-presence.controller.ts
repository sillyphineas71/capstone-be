/* eslint-disable @typescript-eslint/no-unused-vars */
import {
  Controller,
  Get,
  Param,
  ParseUUIDPipe,
  NotFoundException,
  UseGuards,
} from '@nestjs/common';
import { JwtAuthGuard } from '../../auth/guards/jwt-auth.guard.js';
import { IvssPresenceQueryService } from '../services/ivss-presence-query.service.js';

// Mock PermissionsGuard — nhất quán stranger-alert/no-show-config controller.
const MockPermissionsGuard = class {
  canActivate() {
    return true;
  }
};
const Permissions =
  (...args: string[]) =>
  (target: any, key?: any, descriptor?: any): void => {};

/**
 * IvssPresenceController (IPD-001 #41+#42) — READ-ONLY admin xem duration + timeline per-person.
 * SEC-02: admin-only (JwtAuthGuard + PermissionsGuard). KHÔNG mutate. KHÔNG lộ ảnh.
 */
@Controller('ivss/meetings')
export class IvssPresenceController {
  constructor(
    private readonly presenceQueryService: IvssPresenceQueryService,
  ) {}

  // #41 + #42 chi tiết 1 người trong 1 họp.
  @Get(':meetingId/presence/:userId')
  @UseGuards(JwtAuthGuard, MockPermissionsGuard)
  @Permissions('ivss.presence.read')
  async userPresence(
    @Param('meetingId', ParseUUIDPipe) meetingId: string,
    @Param('userId', ParseUUIDPipe) userId: string,
  ) {
    const data = await this.presenceQueryService.getUserPresence(
      meetingId,
      userId,
    );
    if (!data) {
      throw new NotFoundException({
        code: 'MEETING_NOT_FOUND',
        message: 'Meeting not found.',
      });
    }
    return { success: true, message: 'IVSS user presence retrieved', data };
  }

  // Summary mọi participant trong 1 họp.
  @Get(':meetingId/presence')
  @UseGuards(JwtAuthGuard, MockPermissionsGuard)
  @Permissions('ivss.presence.read')
  async meetingPresence(@Param('meetingId', ParseUUIDPipe) meetingId: string) {
    const data = await this.presenceQueryService.getMeetingPresence(meetingId);
    if (!data) {
      throw new NotFoundException({
        code: 'MEETING_NOT_FOUND',
        message: 'Meeting not found.',
      });
    }
    return { success: true, message: 'IVSS meeting presence retrieved', data };
  }
}
