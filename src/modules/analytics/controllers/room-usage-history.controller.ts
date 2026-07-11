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

import { RoomUsageHistoryService } from '../services/room-usage-history.service.js';
import { QueryRoomUsageHistoryDto } from '../dto/query-room-usage-history.dto.js';
import { RoomUsageHistoryResponseDto } from '../dto/room-usage-history-response.dto.js';

/**
 * RoomUsageHistoryController — UC-RUM-04.
 *
 * GET /api/v1/analytics/rooms/usage-history
 *   Danh sách phẳng, đa phòng, mỗi dòng = 1 phiên sử dụng phòng, kèm summary
 *   5 chỉ số. Tái dùng permission `analytics.room.read` đã seed sẵn ở
 *   UC-AA-02 (§2.2 spec.md — không cần seed permission mới).
 */
@ApiTags('Analytics Room')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, PermissionsGuard)
@RequirePermissions('analytics.room.read')
@Controller('analytics/rooms')
export class RoomUsageHistoryController {
  constructor(private readonly service: RoomUsageHistoryService) {}

  @Get('usage-history')
  @ApiOperation({
    summary: 'Xem lich su su dung phong hop theo khoang thoi gian (UC-RUM-04)',
    description:
      'Danh sach chi tiet tung phien su dung phong (sortable, paginated) kem 5 chi so tong quan.',
  })
  @ApiResponse({ status: 200, type: RoomUsageHistoryResponseDto })
  @ApiResponse({
    status: 400,
    description: 'VALIDATION_ERROR / DATE_RANGE_TOO_LARGE',
  })
  @ApiResponse({ status: 401, description: 'Chua dang nhap' })
  @ApiResponse({ status: 403, description: 'PERMISSION_DENIED' })
  @ApiResponse({ status: 500, description: 'INTERNAL_ERROR' })
  async getUsageHistory(
    @Query(new ValidationPipe({ transform: true, whitelist: true }))
    query: QueryRoomUsageHistoryDto,
    @CurrentUser() currentUser: { userId: string },
  ): Promise<{
    success: boolean;
    message: string;
    data: RoomUsageHistoryResponseDto;
    meta: Record<string, unknown>;
  }> {
    try {
      const { data, message, total } = await this.service.getUsageHistory(
        currentUser,
        query,
      );
      const page = query.page ?? 1;
      const limit = query.limit ?? 20;
      return {
        success: true,
        message,
        data,
        meta: {
          page,
          limit,
          total,
          totalPages: limit > 0 ? Math.ceil(total / limit) : 0,
        },
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
