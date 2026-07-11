import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Seed permission analytics.meeting.read (UC-AA-06 / UC-153).
 * Dùng migration vì migration là cơ chế seed duy nhất thực sự chạy được.
 */
export class SeedAnalyticsMeetingReadPermission20260702050000 implements MigrationInterface {
  name = 'SeedAnalyticsMeetingReadPermission20260702050000';

  private readonly permission = {
    code: 'analytics.meeting.read',
    name: 'Xem thong ke cuoc hop',
    action: 'meeting.read',
    description: 'Cho phep xem thong ke cuoc hop theo pham vi phan quyen',
  };

  private readonly roles = ['MANAGER', 'BUSINESS_ADMIN', 'SYSTEM_ADMIN'];

  public async up(queryRunner: QueryRunner): Promise<void> {
    const p = this.permission;
    const inserted: Array<{ id: string }> = await queryRunner.query(
      'INSERT INTO permissions (permission_code, permission_name, module_code, action_code, description, is_active) VALUES ($1, $2, $3, $4, $5, true) ON CONFLICT (permission_code) DO NOTHING RETURNING id;',
      [p.code, p.name, 'analytics', p.action, p.description],
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
