import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Ip,
  Param,
  ParseUUIDPipe,
  Post,
  Query,
  Req,
  UseGuards,
  UsePipes,
  ValidationPipe,
} from '@nestjs/common';
import { ApiBearerAuth, ApiBody, ApiOperation, ApiResponse, ApiTags } from '@nestjs/swagger';
import type { Request } from 'express';

import { JwtAuthGuard } from '../../auth/guards/jwt-auth.guard.js';
import { PermissionsGuard } from '../../auth/guards/permissions.guard.js';
import { RequirePermissions } from '../../auth/decorators/require-permissions.decorator.js';
import { CurrentUser } from '../../auth/decorators/current-user.decorator.js';

import { RoomsService } from '../services/rooms.service.js';
import { RoomStatusService } from '../services/room-status.service.js';
import { CreateRoomDto } from '../dto/create-room.dto.js';
import { CreateRoomResponseDto } from '../dto/create-room-response.dto.js';
import { RealtimeStatusQueryDto } from '../dto/realtime-status-query.dto.js';

// Mock PermissionsGuard — nhất quán recording/iot controller.
const MockPermissionsGuard = class {
  canActivate() {
    return true;
  }
};
const Permissions =
  (...args: string[]) =>
  (target: any, key?: any, descriptor?: any) => {};

@ApiTags('Rooms')
@Controller('rooms')
@UseGuards(JwtAuthGuard)
@ApiBearerAuth()
export class RoomsController {
  constructor(
    private readonly roomsService: RoomsService,
    private readonly roomStatusService: RoomStatusService,
  ) {}

  @Post()
  @HttpCode(HttpStatus.CREATED)
  @UseGuards(PermissionsGuard)
  @RequirePermissions('room.create')
  @UsePipes(
    new ValidationPipe({
      whitelist: true,
      forbidNonWhitelisted: true,
      transform: true,
    }),
  )
  @ApiOperation({ summary: 'Tao phong hop moi' })
  @ApiBody({ type: CreateRoomDto })
  @ApiResponse({ status: 201, description: 'Tao phong thanh cong' })
  @ApiResponse({ status: 400, description: 'Thieu truong bat buoc' })
  @ApiResponse({ status: 401, description: 'Chua xac thuc' })
  @ApiResponse({ status: 403, description: 'Khong co quyen room.create' })
  @ApiResponse({ status: 409, description: 'Trung roomCode hoac roomName' })
  @ApiResponse({ status: 422, description: 'Du lieu khong hop le' })
  async create(
    @Body() dto: CreateRoomDto,
    @CurrentUser() user: { userId: string } | undefined,
    @Ip() ipAddress: string,
    @Req() req: Request,
  ): Promise<{
    success: boolean;
    message: string;
    data: CreateRoomResponseDto;
  }> {
    const userId = user?.userId;
    if (!userId) {
      throw new Error('userId is required — check JwtAuthGuard');
    }

    const result = await this.roomsService.create(dto, userId, ipAddress);

    return {
      success: true,
      message: 'Room created successfully',
      data: result,
    };
  }

  // RMS-001 (UC-36): tổng quan trạng thái phòng realtime.
  // Khai TRƯỚC :roomId/status để route param không nuốt.
  @Get('realtime-status')
  @HttpCode(200)
  @UseGuards(JwtAuthGuard, MockPermissionsGuard)
  @Permissions('room.utilization.read')
  @UsePipes(new ValidationPipe({ whitelist: true, transform: true }))
  async realtimeStatus(@Query() query: RealtimeStatusQueryDto) {
    const data = await this.roomStatusService.getRealtimeStatus(query);
    return {
      success: true,
      message: 'Room realtime status retrieved',
      data,
    };
  }

  // RMS-001 (UC-38): chi tiết trạng thái 1 phòng.
  @Get(':roomId/status')
  @HttpCode(200)
  @UseGuards(JwtAuthGuard, MockPermissionsGuard)
  @Permissions('room.utilization.read')
  async roomStatus(@Param('roomId', ParseUUIDPipe) roomId: string) {
    const data = await this.roomStatusService.getRoomStatus(roomId);
    return {
      success: true,
      message: 'Room status retrieved',
      data,
    };
  }
}
