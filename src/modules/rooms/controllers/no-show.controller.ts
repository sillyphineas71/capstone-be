import {
  BadRequestException,
  Controller,
  Get,
  Post,
  Patch,
  Body,
  Param,
  Query,
  Req,
  Res,
  HttpCode,
  Logger,
  UseGuards,
  UsePipes,
  ValidationPipe,
  ParseUUIDPipe,
} from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import type { Response } from 'express';
import { NoShowService } from '../services/no-show.service.js';
import { NoShowDetectionService } from '../services/no-show-detection.service.js';
import { NoShowLifecycleService } from '../services/no-show-lifecycle.service.js';
import { CreateNoShowDto } from '../dto/create-no-show.dto.js';
import { UpdateNoShowDto } from '../dto/update-no-show.dto.js';
import { ReleaseNoShowDto } from '../dto/release-no-show.dto.js';
import { ListNoShowCasesQueryDto } from '../dto/list-no-show-cases-query.dto.js';
import { InternalTokenGuard } from '../guards/internal-token.guard.js';
import { JwtAuthGuard } from '../../auth/guards/jwt-auth.guard.js';
import { PermissionsGuard } from '../../auth/guards/permissions.guard.js';
import { RequirePermissions } from '../../auth/decorators/require-permissions.decorator.js';

@ApiTags('Rooms - No-Show')
@Controller()
export class NoShowController {
  private readonly logger = new Logger(NoShowController.name);

  constructor(
    private readonly noShowService: NoShowService,
    private readonly noShowDetectionService: NoShowDetectionService,
    private readonly noShowLifecycleService: NoShowLifecycleService,
  ) {}

  // UC-41 (internal): tạo no-show case (token-gated, idempotent → 201/200).
  //
  // [FIX 2026-08-21, Việc A — gap vá] Endpoint này (spec gốc: "gọi bởi cron/camera-service")
  // là đường tạo case THỨ HAI, độc lập với `NoShowDetectionService.detect()` — nhận thẳng
  // `roomId` từ request body. Việc A (2026-08-21) ban đầu chỉ chặn ở `detect()`, bỏ sót
  // đường này nên phòng KHÔNG có camera vẫn tạo case được nếu có request POST thẳng vào
  // đây (case B302 thật, xem no-show-detection.service.ts header). Vá: tái dùng ĐÚNG
  // `NoShowDetectionService.getCameraRoomIds()` (1 nguồn sự thật DUY NHẤT, không viết lại
  // logic) — fail-closed CẢ khi đọc map lỗi (throw tự nhiên → 500, KHÔNG âm thầm cho qua),
  // mirror đúng triết lý fail-safe/fail-closed đã có ở `detect()`.
  @Post('internal/no-show-cases')
  @UseGuards(InternalTokenGuard)
  @UsePipes(new ValidationPipe({ whitelist: true, transform: true }))
  @ApiOperation({
    summary:
      '[NỘI BỘ — token-gated, gọi bởi job phát hiện no-show, không phải endpoint public] Tạo mới 1 case no-show (idempotent — trả 201 nếu tạo mới, 200 nếu đã tồn tại)',
  })
  async createInternal(
    @Body() dto: CreateNoShowDto,
    @Res({ passthrough: true }) res: Response,
  ) {
    // [DEBUG TẠM 2026-08-22 — gỡ cùng đợt với log ở detect(), KHÔNG đổi hành vi nghiệp vụ]
    // In toàn bộ dto NGAY LÚC request tới, trước khi làm bất cứ gì.
    this.logger.debug(
      `[DEBUG createInternal] Request đến lúc ${new Date().toISOString()} — dto=${JSON.stringify(dto)}`,
    );

    const cameraRoomIds = await this.noShowDetectionService.getCameraRoomIds();
    const roomHasCamera = cameraRoomIds.includes(dto.roomId);

    // [DEBUG TẠM 2026-08-22 — gỡ cùng đợt với log ở detect(), KHÔNG đổi hành vi nghiệp vụ]
    // In cameraRoomIds thật + kết quả includes() — TRƯỚC khi quyết định chặn hay cho qua.
    this.logger.debug(
      `[DEBUG createInternal] cameraRoomIds(len=${cameraRoomIds.length})=${JSON.stringify(cameraRoomIds)} | dto.roomId=${dto.roomId} | roomHasCamera=${roomHasCamera}`,
    );

    if (!roomHasCamera) {
      // [DEBUG TẠM 2026-08-22 — gỡ cùng đợt với log ở detect(), KHÔNG đổi hành vi nghiệp vụ]
      // Log NGAY TRƯỚC throw — xác nhận log này CÓ chạy (không bị exception filter nuốt).
      this.logger.debug(
        `[DEBUG createInternal] CHẶN 400 ROOM_HAS_NO_CAMERA cho roomId=${dto.roomId} — KHÔNG tạo case.`,
      );
      throw new BadRequestException({
        code: 'ROOM_HAS_NO_CAMERA',
        message:
          'Room has no camera mapped (ivss.channel_room_map); no-show detection is not applicable for this room.',
      });
    }

    // [DEBUG TẠM 2026-08-22 — gỡ cùng đợt với log ở detect(), KHÔNG đổi hành vi nghiệp vụ]
    // Log NGAY TRƯỚC khi gọi create() (ghi INSERT thật) — đường này KHÔNG bị chặn.
    this.logger.debug(
      `[DEBUG createInternal] LỌT QUA gate — chuẩn bị gọi noShowService.create() cho roomId=${dto.roomId} bookingId=${dto.bookingId}`,
    );
    const { case: c, created } = await this.noShowService.create(dto);
    res.status(created ? 201 : 200);
    return {
      success: true,
      message: created ? 'No-show case created' : 'No-show case already exists',
      data: {
        noShowCaseId: c.id,
        bookingId: c.booking_id,
        detectionStatus: c.detection_status,
        detectedAt: c.detected_at,
      },
    };
  }

