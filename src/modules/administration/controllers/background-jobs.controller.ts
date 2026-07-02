import {
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  ParseUUIDPipe,
  UseGuards,
} from '@nestjs/common';
import {
  ApiBearerAuth,
  ApiOperation,
  ApiResponse,
  ApiTags,
} from '@nestjs/swagger';

import { JwtAuthGuard } from '../../auth/guards/jwt-auth.guard.js';
import { CurrentUser } from '../../auth/decorators/current-user.decorator.js';
import { BackgroundJobsService } from '../services/background-jobs.service.js';
import { BackgroundJobStatusResponseDto } from '../dto/background-job-status-response.dto.js';

/**
 * BackgroundJobsController — endpoint dùng chung để client poll trạng thái
 * mọi background job async (transcription, export report, import...).
 *
 * Route `GET /api/v1/background-jobs/:id` đúng theo CLAUDE.md mục 22.13 +
 * contract `transcription-api.md` ("Background Job Status — reuse, không tạo
 * route mới"). Đây là chỗ implement T007 — trước đây entity/service đã có
 * nhưng CHƯA có controller nào expose ra HTTP, nên quickstart Step 7 trỏ vào
 * 1 endpoint không tồn tại (gap đã ghi nhận).
 *
 * Chỉ dùng JwtAuthGuard, KHÔNG dùng PermissionsGuard: không có permission node
 * `background_job.*` nào được seed; authorization owner/admin xử lý trong
 * service (xem BackgroundJobsService.getJobStatusForUser).
 */
@ApiTags('Background Jobs')
@Controller('background-jobs')
export class BackgroundJobsController {
  constructor(private readonly backgroundJobsService: BackgroundJobsService) {}

  @Get(':id')
  @HttpCode(HttpStatus.OK)
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Poll trạng thái 1 background job theo jobId' })
  @ApiResponse({
    status: HttpStatus.OK,
    description: 'Trạng thái job',
    type: BackgroundJobStatusResponseDto,
  })
  @ApiResponse({ status: 401, description: 'Unauthorized' })
  @ApiResponse({
    status: 403,
    description: 'Forbidden — không phải owner/admin',
  })
  @ApiResponse({ status: 404, description: 'Background job không tồn tại' })
  async getStatus(
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentUser() user: { userId: string },
  ): Promise<{ success: boolean; data: BackgroundJobStatusResponseDto }> {
    const data = await this.backgroundJobsService.getJobStatusForUser(
      id,
      user.userId,
    );
    return { success: true, data };
  }
}
