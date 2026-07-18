import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Gap fix 2026-07-17 (feat-view-minutes-attachment-detail, UC-140).
 *
 * UC-140 dùng chung endpoint GET /media-files/:fileId (UC-121), yêu cầu
 * permission `recording.files.read`. Theo seed
 * 20260704000002-SeedCameraDomainRbacPermissions.ts, permission này chỉ được
 * cấp cho SYSTEM_ADMIN, MANAGER, EMPLOYEE — thiếu BUSINESS_ADMIN, dù đặc tả
 * UC-139/UC-140 liệt kê Business Admin là Primary Actor. Business Admin xem
 * được danh sách đính kèm (meeting.minutes.attachment.read) nhưng KHÔNG mở
 * được chi tiết/tải file (thiếu recording.files.read) — bất nhất quyền hạn.
 */
export class SeedRecordingFilesReadBusinessAdmin20260717000002
  implements MigrationInterface
{
  name = 'SeedRecordingFilesReadBusinessAdmin20260717000002';

  private readonly permissionCode = 'recording.files.read';
  private readonly roleCode = 'BUSINESS_ADMIN';

  public async up(queryRunner: QueryRunner): Promise<void> {
    const permissionRows: Array<{ id: string }> = await queryRunner.query(
      'SELECT id FROM permissions WHERE permission_code = $1',
      [this.permissionCode],
    );
    const permissionId = permissionRows[0]?.id;
    if (!permissionId) return;

    await queryRunner.query(
      `INSERT INTO role_permissions (role_id, permission_id, granted_at)
       SELECT r.id, $2, NOW()
       FROM roles r
       WHERE r.role_code = $1 AND r.is_active = true
       ON CONFLICT (role_id, permission_id) DO NOTHING;`,
      [this.roleCode, permissionId],
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `DELETE FROM role_permissions
       WHERE permission_id IN (SELECT id FROM permissions WHERE permission_code = $1)
         AND role_id IN (SELECT id FROM roles WHERE role_code = $2);`,
      [this.permissionCode, this.roleCode],
    );
  }
}
