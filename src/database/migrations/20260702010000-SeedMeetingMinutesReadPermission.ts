import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Seed permission meeting.minutes.read (UC-MKM-02, feat-list-meeting-minutes).
 * Dùng migration (không dùng src/database/seeds/) vì seed-runner cho thư mục
 * seeds/ chưa được wire vào đâu — migration là cơ chế seed duy nhất thực sự
 * chạy được (xem research.md của feat-list-meeting-minutes mục 1.6).
 */
export class SeedMeetingMinutesReadPermission20260702010000 implements MigrationInterface {
  name = 'SeedMeetingMinutesReadPermission20260702010000';

  private readonly permission = {
    code: 'meeting.minutes.read',
    name: 'Xem danh sach bien ban hop',
    action: 'minutes.read',
    description: 'Cho phep xem danh sach bien ban hop theo pham vi phan quyen',
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
