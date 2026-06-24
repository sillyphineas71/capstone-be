import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Post,
  UploadedFile,
  UseFilters,
  UseGuards,
  UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import {
  ApiBearerAuth,
  ApiBody,
  ApiConsumes,
  ApiOperation,
  ApiResponse,
  ApiTags,
  ApiUnauthorizedResponse,
  ApiForbiddenResponse,
} from '@nestjs/swagger';

import { JwtAuthGuard } from '../../auth/guards/jwt-auth.guard.js';
import { PermissionsGuard } from '../../auth/guards/permissions.guard.js';
import { RequirePermissions } from '../../auth/decorators/require-permissions.decorator.js';
import { CurrentUser } from '../../auth/decorators/current-user.decorator.js';

import { AvatarStatusService } from '../services/avatar-status.service.js';
import {
  AvatarSubmissionService,
  UploadedAvatarFile,
} from '../services/avatar-submission.service.js';
import { AvatarStatusResponseDto } from '../dto/avatar-status-response.dto.js';
import { AvatarSubmissionResponseDto } from '../dto/avatar-submission-response.dto.js';
import { SubmitAvatarDto } from '../dto/submit-avatar.dto.js';
import { AvatarHttpExceptionFilter } from '../filters/avatar-http-exception.filter.js';

/**
 * AvatarController — ACCT-AVATAR-SUBMIT-001 (self-service avatar).
 *
 * Mọi thao tác chỉ áp dụng cho chính user đã xác thực (userId lấy từ JWT, BR-001/FR-003).
 * Dùng guard THẬT (JwtAuthGuard + PermissionsGuard) — KHÔNG dùng MockPermissionsGuard.
 */
@ApiTags('Accounts - Avatar (self-service)')
@Controller('me')
export class AvatarController {
  constructor(
    private readonly avatarStatusService: AvatarStatusService,
    private readonly avatarSubmissionService: AvatarSubmissionService,
  ) {}

  // ACCT-AVATAR-SUBMIT-001 (FR-005): xem trạng thái avatar của chính mình.
  @Get('avatar-status')
  @HttpCode(HttpStatus.OK)
  @UseGuards(JwtAuthGuard, PermissionsGuard)
  @RequirePermissions('profile.avatar.read_status')
  @ApiBearerAuth()
  @ApiOperation({
    summary: 'Xem trạng thái ảnh đại diện của chính mình',
    description:
      'Trả về avatarReviewStatus/avatarRequired/shouldShowAvatarPopup tính theo BR-004 từ face_profiles của user.',
  })
  @ApiResponse({ status: HttpStatus.OK, description: 'Trạng thái avatar.' })
  @ApiUnauthorizedResponse({
    description: 'Chưa đăng nhập / token không hợp lệ.',
  })
  @ApiForbiddenResponse({
    description: 'Thiếu permission profile.avatar.read_status.',
  })
  async getAvatarStatus(
    @CurrentUser() currentUser: { userId: string } | undefined,
  ): Promise<{ success: boolean; data: AvatarStatusResponseDto }> {
    const data = await this.avatarStatusService.getStatus(currentUser!.userId);
    return { success: true, data };
  }

  // ACCT-AVATAR-SUBMIT-001 (FR-006): tự nộp/nộp lại avatar của chính mình.
  @Post('avatar-submission')
  @HttpCode(HttpStatus.CREATED)
  @UseGuards(JwtAuthGuard, PermissionsGuard)
  @RequirePermissions('profile.avatar.submit')
  @UseFilters(AvatarHttpExceptionFilter)
  // KHÔNG set limits.fileSize ở Multer: để service trả đúng AVATAR_FILE_TOO_LARGE
  // theo precedence §11.2 (Multer limit sẽ ném lỗi sai code trước khi tới service).
  @UseInterceptors(FileInterceptor('file'))
  @ApiBearerAuth()
  @ApiConsumes('multipart/form-data')
  @ApiOperation({
    summary: 'Tự nộp/nộp lại ảnh đại diện',
    description:
      'User tự upload ảnh; lưu Cloudinary + media_files, tạo face_profiles status=pending_review.',
  })
  @ApiBody({
    schema: {
      type: 'object',
      properties: {
        file: { type: 'string', format: 'binary' },
        consentAccepted: { type: 'boolean' },
      },
      required: ['file', 'consentAccepted'],
    },
  })
  @ApiResponse({
    status: HttpStatus.CREATED,
    description: 'Nộp ảnh thành công, đang chờ duyệt.',
  })
  @ApiUnauthorizedResponse({
    description: 'Chưa đăng nhập / token không hợp lệ.',
  })
  @ApiForbiddenResponse({
    description:
      'Thiếu permission profile.avatar.submit hoặc account không active.',
  })
  async submitAvatar(
    @CurrentUser() currentUser: { userId: string } | undefined,
    @UploadedFile() file: UploadedAvatarFile | undefined,
    @Body() body: SubmitAvatarDto,
  ): Promise<{ success: boolean; data: AvatarSubmissionResponseDto }> {
    const data = await this.avatarSubmissionService.submit(
      currentUser!.userId,
      file,
      body?.consentAccepted,
    );
    return { success: true, data };
  }
}
