import {
  Body,
  Controller,
  Get,
  Post,
  HttpCode,
  Req,
  UseGuards,
  UsePipes,
  ValidationPipe,
  Param,
  ParseUUIDPipe,
} from '@nestjs/common';
import { RecordingSessionService } from '../services/recording-session.service.js';
import { StartVideoDto } from '../dto/start-video.dto.js';
import { JwtAuthGuard } from '../../auth/guards/jwt-auth.guard.js';

// Mock PermissionsGuard — nhất quán IOT/REC controller.
const MockPermissionsGuard = class {
  canActivate() {
    return true;
  }
};
const Permissions =
  (...args: string[]) =>
  (target: any, key?: any, descriptor?: any) => {};

@Controller()
export class RecordingSessionController {
  constructor(
    private readonly recordingSessionService: RecordingSessionService,
  ) {}

  // REC-002 (UC-111): bắt đầu ghi hình video từ IP camera.
  @Post('live-meetings/:meetingId/recording/start-video')
  @HttpCode(201)
  @UseGuards(JwtAuthGuard, MockPermissionsGuard)
  @Permissions('recording.video.start')
  @UsePipes(new ValidationPipe({ whitelist: true, transform: true }))
  async startVideo(
    @Req() req: any,
    @Param('meetingId', ParseUUIDPipe) meetingId: string,
    @Body() dto: StartVideoDto,
  ) {
    const userId = req.user?.userId || req.user?.sub || req.user?.id || null;
    const data = await this.recordingSessionService.startVideo(
      meetingId,
      dto,
      userId,
    );
    return {
      success: true,
      message: 'Video recording started',
      data,
    };
  }

  // REC-003 (UC-116): dừng ghi hình video. v1 đồng bộ → 200.
  @Post('live-meetings/:meetingId/recording/:sessionId/stop-video')
  @HttpCode(200)
  @UseGuards(JwtAuthGuard, MockPermissionsGuard)
  @Permissions('recording.video.stop')
  async stopVideo(
    @Req() req: any,
    @Param('meetingId', ParseUUIDPipe) meetingId: string,
    @Param('sessionId', ParseUUIDPipe) sessionId: string,
  ) {
    const userId = req.user?.userId || req.user?.sub || req.user?.id || null;
    const data = await this.recordingSessionService.stopVideo(
      meetingId,
      sessionId,
      userId,
    );
    return {
      success: true,
      message: data.captured
        ? 'Video recording stopped'
        : 'Đã dừng nhưng không ghi được video',
      data,
    };
  }

  // REC-004 (Phần A): đọc trạng thái phiên ghi (read-only).
  @Get('live-meetings/:meetingId/recording/:sessionId/status')
  @HttpCode(200)
  @UseGuards(JwtAuthGuard, MockPermissionsGuard)
  @Permissions('recording.video.status')
  async getStatus(
    @Param('meetingId', ParseUUIDPipe) meetingId: string,
    @Param('sessionId', ParseUUIDPipe) sessionId: string,
  ) {
    const data = await this.recordingSessionService.getStatus(
      meetingId,
      sessionId,
    );
    return {
      success: true,
      message: 'Recording status retrieved',
      data,
    };
  }
}
