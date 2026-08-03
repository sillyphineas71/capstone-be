import {
  Body,
  Controller,
  Get,
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
import { CreateSpeakerMappingsDto } from './dto/create-speaker-mappings.dto.js';
import { SpeakerClusterDto } from './dto/speaker-cluster-response.dto.js';

/**
 * GA-20/GA-23 (feat-speaker-tagging-post-meeting) — base path `transcripts`,
 * cùng convention với TranscriptSegmentsController (UC-127).
 */
@ApiTags('Transcription')
@Controller('transcripts')
export class TranscriptSpeakerMappingsController {
  constructor(private readonly speakerMappingService: SpeakerMappingService) {}

  @Get(':transcriptId/speaker-clusters')
  @HttpCode(HttpStatus.OK)
  @UseGuards(JwtAuthGuard, PermissionsGuard)
  @RequirePermissions('transcript.read')
  @ApiBearerAuth()
  @ApiOperation({
    summary: 'Danh sách cụm giọng (Speaker_N) đã phát hiện, kèm thời lượng nói',
  })
  @ApiResponse({
    status: 200,
    description: 'Danh sách cụm',
    type: [SpeakerClusterDto],
  })
  @ApiResponse({ status: 401, description: 'Unauthorized' })
  @ApiResponse({ status: 403, description: 'Không phải Host/Admin' })
  @ApiResponse({ status: 404, description: 'Transcript không tồn tại' })
  async listSpeakerClusters(
    @Param('transcriptId', ParseUUIDPipe) transcriptId: string,
    @CurrentUser() user: { userId: string },
  ): Promise<{ success: boolean; data: SpeakerClusterDto[] }> {
    const data = await this.speakerMappingService.listSpeakerClusters(
      transcriptId,
      user.userId,
    );
    return { success: true, data };
  }

  @Post(':transcriptId/speaker-mappings')
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
      'Gán tên hàng loạt cho cụm giọng (Host/Admin) — sống sót qua chạy lại transcription',
  })
  @ApiBody({ type: CreateSpeakerMappingsDto })
  @ApiResponse({ status: 200, description: 'Đã gán mapping' })
  @ApiResponse({
    status: 400,
    description: 'Validation error hoặc mâu thuẫn gán',
  })
  @ApiResponse({ status: 401, description: 'Unauthorized' })
  @ApiResponse({ status: 403, description: 'Không phải Host/Admin' })
  @ApiResponse({ status: 404, description: 'Transcript không tồn tại' })
  @ApiResponse({
    status: 409,
    description: 'Transcript đang xử lý hoặc thiếu recording session',
  })
  async createSpeakerMappings(
    @Param('transcriptId', ParseUUIDPipe) transcriptId: string,
    @Body() dto: CreateSpeakerMappingsDto,
    @CurrentUser() user: { userId: string },
  ): Promise<{ success: boolean; data: unknown }> {
    const data = await this.speakerMappingService.createSpeakerMappings(
      transcriptId,
      dto,
      user.userId,
    );
    return { success: true, data };
  }
}
