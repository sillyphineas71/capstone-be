import {
  Controller,
  Get,
  Post,
  Delete,
  Patch,
  Param,
  Query,
  UploadedFile,
  Body,
  UseGuards,
  UseInterceptors,
  ValidationPipe,
  ParseUUIDPipe,
  HttpCode,
  HttpStatus,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import {
  ApiBearerAuth,
  ApiOperation,
  ApiQuery,
  ApiResponse,
  ApiTags,
  ApiConsumes,
  ApiBody,
  ApiParam,
} from '@nestjs/swagger';

import { JwtAuthGuard } from '../../auth/guards/jwt-auth.guard.js';
import { PermissionsGuard } from '../../auth/guards/permissions.guard.js';
import { RequirePermissions } from '../../auth/decorators/require-permissions.decorator.js';
import { CurrentUser } from '../../auth/decorators/current-user.decorator.js';

import { MinutesService } from '../services/minutes.service.js';
import { MinutesQueryDto } from '../dto/minutes-query.dto.js';
import { MinutesListItemDto } from '../dto/minutes-list-item.dto.js';
import { MinutesDetailResponseDto } from '../dto/minutes-detail-response.dto.js';
import { MinutesAttachmentResponseDto } from '../dto/minutes-attachment-response.dto.js';
import { UpdateDraftMinutesDto } from '../dto/update-draft-minutes.dto.js';
import { UpdateDraftMinutesResponseDto } from '../dto/update-draft-minutes-response.dto.js';
import { SearchMinutesByPersonQueryDto } from '../dto/search-minutes-by-person-query.dto.js';
import { IssueMinutesResponseDto } from '../dto/issue-minutes-response.dto.js';

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
  @Get('search-by-person')
  @HttpCode(HttpStatus.OK)
  @UseGuards(JwtAuthGuard, PermissionsGuard)
  @RequirePermissions('meeting.minutes.search_by_person')
  @ApiTags('Minutes')
  @ApiBearerAuth()
  @ApiOperation({
    summary: 'Tim kiem bien ban theo nhan su (UC-MKM-07)',
    description:
      'Cho phep Manager/Admin tra cuu bien ban hop lien quan toi mot nhan su cu the.',
  })
  @ApiBody({ type: Object })
  @ApiResponse({ status: 200, description: 'Danh sach bien ban' })
  @ApiResponse({ status: 400, description: 'VALIDATION_ERROR' })
  @ApiResponse({ status: 401, description: 'Unauthorized' })
  @ApiResponse({ status: 403, description: 'FORBIDDEN' })
  @ApiResponse({ status: 404, description: 'USER_NOT_FOUND' })
  async searchByPerson(
    @Query(new ValidationPipe({ transform: true, whitelist: true }))
    query: SearchMinutesByPersonQueryDto,
    @CurrentUser() user: { userId: string },
  ): Promise<{
    success: boolean;
    message: string;
    data: MinutesListItemDto[];
    meta: any;
  }> {
    const result = await this.minutesService.searchMinutesByPerson(query, {
      userId: user.userId,
    });
    return {
      success: true,
      message: 'Danh sach bien ban lien quan den nhan su',
      data: result.items,
      meta: {
        page: result.page,
        limit: result.limit,
        total: result.total,
        totalPages: Math.ceil(result.total / result.limit) || 0,
        person: result.person,
      },
    };
  }

  @Get(':id')
  @UseGuards(JwtAuthGuard, PermissionsGuard)
  @RequirePermissions('meeting.minutes.read')
  @ApiTags('Minutes')
  @ApiBearerAuth()
  @ApiOperation({
    summary: 'Xem chi tiet bien ban hop (UC-MKM-03)',
    description:
      'Tra ve chi tiet bien ban hop bao gom thong tin chung, noi dung chinh, tai nguyen lien quan, file dinh kem.',
  })
  @ApiParam({ name: 'id', type: 'string', format: 'uuid' })
  @ApiResponse({ status: 200, description: 'Chi tiet bien ban hop' })
  @ApiResponse({ status: 400, description: 'VALIDATION_ERROR' })
  @ApiResponse({ status: 401, description: 'Unauthorized' })
  @ApiResponse({
    status: 403,
    description: 'FORBIDDEN / MEETING_MINUTES_ACCESS_DENIED',
  })
  @ApiResponse({ status: 404, description: 'MEETING_MINUTES_NOT_FOUND' })
  async findOne(
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentUser() user: { userId: string },
  ): Promise<{
    success: boolean;
    message: string;
    data: MinutesDetailResponseDto;
  }> {
    const data = await this.minutesService.findMinutesDetail(id, {
      userId: user.userId,
    });

    return {
      success: true,
      message: 'Chi tiet bien ban hop',
      data,
    };
  }

  @Patch(':id')
  @HttpCode(HttpStatus.OK)
  @UseGuards(JwtAuthGuard, PermissionsGuard)
  @RequirePermissions('meeting.minutes.update')
  @ApiTags('Minutes')
  @ApiBearerAuth()
  @ApiOperation({
    summary: 'Cap nhat noi dung bien ban hop nhap (UC-MKM-04)',
    description:
      'Cho phep Host cap nhat title/minutesContent/decisionsJson/actionItemsJson cua bien ban dang o trang thai draft.',
  })
  @ApiParam({ name: 'id', type: 'string', format: 'uuid' })
  @ApiBody({ type: UpdateDraftMinutesDto })
  @ApiResponse({ status: 200, description: 'Cap nhat thanh cong' })
  @ApiResponse({ status: 400, description: 'VALIDATION_ERROR' })
  @ApiResponse({ status: 401, description: 'Unauthorized' })
  @ApiResponse({ status: 403, description: 'FORBIDDEN / NOT_MINUTES_OWNER' })
  @ApiResponse({ status: 404, description: 'MINUTES_NOT_FOUND' })
  @ApiResponse({
    status: 409,
    description: 'MINUTES_NOT_DRAFT / MINUTES_VERSION_CONFLICT',
  })
  async updateDraft(
    @Param('id', ParseUUIDPipe) id: string,
    @Body(
      new ValidationPipe({
        whitelist: true,
        forbidNonWhitelisted: true,
        transform: true,
      }),
    )
    dto: UpdateDraftMinutesDto,
    @CurrentUser() user: { userId: string },
  ): Promise<{
    success: boolean;
    message: string;
    data: UpdateDraftMinutesResponseDto;
  }> {
    const data = await this.minutesService.updateDraft(id, dto, {
      userId: user.userId,
    });
    return {
      success: true,
      message: 'Cap nhat noi dung bien ban cuoc hop thanh cong',
      data,
    };
  }

  @Delete(':id')
  @HttpCode(HttpStatus.OK)
  @UseGuards(JwtAuthGuard, PermissionsGuard)
  @RequirePermissions('meeting.minutes.delete')
  @ApiTags('Minutes')
  @ApiBearerAuth()
  @ApiOperation({
    summary: 'Xoa bien ban hop nhap (UC-MKM-05)',
    description:
      'Soft-delete bien ban dang o trang thai draft. Host hoac Admin duoc thuc hien.',
  })
  @ApiParam({ name: 'id', type: 'string', format: 'uuid' })
  @ApiResponse({ status: 200, description: 'Da xoa bien ban hop nhap' })
  @ApiResponse({ status: 400, description: 'VALIDATION_ERROR' })
  @ApiResponse({ status: 401, description: 'Unauthorized' })
  @ApiResponse({ status: 403, description: 'FORBIDDEN / NOT_MINUTES_OWNER' })
  @ApiResponse({ status: 404, description: 'MINUTES_NOT_FOUND' })
  @ApiResponse({ status: 409, description: 'MINUTES_NOT_DRAFT' })
  async deleteDraft(
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentUser() user: { userId: string },
  ): Promise<{
    success: boolean;
    message: string;
    data: {
      deleted: boolean;
      minutesId: string;
      deletedAt: Date;
      cascadedAttachmentCount: number;
    };
  }> {
    const data = await this.minutesService.deleteDraft(id, {
      userId: user.userId,
    });
    return {
      success: true,
      message: 'Da xoa bien ban hop nhap thanh cong',
      data,
    };
  }

  // -- Issue (publish) --
  @Post(':id/issue')
  @HttpCode(HttpStatus.OK)
  @UseGuards(JwtAuthGuard, PermissionsGuard)
  @RequirePermissions('meeting.minutes.issue')
  @ApiTags('Minutes')
  @ApiBearerAuth()
  @ApiOperation({
    summary: 'Ban hanh bien ban hop chinh thuc (UC-MKM-09)',
    description:
      'Chuyen bien ban hop tu draft sang published, ghi nhan issued_by/issued_at, thong bao cho participant.',
  })
  @ApiParam({ name: 'id', type: 'string', format: 'uuid' })
  @ApiResponse({ status: 200, description: 'Ban hanh thanh cong' })
  @ApiResponse({ status: 401, description: 'Unauthorized' })
  @ApiResponse({ status: 403, description: 'FORBIDDEN / NOT_MINUTES_OWNER' })
  @ApiResponse({ status: 404, description: 'MINUTES_NOT_FOUND' })
  @ApiResponse({
    status: 409,
    description: 'MINUTES_NOT_DRAFT / MEETING_NOT_COMPLETED',
  })
  async issue(
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentUser() user: { userId: string },
  ): Promise<{
    success: boolean;
    message: string;
    data: IssueMinutesResponseDto;
  }> {
    const data = await this.minutesService.issueMinutes(id, {
      userId: user.userId,
    });
    return {
      success: true,
      message: 'Ban hanh bien ban cuoc hop thanh cong',
      data,
    };
  }

  // ── Attachment: Upload ──
  @Post(':minutesId/attachments')
  @HttpCode(HttpStatus.CREATED)
  @UseGuards(JwtAuthGuard, PermissionsGuard)
  @RequirePermissions('meeting.minutes.attachment.create')
  @UseInterceptors(FileInterceptor('file'))
  @ApiTags('Minutes')
  @ApiBearerAuth()
  @ApiOperation({
    summary: 'Dinh kem tai lieu vao bien ban (upload)',
    description:
      'Upload file dinh kem cho bien ban dang o trang thai draft. Chi Host (preparedBy) duoc thuc hien.',
  })
  @ApiConsumes('multipart/form-data')
  @ApiBody({
    schema: {
      type: 'object',
      properties: {
        file: { type: 'string', format: 'binary' },
      },
      required: ['file'],
    },
  })
  @ApiResponse({
    status: HttpStatus.CREATED,
    description: 'Tai lieu da duoc dinh kem',
  })
  @ApiResponse({
    status: HttpStatus.BAD_REQUEST,
    description:
      'ATTACHMENT_FILE_REQUIRED / ATTACHMENT_FILE_TOO_LARGE / ATTACHMENT_FILE_TYPE_INVALID',
  })
  @ApiResponse({ status: HttpStatus.UNAUTHORIZED, description: 'Unauthorized' })
  @ApiResponse({
    status: HttpStatus.FORBIDDEN,
    description: 'FORBIDDEN / NOT_MINUTES_OWNER',
  })
  @ApiResponse({
    status: HttpStatus.NOT_FOUND,
    description: 'MINUTES_NOT_FOUND',
  })
  @ApiResponse({
    status: HttpStatus.CONFLICT,
    description: 'MINUTES_NOT_DRAFT / ATTACHMENT_LIMIT_EXCEEDED',
  })
  @ApiResponse({
    status: HttpStatus.BAD_GATEWAY,
    description: 'ATTACHMENT_STORAGE_FAILED',
  })
  async uploadAttachment(
    @Param('minutesId', ParseUUIDPipe) minutesId: string,
    @UploadedFile() file: any,
    @CurrentUser() user: { userId: string },
  ): Promise<{
    success: boolean;
    message: string;
    data: MinutesAttachmentResponseDto;
  }> {
    const data = await this.minutesService.addAttachment(minutesId, file, {
      userId: user.userId,
    });
    return {
      success: true,
      message: 'Tai lieu da duoc dinh kem thanh cong',
      data,
    };
  }

  // ── Attachment: List ──
  @Get(':minutesId/attachments')
  @HttpCode(HttpStatus.OK)
  @UseGuards(JwtAuthGuard, PermissionsGuard)
  @RequirePermissions('meeting.minutes.attachment.read')
  @ApiTags('Minutes')
  @ApiBearerAuth()
  @ApiOperation({
    summary: 'Danh sach tai lieu dinh kem cua bien ban',
    description:
      'Tra ve danh sach file dinh kem (chua xoa mem) cua bien ban, sap xep theo uploadedAt DESC.',
  })
  @ApiResponse({
    status: HttpStatus.OK,
    description: 'Danh sach tai lieu dinh kem',
  })
  @ApiResponse({ status: HttpStatus.UNAUTHORIZED, description: 'Unauthorized' })
  @ApiResponse({
    status: HttpStatus.FORBIDDEN,
    description: 'FORBIDDEN / NOT_MINUTES_OWNER',
  })
  @ApiResponse({
    status: HttpStatus.NOT_FOUND,
    description: 'MINUTES_NOT_FOUND',
  })
  async listAttachments(
    @Param('minutesId', ParseUUIDPipe) minutesId: string,
    @CurrentUser() user: { userId: string },
  ): Promise<{
    success: boolean;
    message: string;
    data: MinutesAttachmentResponseDto[];
    meta: { total: number; maxCount: number };
  }> {
    const result = await this.minutesService.listAttachments(minutesId, {
      userId: user.userId,
    });
    return {
      success: true,
      message: 'Danh sach tai lieu dinh kem',
      data: result.items,
      meta: { total: result.total, maxCount: result.maxCount },
    };
  }

  // ── Attachment: Delete ──
  @Delete(':minutesId/attachments/:fileId')
  @HttpCode(HttpStatus.OK)
  @UseGuards(JwtAuthGuard, PermissionsGuard)
  @RequirePermissions('meeting.minutes.attachment.delete')
  @ApiTags('Minutes')
  @ApiBearerAuth()
  @ApiOperation({
    summary: 'Go tai lieu dinh kem khoi bien ban',
    description:
      'Soft-delete file dinh kem. Chi Host (preparedBy) duoc thuc hien, chi khi bien ban o trang thai draft.',
  })
  @ApiResponse({
    status: HttpStatus.OK,
    description: 'Da go tai lieu dinh kem',
  })
  @ApiResponse({ status: HttpStatus.UNAUTHORIZED, description: 'Unauthorized' })
  @ApiResponse({
    status: HttpStatus.FORBIDDEN,
    description: 'FORBIDDEN / NOT_MINUTES_OWNER',
  })
  @ApiResponse({
    status: HttpStatus.NOT_FOUND,
    description: 'MINUTES_NOT_FOUND / ATTACHMENT_NOT_FOUND',
  })
  @ApiResponse({
    status: HttpStatus.CONFLICT,
    description: 'MINUTES_NOT_DRAFT',
  })
  async deleteAttachment(
    @Param('minutesId', ParseUUIDPipe) minutesId: string,
    @Param('fileId', ParseUUIDPipe) fileId: string,
    @CurrentUser() user: { userId: string },
  ): Promise<{
    success: boolean;
    message: string;
    data: { fileId: string; deletedAt: Date };
  }> {
    const data = await this.minutesService.removeAttachment(minutesId, fileId, {
      userId: user.userId,
    });
    return {
      success: true,
      message: 'Da go tai lieu dinh kem',
      data,
    };
  }
}
