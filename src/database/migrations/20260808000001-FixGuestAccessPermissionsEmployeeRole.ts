import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Gap fix 2026-08-08 (feat-external-guest-live-meeting-access, GLA-001).
 *
 * Migration goc 20260807000003-SeedGuestAccessPermissions.ts seed quyen cho
 * role code `INTERNAL_USER` (cung MANAGER/BUSINESS_ADMIN/SYSTEM_ADMIN). Nhung
 * `INTERNAL_USER` KHONG ton tai trong DB that (roles that: BUSINESS_ADMIN,
 * EMPLOYEE, MANAGER, SYSTEM_ADMIN — cung mot loi da tung fix o
 * 20260711000001-SeedRecordingUploadTrackEmployeeRole.ts va
 * 20260717000001-FixMinutesAttachmentEmployeeRole.ts). INSERT...SELECT
 * WHERE role_code = 'INTERNAL_USER' khong match role nao nen am tham khong
 * lam gi — Host la nhan vien thuong (role EMPLOYEE, actor chinh tao/chu tri
 * cuoc hop) chua bao gio co 3 quyen meeting.guest.* du la actor duoc spec.md
 * liet ke ro (FR-GLA-*).
 *
 * Phat hien khi test thuc te: user role EMPLOYEE la host cuoc hop nhung goi
 * GET /live-meetings/:id/guests bi 403 FORBIDDEN, xac nhan qua GET /auth/me
 * permissions[] khong co bat ky quyen guest.* nao.
 */
export class FixGuestAccessPermissionsEmployeeRole20260808000001
  implements MigrationInterface
{
  name = 'FixGuestAccessPermissionsEmployeeRole20260808000001';

  private readonly permissionCodes = [
    'meeting.guest.invite.manage',
    'meeting.guest.session.read',
    'meeting.guest.admit',
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
