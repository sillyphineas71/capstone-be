import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Seed permission `campus_dashboard.manager_summary.read` (CDB-RS-001).
 *
 * ROLES: CHỈ MANAGER — endpoint tự-scope theo `req.user.id` là chính manager gọi (không có
 * tham số `managerId`), SYSTEM_ADMIN/BUSINESS_ADMIN không có `direct_manager_id`/team riêng
 * theo nghĩa này (xem spec §2.1). Mirror 20260723000008-SeedCampusDashboardOverviewPermission.ts.
 */
export class SeedCampusDashboardManagerSummaryPermission20260729000003 implements MigrationInterface {
  name = 'SeedCampusDashboardManagerSummaryPermission20260729000003';

  private readonly permission = {
    code: 'campus_dashboard.manager_summary.read',
    name: 'Xem dashboard tổng hợp cho Manager',
    module: 'campus_dashboard',
    action: 'read',
    description:
      'Cho phép Manager xem dashboard tổng hợp team: hiện diện hôm nay, meeting request chờ duyệt, on-time rate tuần',
  };

  private readonly roles = ['MANAGER'];

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
