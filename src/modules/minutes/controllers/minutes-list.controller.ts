import {
  Controller,
  Get,
  Query,
  UseGuards,
  ValidationPipe,
} from '@nestjs/common';
import {
  ApiBearerAuth,
  ApiOperation,
  ApiQuery,
  ApiResponse,
  ApiTags,
} from '@nestjs/swagger';

import { JwtAuthGuard } from '../../auth/guards/jwt-auth.guard.js';
import { PermissionsGuard } from '../../auth/guards/permissions.guard.js';
import { RequirePermissions } from '../../auth/decorators/require-permissions.decorator.js';
import { CurrentUser } from '../../auth/decorators/current-user.decorator.js';

import { MinutesService } from '../services/minutes.service.js';
import { MinutesQueryDto } from '../dto/minutes-query.dto.js';
import { MinutesListItemDto } from '../dto/minutes-list-item.dto.js';

@Controller('meeting-minutes')
export class MeetingMinutesListController {
  constructor(private readonly minutesService: MinutesService) {}

  @Get()
  @UseGuards(JwtAuthGuard, PermissionsGuard)
  @RequirePermissions('meeting.minutes.read')
  @ApiTags('Minutes')
  @ApiBearerAuth()
  @ApiOperation({
    summary: 'Xem danh sach bien ban hop (UC-MKM-02)',
    description:
      'Tra ve danh sach bien ban hop theo pham vi phan quyen: Host thay ban Nhap cua chinh minh, ' +
      'Host/Participant thay bien ban da published/archived cua cuoc hop lien quan, ' +
      'Business Admin/System Admin thay toan bo (tru status=deleted).',
  })
  @ApiQuery({ name: 'page', required: false, type: Number })
  @ApiQuery({
    name: 'limit',
    required: false,
    type: Number,
    description: 'Toi da 20 (BR2)',
  })
  @ApiQuery({
    name: 'status',
    required: false,
    enum: ['draft', 'published', 'archived', 'all'],
  })
  @ApiQuery({ name: 'roomId', required: false, type: String })
  @ApiQuery({ name: 'from', required: false, type: String })
  @ApiQuery({ name: 'to', required: false, type: String })
  @ApiQuery({ name: 'q', required: false, type: String })
  @ApiQuery({
    name: 'sortBy',
    required: false,
    enum: ['actual_start_time', 'created_at'],
  })
  @ApiQuery({ name: 'sortOrder', required: false, enum: ['asc', 'desc'] })
  @ApiResponse({ status: 200, description: 'Danh sach bien ban hop' })
  @ApiResponse({ status: 400, description: 'VALIDATION_ERROR' })
  @ApiResponse({ status: 401, description: 'Unauthorized' })
  @ApiResponse({ status: 403, description: 'FORBIDDEN' })
  async findAll(
    @Query(new ValidationPipe({ transform: true, whitelist: true }))
    query: MinutesQueryDto,
    @CurrentUser() user: { userId: string },
  ): Promise<{
    success: boolean;
    message: string;
    data: MinutesListItemDto[];
    meta: { page: number; limit: number; total: number; totalPages: number };
  }> {
    const result = await this.minutesService.findMinutesList(query, {
      userId: user.userId,
    });

    return {
      success: true,
      message: 'Danh sách biên bản họp',
      data: result.items,
      meta: {
        page: result.page,
        limit: result.limit,
        total: result.total,
        totalPages: Math.ceil(result.total / result.limit) || 0,
      },
    };
  }
}
