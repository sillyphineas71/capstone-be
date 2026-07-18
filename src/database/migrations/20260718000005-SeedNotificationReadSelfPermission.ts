import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Seed permission notification.read.self (Cho phep xem danh sach thong bao va danh dau da doc).
 * Roles: EMPLOYEE, MANAGER, BUSINESS_ADMIN, SYSTEM_ADMIN.
 * KHONG dung role INTERNAL_USER (role nay khong ton tai trong DB).
 */
export class SeedNotificationReadSelfPermission20260718000005 implements MigrationInterface {
  name = 'SeedNotificationReadSelfPermission20260718000005';

  private readonly permission = {
    code: 'notification.read.self',
    name: 'Xem thong bao ca nhan',
    action: 'read.self',
    description: 'Cho phep xem danh sach thong bao va danh dau da doc',
  };

  private readonly roles = [
    'EMPLOYEE',
    'MANAGER',
    'BUSINESS_ADMIN',
    'SYSTEM_ADMIN',
  ];

  public async up(queryRunner: QueryRunner): Promise<void> {
    const p = this.permission;
    const inserted = (await queryRunner.query(
      'INSERT INTO permissions (permission_code, permission_name, module_code, action_code, description, is_active) VALUES ($1, $2, $3, $4, $5, true) ON CONFLICT (permission_code) DO NOTHING RETURNING id;',
      [p.code, p.name, 'notifications', p.action, p.description],
    )) as Array<{ id: string }>;
    let permissionId = inserted[0]?.id;
    if (!permissionId) {
      const existing = (await queryRunner.query(
        'SELECT id FROM permissions WHERE permission_code = $1',
        [p.code],
      )) as Array<{ id: string }>;
      permissionId = existing[0]?.id;
    }
    if (!permissionId) return;

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
