import {
  Controller,
  Get,
  Param,
  Query,
  HttpCode,
  UseGuards,
  UsePipes,
  ValidationPipe,
  ParseUUIDPipe,
} from '@nestjs/common';
import { RoomStatusService } from '../services/room-status.service.js';
import { RealtimeStatusQueryDto } from '../dto/realtime-status-query.dto.js';
import { JwtAuthGuard } from '../../auth/guards/jwt-auth.guard.js';

// Mock PermissionsGuard — nhất quán recording/iot controller.
const MockPermissionsGuard = class {
  canActivate() {
    return true;
  }
};
const Permissions =
  (...args: string[]) =>
  (target: any, key?: any, descriptor?: any) => {};

@Controller()
export class RoomsController {
  constructor(private readonly roomStatusService: RoomStatusService) {}

  // RMS-001 (UC-36): tổng quan trạng thái phòng realtime.
  // Khai TRƯỚC :roomId/status để route param không nuốt.
  @Get('rooms/realtime-status')
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
  @Get('rooms/:roomId/status')
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
