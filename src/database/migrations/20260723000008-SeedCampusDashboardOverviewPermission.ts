import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Seed permission `campus_dashboard.overview.read` (CDB-001 / UC-126 — Dashboard dieu hanh
 * khuon vien).
 *
 * ROLES: chi SYSTEM_ADMIN/BUSINESS_ADMIN/MANAGER (KHONG EMPLOYEE) - dung SRS PRE-1
 * "Nguoi dung da dang nhap voi phan quyen Admin/Manager".
 *
 * Format permission 3 tang `module.entity.action`. Idempotent hoan toan. Mirror
 * 20260722000004-SeedZoneReadPermission.ts.
 */
export class SeedCampusDashboardOverviewPermission20260723000008 implements MigrationInterface {
  name = 'SeedCampusDashboardOverviewPermission20260723000008';

  private readonly permission = {
    code: 'campus_dashboard.overview.read',
    name: 'Xem dashboard dieu hanh khuon vien',
    module: 'campus_dashboard',
    action: 'read',
    description:
      'Cho phep xem dashboard tong hop hien dien/ra-vao/trang thai camera theo khu vuc',
  };

  private readonly roles = ['SYSTEM_ADMIN', 'BUSINESS_ADMIN', 'MANAGER'];

  public async up(queryRunner: QueryRunner): Promise<void> {
    const p = this.permission;
    const inserted = (await queryRunner.query(
      'INSERT INTO permissions (permission_code, permission_name, module_code, action_code, description, is_active) VALUES ($1, $2, $3, $4, $5, true) ON CONFLICT (permission_code) DO NOTHING RETURNING id;',
      [p.code, p.name, p.module, p.action, p.description],
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
