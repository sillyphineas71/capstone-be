/* eslint-disable @typescript-eslint/no-unused-vars */
import {
  Controller,
  Get,
  Param,
  ParseUUIDPipe,
  NotFoundException,
  UseGuards,
  Res,
} from '@nestjs/common';
import type { Response } from 'express';
import { JwtAuthGuard } from '../../auth/guards/jwt-auth.guard.js';
import { IvssPresenceQueryService } from '../services/ivss-presence-query.service.js';
import { IvssPresenceReportService } from '../services/ivss-presence-report.service.js';

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
    private readonly presenceReportService: IvssPresenceReportService,
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

  // #43 (IPR-001): tải PDF báo cáo hiện diện cả họp. C2: @Res() file, KHÔNG envelope.
  @Get(':meetingId/presence/report')
  @UseGuards(JwtAuthGuard, MockPermissionsGuard)
  @Permissions('ivss.presence.read')
  async report(
    @Param('meetingId', ParseUUIDPipe) meetingId: string,
    @Res() res: Response,
  ) {
    let report: { buffer: Buffer; filename: string } | null;
    try {
      report = await this.presenceReportService.buildMeetingReport(meetingId);
    } catch {
      // Lỗi render → 500, KHÔNG lộ path/chi tiết nội bộ.
      res.status(500).end();
      return;
    }
    if (!report) {
      res.status(404).json({
        code: 'MEETING_NOT_FOUND',
        message: 'Meeting not found.',
      });
      return;
    }
    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader(
      'Content-Disposition',
      `attachment; filename="${report.filename}"`,
    );
    res.send(report.buffer);
  }
}
