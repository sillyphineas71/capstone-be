import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  Post,
  Query,
  UseGuards,
  UsePipes,
  ValidationPipe,
} from '@nestjs/common';
import {
  ApiBearerAuth,
  ApiBody,
  ApiOperation,
  ApiQuery,
  ApiResponse,
  ApiTags,
} from '@nestjs/swagger';

import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard.js';
import { PermissionsGuard } from '../auth/guards/permissions.guard.js';
import { RequirePermissions } from '../auth/decorators/require-permissions.decorator.js';
import { CurrentUser } from '../auth/decorators/current-user.decorator.js';

import { TranscriptionService } from './transcription.service.js';
import { CreateTranscriptionJobDto } from './dto/create-transcription-job.dto.js';
import { QueryTranscriptDto } from './dto/query-transcript.dto.js';
import {
  TranscriptResponseDto,
  CreateJobResponseDto,
} from './dto/transcription-response.dto.js';

@ApiTags('Transcription')
@Controller('meetings/:meetingId')
export class TranscriptionController {
  constructor(private readonly transcriptionService: TranscriptionService) {}

  @Post('transcription-jobs')
  @HttpCode(HttpStatus.ACCEPTED)
  @UseGuards(JwtAuthGuard, PermissionsGuard)
  @RequirePermissions('transcript.create')
  @UsePipes(
    new ValidationPipe({
      whitelist: true,
      transform: true,
      forbidNonWhitelisted: true,
    }),
  )
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Tạo transcription job cho cuộc họp' })
  @ApiBody({ type: CreateTranscriptionJobDto })
  @ApiResponse({
    status: HttpStatus.ACCEPTED,
    description: 'Job created',
    type: CreateJobResponseDto,
  })
  @ApiResponse({ status: 400, description: 'Validation error' })
  @ApiResponse({ status: 401, description: 'Unauthorized' })
  @ApiResponse({ status: 403, description: 'Forbidden' })
  @ApiResponse({ status: 404, description: 'Not found' })
  @ApiResponse({ status: 409, description: 'Conflict' })
  async createJob(
    @Param('meetingId') meetingId: string,
    @Body() dto: CreateTranscriptionJobDto,
    @CurrentUser() user: { userId: string },
  ): Promise<{ success: boolean; data: CreateJobResponseDto }> {
    const result = await this.transcriptionService.createTranscriptionJob(
      meetingId,
      dto,
      user.userId,
    );
    return { success: true, data: result };
  }

  @Get('transcription-jobs')
  @HttpCode(HttpStatus.OK)
  @UseGuards(JwtAuthGuard, PermissionsGuard)
  @RequirePermissions('transcript.read')
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Danh sách transcription jobs của meeting' })
  @ApiResponse({
    status: HttpStatus.OK,
    description: 'Danh sách jobs (mới nhất trước)',
  })
  @ApiResponse({ status: 401, description: 'Unauthorized' })
  @ApiResponse({ status: 403, description: 'Forbidden' })
  @ApiResponse({ status: 404, description: 'Meeting not found' })
  async getTranscriptionJobs(
    @Param('meetingId') meetingId: string,
    @CurrentUser() user: { userId: string },
  ): Promise<{ success: boolean; data: any[] }> {
    const data = await this.transcriptionService.getTranscriptionJobs(
      meetingId,
      user.userId,
    );
    return { success: true, data };
  }

  @Get('transcript')
  @HttpCode(HttpStatus.OK)
  @UseGuards(JwtAuthGuard, PermissionsGuard)
  @RequirePermissions('transcript.read')
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Xem transcript cuộc họp' })
  @ApiQuery({ name: 'includeSegments', required: false, type: Boolean })
  @ApiQuery({ name: 'page', required: false, type: Number })
  @ApiQuery({ name: 'limit', required: false, type: Number })
  @ApiResponse({
    status: HttpStatus.OK,
    description: 'Transcript data',
    type: TranscriptResponseDto,
  })
  @ApiResponse({ status: 401, description: 'Unauthorized' })
  @ApiResponse({ status: 403, description: 'Forbidden' })
  @ApiResponse({ status: 404, description: 'Not found' })
  async getTranscript(
    @Param('meetingId') meetingId: string,
    @Query() query: QueryTranscriptDto,
    @CurrentUser() user: { userId: string },
  ): Promise<{ success: boolean; data: any; meta?: any }> {
    const transcript = await this.transcriptionService.getTranscript(
      meetingId,
      user.userId,
      query,
    );
    const { meta, ...data } = transcript;
    return { success: true, data, ...(meta ? { meta } : {}) };
  }
}
