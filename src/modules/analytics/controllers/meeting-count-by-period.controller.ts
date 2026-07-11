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

import { MeetingCountByPeriodService } from '../services/meeting-count-by-period.service';
import { QueryMeetingCountByPeriodDto } from '../dto/query-meeting-count-by-period.dto';
import { MeetingCountByPeriodResponseDto } from '../dto/meeting-count-by-period-response.dto';

@ApiTags('Analytics Meeting')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, PermissionsGuard)
@RequirePermissions('analytics.meeting.read')
@Controller('analytics/meetings')
export class MeetingCountByPeriodController {
  constructor(private readonly service: MeetingCountByPeriodService) {}

  @Get('count-by-period')
  @ApiOperation({
    summary:
      'Xem thong ke so luong cuoc hop theo khoang thoi gian (UC-AA-04 / UC-151)',
    description:
      'Tra ve thong ke so luong cuoc hop theo tuan hoac thang trong dải thoi gian.',
  })
  @ApiResponse({
    status: 200,
    description: 'Thong ke so luong cuoc hop duoc truy xuat thanh cong',
    type: MeetingCountByPeriodResponseDto,
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
  async getCountByPeriod(
    @Query(new ValidationPipe({ transform: true, whitelist: true }))
    query: QueryMeetingCountByPeriodDto,
    @CurrentUser() currentUser: { userId: string },
  ): Promise<{
    success: boolean;
    message: string;
    data: MeetingCountByPeriodResponseDto;
    meta: Record<string, any>;
  }> {
    try {
      const { data, message } = await this.service.getCountByPeriod(
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
