import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Seed permission analytics.attendance.read (UC-AA-10 / UC-157).
 * Dùng migration vì migration là cơ chế seed duy nhất thực sự chạy được.
 */
export class SeedAnalyticsAttendanceReadPermission20260702060000 implements MigrationInterface {
  name = 'SeedAnalyticsAttendanceReadPermission20260702060000';

  private readonly permission = {
    code: 'analytics.attendance.read',
    name: 'Xem thong ke ty le tham du dung gio',
    action: 'attendance.read',
    description:
      'Cho phep xem thong ke va lich su di muon tham du cuoc hop (read-only)',
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
