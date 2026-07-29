import {
  Controller,
  Get,
  Query,
  UseGuards,
  UsePipes,
  ValidationPipe,
} from '@nestjs/common';
import { JwtAuthGuard } from '../../auth/guards/jwt-auth.guard.js';
import { PermissionsGuard } from '../../auth/guards/permissions.guard.js';
import { RequirePermissions } from '../../auth/decorators/require-permissions.decorator.js';
import { UserJourneyService } from '../services/user-journey.service.js';
import { UserJourneyQueryDto } from '../dto/user-journey-query.dto.js';

/**
 * UserJourneyController (UJN-001) — GET /campus/user-journey?userId=&date=
 *
 * Hành trình khuôn viên của 1 người trong 1 ngày, ghép 3 kiểu nguồn (cổng/họp/khu vực).
 * READ-ONLY, admin-gated.
 *
 * ⚠ PERMISSION: dùng `zones.gate_log.read` — đã kiểm `role_permissions` trên DB thật:
 * quyền này TỒN TẠI và được cấp cho BUSINESS_ADMIN + MANAGER + SYSTEM_ADMIN.
 * KHÔNG dùng `gate_access.history.read_all`/`gate_access.stats.read`: tuy có migration
 * seed (20260723000002/3) nhưng CHƯA có trong DB đang kiểm ⇒ rủi ro 403 nếu môi trường
 * đích cũng chưa chạy 2 migration đó. Không bịa quyền mới ⇒ không cần migration kèm.
 */
@Controller('campus')
export class UserJourneyController {
  constructor(private readonly userJourneyService: UserJourneyService) {}

  @Get('user-journey')
  @UseGuards(JwtAuthGuard, PermissionsGuard)
  @RequirePermissions('zones.gate_log.read')
  @UsePipes(new ValidationPipe({ whitelist: true, transform: true }))
  async userJourney(@Query() query: UserJourneyQueryDto) {
    const data = await this.userJourneyService.getUserJourney(
      query.userId,
      query.date,
    );
    return { success: true, message: 'User journey retrieved', data };
  }
}
