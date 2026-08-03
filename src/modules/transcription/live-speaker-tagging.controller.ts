import {
  Body,
  Controller,
  HttpCode,
  HttpStatus,
  Param,
  ParseUUIDPipe,
  Post,
  UseGuards,
  UsePipes,
  ValidationPipe,
} from '@nestjs/common';
import {
  ApiBearerAuth,
  ApiBody,
  ApiOperation,
  ApiResponse,
  ApiTags,
} from '@nestjs/swagger';

import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard.js';
import { PermissionsGuard } from '../auth/guards/permissions.guard.js';
import { RequirePermissions } from '../auth/decorators/require-permissions.decorator.js';
import { CurrentUser } from '../auth/decorators/current-user.decorator.js';

import { SpeakerMappingService } from './speaker-mapping.service.js';
import { CreateLiveSpeakerTagDto } from './dto/create-live-speaker-tag.dto.js';
import { SetManualRecordingStartDto } from './dto/set-manual-recording-start.dto.js';
import { CreateOffsetSpeakerMarksDto } from './dto/create-offset-speaker-marks.dto.js';

/**
 * GA-30/32/35 (feat-speaker-tagging-live) — base `meetings/:meetingId`, cùng
 * convention với TranscriptionController. Dùng LẠI permission
 * `transcript.speaker_tag` (đã seed ở GIAI ĐOẠN 2) — KHÔNG seed permission mới,
 * vì cùng một hành động nghiệp vụ "gán danh tính người nói", chỉ khác thời điểm.
 */
@ApiTags('Transcription')
@Controller('meetings/:meetingId')
export class LiveSpeakerTaggingController {
  constructor(private readonly speakerMappingService: SpeakerMappingService) {}

  @Post('recording/start-marker')
  @HttpCode(HttpStatus.OK)
  @UseGuards(JwtAuthGuard, PermissionsGuard)
  @RequirePermissions('transcript.speaker_tag')
  @ApiBearerAuth()
  @ApiOperation({
    summary: 'Host bấm "Bắt đầu ghi âm" — server đóng dấu mốc t=0 (Host/Admin)',
  })
  @ApiResponse({ status: 200, description: 'Đã ghi mốc bắt đầu ghi âm' })
  @ApiResponse({ status: 401, description: 'Unauthorized' })
  @ApiResponse({ status: 403, description: 'Không phải Host/Admin' })
  async startMarker(
    @Param('meetingId', ParseUUIDPipe) meetingId: string,
    @CurrentUser() user: { userId: string },
  ): Promise<{ success: boolean; data: unknown }> {
    const data = await this.speakerMappingService.createStartMarker(
      meetingId,
      user.userId,
    );
    return { success: true, data };
  }

  @Post('recording/live-speaker-tag')
  @HttpCode(HttpStatus.OK)
  @UseGuards(JwtAuthGuard, PermissionsGuard)
  @RequirePermissions('transcript.speaker_tag')
  @UsePipes(
    new ValidationPipe({
      whitelist: true,
      transform: true,
      forbidNonWhitelisted: true,
    }),
  )
  @ApiBearerAuth()
  @ApiOperation({
    summary: 'Host bấm gán "người này đang nói ngay bây giờ" (Host/Admin)',
  })
  @ApiBody({ type: CreateLiveSpeakerTagDto })
  @ApiResponse({ status: 200, description: 'Đã ghi mốc gán trực tiếp' })
  @ApiResponse({ status: 400, description: 'Validation error' })
  @ApiResponse({ status: 401, description: 'Unauthorized' })
  @ApiResponse({ status: 403, description: 'Không phải Host/Admin' })
  async liveSpeakerTag(
    @Param('meetingId', ParseUUIDPipe) meetingId: string,
    @Body() dto: CreateLiveSpeakerTagDto,
    @CurrentUser() user: { userId: string },
  ): Promise<{ success: boolean; data: unknown }> {
    const data = await this.speakerMappingService.createLiveSpeakerTag(
      meetingId,
      dto,
      user.userId,
    );
    return { success: true, data };
  }

  @Post('recording/start-marker/manual')
  @HttpCode(HttpStatus.OK)
  @UseGuards(JwtAuthGuard, PermissionsGuard)
  @RequirePermissions('transcript.speaker_tag')
  @UsePipes(
    new ValidationPipe({
      whitelist: true,
      transform: true,
      forbidNonWhitelisted: true,
    }),
  )
  @ApiBearerAuth()
  @ApiOperation({
    summary:
      'Nhập tay mốc bắt đầu ghi âm khi Host quên bấm (Host/Admin, dự phòng GA-35)',
  })
  @ApiBody({ type: SetManualRecordingStartDto })
  @ApiResponse({
    status: 200,
    description: 'Đã ghi mốc bắt đầu ghi âm (nhập tay)',
  })
  @ApiResponse({
    status: 400,
    description: 'Validation error — thời điểm không hợp lệ',
  })
  @ApiResponse({ status: 401, description: 'Unauthorized' })
  @ApiResponse({ status: 403, description: 'Không phải Host/Admin' })
  @ApiResponse({ status: 404, description: 'Meeting không tồn tại' })
  async manualStartMarker(
    @Param('meetingId', ParseUUIDPipe) meetingId: string,
    @Body() dto: SetManualRecordingStartDto,
    @CurrentUser() user: { userId: string },
  ): Promise<{ success: boolean; data: unknown }> {
    const data = await this.speakerMappingService.setManualRecordingStart(
      meetingId,
      dto,
      user.userId,
    );
    return { success: true, data };
  }

  /**
   * REC-006 (feat-fixed-station-browser-recording) — nhận mốc gán tên kèm
   * offsetSeconds do FE tự tính (trạm cố định, ghi âm ngay trong trình duyệt).
   * Route đặt dưới `recording-sessions/:sessionId` (khác 3 route trên dưới
   * `recording/`) vì cần biết đúng session đã tồn tại — khác marker/live-tag
   * vốn ghi trước khi recording_sessions tồn tại.
   */
  @Post('recording-sessions/:sessionId/speaker-marks')
  @HttpCode(HttpStatus.CREATED)
  @UseGuards(JwtAuthGuard, PermissionsGuard)
  @RequirePermissions('transcript.speaker_tag')
  @UsePipes(
    new ValidationPipe({
      whitelist: true,
      transform: true,
      forbidNonWhitelisted: true,
    }),
  )
  @ApiBearerAuth()
  @ApiOperation({
    summary:
      'Gửi mốc gán tên kèm offsetSeconds cho recording session đã upload (trạm cố định, Host/Admin)',
  })
  @ApiBody({ type: CreateOffsetSpeakerMarksDto })
  @ApiResponse({ status: 201, description: 'Đã ghi các mốc gán tên' })
  @ApiResponse({ status: 400, description: 'Validation error' })
  @ApiResponse({ status: 401, description: 'Unauthorized' })
  @ApiResponse({ status: 403, description: 'Không phải Host/Admin' })
  @ApiResponse({ status: 404, description: 'Recording session không tồn tại' })
  async createOffsetSpeakerMarks(
    @Param('meetingId', ParseUUIDPipe) meetingId: string,
    @Param('sessionId', ParseUUIDPipe) sessionId: string,
    @Body() dto: CreateOffsetSpeakerMarksDto,
    @CurrentUser() user: { userId: string },
  ): Promise<{ success: boolean; data: unknown }> {
    const data = await this.speakerMappingService.createOffsetSpeakerMarks(
      meetingId,
      sessionId,
      dto,
      user.userId,
    );
    return { success: true, data };
  }
}
