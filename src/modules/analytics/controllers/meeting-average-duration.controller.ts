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

import { MeetingAverageDurationService } from '../services/meeting-average-duration.service';
import { QueryMeetingAverageDurationDto } from '../dto/query-meeting-average-duration.dto';
import { MeetingAverageDurationResponseDto } from '../dto/meeting-average-duration-response.dto';

@ApiTags('Analytics Meeting')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, PermissionsGuard)
@RequirePermissions('analytics.meeting.read')
@Controller('analytics/meetings')
export class MeetingAverageDurationController {
  constructor(private readonly service: MeetingAverageDurationService) {}

  @Get('average-duration')
  @ApiOperation({
    summary: 'Xem thong ke thoi luong trung binh cuoc hop (UC-AA-06 / UC-153)',
    description:
      'Tra ve thong ke doi chieu thoi luong ke hoach va thuc te cua cac cuoc hop completed.',
  })
  @ApiResponse({
    status: 200,
    description: 'Thong ke thoi luong trung binh cuoc hop duoc truy xuat thanh cong',
    type: MeetingAverageDurationResponseDto,
  })
  @ApiResponse({ status: 400, description: 'VALIDATION_ERROR / DATE_RANGE_TOO_LARGE' })
  @ApiResponse({ status: 401, description: 'Chua dang nhap' })
  @ApiResponse({ status: 403, description: 'PERMISSION_DENIED / DEPARTMENT_OUT_OF_SCOPE' })
  @ApiResponse({ status: 500, description: 'INTERNAL_ERROR' })
  async getAverageDuration(
    @Query(new ValidationPipe({ transform: true, whitelist: true }))
    query: QueryMeetingAverageDurationDto,
    @CurrentUser() currentUser: { userId: string },
  ): Promise<{
    success: boolean;
    message: string;
    data: MeetingAverageDurationResponseDto;
    meta: Record<string, any>;
  }> {
    try {
      const { data, message } = await this.service.getAverageDuration(currentUser, query);
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
