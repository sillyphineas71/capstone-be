import {
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Post,
  Body,
  Query,
  Req,
  UseGuards,
  UsePipes,
  ValidationPipe,
} from '@nestjs/common';
import type { Request } from 'express';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard.js';
import { PermissionsGuard } from '../auth/guards/permissions.guard.js';
import { RequirePermissions } from '../auth/decorators/require-permissions.decorator.js';
import { SchedulingService } from './services/scheduling.service.js';
import { ParticipantConflictService } from './services/participant-conflict.service.js';
import { RoomSuggestionQueryDto } from './dto/room-suggestion-query.dto.js';
import { RoomSuggestionItemDto } from './dto/room-suggestion-item.dto.js';
import { CheckParticipantConflictDto } from './dto/check-participant-conflict.dto.js';
import { ParticipantConflictResponseDto } from './dto/participant-conflict-response.dto.js';

@Controller()
export class SchedulingController {
  constructor(
    private readonly schedulingService: SchedulingService,
    private readonly participantConflictService: ParticipantConflictService,
  ) {}

  /**
   * UC-SM-01 / UC-50: Xem danh sách phòng họp đề xuất.
   * GET /api/v1/scheduling/room-suggestions
   */
  @Get('scheduling/room-suggestions')
  @HttpCode(HttpStatus.OK)
  @UseGuards(JwtAuthGuard, PermissionsGuard)
  @RequirePermissions('scheduling.suggest.rooms')
  @UsePipes(
    new ValidationPipe({
      whitelist: true,
      transform: true,
      forbidNonWhitelisted: true,
    }),
  )
  async getRoomSuggestions(
    @Query() dto: RoomSuggestionQueryDto,
    @Req() request: Request,
  ): Promise<{
    success: boolean;
    message: string;
    data: RoomSuggestionItemDto[];
    meta: { resultLimit: number; totalRoomsFound: number };
  }> {
    // Auth userId từ JWT — chỉ dùng để xác thực, không dùng trong business logic
    const _user = request['user'] as { userId: string } | undefined;

    const result = await this.schedulingService.getRoomSuggestions(dto);

    // Empty result handling (FR-020, AC-014) — HTTP 200 với data rỗng
    const message =
      result.data.length === 0
        ? 'Không tìm thấy phòng họp nào đáp ứng đủ các tiêu chí của bạn trong khung giờ này.'
        : 'Danh sách phòng họp đề xuất';

    return {
      success: true,
      message,
      data: result.data,
      meta: {
        resultLimit: 20,
        totalRoomsFound: result.totalRoomsFound,
      },
    };
  }

  /**
   * UC-SM-04 / UC-53: Kiểm tra xung đột lịch người tham gia.
   * POST /api/v1/scheduling/participant-conflicts/check
   *
   * Soft warning — participant busy không phải error, không trả 409/422.
   * Kết quả chỉ gồm free/busy/unknown, busyFrom/busyTo, không chi tiết meeting.
   */
  @Post('scheduling/participant-conflicts/check')
  @HttpCode(HttpStatus.OK)
  @UseGuards(JwtAuthGuard, PermissionsGuard)
  @RequirePermissions('scheduling.conflict.participant.check')
  @UsePipes(
    new ValidationPipe({
      whitelist: true,
      transform: true,
      forbidNonWhitelisted: true,
    }),
  )
  async checkParticipantConflicts(
    @Body() dto: CheckParticipantConflictDto,
    @Req() request: Request,
  ): Promise<{
    success: boolean;
    message: string;
    data: ParticipantConflictResponseDto;
  }> {
    // Lấy userId từ JWT để IDOR check trên excludeMeetingId
    const user = request['user'] as { userId: string } | undefined;
    const requestingUserId = user?.userId;

    const result = await this.participantConflictService.checkConflicts(
      dto,
      requestingUserId,
    );

    return {
      success: true,
      message: 'Kiểm tra xung đột lịch hoàn tất',
      data: result,
    };
  }
}
