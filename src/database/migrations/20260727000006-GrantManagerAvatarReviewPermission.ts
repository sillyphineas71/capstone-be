import { MigrationInterface, QueryRunner } from 'typeorm';

export class GrantManagerAvatarReviewPermission20260727000006 implements MigrationInterface {
  name = 'GrantManagerAvatarReviewPermission20260727000006';

  public async up(queryRunner: QueryRunner): Promise<void> {
    const permissionCodes = [
      'account.avatar.review',
      'account.avatar.download',
    ];

    for (const code of permissionCodes) {
      await queryRunner.query(
        'INSERT INTO role_permissions (role_id, permission_id, granted_at) SELECT r.id, p.id, NOW() FROM roles r, permissions p WHERE r.role_code = $1 AND r.is_active = true AND p.permission_code = $2 ON CONFLICT (role_id, permission_id) DO NOTHING;',
        ['MANAGER', code],
      );
    }
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      'DELETE FROM role_permissions WHERE role_id IN (SELECT id FROM roles WHERE role_code = $1) AND permission_id IN (SELECT id FROM permissions WHERE permission_code IN ($2, $3));',
      ['MANAGER', 'account.avatar.review', 'account.avatar.download'],
    );
  }
}
