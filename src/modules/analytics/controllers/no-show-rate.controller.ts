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

import { NoShowRateService } from '../services/no-show-rate.service';
import { QueryNoShowRateDto } from '../dto/query-no-show-rate.dto';
import { NoShowRateResponseDto } from '../dto/no-show-rate-response.dto';

@ApiTags('Analytics Room')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, PermissionsGuard)
@RequirePermissions('analytics.room.read')
@Controller('analytics/rooms')
export class NoShowRateController {
  constructor(private readonly service: NoShowRateService) {}

  @Get('no-show-rate')
  @ApiOperation({
    summary: 'Xem thong ke ty le no-show (UC-AA-09 / UC-156)',
    description:
      'Tra ve thong ke tong so ca no-show, ty le no-show va bang xep hang chi tiet co phan trang.',
  })
  @ApiResponse({
    status: 200,
    description: 'Thong ke ty le no-show duoc truy xuat thanh cong',
    type: NoShowRateResponseDto,
  })
  @ApiResponse({ status: 400, description: 'VALIDATION_ERROR / DATE_RANGE_TOO_LARGE' })
  @ApiResponse({ status: 401, description: 'Chua dang nhap' })
  @ApiResponse({ status: 403, description: 'PERMISSION_DENIED / DEPARTMENT_OUT_OF_SCOPE / ROOM_OUT_OF_SCOPE' })
  @ApiResponse({ status: 500, description: 'INTERNAL_ERROR' })
  async getNoShowRate(
    @Query(new ValidationPipe({ transform: true, whitelist: true }))
    query: QueryNoShowRateDto,
    @CurrentUser() currentUser: { userId: string },
  ): Promise<{
    success: boolean;
    message: string;
    data: NoShowRateResponseDto;
    meta: Record<string, any>;
  }> {
    try {
      const { data, message } = await this.service.getNoShowRate(currentUser, query);
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
