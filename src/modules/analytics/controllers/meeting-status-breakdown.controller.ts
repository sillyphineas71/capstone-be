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

import { MeetingStatusBreakdownService } from '../services/meeting-status-breakdown.service';
import { QueryMeetingStatusBreakdownDto } from '../dto/query-meeting-status-breakdown.dto';
import { MeetingStatusBreakdownResponseDto } from '../dto/meeting-status-breakdown-response.dto';

@ApiTags('Analytics Meeting')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, PermissionsGuard)
@RequirePermissions('analytics.meeting.read')
@Controller('analytics/meetings')
export class MeetingStatusBreakdownController {
  constructor(private readonly service: MeetingStatusBreakdownService) {}

  @Get('status-breakdown')
  @ApiOperation({
    summary: 'Xem thong ke cuoc hop theo trang thai (UC-AA-05 / UC-152)',
    description:
      'Tra ve thong ke so luong va ty le % cuoc hop theo 4 trang thai Scheduled, Completed, Cancelled, va No-show.',
  })
  @ApiResponse({
    status: 200,
    description: 'Thong ke trang thai cuoc hop duoc truy xuat thanh cong',
    type: MeetingStatusBreakdownResponseDto,
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
  async getStatusBreakdown(
    @Query(new ValidationPipe({ transform: true, whitelist: true }))
    query: QueryMeetingStatusBreakdownDto,
    @CurrentUser() currentUser: { userId: string },
  ): Promise<{
    success: boolean;
    message: string;
    data: MeetingStatusBreakdownResponseDto;
    meta: Record<string, any>;
  }> {
    try {
      const { data, message } = await this.service.getStatusBreakdown(
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
}
