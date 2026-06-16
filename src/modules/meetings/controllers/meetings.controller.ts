import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Ip,
  Headers,
  Patch,
  Post,
  Param,
  ParseUUIDPipe,
  Query,
  Req,
  UseGuards,
  UsePipes,
  ValidationPipe,
  Delete,
  Put,
} from '@nestjs/common';
import {
  ApiBearerAuth,
  ApiBody,
  ApiOperation,
  ApiParam,
  ApiResponse,
  ApiTags,
} from '@nestjs/swagger';
import type { Request } from 'express';

import { JwtAuthGuard } from '../../auth/guards/jwt-auth.guard.js';
import { PermissionsGuard } from '../../auth/guards/permissions.guard.js';
import { RequirePermissions } from '../../auth/decorators/require-permissions.decorator.js';
import { CurrentUser } from '../../auth/decorators/current-user.decorator.js';

import { MeetingsService } from '../services/meetings.service.js';
import type { UpdateMeetingTimeResponse } from '../services/meetings.service.js';
import { MeetingRequestReviewService } from '../services/meeting-request-review.service.js';
import { CancelMeetingDto } from '../dto/cancel-meeting.dto.js';
import { CancelMeetingResponseDto } from '../dto/cancel-meeting-response.dto.js';
import { CreateMeetingDto } from '../dto/create-meeting.dto.js';
import { CreateMeetingResponseDto } from '../dto/create-meeting-response.dto.js';
import { UpdateMeetingTimeDto } from '../dto/update-meeting-time.dto.js';
import { UpdateMeetingRoomDto } from '../dto/update-meeting-room.dto.js';
import type { UpdateMeetingRoomResponseDto } from '../dto/update-meeting-room-response.dto.js';
import type { AvailableRoomDto } from '../dto/available-room.dto.js';
import { AddInternalParticipantDto } from '../dto/add-internal-participant.dto.js';
import type { IAddInternalParticipantResponse } from '../dto/add-internal-participant-response.dto.js';
import { ApproveMeetingRequestDto } from '../dto/approve-meeting-request.dto.js';
import { RejectMeetingRequestDto } from '../dto/reject-meeting-request.dto.js';
import { ApproveResponseDto } from '../dto/approve-response.dto.js';
import { RejectResponseDto } from '../dto/reject-response.dto.js';
import { MyScheduleQueryDto } from '../dto/my-schedule-query.dto.js';
import { ScheduleResponseDto } from '../dto/schedule-response.dto.js';
import { MyScheduleDetailDto } from '../dto/my-schedule-detail.dto.js';
import { RemoveParticipantParamsDto } from '../dto/remove-participant-params.dto.js';
import { RemoveParticipantBodyDto } from '../dto/remove-participant-body.dto.js';
import { RemoveParticipantResponseDto } from '../dto/remove-participant-response.dto.js';
import { ReplaceAgendaDto } from '../dto/replace-agenda.dto.js';
import { AgendaListResponseDto, ReplaceAgendaResponseDto } from '../dto/agenda-response.dto.js';
import { ClientContext } from '../services/meetings.service.js';


@Controller()
export class MeetingsController {
  constructor(
    private readonly meetingsService: MeetingsService,
    private readonly meetingRequestReviewService: MeetingRequestReviewService,
  ) {}

  @Post('meetings')
  @HttpCode(HttpStatus.CREATED)
  @UseGuards(JwtAuthGuard, PermissionsGuard)
  @RequirePermissions('meeting.create')
  @UsePipes(
    new ValidationPipe({
      whitelist: true,
      transform: true,
      forbidNonWhitelisted: true,
    }),
  )
  async createMeeting(
    @Body() dto: CreateMeetingDto,
    @Req() request: Request,
    @Ip() ipAddress: string,
    @Headers('user-agent') userAgent?: string,
  ): Promise<{
    success: boolean;
    message: string;
    data: CreateMeetingResponseDto;
  }> {
    const user = request['user'] as { userId: string } | undefined;
    const authUserId = user?.userId;

    const result = await this.meetingsService.create(
      dto,
      { userId: authUserId! },
      { ipAddress, userAgent },
    );

    return {
      success: true,
      message: 'Yêu cầu tạo cuộc họp đã được gửi thành công',
      data: result,
    };
  }

