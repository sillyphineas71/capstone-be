import {
  Controller,
  Get,
  Param,
  ParseUUIDPipe,
  Query,
  UseGuards,
  UsePipes,
  ValidationPipe,
} from '@nestjs/common';
import {
  ApiBearerAuth,
  ApiOperation,
  ApiParam,
  ApiQuery,
  ApiResponse,
  ApiTags,
} from '@nestjs/swagger';
import { JwtAuthGuard } from '../../auth/guards/jwt-auth.guard.js';
import { PermissionsGuard } from '../../auth/guards/permissions.guard.js';
import { RequirePermissions } from '../../auth/decorators/require-permissions.decorator.js';
import { CurrentUser } from '../../auth/decorators/current-user.decorator.js';
import { AttendanceService } from '../services/attendance.service.js';
import { QueryAttendanceDto } from '../dto/query-attendance.dto.js';
import { AttendanceListResponseDto } from '../dto/attendance-list-response.dto.js';
import { AttendanceItemDto } from '../dto/attendance-item.dto.js';
import { AttendanceRecordDetailResponseDto } from '../dto/attendance-record-detail-response.dto.js';

@ApiTags('Attendance')
@ApiBearerAuth()
@Controller('meetings/:meetingId/attendance')
@UseGuards(JwtAuthGuard)
export class AttendanceController {
  constructor(private readonly attendanceService: AttendanceService) {}

  @Get()
  @UseGuards(PermissionsGuard)
  @RequirePermissions('attendance.read')
  @UsePipes(
    new ValidationPipe({
      whitelist: true,
      transform: true,
      forbidNonWhitelisted: true,
    }),
  )
  @ApiOperation({ summary: 'Get meeting attendance list (UC-APM-02)' })
  @ApiParam({ name: 'meetingId', type: 'string', format: 'uuid' })
  @ApiQuery({
    name: 'status',
    required: false,
    enum: ['all', 'present', 'late', 'absent', 'not_checked_in', 'left_early'],
  })
  @ApiQuery({ name: 'search', required: false, type: 'string' })
  @ApiQuery({ name: 'page', required: false, type: 'number' })
  @ApiQuery({ name: 'pageSize', required: false, type: 'number' })
  @ApiResponse({
    status: 200,
    description: 'Attendance list retrieved successfully',
    type: AttendanceListResponseDto,
  })
  @ApiResponse({ status: 400, description: 'VALIDATION_ERROR' })
  @ApiResponse({ status: 401, description: 'Unauthorized' })
  @ApiResponse({ status: 403, description: 'PERMISSION_DENIED' })
  @ApiResponse({ status: 404, description: 'MEETING_NOT_FOUND' })
  @ApiResponse({ status: 409, description: 'ATTENDANCE_NOT_OPEN_YET' })
  @ApiResponse({ status: 500, description: 'INTERNAL_ERROR' })
  async getAttendanceList(
    @Param('meetingId', ParseUUIDPipe) meetingId: string,
    @Query() query: QueryAttendanceDto,
    @CurrentUser() currentUser: { userId: string },
  ): Promise<{ success: boolean; message: string; data: any; meta?: any }> {
    const result = await this.attendanceService.getAttendanceList(
      meetingId,
      currentUser.userId,
      query,
    );
    return result;
  }

  // UC-82 — GET detail. Route ĐỘNG `:recordId` khai SAU `@Get()` list (tránh nuốt path).
  @Get(':recordId')
  @UseGuards(PermissionsGuard)
  @RequirePermissions('attendance.read')
  @ApiOperation({ summary: 'Get attendance record detail (UC-82)' })
  @ApiParam({ name: 'meetingId', type: 'string', format: 'uuid' })
  @ApiParam({ name: 'recordId', type: 'string', format: 'uuid' })
  @ApiResponse({
    status: 200,
    description: 'Attendance record detail retrieved successfully',
    type: AttendanceRecordDetailResponseDto,
  })
  @ApiResponse({ status: 400, description: 'VALIDATION_ERROR' })
  @ApiResponse({ status: 401, description: 'Unauthorized' })
  @ApiResponse({ status: 403, description: 'PERMISSION_DENIED' })
  @ApiResponse({ status: 404, description: 'ATTENDANCE_RECORD_NOT_FOUND' })
  async getAttendanceRecordDetail(
    @Param('meetingId', ParseUUIDPipe) meetingId: string,
    @Param('recordId', ParseUUIDPipe) recordId: string,
  ): Promise<{
    success: boolean;
    message: string;
    data: AttendanceRecordDetailResponseDto;
  }> {
    const data = await this.attendanceService.getAttendanceRecordDetail(
      meetingId,
      recordId,
    );
    return {
      success: true,
      message: 'Attendance record detail retrieved successfully',
      data,
    };
  }
}