  // GET list no-show cases (bảng giám sát phòng) — phân trang + lọc status/roomId.
  @Get('no-show-cases')
  @UseGuards(JwtAuthGuard, PermissionsGuard)
  @RequirePermissions('room.noshow.read')
  @UsePipes(new ValidationPipe({ whitelist: true, transform: true }))
  @ApiOperation({
    summary:
      'Xem danh sách case no-show (bảng giám sát phòng), có phân trang + lọc theo trạng thái/phòng',
  })
  async list(@Query() query: ListNoShowCasesQueryDto) {
    const { items, meta } = await this.noShowService.list(query);
    return {
      success: true,
      message: 'No-show cases retrieved successfully',
      data: items,
      meta,
    };
  }

  // UC-42: cập nhật no-show case (user).
  // [FIX 2026-08-09, Phần 5 — R5.1] KHÔNG dùng PermissionsGuard/@RequirePermissions ở
  // route này (khác mọi route khác trong controller) — authorization đã chuyển vào
  // NoShowService.update()/snooze() để có đủ context (dto.detectionStatus + meeting
  // ownership) cho host/organizer tự dismiss/snooze case CỦA CHÍNH MÌNH mà không cần
  // quyền admin rộng. Guard dùng chung KHÔNG bị đụng, mọi route khác vẫn y hệt trước.
  //
  // [Việc B, tái đánh giá 2026-08-21] `detectionStatus:'snoozed'` ("Tôi vẫn đến") tách
  // riêng qua `NoShowService.snooze()` (KHÔNG qua update() — state machine khác hẳn:
  // không terminal, atomic + idempotent) — 'dismissed' ("Bỏ qua" tay của admin) VẪN đi
  // update() y hệt cũ, KHÔNG đổi.
  @Patch('no-show-cases/:id')
  @HttpCode(200)
  @UseGuards(JwtAuthGuard)
  @UsePipes(new ValidationPipe({ whitelist: true, transform: true }))
  @ApiOperation({
    summary:
      'Cập nhật 1 case no-show (user xử lý) — host/organizer được tự dismiss/snooze case của cuộc họp mình, còn lại cần quyền room.noshow.update',
  })
  async update(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdateNoShowDto,
    @Req() req: any,
  ) {
    const userId = req.user?.userId || req.user?.sub || req.user?.id || null;
    if (dto.detectionStatus === 'snoozed') {
      const data = await this.noShowService.snooze(id, userId, dto.note);
      return {
        success: true,
        message: 'No-show case snoozed',
        data,
      };
    }
    const data = await this.noShowService.update(id, dto, userId);
    return {
      success: true,
      message: 'No-show case updated',
      data,
    };
  }

  // UC-45 (#33b): admin giải phóng phòng thủ công cho no-show case.
  // Mã trả (A): 404 not-found · 400 dismissed/resolved · 200 released/no-op · 409 booking_changed.
  @Post('no-show-cases/:id/release')
  @HttpCode(200)
  @UseGuards(JwtAuthGuard, PermissionsGuard)
  @RequirePermissions('room.noshow.release')
  @UsePipes(new ValidationPipe({ whitelist: true, transform: true }))
  @ApiOperation({
    summary: 'Admin giải phóng phòng thủ công cho 1 case no-show',
  })
  async release(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: ReleaseNoShowDto,
    @Req() req: any,
  ) {
    const userId = req.user?.userId || req.user?.sub || req.user?.id || null;
    const data = await this.noShowLifecycleService.manualRelease(
      id,
      dto.reason,
      userId,
    );
    return {
      success: true,
      message: 'No-show case released',
      data,
    };
  }
}
