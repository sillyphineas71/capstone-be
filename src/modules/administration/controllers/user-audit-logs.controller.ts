import {
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  ParseUUIDPipe,
  Query,
  UseGuards,
} from '@nestjs/common';
import {
  ApiBearerAuth,
  ApiOperation,
  ApiParam,
  ApiResponse,
  ApiTags,
} from '@nestjs/swagger';
import { JwtAuthGuard } from '../../auth/guards/jwt-auth.guard.js';
import { PermissionsGuard } from '../../auth/guards/permissions.guard.js';
import { RequirePermissions } from '../../auth/decorators/require-permissions.decorator.js';
import { UserAuditLogQueryService } from '../services/user-audit-log-query.service.js';
import { QueryUserAuditLogsDto } from '../dto/query-user-audit-logs.dto.js';
import { UserAuditLogListResponseDto } from '../dto/user-audit-log-response.dto.js';

/**
 * UserAuditLogsController — lịch sử hoạt động của MỘT user với tư cách ĐỐI TƯỢNG
 * bị tác động (be-user-activity-log-requirement.md — Option B).
 *
 * Route: GET /api/v1/users/:userId/audit-logs
 * Permission: audit.users.read (seed cho cả BUSINESS_ADMIN và SYSTEM_ADMIN —
 * PermissionsGuard yêu cầu ALL nên không dùng OR; thay vào đó cấp cùng 1 quyền
 * cho cả hai role qua migration).
 *
 * Read-only tuyệt đối: không PATCH/PUT/DELETE, không ghi thêm audit log.
 */
@ApiTags('Audit Logs')
@Controller('users/:userId/audit-logs')
@UseGuards(JwtAuthGuard, PermissionsGuard)
@RequirePermissions('audit.users.read')
@ApiBearerAuth()
export class UserAuditLogsController {
  constructor(
    private readonly userAuditLogQueryService: UserAuditLogQueryService,
  ) {}

  @Get()
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'Lịch sử hoạt động của một tài khoản (đối tượng bị tác động)',
    description:
      'Trả về danh sách phân trang các log mà user này là ĐỐI TƯỢNG bị tác động ' +
      '(entity_type=users AND entity_id=userId), sắp xếp created_at DESC. ' +
      'Yêu cầu quyền audit.users.read.',
  })
  @ApiParam({ name: 'userId', description: 'UUID của user cần xem lịch sử' })
  @ApiResponse({
    status: HttpStatus.OK,
    description: 'Danh sách lịch sử hoạt động phân trang',
    type: UserAuditLogListResponseDto,
  })
  @ApiResponse({
    status: 400,
    description: 'VALIDATION_ERROR — userId không hợp lệ',
  })
  @ApiResponse({ status: 401, description: 'Unauthorized — chưa đăng nhập' })
  @ApiResponse({
    status: 403,
    description: 'PERMISSION_DENIED — thiếu quyền audit.users.read',
  })
  async listUserAuditLogs(
    @Param('userId', ParseUUIDPipe) userId: string,
    @Query() query: QueryUserAuditLogsDto,
  ): Promise<{
    success: boolean;
    data: UserAuditLogListResponseDto['data'];
    meta: UserAuditLogListResponseDto['meta'];
  }> {
    const result = await this.userAuditLogQueryService.listUserAuditLogs(
      userId,
      query,
    );
    return { success: true, data: result.data, meta: result.meta };
  }
}
