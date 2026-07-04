import {
  Body,
  Controller,
  HttpCode,
  HttpStatus,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  UseGuards,
  UsePipes,
  ValidationPipe,
} from '@nestjs/common';
import {
  ApiBearerAuth,
  ApiOperation,
  ApiParam,
  ApiResponse,
  ApiTags,
} from '@nestjs/swagger';
import { JwtAuthGuard } from '../../auth/guards/jwt-auth.guard.js';
import { PermissionsGuard } from '../../auth/guards/permissions.guard.js';
import { RequirePermissions } from '../../auth/decorators/require-permissions.decorator.js';
import { CurrentUser } from '../../auth/decorators/current-user.decorator.js';
import { ManualAttendanceService } from '../services/manual-attendance.service.js';
import { ManualAttendanceResponseDto } from '../dto/manual-attendance-response.dto.js';
import { CreateManualAttendanceDto } from '../dto/create-manual-attendance.dto.js';
import { UpdateAttendanceStatusDto } from '../dto/update-attendance-status.dto.js';
import { UpdateAttendanceProfileDto } from '../dto/update-attendance-profile.dto.js';
import { InvalidateAttendanceDto } from '../dto/invalidate-attendance.dto.js';

type ManualAttendanceEnvelope = {
  success: boolean;
  message: string;
  data: ManualAttendanceResponseDto;
};

const bodyValidationPipe = new ValidationPipe({
  whitelist: true,
  transform: true,
  forbidNonWhitelisted: true,
});

/**
 * ManualAttendanceController (UC-B21) — phần GHI điểm danh thủ công.
 * Thin: nhận DTO + actor (@CurrentUser), gọi ManualAttendanceService, bọc envelope.
 * Mirror read-side AttendanceController (prefix `meetings/:meetingId/attendance`).
 * Route tĩnh `:recordId/status` khai báo TRƯỚC route động `:recordId` (tránh nuốt path).
 */
@ApiTags('Attendance')
@ApiBearerAuth()
@Controller('meetings/:meetingId/attendance')
export class ManualAttendanceController {
  constructor(
    private readonly manualAttendanceService: ManualAttendanceService,
  ) {}

  // #1 — POST /api/v1/meetings/{meetingId}/attendance
  @Post()
  @HttpCode(HttpStatus.CREATED)
  @UseGuards(JwtAuthGuard, PermissionsGuard)
  @RequirePermissions('attendance.manual.create')
  @UsePipes(bodyValidationPipe)
  @ApiOperation({ summary: 'Create manual attendance record (UC-B21)' })
  @ApiParam({ name: 'meetingId', type: 'string', format: 'uuid' })
  @ApiResponse({
    status: 201,
    description: 'Manual attendance created',
    type: ManualAttendanceResponseDto,
  })
  @ApiResponse({ status: 403, description: 'PERMISSION_DENIED' })
  @ApiResponse({ status: 404, description: 'MEETING_NOT_FOUND' })
  @ApiResponse({
    status: 409,
    description: 'ATTENDANCE_RECORD_EXISTS / ATTENDANCE_NOT_OPEN_YET',
  })
  @ApiResponse({ status: 422, description: 'USER_NOT_PARTICIPANT' })
  async create(
    @Param('meetingId', ParseUUIDPipe) meetingId: string,
    @Body() dto: CreateManualAttendanceDto,
    @CurrentUser() actor: { userId: string },
  ): Promise<ManualAttendanceEnvelope> {
    const data = await this.manualAttendanceService.createManual(
      meetingId,
      dto,
      actor.userId,
    );
    return {
      success: true,
      message: 'Manual attendance record created successfully',
      data,
    };
  }

