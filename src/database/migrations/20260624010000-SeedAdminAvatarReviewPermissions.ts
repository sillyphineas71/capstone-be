import { MigrationInterface, QueryRunner } from 'typeorm';

export class SeedAdminAvatarReviewPermissions20260624010000 implements MigrationInterface {
  name = 'SeedAdminAvatarReviewPermissions20260624010000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    const permissions = [
      {
        code: 'account.avatar.review',
        name: 'Xem và duyet/tu choi avatar',
        action: 'review',
      },
      {
        code: 'account.avatar.download',
        name: 'Tai anh avatar submission',
        action: 'download',
      },
    ];
    const roles = ['SYSTEM_ADMIN'];

    for (const p of permissions) {
      const inserted: Array<{ id: string }> = await queryRunner.query(
        'INSERT INTO permissions (permission_code, permission_name, module_code, action_code, description, is_active) VALUES ($1, $2, $3, $4, $5, true) ON CONFLICT (permission_code) DO NOTHING RETURNING id;',
        [p.code, p.name, 'accounts', p.action, p.name],
      );
      const permissionId =
        inserted[0]?.id ??
        (
          await queryRunner.query(
            'SELECT id FROM permissions WHERE permission_code = $1',
            [p.code],
          )
        )[0]?.id;
      if (!permissionId) continue;

      for (const roleCode of roles) {
        await queryRunner.query(
          'INSERT INTO role_permissions (role_id, permission_id, granted_at) SELECT r.id, $2, NOW() FROM roles r WHERE r.role_code = $1 AND r.is_active = true ON CONFLICT (role_id, permission_id) DO NOTHING;',
          [roleCode, permissionId],
        );
      }
    }
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      'DELETE FROM role_permissions WHERE permission_id IN (SELECT id FROM permissions WHERE permission_code IN ($1, $2));',
      ['account.avatar.review', 'account.avatar.download'],
    );
    await queryRunner.query(
      'DELETE FROM permissions WHERE permission_code IN ($1, $2);',
      ['account.avatar.review', 'account.avatar.download'],
    );
  }
}
