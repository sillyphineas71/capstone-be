import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Seed permission meeting.minutes.export (UC-147, feat-export-meeting-minutes).
 * Mirror pattern 20260702030000-SeedMeetingMinutesIssuePermission.ts.
 * Cap cho INTERNAL_USER, MANAGER, BUSINESS_ADMIN, SYSTEM_ADMIN (theo cot System
 * Role cua UC-147). So huu permission la dieu kien can; service con kiem tra
 * ownership (preparedBy/hostId) / Admin bypass.
 */
export class SeedMeetingMinutesExportPermission20260717100002
  implements MigrationInterface
{
  name = 'SeedMeetingMinutesExportPermission20260717100002';

  private readonly permission = {
    code: 'meeting.minutes.export',
    name: 'Xuat bien ban cuoc hop',
    action: 'minutes.export',
    description:
      'Cho phep tao job xuat bien ban da published ra file PDF/Word va tai qua background job',
  };

  private readonly roles = [
    'INTERNAL_USER',
    'MANAGER',
    'BUSINESS_ADMIN',
    'SYSTEM_ADMIN',
  ];

  public async up(queryRunner: QueryRunner): Promise<void> {
    const p = this.permission;
    const inserted: Array<{ id: string }> = await queryRunner.query(
      'INSERT INTO permissions (permission_code, permission_name, module_code, action_code, description, is_active) VALUES ($1, $2, $3, $4, $5, true) ON CONFLICT (permission_code) DO NOTHING RETURNING id;',
      [p.code, p.name, 'minutes', p.action, p.description],
    );
    let permissionId = inserted[0]?.id;
    if (!permissionId) {
      const existing: Array<{ id: string }> = await queryRunner.query(
        'SELECT id FROM permissions WHERE permission_code = $1',
        [p.code],
      );
      permissionId = existing[0]?.id;
    }

    if (!permissionId) {
      return;
    }

    for (const roleCode of this.roles) {
      await queryRunner.query(
        'INSERT INTO role_permissions (role_id, permission_id, granted_at) SELECT r.id, $2, NOW() FROM roles r WHERE r.role_code = $1 AND r.is_active = true ON CONFLICT (role_id, permission_id) DO NOTHING;',
        [roleCode, permissionId],
      );
    }
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    const code = this.permission.code;
    await queryRunner.query(
      'DELETE FROM role_permissions WHERE permission_id IN (SELECT id FROM permissions WHERE permission_code = $1);',
      [code],
    );
    await queryRunner.query(
      'DELETE FROM permissions WHERE permission_code = $1;',
      [code],
    );
  }
}
