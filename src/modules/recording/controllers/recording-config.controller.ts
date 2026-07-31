import {
  Body,
  Controller,
  Post,
  Get,
  Patch,
  HttpCode,
  Req,
  UseGuards,
  UsePipes,
  ValidationPipe,
  Param,
  ParseUUIDPipe,
} from '@nestjs/common';
import { RecordingConfigService } from '../services/recording-config.service.js';
import { CreateRecordingConfigDto } from '../dto/create-recording-config.dto.js';
import { UpdateRecordingConfigDto } from '../dto/update-recording-config.dto.js';
import { JwtAuthGuard } from '../../auth/guards/jwt-auth.guard.js';
import { PermissionsGuard } from '../../auth/guards/permissions.guard.js';
import { RequirePermissions } from '../../auth/decorators/require-permissions.decorator.js';

@Controller()
export class RecordingConfigController {
  constructor(
    private readonly recordingConfigService: RecordingConfigService,
  ) {}

  // REC-001: tạo cấu hình recording cho cuộc họp (1:1).
  @Post('meetings/:meetingId/recording-config')
  @UseGuards(JwtAuthGuard, PermissionsGuard)
  @RequirePermissions('recording.config.create')
  @UsePipes(
    new ValidationPipe({
      whitelist: true,
      forbidNonWhitelisted: true,
      transform: true,
    }),
  )
  async create(
    @Req() req: any,
    @Param('meetingId', ParseUUIDPipe) meetingId: string,
    @Body() dto: CreateRecordingConfigDto,
  ) {
    const userId = req.user?.userId || req.user?.sub || req.user?.id || null;
    const data = await this.recordingConfigService.create(
      meetingId,
      dto,
      userId,
    );
    return {
      success: true,
      message: 'Recording config created successfully',
      data,
    };
  }

  // REC-001: đọc cấu hình recording.
  @Get('meetings/:meetingId/recording-config')
  @HttpCode(200)
  @UseGuards(JwtAuthGuard, PermissionsGuard)
  @RequirePermissions('recording.config.read')
  async findOne(
    @Req() req: any,
    @Param('meetingId', ParseUUIDPipe) meetingId: string,
  ) {
    const userId = req.user?.userId || req.user?.sub || req.user?.id || null;
    const data = await this.recordingConfigService.findOne(meetingId, userId);
    return {
      success: true,
      message: 'Recording config retrieved successfully',
      data,
    };
  }

  // REC-001: cập nhật một phần cấu hình recording.
  @Patch('meetings/:meetingId/recording-config')
  @HttpCode(200)
  @UseGuards(JwtAuthGuard, PermissionsGuard)
  @RequirePermissions('recording.config.update')
  @UsePipes(
    new ValidationPipe({
      whitelist: true,
      forbidNonWhitelisted: true,
      transform: true,
    }),
  )
  async update(
    @Req() req: any,
    @Param('meetingId', ParseUUIDPipe) meetingId: string,
    @Body() dto: UpdateRecordingConfigDto,
  ) {
    const userId = req.user?.userId || req.user?.sub || req.user?.id || null;
    const data = await this.recordingConfigService.update(
      meetingId,
      dto,
      userId,
    );
    return {
      success: true,
      message: 'Recording config updated successfully',
      data,
    };
  }
}
