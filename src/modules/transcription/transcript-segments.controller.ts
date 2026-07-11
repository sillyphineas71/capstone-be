import {
  Body,
  Controller,
  HttpCode,
  HttpStatus,
  Param,
  ParseUUIDPipe,
  Patch,
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

import { TranscriptionService } from './transcription.service.js';
import { UpdateTranscriptSegmentsDto } from './dto/update-transcript-segments.dto.js';
import { UpdateTranscriptContentDto } from './dto/update-transcript-content.dto.js';
import { UpdateTranscriptStatusDto } from './dto/update-transcript-status.dto.js';

/**
 * UC-127 — PATCH /api/v1/transcripts/:transcriptId/segments (T-EDIT-001).
 *
 * Base path là `transcripts` (KHÁC `meetings/:meetingId` của
 * TranscriptionController) — đúng contract. Permission node `transcript.update`
 * (đã seed T-PERM-001) là gate thô; business rule Host/Admin siết trong service.
 */
@ApiTags('Transcription')
@Controller('transcripts')
export class TranscriptSegmentsController {
  constructor(private readonly transcriptionService: TranscriptionService) {}

  @Patch(':transcriptId/segments')
  @HttpCode(HttpStatus.OK)
  @UseGuards(JwtAuthGuard, PermissionsGuard)
  @RequirePermissions('transcript.update')
  @UsePipes(
    new ValidationPipe({
      whitelist: true,
      transform: true,
      forbidNonWhitelisted: true,
    }),
  )
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Sửa tay segment transcript (Host/Admin)' })
  @ApiBody({ type: UpdateTranscriptSegmentsDto })
  @ApiResponse({ status: 200, description: 'Đã cập nhật segment' })
  @ApiResponse({ status: 400, description: 'Validation error' })
  @ApiResponse({ status: 401, description: 'Unauthorized' })
  @ApiResponse({ status: 403, description: 'Không phải Host/Admin' })
  @ApiResponse({
    status: 404,
    description: 'Transcript hoặc segment không tồn tại',
  })
  async updateSegments(
    @Param('transcriptId', ParseUUIDPipe) transcriptId: string,
    @Body() dto: UpdateTranscriptSegmentsDto,
    @CurrentUser() user: { userId: string },
  ): Promise<{ success: boolean; data: unknown }> {
    const data = await this.transcriptionService.updateTranscriptSegments(
      transcriptId,
      dto,
      user.userId,
    );
    return { success: true, data };
  }

  @Patch(':transcriptId/content')
  @HttpCode(HttpStatus.OK)
  @UseGuards(JwtAuthGuard, PermissionsGuard)
  @RequirePermissions('transcript.update')
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
      'Ghi đè rawText/cleanedText của transcript (Host/Admin) — dùng để test AI summarize hoặc sửa tay khi STT sai nhiều',
  })
  @ApiBody({ type: UpdateTranscriptContentDto })
  @ApiResponse({ status: 200, description: 'Đã cập nhật nội dung transcript' })
  @ApiResponse({ status: 400, description: 'Validation error' })
  @ApiResponse({ status: 401, description: 'Unauthorized' })
  @ApiResponse({ status: 403, description: 'Không phải Host/Admin' })
  @ApiResponse({ status: 404, description: 'Transcript không tồn tại' })
  async updateContent(
    @Param('transcriptId', ParseUUIDPipe) transcriptId: string,
    @Body() dto: UpdateTranscriptContentDto,
    @CurrentUser() user: { userId: string },
  ): Promise<{ success: boolean; data: unknown }> {
    const data = await this.transcriptionService.updateTranscriptContent(
      transcriptId,
      dto,
      user.userId,
    );
    return { success: true, data };
  }

  // Gap fix (Nhóm A) — chuyển trạng thái transcript draft→reviewed→approved,
  // enum đã có sẵn 2 trạng thái này nhưng chưa từng có endpoint set được.
  @Patch(':transcriptId/status')
  @HttpCode(HttpStatus.OK)
  @UseGuards(JwtAuthGuard, PermissionsGuard)
  @RequirePermissions('transcript.update')
  @UsePipes(
    new ValidationPipe({
      whitelist: true,
      transform: true,
      forbidNonWhitelisted: true,
    }),
  )
  @ApiBearerAuth()
  @ApiOperation({
    summary: 'Chuyển trạng thái transcript sang reviewed/approved (Host/Admin)',
  })
  @ApiBody({ type: UpdateTranscriptStatusDto })
  @ApiResponse({ status: 200, description: 'Đã cập nhật trạng thái' })
  @ApiResponse({ status: 400, description: 'Validation error' })
  @ApiResponse({ status: 401, description: 'Unauthorized' })
  @ApiResponse({ status: 403, description: 'Không phải Host/Admin' })
  @ApiResponse({ status: 404, description: 'Transcript không tồn tại' })
  @ApiResponse({
    status: 409,
    description: 'Chuyển trạng thái không hợp lệ (ví dụ đã approved)',
  })
  async updateStatus(
    @Param('transcriptId', ParseUUIDPipe) transcriptId: string,
    @Body() dto: UpdateTranscriptStatusDto,
    @CurrentUser() user: { userId: string },
  ): Promise<{ success: boolean; data: unknown }> {
    const data = await this.transcriptionService.updateTranscriptStatus(
      transcriptId,
      dto,
      user.userId,
    );
    return { success: true, data };
  }
}