  @Patch('meetings/:meetingId/time')
  @HttpCode(HttpStatus.OK)
  @UseGuards(JwtAuthGuard, PermissionsGuard)
  @RequirePermissions('meeting.time.update')
  @UsePipes(
    new ValidationPipe({
      whitelist: true,
      transform: true,
      forbidNonWhitelisted: true,
    }),
  )
  async updateMeetingTime(
    @Param('meetingId', ParseUUIDPipe) meetingId: string,
    @Body() dto: UpdateMeetingTimeDto,
    @Req() request: Request,
    @Ip() ipAddress: string,
    @Headers('user-agent') userAgent?: string,
  ): Promise<{
    success: boolean;
    message: string;
    data: UpdateMeetingTimeResponse;
    meta: { requestId: string };
  }> {
    const user = request['user'] as { userId: string } | undefined;
    const requestId = `req-${Date.now()}`;

    const result = await this.meetingsService.updateMeetingTime(
      meetingId,
      dto,
      { userId: user!.userId },
      { ipAddress, userAgent },
    );

    return {
      success: true,
      message: 'Thời gian cuộc họp đã được cập nhật thành công',
      data: result,
      meta: { requestId },
    };
  }

  @Get('meetings/:meetingId/available-rooms')
  @HttpCode(HttpStatus.OK)
  @UseGuards(JwtAuthGuard)
  async getAvailableRoomsForMeeting(
    @Param('meetingId', ParseUUIDPipe) meetingId: string,
    @Query('capacityWarningMode') capacityWarningMode?: string,
    @Query('includeCurrentRoom') includeCurrentRoom?: string,
  ): Promise<{
    success: boolean;
    message: string;
    data: AvailableRoomDto[];
  }> {
    const options = {
      capacityWarningMode: capacityWarningMode === 'true',
      includeCurrentRoom: includeCurrentRoom === 'true',
    };

    const rooms = await this.meetingsService.getAvailableRoomsForMeeting(
      meetingId,
      options,
    );

    return {
      success: true,
      message: 'Danh sách phòng khả dụng',
      data: rooms,
    };
  }

  @Post('meetings/:meetingId/participants/internal')
  @HttpCode(HttpStatus.OK)
  @UseGuards(JwtAuthGuard, PermissionsGuard)
  @RequirePermissions('meeting.participant.add.internal')
  @UsePipes(
    new ValidationPipe({
      whitelist: true,
      transform: true,
      forbidNonWhitelisted: true,
    }),
  )
  async addInternalParticipant(
    @Param('meetingId', ParseUUIDPipe) meetingId: string,
    @Body() dto: AddInternalParticipantDto,
    @Req() request: Request,
    @Ip() ipAddress: string,
    @Headers('user-agent') userAgent?: string,
  ): Promise<{
    success: boolean;
    message: string;
    data: IAddInternalParticipantResponse;
  }> {
    const user = request['user'] as { userId: string } | undefined;

    const result = await this.meetingsService.addInternalParticipant(
      meetingId,
      dto,
      { userId: user!.userId },
      { ipAddress, userAgent },
    );

    return {
      success: true,
      message: 'Thành viên nội bộ đã được thêm vào cuộc họp thành công',
      data: result,
    };
  }

  @Patch('meetings/:meetingId/room')
  @HttpCode(HttpStatus.OK)
  @UseGuards(JwtAuthGuard, PermissionsGuard)
  @RequirePermissions('meeting.room.update')
  @UsePipes(
    new ValidationPipe({
      whitelist: true,
      transform: true,
      forbidNonWhitelisted: true,
    }),
  )
  async updateMeetingRoom(
    @Param('meetingId', ParseUUIDPipe) meetingId: string,
    @Body() dto: UpdateMeetingRoomDto,
    @Req() request: Request,
    @Ip() ipAddress: string,
    @Headers('user-agent') userAgent?: string,
  ): Promise<{
    success: boolean;
    message: string;
    data: UpdateMeetingRoomResponseDto;
  }> {
    const user = request['user'] as { userId: string } | undefined;

    const result = await this.meetingsService.updateMeetingRoom(
      meetingId,
      dto,
      { userId: user!.userId },
      { ipAddress, userAgent },
    );

    return {
      success: true,
      message: 'Phòng họp đã được cập nhật thành công',
      data: result,
    };
  }

