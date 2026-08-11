import { MigrationInterface, QueryRunner } from 'typeorm';

export class SeedPartnerAccountManagePermission20260811000002
  implements MigrationInterface
{
  name = 'SeedPartnerAccountManagePermission20260811000002';

  private readonly permission = {
    code: 'account.partner.manage',
    name: 'Quản lý tài khoản đối tác',
    action: 'partner.manage',
    description:
      'Cho phép tạo, gia hạn và khoá sớm tài khoản đối tác tạm thời',
  };

  private readonly roles = ['MANAGER', 'BUSINESS_ADMIN', 'SYSTEM_ADMIN'];

  public async up(queryRunner: QueryRunner): Promise<void> {
    const inserted: Array<{ id: string }> = await queryRunner.query(
      `INSERT INTO permissions (permission_code, permission_name, module_code, action_code, description, is_active)
       VALUES ($1, $2, 'accounts', $3, $4, true)
       ON CONFLICT (permission_code) DO NOTHING
       RETURNING id;`,
      [this.permission.code, this.permission.name, this.permission.action, this.permission.description],
    );

    let permissionId = inserted[0]?.id;
    if (!permissionId) {
      const existing: Array<{ id: string }> = await queryRunner.query(
        `SELECT id FROM permissions WHERE permission_code = $1;`,
        [this.permission.code],
      );
      permissionId = existing[0]?.id;
    }

    if (!permissionId) {
      return;
    }

    for (const roleCode of this.roles) {
      await queryRunner.query(
        `INSERT INTO role_permissions (role_id, permission_id, granted_at)
         SELECT r.id, $2, NOW()
         FROM roles r
         WHERE r.role_code = $1 AND r.is_active = true
         ON CONFLICT (role_id, permission_id) DO NOTHING;`,
        [roleCode, permissionId],
      );
    }
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `DELETE FROM role_permissions
       WHERE permission_id IN (SELECT id FROM permissions WHERE permission_code = $1);`,
      [this.permission.code],
    );
    await queryRunner.query(
      `DELETE FROM permissions WHERE permission_code = $1;`,
      [this.permission.code],
    );
  }
}