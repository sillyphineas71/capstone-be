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

import { MeetingCancelRateService } from '../services/meeting-cancel-rate.service';
import { QueryMeetingCancelRateDto } from '../dto/query-meeting-cancel-rate.dto';
import { MeetingCancelRateResponseDto } from '../dto/meeting-cancel-rate-response.dto';

@ApiTags('Analytics Meeting')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, PermissionsGuard)
@RequirePermissions('analytics.meeting.read')
@Controller('analytics/meetings')
export class MeetingCancelRateController {
  constructor(private readonly service: MeetingCancelRateService) {}

  @Get('cancel-rate')
  @ApiOperation({
    summary: 'Xem thong ke ty le cuoc hop bi huy (UC-AA-07 / UC-154)',
    description:
      'Tra ve thong ke xu huong ty le huy va Top-10 nhan su/phong ban co ty le huy cao.',
  })
  @ApiResponse({
    status: 200,
    description: 'Thong ke ty le cuoc hop bi huy duoc truy xuat thanh cong',
    type: MeetingCancelRateResponseDto,
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
  async getCancelRate(
    @Query(new ValidationPipe({ transform: true, whitelist: true }))
    query: QueryMeetingCancelRateDto,
    @CurrentUser() currentUser: { userId: string },
  ): Promise<{
    success: boolean;
    message: string;
    data: MeetingCancelRateResponseDto;
    meta: Record<string, any>;
  }> {
    try {
      const { data, message } = await this.service.getCancelRate(
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