  @Post('meetings/:meetingId/cancel')
  @HttpCode(HttpStatus.OK)
  @UseGuards(JwtAuthGuard, PermissionsGuard)
  @RequirePermissions('meeting.cancel.own')
  @UsePipes(
    new ValidationPipe({
      whitelist: true,
      transform: true,
      forbidNonWhitelisted: true,
    }),
  )
  @ApiTags('Meetings')
  @ApiBearerAuth()
  @ApiOperation({
    summary: 'Hủy cuộc họp đã lên lịch',
    description:
      'Cho phép Meeting Organizer, Meeting Host hoặc System Admin hủy cuộc họp đang ở trạng thái scheduled và chưa bắt đầu. Khi hủy, phòng họp được giải phóng, events + audit logs được ghi, và notification được queue gửi đến participants.',
  })
  @ApiParam({
    name: 'meetingId',
    type: 'string',
    format: 'uuid',
    description: 'ID của cuộc họp cần hủy',
  })
  @ApiBody({ type: CancelMeetingDto, required: false })
  @ApiResponse({
    status: 200,
    description: 'Cuộc họp đã được hủy thành công',
    type: CancelMeetingResponseDto,
  })
  @ApiResponse({ status: 400, description: 'Validation error' })
  @ApiResponse({ status: 401, description: 'Unauthorized' })
  @ApiResponse({ status: 403, description: 'Forbidden' })
  @ApiResponse({ status: 404, description: 'Meeting not found' })
  @ApiResponse({ status: 409, description: 'Conflict' })
  async cancelMeeting(
    @Param('meetingId', ParseUUIDPipe) meetingId: string,
    @Body() dto: CancelMeetingDto,
    @Req() request: Request,
    @Ip() ipAddress: string,
    @Headers('user-agent') userAgent?: string,
  ): Promise<{
    success: boolean;
    message: string;
    data: CancelMeetingResponseDto;
  }> {
    const user = request['user'] as { userId: string } | undefined;

    const result = await this.meetingsService.cancelMeeting(
      meetingId,
      { userId: user!.userId },
      { ipAddress, userAgent },
      dto.cancellationReason,
    );

    return {
      success: true,
      message: 'Cuộc họp đã được hủy thành công',
      data: result,
    };
  }

  @Get('rooms/available')
  @HttpCode(HttpStatus.OK)
  @UseGuards(JwtAuthGuard)
  async getAvailableRooms(
    @Query('startTime') startTime: string,
    @Query('endTime') endTime: string,
    @Query('minCapacity') minCapacity?: string,
  ): Promise<{ success: boolean; message: string; data: object[] }> {
    if (!startTime || !endTime) {
      return {
        success: false,
        message: 'startTime và endTime là bắt buộc',
        data: [],
      };
    }

    const start = new Date(startTime);
    const end = new Date(endTime);

    if (Number.isNaN(start.getTime()) || Number.isNaN(end.getTime())) {
      return {
        success: false,
        message: 'startTime hoặc endTime không đúng định dạng',
        data: [],
      };
    }

    if (end <= start) {
      return {
        success: false,
        message: 'endTime phải sau startTime',
        data: [],
      };
    }

    const capacity = minCapacity ? Number(minCapacity) : undefined;
    const rooms = await this.meetingsService.getAvailableRooms(
      start,
      end,
      capacity,
    );

    return {
      success: true,
      message: 'Danh sách phòng khả dụng',
      data: rooms.map((room) => ({
        id: room.id,
        roomCode: room.roomCode,
        roomName: room.roomName,
        capacity: room.capacity,
        roomType: room.roomType,
        siteName: room.siteName,
        areaName: room.areaName,
        locationDescription: room.locationDescription,
        hasCamera: room.hasCamera,
        hasMicrophone: room.hasMicrophone,
        hasDisplay: room.hasDisplay,
        allowRecording: room.allowRecording,
      })),
    };
  }

