import {
  Controller,
  Get,
  Query,
  Req,
  UseGuards,
  ValidationPipe,
} from '@nestjs/common';
import type { Request } from 'express';
import { JwtAuthGuard } from '../../auth/guards/jwt-auth.guard.js';
import { PermissionsGuard } from '../../auth/guards/permissions.guard.js';
import { RequirePermissions } from '../../auth/decorators/require-permissions.decorator.js';
import { MeetingsService } from '../services/meetings.service.js';
import { MeetingRequestQueryDto } from '../dto/meeting-request-query.dto.js';

@Controller('meeting-requests')
@UseGuards(JwtAuthGuard, PermissionsGuard)
export class MeetingRequestsController {
  constructor(private readonly meetingsService: MeetingsService) {}

  @Get()
  @RequirePermissions('meeting_request.read')
  async findAll(
    @Query(
      new ValidationPipe({
        transform: true,
        whitelist: true,
        forbidNonWhitelisted: true,
      }),
    )
    query: MeetingRequestQueryDto,
    @Req() req: Request,
  ) {
    const result = await this.meetingsService.findMeetingRequests(
      query,
      (req as any).user,
    );

    return {
      success: true,
      message: 'Danh sách yêu cầu cuộc họp',
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
