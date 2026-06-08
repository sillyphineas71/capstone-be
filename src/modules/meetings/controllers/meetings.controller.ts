import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Ip,
  Headers,
  Post,
  Param,
  ParseUUIDPipe,
  Query,
  Req,
  UseGuards,
  UsePipes,
  ValidationPipe,
} from '@nestjs/common';
import type { Request } from 'express';

import { JwtAuthGuard } from '../../auth/guards/jwt-auth.guard.js';
import { PermissionsGuard } from '../../auth/guards/permissions.guard.js';
import { RequirePermissions } from '../../auth/decorators/require-permissions.decorator.js';

import { MeetingsService } from '../services/meetings.service.js';
import { MeetingRequestReviewService } from '../services/meeting-request-review.service.js';
import { CreateMeetingDto } from '../dto/create-meeting.dto.js';
import { CreateMeetingResponseDto } from '../dto/create-meeting-response.dto.js';
import { ApproveMeetingRequestDto } from '../dto/approve-meeting-request.dto.js';
import { RejectMeetingRequestDto } from '../dto/reject-meeting-request.dto.js';
import { ApproveResponseDto } from '../dto/approve-response.dto.js';
import { RejectResponseDto } from '../dto/reject-response.dto.js';

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
}
