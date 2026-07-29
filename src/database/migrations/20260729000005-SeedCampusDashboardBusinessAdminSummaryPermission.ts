import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Seed permission `campus_dashboard.business_admin_summary.read` (CDB-RS-001).
 *
 * ROLES: CHỈ BUSINESS_ADMIN, SYSTEM_ADMIN — dữ liệu điều hành cấp tổ chức (gate traffic toàn
 * trường, breakdown alert severity, zone occupancy toàn trường, ANPR blocklist hits), KHÔNG
 * MANAGER (xem spec §2.1). Mirror
 * 20260723000008-SeedCampusDashboardOverviewPermission.ts.
 */
export class SeedCampusDashboardBusinessAdminSummaryPermission20260729000005
  implements MigrationInterface
{
  name = 'SeedCampusDashboardBusinessAdminSummaryPermission20260729000005';

  private readonly permission = {
    code: 'campus_dashboard.business_admin_summary.read',
    name: 'Xem dashboard tổng hợp toàn tổ chức',
    module: 'campus_dashboard',
    action: 'read',
    description:
      'Cho phép BUSINESS_ADMIN/SYSTEM_ADMIN xem dashboard tổng hợp toàn tổ chức: lưu lượng ra/vào, cảnh báo theo mức độ, occupancy toàn trường, số lượt khớp blocklist hôm nay',
  };

  private readonly roles = ['BUSINESS_ADMIN', 'SYSTEM_ADMIN'];

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
