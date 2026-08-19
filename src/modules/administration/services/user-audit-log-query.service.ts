import {
  Injectable,
  InternalServerErrorException,
  Logger,
} from '@nestjs/common';
import {
  AuditLogQueryRepository,
  UserAuditLogRow,
} from '../repositories/audit-log-query.repository.js';
import { QueryUserAuditLogsDto } from '../dto/query-user-audit-logs.dto.js';
import {
  UserAuditLogItemDto,
  UserAuditLogListResponseDto,
} from '../dto/user-audit-log-response.dto.js';

/**
 * Ánh xạ mã hành động THẬT của BE (users.service.ts) sang mô tả tiếng Việt.
 *
 * Lưu ý: đây là `description` do server sinh, ĐỘC LẬP với việc FE tự map mã
 * `action` thô sang nhãn hiển thị (quyết định 13/08/2026 — FE giữ bảng map
 * riêng). Key so khớp không phân biệt hoa/thường.
 */
const USER_ACTION_VN_MAP: Record<string, string> = {
  ACCOUNT_CREATE: 'Thêm tài khoản',
  'ACCOUNT.PARTNER.CREATE': 'Tạo tài khoản đối tác',
  ACCOUNT_UPDATE: 'Cập nhật tài khoản',
  ACCOUNT_LOCK: 'Khóa tài khoản',
  ACCOUNT_UNLOCK: 'Mở khóa tài khoản',
  ACCOUNT_DELETE: 'Xóa tài khoản',
  ACCOUNT_ROLE_UPDATE: 'Cập nhật vai trò',
  ACCOUNT_STATUS_UPDATE: 'Cập nhật trạng thái tài khoản',
  'ACCOUNT.PARTNER.EXTEND': 'Gia hạn tài khoản đối tác',
  VIEW_DETAIL: 'Xem chi tiết tài khoản',
};

/**
 * UserAuditLogQueryService — orchestrator ĐỌC cho GET /users/:userId/audit-logs.
 *
 * Chỉ ĐỌC: KHÔNG gọi logAction()/logEntityChange() (giống AuditLogQueryService).
 */
@Injectable()
export class UserAuditLogQueryService {
  private readonly logger = new Logger(UserAuditLogQueryService.name);

  constructor(
    private readonly auditLogQueryRepository: AuditLogQueryRepository,
  ) {}

  async listUserAuditLogs(
    targetUserId: string,
    query: QueryUserAuditLogsDto,
  ): Promise<UserAuditLogListResponseDto> {
    try {
      const page = query.page ?? 1;
      const limit = query.limit ?? 10;

      const [rows, total] = await Promise.all([
        this.auditLogQueryRepository.findUserAuditLogs(
          targetUserId,
          page,
          limit,
        ),
        this.auditLogQueryRepository.countUserAuditLogs(targetUserId),
      ]);

      const data = rows.map((row) => this.mapRow(row));

      return {
        data,
        meta: {
          page,
          limit,
          total,
          totalPages: limit > 0 ? Math.ceil(total / limit) : 0,
        },
      };
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Unknown error';
      this.logger.error(`[UserAuditLogQuery] Unexpected error: ${message}`);
      throw new InternalServerErrorException({ code: 'INTERNAL_ERROR' });
    }
  }

  /** Map row DB giàu field → item response cho FE. */
  private mapRow(row: UserAuditLogRow): UserAuditLogItemDto {
    const actorName =
      row.user_id === null ? 'Hệ thống' : (row.user_full_name ?? 'Hệ thống');

    return {
      id: row.id,
      timestamp: row.created_at,
      actorName,
      actorEmail: row.user_email ?? null,
      action: row.action_type,
      entity: row.entity_type,
      status: this.deriveStatus(row.severity),
      description: this.deriveDescription(row.action_type),
      ipAddress: row.ip_address ?? null,
      // Ưu tiên giá trị mới, rồi metadata, cuối cùng snapshot cũ.
      payload:
        row.new_value_json ?? row.metadata_json ?? row.old_value_json ?? null,
    };
  }

  /**
   * status = 'failed' khi severity là error/critical; ngược lại 'success'.
   * (Bảng audit_logs không có cột status riêng — suy ra từ severity.)
   */
  private deriveStatus(severity: string): 'success' | 'failed' {
    const s = (severity ?? '').toLowerCase();
    return s === 'error' || s === 'critical' ? 'failed' : 'success';
  }

  /** Sinh mô tả tiếng Việt từ mã hành động; fallback về chính mã thô. */
  private deriveDescription(actionType: string): string {
    return USER_ACTION_VN_MAP[actionType.toUpperCase()] ?? actionType;
  }
}