  // #2 — PATCH /api/v1/meetings/{meetingId}/attendance/{recordId}/status (TĨNH — trước :recordId)
  @Patch(':recordId/status')
  @HttpCode(HttpStatus.OK)
  @UseGuards(JwtAuthGuard, PermissionsGuard)
  @RequirePermissions('attendance.manual.update')
  @UsePipes(bodyValidationPipe)
  @ApiOperation({ summary: 'Update attendance status (UC-B21)' })
  @ApiParam({ name: 'meetingId', type: 'string', format: 'uuid' })
  @ApiParam({ name: 'recordId', type: 'string', format: 'uuid' })
  @ApiResponse({
    status: 200,
    description: 'Attendance status updated',
    type: ManualAttendanceResponseDto,
  })
  @ApiResponse({ status: 400, description: 'INVALID_STATUS' })
  @ApiResponse({ status: 404, description: 'ATTENDANCE_RECORD_NOT_FOUND' })
  async updateStatus(
    @Param('meetingId', ParseUUIDPipe) meetingId: string,
    @Param('recordId', ParseUUIDPipe) recordId: string,
    @Body() dto: UpdateAttendanceStatusDto,
    @CurrentUser() actor: { userId: string },
  ): Promise<ManualAttendanceEnvelope> {
    const data = await this.manualAttendanceService.updateStatus(
      meetingId,
      recordId,
      dto,
      actor.userId,
    );
    return {
      success: true,
      message: 'Attendance status updated successfully',
      data,
    };
  }

  // #3 — PATCH /api/v1/meetings/{meetingId}/attendance/{recordId} (ĐỘNG — sau :recordId/status)
  @Patch(':recordId')
  @HttpCode(HttpStatus.OK)
  @UseGuards(JwtAuthGuard, PermissionsGuard)
  @RequirePermissions('attendance.manual.update')
  @UsePipes(bodyValidationPipe)
  @ApiOperation({
    summary: 'Update attendance profile (check-in/out/note) (UC-B21)',
  })
  @ApiParam({ name: 'meetingId', type: 'string', format: 'uuid' })
  @ApiParam({ name: 'recordId', type: 'string', format: 'uuid' })
  @ApiResponse({
    status: 200,
    description: 'Attendance record updated',
    type: ManualAttendanceResponseDto,
  })
  @ApiResponse({ status: 404, description: 'ATTENDANCE_RECORD_NOT_FOUND' })
  @ApiResponse({ status: 422, description: 'INVALID_TIME_RANGE' })
  async updateProfile(
    @Param('meetingId', ParseUUIDPipe) meetingId: string,
    @Param('recordId', ParseUUIDPipe) recordId: string,
    @Body() dto: UpdateAttendanceProfileDto,
    @CurrentUser() actor: { userId: string },
  ): Promise<ManualAttendanceEnvelope> {
    const data = await this.manualAttendanceService.updateProfile(
      meetingId,
      recordId,
      dto,
      actor.userId,
    );
    return {
      success: true,
      message: 'Attendance record updated successfully',
      data,
    };
  }

  // #4 — POST /api/v1/meetings/{meetingId}/attendance/{recordId}/invalidate
  @Post(':recordId/invalidate')
  @HttpCode(HttpStatus.OK)
  @UseGuards(JwtAuthGuard, PermissionsGuard)
  @RequirePermissions('attendance.invalidate')
  @UsePipes(bodyValidationPipe)
  @ApiOperation({
    summary: 'Invalidate attendance record (System Admin) (UC-B21)',
  })
  @ApiParam({ name: 'meetingId', type: 'string', format: 'uuid' })
  @ApiParam({ name: 'recordId', type: 'string', format: 'uuid' })
  @ApiResponse({
    status: 200,
    description: 'Attendance record invalidated',
    type: ManualAttendanceResponseDto,
  })
  @ApiResponse({ status: 400, description: 'REASON_REQUIRED' })
  @ApiResponse({ status: 403, description: 'PERMISSION_DENIED' })
  @ApiResponse({ status: 404, description: 'ATTENDANCE_RECORD_NOT_FOUND' })
  @ApiResponse({
    status: 409,
    description: 'ALREADY_INVALIDATED / ATTENDANCE_NOT_OPEN_YET',
  })
  async invalidate(
    @Param('meetingId', ParseUUIDPipe) meetingId: string,
    @Param('recordId', ParseUUIDPipe) recordId: string,
    @Body() dto: InvalidateAttendanceDto,
    @CurrentUser() actor: { userId: string },
  ): Promise<ManualAttendanceEnvelope> {
    const data = await this.manualAttendanceService.invalidate(
      meetingId,
      recordId,
      dto,
      actor.userId,
    );
    return {
      success: true,
      message: 'Attendance record invalidated successfully',
      data,
    };
  }
}
