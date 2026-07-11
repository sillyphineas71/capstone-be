import {
  Controller,
  Get,
  Query,
  Param,
  UseGuards,
  ValidationPipe,
  ParseUUIDPipe,
  HttpException,
  InternalServerErrorException,
} from '@nestjs/common';
import {
  ApiBearerAuth,
  ApiOperation,
  ApiResponse,
  ApiTags,
} from '@nestjs/swagger';

import { JwtAuthGuard } from '../../auth/guards/jwt-auth.guard';
import { PermissionsGuard } from '../../auth/guards/permissions.guard';
import { RequirePermissions } from '../../auth/decorators/require-permissions.decorator';
import { CurrentUser } from '../../auth/decorators/current-user.decorator';

import { RoomUsageDashboardService } from '../services/room-usage-dashboard.service';
import { QueryRoomUsageDashboardDto } from '../dto/query-room-usage-dashboard.dto';
import { QueryRoomDetailDto } from '../dto/query-room-detail.dto';
import {
  RoomUsageDashboardResponseDto,
  RoomDetailResponseDto,
} from '../dto/room-usage-response.dto';

@ApiTags('Analytics Room')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, PermissionsGuard)
@RequirePermissions('analytics.room.read')
@Controller('analytics/rooms')
export class RoomUsageDashboardController {
  constructor(private readonly service: RoomUsageDashboardService) {}

  @Get('dashboard')
  @ApiOperation({
    summary: 'Xem dashboard su dung phong hop (UC-AA-02 / UC-149)',
    description:
      'Tra ve danh sach cac phong kem theo thong so dat phong, su dung thuc te va bieu do trend.',
  })
  @ApiResponse({
    status: 200,
    description: 'Thong ke su dung phong hop duoc truy xuat thanh cong',
    type: RoomUsageDashboardResponseDto,
  })
  @ApiResponse({
    status: 400,
    description: 'VALIDATION_ERROR / DATE_RANGE_TOO_LARGE',
  })
  @ApiResponse({ status: 401, description: 'Chua dang nhap' })
  @ApiResponse({ status: 403, description: 'PERMISSION_DENIED' })
  @ApiResponse({ status: 500, description: 'INTERNAL_ERROR' })
  async getComparison(
    @Query(new ValidationPipe({ transform: true, whitelist: true }))
    query: QueryRoomUsageDashboardDto,
    @CurrentUser() currentUser: { userId: string },
  ): Promise<{
    success: boolean;
    message: string;
    data: RoomUsageDashboardResponseDto;
    meta: Record<string, any>;
  }> {
    try {
      const { data, message } = await this.service.getComparisonDashboard(
        currentUser,
        query,
      );
      return {
        success: true,
        message,
        data,
        meta: {},
      };
    } catch (error: unknown) {
      if (error instanceof HttpException) {
        throw error;
      }
      throw new InternalServerErrorException({
        success: false,
        message: 'Internal server error',
        error: { code: 'INTERNAL_ERROR', details: {} },
      });
    }
  }

  @Get(':roomId/detail')
  @ApiOperation({
    summary: 'Xem chi tiet su dung cua mot phong hop',
    description:
      'Tra ve thong ke chi tiet, heatmap 24 gio va danh sach cac cuoc hop cua phong.',
  })
  @ApiResponse({
    status: 200,
    description: 'Thong tin chi tiet phong hop duoc truy xuat thanh cong',
    type: RoomDetailResponseDto,
  })
  @ApiResponse({
    status: 400,
    description: 'VALIDATION_ERROR / DATE_RANGE_TOO_LARGE',
  })
  @ApiResponse({ status: 401, description: 'Chua dang nhap' })
  @ApiResponse({
    status: 403,
    description: 'PERMISSION_DENIED / ROOM_OUT_OF_SCOPE',
  })
  @ApiResponse({ status: 404, description: 'ROOM_NOT_FOUND' })
  @ApiResponse({ status: 500, description: 'INTERNAL_ERROR' })
  async getDetail(
    @Param('roomId', ParseUUIDPipe) roomId: string,
    @Query(new ValidationPipe({ transform: true, whitelist: true }))
    query: QueryRoomDetailDto,
    @CurrentUser() currentUser: { userId: string },
  ): Promise<{
    success: boolean;
    message: string;
    data: RoomDetailResponseDto;
    meta: Record<string, any>;
  }> {
    try {
      const { data, message } = await this.service.getRoomDetail(
        currentUser,
        roomId,
        query,
      );
      return {
        success: true,
        message,
        data,
        meta: {},
      };
    } catch (error: unknown) {
      if (error instanceof HttpException) {
        throw error;
      }
      throw new InternalServerErrorException({
        success: false,
        message: 'Internal server error',
        error: { code: 'INTERNAL_ERROR', details: {} },
      });
    }
  }
}