  @Post('meeting-requests/:requestId/approve')
  @HttpCode(HttpStatus.OK)
  @UseGuards(JwtAuthGuard, PermissionsGuard)
  @RequirePermissions('meeting_request.approve')
  @UsePipes(
    new ValidationPipe({
      whitelist: true,
      transform: true,
      forbidNonWhitelisted: true,
    }),
  )
  async approveMeetingRequest(
    @Param('requestId', ParseUUIDPipe) requestId: string,
    @Body() dto: ApproveMeetingRequestDto,
    @Req() request: Request,
    @Ip() ipAddress: string,
    @Headers('user-agent') userAgent?: string,
  ): Promise<{ success: boolean; message: string; data: ApproveResponseDto }> {
    const user = request['user'] as { userId: string } | undefined;

    const result = await this.meetingRequestReviewService.approve(
      requestId,
      dto,
      { userId: user!.userId },
      { ipAddress, userAgent },
    );

    return {
      success: true,
      message: 'Yêu cầu cuộc họp đã được phê duyệt thành công',
      data: result,
    };
  }

  @Post('meeting-requests/:requestId/reject')
  @HttpCode(HttpStatus.OK)
  @UseGuards(JwtAuthGuard, PermissionsGuard)
  @RequirePermissions('meeting_request.reject')
  @UsePipes(
    new ValidationPipe({
      whitelist: true,
      transform: true,
      forbidNonWhitelisted: true,
    }),
  )
  async rejectMeetingRequest(
    @Param('requestId', ParseUUIDPipe) requestId: string,
    @Body() dto: RejectMeetingRequestDto,
    @Req() request: Request,
    @Ip() ipAddress: string,
    @Headers('user-agent') userAgent?: string,
  ): Promise<{ success: boolean; message: string; data: RejectResponseDto }> {
    const user = request['user'] as { userId: string } | undefined;

    const result = await this.meetingRequestReviewService.reject(
      requestId,
      dto,
      { userId: user!.userId },
      { ipAddress, userAgent },
    );

    return {
      success: true,
      message: 'Yêu cầu cuộc họp đã bị từ chối',
      data: result,
    };
  }
  @Get('me/schedule')
  @HttpCode(HttpStatus.OK)
  @UseGuards(JwtAuthGuard, PermissionsGuard)
  @RequirePermissions('schedule.read.self')
  @UsePipes(
    new ValidationPipe({
      whitelist: true,
      transform: true,
      forbidNonWhitelisted: true,
    }),
  )
  async getMySchedule(
    @CurrentUser() user: { userId: string },
    @Query() dto: MyScheduleQueryDto,
  ): Promise<{ success: boolean; message: string; data: ScheduleResponseDto }> {
    const result = await this.meetingsService.getMySchedule(user.userId, dto);

    return {
      success: true,
      message: 'Lay lich thanh cong',
      data: result,
    };
  }

  @Get('me/schedule/:meetingId')
  @HttpCode(HttpStatus.OK)
  @UseGuards(JwtAuthGuard, PermissionsGuard)
  @RequirePermissions('schedule.read.self')
  @UsePipes(
    new ValidationPipe({
      whitelist: true,
      transform: true,
    }),
  )
  async getMyScheduleDetail(
    @CurrentUser() user: { userId: string },
    @Param('meetingId', ParseUUIDPipe) meetingId: string,
  ): Promise<{ success: boolean; message: string; data: MyScheduleDetailDto }> {
    const result = await this.meetingsService.getMyScheduleDetail(
      user.userId,
      meetingId,
    );

    return {
      success: true,
      message: 'Chi tiet cuoc hop',
      data: result,
    };
  }

