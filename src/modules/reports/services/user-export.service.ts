import { Injectable, Logger } from '@nestjs/common';
import { AuditLogsService } from '../../administration/services/audit-logs.service.js';
import { ExportUsersQueryDto } from '../../accounts/dto/export-users-query.dto.js';
import { UserExportDataService } from './user-export-data.service.js';
import { renderUserExportXlsx } from '../renderers/user-export-xlsx-renderer.js';

function pad(n: number): string {
  return n.toString().padStart(2, '0');
}

function buildExportFileName(now: Date): string {
  const stamp =
    `${now.getFullYear()}${pad(now.getMonth() + 1)}${pad(now.getDate())}` +
    `-${pad(now.getHours())}${pad(now.getMinutes())}${pad(now.getSeconds())}`;
  return `danh-sach-nguoi-dung-${stamp}.xlsx`;
}

/**
 * UserExportService (BE-04) — `GET /users/export` → 200, trả thẳng file XLSX.
 *
 * [Quyết định 2026-07-27 của Hải, PLAN_PHAN_HOI_TAI_2026-07-27.md mục 3] Đổi từ
 * background job + poll (202 {jobId}) sang render đồng bộ, trả file trực tiếp trong
 * response. Lý do: Nam (FE) là nút thắt cho việc sửa `UserManagement.jsx` để nhận
 * {jobId} rồi poll `GET /background-jobs/:id` — luồng poll nặng không cần thiết cho
 * một thao tác vốn đã nhanh (≤10.000 dòng, xem MAX_EXPORT_ROWS ở
 * `UserExportDataService`). FE (`request.js`) vẫn cần nhánh `responseType: 'blob'` như
 * cách `sysAdminServices.js`/`businessAdminServices.js` đang gọi — đây không phải "FE
 * khỏi sửa", Hải tự đính chính điểm này.
 *
 * KHÔNG dùng `BackgroundJobsService`/`QueueService` — không còn job nào được tạo cho
 * luồng export user. Hạ tầng job dùng chung của 5 report khác (meeting-activity,
 * room-utilization, gate-access, vehicle, security-alert) không bị đụng tới.
 */
@Injectable()
export class UserExportService {
  private readonly logger = new Logger(UserExportService.name);

  constructor(
    private readonly userExportDataService: UserExportDataService,
    private readonly auditLogsService: AuditLogsService,
  ) {}

  async exportUsersXlsx(
    currentUser: { userId: string; email: string },
    dto: ExportUsersQueryDto,
  ): Promise<{ buffer: Buffer; fileName: string }> {
    const filter = {
      search: dto.search,
      departmentId: dto.departmentId,
      roleId: dto.roleId,
      locked: dto.locked,
    };

    const rows = await this.userExportDataService.listUsersForExport(filter);

    const now = new Date();
    const buffer = await renderUserExportXlsx(rows, {
      generatedAt: now,
      extractedByEmail: currentUser.email,
    });
    const fileName = buildExportFileName(now);

    this.auditLogsService
      .logAction({
        userId: currentUser.userId,
        actionType: 'export_users',
        entityType: 'users',
        metadataJson: { filter, rowCount: rows.length },
      })
      .catch((err) =>
        this.logger.warn(
          `Audit log write failed: ${err instanceof Error ? err.message : String(err)}`,
        ),
      );

    return { buffer, fileName };
  }
}
