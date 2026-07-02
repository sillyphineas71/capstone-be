import {
  Controller,
  Get,
  Post,
  Param,
  Query,
  Body,
  Req,
  UseGuards,
  UseFilters,
  UsePipes,
  ValidationPipe,
  HttpCode,
} from '@nestjs/common';
import type { Request } from 'express';
import { JwtAuthGuard } from '../../auth/guards/jwt-auth.guard.js';
import { RolesGuard } from '../../auth/guards/roles.guard.js';
import { PermissionsGuard } from '../../auth/guards/permissions.guard.js';
import { RequireRoles } from '../../auth/decorators/require-roles.decorator.js';
import { RequirePermissions } from '../../auth/decorators/require-permissions.decorator.js';
import { AdminAvatarReviewService } from '../services/admin-avatar-review.service.js';
import { ListAvatarSubmissionsQueryDto } from '../dto/list-avatar-submissions-query.dto.js';
import { RejectAvatarSubmissionDto } from '../dto/reject-avatar-submission.dto.js';
import { avatarSubmissionIdPipe } from '../pipes/avatar-submission-id.pipe.js';
import { AdminAvatarReviewHttpExceptionFilter } from '../filters/admin-avatar-review-http-exception.filter.js';

interface AuthenticatedRequest extends Request {
  user: { userId: string };
}

@Controller('admin/avatar-submissions')
@UseFilters(AdminAvatarReviewHttpExceptionFilter)
@UseGuards(JwtAuthGuard, RolesGuard, PermissionsGuard)
export class AdminAvatarReviewController {
  constructor(private readonly service: AdminAvatarReviewService) {}

  @Get()
  @RequireRoles('SYSTEM_ADMIN')
  @RequirePermissions('account.avatar.review')
  @UsePipes(new ValidationPipe({ whitelist: true, transform: true }))
  async list(@Query() query: ListAvatarSubmissionsQueryDto) {
    const result = await this.service.listAvatarSubmissions(query);
    return {
      success: true,
      message: 'Avatar submissions retrieved successfully',
      ...result,
    };
  }

  @Get(':faceProfileId')
  @RequireRoles('SYSTEM_ADMIN')
  @RequirePermissions('account.avatar.review')
  async detail(
    @Param('faceProfileId', avatarSubmissionIdPipe()) faceProfileId: string,
  ) {
    const data = await this.service.getAvatarSubmissionDetail(faceProfileId);
    return {
      success: true,
      message: 'Avatar submission detail retrieved successfully',
      data,
    };
  }

  @Get(':faceProfileId/download-url')
  @RequireRoles('SYSTEM_ADMIN')
  @RequirePermissions('account.avatar.download')
  async downloadUrl(
    @Param('faceProfileId', avatarSubmissionIdPipe()) faceProfileId: string,
    @Req() request: AuthenticatedRequest,
  ) {
    const data = await this.service.getAvatarDownloadUrl(
      faceProfileId,
      request.user.userId,
    );
    return {
      success: true,
      message: 'Download URL generated successfully',
      data,
    };
  }

  @Post(':faceProfileId/approve')
  @HttpCode(200)
  @RequireRoles('SYSTEM_ADMIN')
  @RequirePermissions('account.avatar.review')
  async approve(
    @Param('faceProfileId', avatarSubmissionIdPipe()) faceProfileId: string,
    @Req() request: AuthenticatedRequest,
  ) {
    const data = await this.service.approveAvatarSubmission(
      faceProfileId,
      request.user.userId,
    );
    return { success: true, message: 'Avatar da duoc duyet thanh cong', data };
  }

  @Post(':faceProfileId/reject')
  @HttpCode(200)
  @RequireRoles('SYSTEM_ADMIN')
  @RequirePermissions('account.avatar.review')
  @UsePipes(new ValidationPipe({ whitelist: true, transform: true }))
  async reject(
    @Param('faceProfileId', avatarSubmissionIdPipe()) faceProfileId: string,
    @Body() dto: RejectAvatarSubmissionDto,
    @Req() request: AuthenticatedRequest,
  ) {
    const data = await this.service.rejectAvatarSubmission(
      faceProfileId,
      dto.reason,
      request.user.userId,
    );
    return { success: true, message: 'Avatar da bi tu choi', data };
  }
}
