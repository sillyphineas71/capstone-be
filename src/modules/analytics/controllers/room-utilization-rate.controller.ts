import {
  Controller,
  Get,
  Query,
  UseGuards,
  ValidationPipe,
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

import { RoomUtilizationRateService } from '../services/room-utilization-rate.service';
import { QueryRoomUtilizationRateDto } from '../dto/query-room-utilization-rate.dto';
import { RoomUtilizationRateResponseDto } from '../dto/room-utilization-rate-response.dto';

@ApiTags('Analytics Room')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, PermissionsGuard)
@RequirePermissions('analytics.room.read')
@Controller('analytics/rooms')
export class RoomUtilizationRateController {
  constructor(private readonly service: RoomUtilizationRateService) {}

  @Get('utilization-rate')
  @ApiOperation({
    summary: 'Xem thong ke ty le su dung phong tong hop (UC-AA-08 / UC-155)',
    description: 'Tra ve ty le su dung phong dat lich va thuc te cung voi bieu do so sanh hai chu ky.',
  })
  @ApiResponse({
    status: 200,
    description: 'Thong ke ty le su dung phong duoc truy xuat thanh cong',
    type: RoomUtilizationRateResponseDto,
  })
  @ApiResponse({ status: 400, description: 'VALIDATION_ERROR / DATE_RANGE_TOO_LARGE' })
  @ApiResponse({ status: 401, description: 'Chua dang nhap' })
  @ApiResponse({ status: 403, description: 'PERMISSION_DENIED / ROOM_OUT_OF_SCOPE' })
  @ApiResponse({ status: 404, description: 'ROOM_NOT_FOUND' })
  @ApiResponse({ status: 500, description: 'INTERNAL_ERROR' })
  async getUtilizationRate(
    @Query(new ValidationPipe({ transform: true, whitelist: true }))
    query: QueryRoomUtilizationRateDto,
    @CurrentUser() currentUser: { userId: string },
  ): Promise<{
    success: boolean;
    message: string;
    data: RoomUtilizationRateResponseDto;
    meta: Record<string, any>;
  }> {
    try {
      const { data, message } = await this.service.getUtilizationRate(currentUser, query);
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
