import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Gap fix 2026-07-17 (feat-view-minutes-attachment-detail, UC-140).
 *
 * Các migration gốc sau đây seed quyền cho role code `INTERNAL_USER`:
 * - 20260702010000 (meeting.minutes.read)
 * - 20260702020000 (meeting.minutes.attachment.create/read/delete)
 *
 * Nhưng `INTERNAL_USER` KHÔNG tồn tại trong DB thật (roles thật: BUSINESS_ADMIN,
 * EMPLOYEE, MANAGER, SYSTEM_ADMIN — xem tiền lệ đã fix tại migration
 * 20260711000001-SeedRecordingUploadTrackEmployeeRole.ts). INSERT...SELECT
 * không match role nào nên âm thầm không làm gì — Host/Participant (role
 * EMPLOYEE) chưa từng có quyền xem danh sách biên bản lẫn tài liệu đính kèm,
 * dù đó là actor chính trong đặc tả UC-MKM-02/UC-139/UC-140.
 *
 * Phát hiện khi build tính năng "Xem chi tiết tệp đính kèm" (UC-140) và kiểm
 * tra role EMPLOYEE không gọi được GET /meeting-minutes.
 */
export class FixMinutesAttachmentEmployeeRole20260717000001
  implements MigrationInterface
{
  name = 'FixMinutesAttachmentEmployeeRole20260717000001';

  private readonly permissionCodes = [
    'meeting.minutes.read',
    'meeting.minutes.attachment.create',
    'meeting.minutes.attachment.read',
    'meeting.minutes.attachment.delete',
  ];

  private readonly roleCode = 'EMPLOYEE';

  public async up(queryRunner: QueryRunner): Promise<void> {
    for (const permissionCode of this.permissionCodes) {
      const permissionRows: Array<{ id: string }> = await queryRunner.query(
        'SELECT id FROM permissions WHERE permission_code = $1',
        [permissionCode],
      );
      const permissionId = permissionRows[0]?.id;
      if (!permissionId) continue;

      await queryRunner.query(
        `INSERT INTO role_permissions (role_id, permission_id, granted_at)
         SELECT r.id, $2, NOW()
         FROM roles r
         WHERE r.role_code = $1 AND r.is_active = true
         ON CONFLICT (role_id, permission_id) DO NOTHING;`,
        [this.roleCode, permissionId],
      );
    }
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    for (const permissionCode of this.permissionCodes) {
      await queryRunner.query(
        `DELETE FROM role_permissions
         WHERE permission_id IN (SELECT id FROM permissions WHERE permission_code = $1)
           AND role_id IN (SELECT id FROM roles WHERE role_code = $2);`,
        [permissionCode, this.roleCode],
      );
    }
  }
}
