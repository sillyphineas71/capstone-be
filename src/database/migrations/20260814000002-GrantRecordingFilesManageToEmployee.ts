import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Grant recording.files.manage to EMPLOYEE role.
 * Allows Employee who is Host of a meeting to hide/soft-delete media files of their meeting.
 * Ownership check is handled in MediaFilesService layer.
 */
export class GrantRecordingFilesManageToEmployee20260814000002 implements MigrationInterface {
  name = 'GrantRecordingFilesManageToEmployee20260814000002';

  private readonly grants: Array<{ role: string; permission: string }> = [
    { role: 'EMPLOYEE', permission: 'recording.files.manage' },
  ];

  public async up(queryRunner: QueryRunner): Promise<void> {
    for (const { role, permission } of this.grants) {
      await queryRunner.query(
        `INSERT INTO role_permissions (role_id, permission_id, granted_at)
         SELECT r.id, p.id, NOW()
         FROM roles r, permissions p
         WHERE r.role_code = $1 AND r.is_active = true AND p.permission_code = $2
         ON CONFLICT (role_id, permission_id) DO NOTHING;`,
        [role, permission],
      );
    }
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    for (const { role, permission } of this.grants) {
      await queryRunner.query(
        `DELETE FROM role_permissions
         WHERE role_id IN (SELECT id FROM roles WHERE role_code = $1)
           AND permission_id IN (SELECT id FROM permissions WHERE permission_code = $2);`,
        [role, permission],
      );
    }
  }
}
