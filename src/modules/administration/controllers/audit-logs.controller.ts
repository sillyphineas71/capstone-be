import {
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Query,
  UseGuards,
} from '@nestjs/common';
import {
  ApiBearerAuth,
  ApiOperation,
  ApiResponse,
  ApiTags,
} from '@nestjs/swagger';
import { JwtAuthGuard } from '../../auth/guards/jwt-auth.guard.js';
import { PermissionsGuard } from '../../auth/guards/permissions.guard.js';
import { RequirePermissions } from '../../auth/decorators/require-permissions.decorator.js';
import { AuditLogQueryService } from '../services/audit-log-query.service.js';
import { QueryAuditLogsDto } from '../dto/query-audit-logs.dto.js';
import { AuditLogListResponseDto } from '../dto/audit-log-response.dto.js';

/**
 * AuditLogsController — endpoint xem nhật ký kiểm tra hệ thống (UC-AA-11).
 *
 * Route: GET /api/v1/audit-logs
 * Permission: audit.system.read (chỉ SYSTEM_ADMIN)
 *
 * KHÔNG gọi AuditLogsService.logAction()/logSecurityEvent()/logEntityChange()
 * ở bất kỳ đâu trong controller này (§0.10 spec.md).
 *
 * Read-only tuyệt đối: không có PATCH/PUT/DELETE.
 */
@ApiTags('Audit Logs')
@Controller('audit-logs')
@UseGuards(JwtAuthGuard, PermissionsGuard)
@RequirePermissions('audit.system.read')
@ApiBearerAuth()
export class AuditLogsController {
  constructor(private readonly auditLogQueryService: AuditLogQueryService) {}

  /**
   * T009 + T020: GET /api/v1/audit-logs
   * Danh sách phân trang audit logs với bộ lọc tùy chọn.
   */
  @Get()
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'Xem danh sách nhật ký kiểm tra hệ thống (UC-AA-11)',
    description:
      'Trả về danh sách phân trang audit logs sắp xếp theo created_at DESC. ' +
      'Chỉ SYSTEM_ADMIN mới có quyền truy cập (permission: audit.system.read). ' +
      'Read-only tuyệt đối — không ghi thêm audit log cho hành động xem này.',
  })
  @ApiResponse({
    status: HttpStatus.OK,
    description: 'Danh sách audit logs phân trang',
    type: AuditLogListResponseDto,
  })
  @ApiResponse({
    status: 400,
    description: 'VALIDATION_ERROR — tham số không hợp lệ (e.g. from > to)',
  })
  @ApiResponse({ status: 401, description: 'Unauthorized — chưa đăng nhập' })
  @ApiResponse({
    status: 403,
    description: 'PERMISSION_DENIED — thiếu quyền audit.system.read',
  })
  @ApiResponse({
    status: 500,
    description: 'INTERNAL_ERROR — lỗi máy chủ không lường trước',
  })
  async listAuditLogs(
    @Query() query: QueryAuditLogsDto,
  ): Promise<{ success: boolean; data: AuditLogItemType[]; meta: MetaType }> {
    const result = await this.auditLogQueryService.listAuditLogs(query);
    return {
      success: true,
      data: result.data,
      meta: result.meta,
    };
  }
}

// Type aliases để tránh import thừa trong return type
type AuditLogItemType = AuditLogListResponseDto['data'][number];
type MetaType = AuditLogListResponseDto['meta'];
