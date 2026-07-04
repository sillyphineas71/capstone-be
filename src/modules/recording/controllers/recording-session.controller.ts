import {
  Body,
  Controller,
  Get,
  Post,
  HttpCode,
  Req,
  UseGuards,
  UseInterceptors,
  UploadedFile,
  UsePipes,
  ValidationPipe,
  Param,
  ParseUUIDPipe,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { RecordingSessionService } from '../services/recording-session.service.js';
import { StartVideoDto } from '../dto/start-video.dto.js';
import { JwtAuthGuard } from '../../auth/guards/jwt-auth.guard.js';
import { PermissionsGuard } from '../../auth/guards/permissions.guard.js';
import { RequirePermissions } from '../../auth/decorators/require-permissions.decorator.js';

const AUDIO_UPLOAD_MAX_BYTES =
  Number(process.env.STORAGE_MAX_FILE_SIZE) || 50 * 1024 * 1024;

@Controller()
export class RecordingSessionController {
  constructor(
    private readonly recordingSessionService: RecordingSessionService,
  ) {}

  // REC-002 (UC-111): bắt đầu ghi hình video từ IP camera.
  @Post('live-meetings/:meetingId/recording/start-video')
  @HttpCode(201)
  @UseGuards(JwtAuthGuard, PermissionsGuard)
  @RequirePermissions('recording.video.start')
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
  @UseGuards(JwtAuthGuard, PermissionsGuard)
  @RequirePermissions('recording.video.stop')
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

  // Ad-hoc (ngoài REC-002/003/004 gốc): upload audio đã ghi sẵn (.wav/.mp3/.m4a/...)
  // để feed pipeline transcription (TRANS-OFFLINE-001) khi không có camera/capture
  // agent thật. Dùng guard thật (không Mock như các route REC khác) vì endpoint này
  // tạo dữ liệu được transcription.create đọc lại — cùng permission transcript.create.
  @Post('meetings/:meetingId/recording-sessions/audio-upload')
  @HttpCode(201)
  @UseGuards(JwtAuthGuard, PermissionsGuard)
  @RequirePermissions('transcript.create')
  @UseInterceptors(
    FileInterceptor('file', { limits: { fileSize: AUDIO_UPLOAD_MAX_BYTES } }),
  )
  async uploadAudio(
    @Req() req: any,
    @Param('meetingId', ParseUUIDPipe) meetingId: string,
    @UploadedFile() file: any,
  ) {
    const userId = req.user?.userId || req.user?.sub || req.user?.id || null;
    const data = await this.recordingSessionService.uploadAudioForTranscription(
      meetingId,
      file,
      userId,
    );
    return {
      success: true,
      message:
        'Audio uploaded — dùng recordingSessionId để tạo transcription job',
      data,
    };
  }

  // Phase 1 — PLAN-transcription-completion: participant upload audio track riêng.
  @Post('meetings/:meetingId/recording-sessions/:sessionId/audio-tracks')
  @HttpCode(201)
  @UseGuards(JwtAuthGuard, PermissionsGuard)
  @RequirePermissions('recording.upload_track')
  @UseInterceptors(
    FileInterceptor('file', { limits: { fileSize: AUDIO_UPLOAD_MAX_BYTES } }),
  )
  async uploadAudioTrack(
    @Req() req: any,
    @Param('meetingId', ParseUUIDPipe) meetingId: string,
    @Param('sessionId', ParseUUIDPipe) sessionId: string,
    @UploadedFile() file: any,
  ) {
    const userId = req.user?.userId || req.user?.sub || req.user?.id;
    if (!userId) {
      return {
        success: false,
        message: 'Unauthorized — missing userId in token.',
      };
    }
    const data = await this.recordingSessionService.uploadAudioTrack(
      meetingId,
      sessionId,
      file,
      userId,
    );
    return {
      success: true,
      message: 'Audio track uploaded successfully.',
      data,
    };
  }

  // REC-004 (Phần A): đọc trạng thái phiên ghi (read-only).
  @Get('live-meetings/:meetingId/recording/:sessionId/status')
  @HttpCode(200)
  @UseGuards(JwtAuthGuard, PermissionsGuard)
  @RequirePermissions('recording.video.status')
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