  @Delete(':meetingId/participants/:participantUserId')
  @HttpCode(HttpStatus.OK)
  @UseGuards(JwtAuthGuard)
  @UsePipes(
    new ValidationPipe({
      whitelist: true,
      transform: true,
      forbidNonWhitelisted: true,
    }),
  )
  async removeParticipant(
    @Param() params: RemoveParticipantParamsDto,
    @Body() body: RemoveParticipantBodyDto,
    @Req() request: Request,
    @Ip() ipAddress: string,
    @Headers('user-agent') userAgent?: string,
  ): Promise<{
    success: boolean;
    message: string;
    data: RemoveParticipantResponseDto;
  }> {
    const user = request['user'] as { userId: string } | undefined;

    const result = await this.meetingsService.removeParticipant(
      params.meetingId,
      params.participantUserId,
      { userId: user!.userId },
      { ipAddress, userAgent },
      body,
    );

    return {
      success: true,
      message: 'Đã gỡ bỏ thành viên khỏi cuộc họp thành công',
      data: result,
    };
  }

  // ────────────────────────────────────────────────────────────
  // Agenda endpoints (UC-MM-09)
  // ────────────────────────────────────────────────────────────

  @Get(':meetingId/agendas')
  @UseGuards(JwtAuthGuard)
  @ApiOperation({ summary: 'Xem danh sách agenda của cuộc họp' })
  @ApiParam({ name: 'meetingId', type: 'string', format: 'uuid' })
  @ApiResponse({ status: 200, description: 'Danh sách agenda', type: AgendaListResponseDto })
  @ApiResponse({ status: 403, description: 'AGENDA_READ_FORBIDDEN' })
  @ApiResponse({ status: 404, description: 'MEETING_NOT_FOUND' })
  async getAgendas(
    @Param('meetingId', new ParseUUIDPipe({ version: '4' })) meetingId: string,
    @CurrentUser() currentUser: { userId: string },
  ): Promise<{ success: boolean; message: string; data: AgendaListResponseDto }> {
    const result = await this.meetingsService.getAgendas(
      meetingId,
      currentUser.userId,
    );
    return {
      success: true,
      message: 'Lấy danh sách agenda thành công',
      data: result,
    };
  }

  @Put(':meetingId/agendas')
  @UseGuards(JwtAuthGuard)
  @ApiOperation({ summary: 'Lưu toàn bộ chương trình họp (atomic replace)' })
  @ApiParam({ name: 'meetingId', type: 'string', format: 'uuid' })
  @ApiBody({ type: ReplaceAgendaDto })
  @ApiResponse({ status: 200, description: 'Lưu agenda thành công', type: ReplaceAgendaResponseDto })
  @ApiResponse({ status: 400, description: 'AGENDA_ITEMS_REQUIRED / AGENDA_INVALID_PAYLOAD' })
  @ApiResponse({ status: 403, description: 'AGENDA_WRITE_FORBIDDEN' })
  @ApiResponse({ status: 404, description: 'MEETING_NOT_FOUND' })
  @ApiResponse({ status: 409, description: 'AGENDA_MEETING_STATUS_BLOCKED / MEETING_TIME_INVALID_FOR_AGENDA' })
  @ApiResponse({ status: 422, description: 'Validation errors' })
  @UsePipes(
    new ValidationPipe({
      whitelist: true,
      transform: true,
      forbidNonWhitelisted: true,
    }),
  )
  async replaceAgendas(
    @Param('meetingId', new ParseUUIDPipe({ version: '4' })) meetingId: string,
    @Body() dto: ReplaceAgendaDto,
    @CurrentUser() currentUser: { userId: string },
    @Ip() ipAddress: string,
    @Headers('user-agent') userAgent: string,
  ): Promise<{ success: boolean; message: string; data: ReplaceAgendaResponseDto }> {
    const clientContext: ClientContext = {
      ipAddress,
      userAgent: userAgent || undefined,
    };
    const result = await this.meetingsService.replaceAgendas(
      meetingId,
      dto,
      currentUser.userId,
      clientContext,
    );
    return {
      success: true,
      message: 'Lưu chương trình họp thành công',
      data: result,
    };
  }


}

