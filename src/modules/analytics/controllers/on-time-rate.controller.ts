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

import { OnTimeRateService } from '../services/on-time-rate.service';
import { QueryOnTimeRateDto } from '../dto/query-on-time-rate.dto';
import { QueryLateHistoryDto } from '../dto/query-late-history.dto';
import { UserLateStatsQueryDto } from '../dto/query-user-late-stats.dto';
import {
  OnTimeRateResponseDto,
  LateHistoryResponseDto,
  UserLateStatsResponseDto,
} from '../dto/on-time-rate-response.dto';

@ApiTags('Analytics Attendance')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, PermissionsGuard)
@RequirePermissions('analytics.attendance.read')
@Controller('analytics/attendance')
export class OnTimeRateController {
  constructor(private readonly service: OnTimeRateService) {}

  @Get('on-time-rate')
  @ApiOperation({
    summary: 'Xem thong ke ty le dung gio (UC-AA-10 / UC-157)',
    description:
      'Tra ve thong ke tong hop va bieu do/danh sach thong ke ty le di tre, dung gio.',
  })
  @ApiResponse({
    status: 200,
    description: 'Thong ke ty le tham du dung gio duoc truy xuat thanh cong',
    type: OnTimeRateResponseDto,
  })
  @ApiResponse({
    status: 400,
    description: 'VALIDATION_ERROR / DATE_RANGE_TOO_LARGE',
  })
  @ApiResponse({ status: 401, description: 'Chua dang nhap' })
  @ApiResponse({
    status: 403,
    description: 'PERMISSION_DENIED / DEPARTMENT_OUT_OF_SCOPE',
  })
  @ApiResponse({ status: 500, description: 'INTERNAL_ERROR' })
  async getOnTimeRate(
    @Query(new ValidationPipe({ transform: true, whitelist: true }))
    query: QueryOnTimeRateDto,
    @CurrentUser() currentUser: { userId: string },
  ): Promise<{
    success: boolean;
    message: string;
    data: OnTimeRateResponseDto;
    meta: Record<string, any>;
  }> {
    try {
      const { data, message } = await this.service.getOnTimeRate(
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

  @Get('on-time-rate/users')
  @ApiOperation({
    summary: 'Thống kê tỷ lệ đúng giờ theo nhân sự (UC-AA-10 / UC-157)',
    description:
      'Trả về danh sách tỷ lệ đi trễ theo từng nhân sự có phân trang và tìm kiếm.',
  })
  @ApiResponse({
    status: 200,
    description:
      'Thống kê tỷ lệ tham dự đúng giờ theo nhân sự được truy xuất thành công',
    type: UserLateStatsResponseDto,
  })
  @ApiResponse({
    status: 400,
    description: 'VALIDATION_ERROR / DATE_RANGE_TOO_LARGE',
  })
  @ApiResponse({ status: 401, description: 'Chưa đăng nhập' })
  @ApiResponse({
    status: 403,
    description: 'PERMISSION_DENIED / DEPARTMENT_OUT_OF_SCOPE',
  })
  @ApiResponse({ status: 404, description: 'DEPARTMENT_NOT_EXISTS' })
  @ApiResponse({ status: 500, description: 'INTERNAL_ERROR' })
  async getOnTimeRateByUsers(
    @Query(new ValidationPipe({ transform: true, whitelist: true }))
    query: UserLateStatsQueryDto,
    @CurrentUser() currentUser: { userId: string },
  ): Promise<{
    success: boolean;
    message: string;
    data: UserLateStatsResponseDto;
    meta: Record<string, any>;
  }> {
    try {
      const { data, message } = await this.service.getOnTimeRateByUsers(
        currentUser,
        query,
      );
      return {
        success: true,
        message,
        data,
        // FE đọc phân trang ở res.meta (be_required_endpoints.md); mirror từ data.
        meta: {
          total: data.total,
          page: data.page,
          limit: data.limit,
          totalPages: data.totalPages,
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

  @Get('on-time-rate/users/:userId/late-history')
  @ApiOperation({
    summary: 'Xem lich su di tre cua mot user',
    description: 'Tra ve danh sach cac cuoc hop ma user nay di tre trong ky.',
  })
  @ApiResponse({
    status: 200,
    description: 'Lich su di muon cua nhan su duoc truy xuat thanh cong',
    type: LateHistoryResponseDto,
  })
  @ApiResponse({
    status: 400,
    description: 'VALIDATION_ERROR / DATE_RANGE_TOO_LARGE',
  })
  @ApiResponse({ status: 401, description: 'Chua dang nhap' })
  @ApiResponse({
    status: 403,
    description: 'PERMISSION_DENIED / USER_OUT_OF_SCOPE',
  })
  @ApiResponse({ status: 404, description: 'USER_NOT_FOUND' })
  @ApiResponse({ status: 500, description: 'INTERNAL_ERROR' })
  async getLateHistory(
    @Param('userId', ParseUUIDPipe) userId: string,
    @Query(new ValidationPipe({ transform: true, whitelist: true }))
    query: QueryLateHistoryDto,
    @CurrentUser() currentUser: { userId: string },
  ): Promise<{
    success: boolean;
    message: string;
    data: LateHistoryResponseDto;
    meta: Record<string, any>;
  }> {
    try {
      const { data, message } = await this.service.getLateHistory(
        currentUser,
        userId,
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
