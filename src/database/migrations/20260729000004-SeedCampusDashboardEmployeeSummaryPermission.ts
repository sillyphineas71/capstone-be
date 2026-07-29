import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Seed permission `campus_dashboard.employee_summary.read` (CDB-RS-001).
 *
 * ROLES: cả 4 role — dữ liệu "của chính người gọi" (gate access hôm nay, vehicle status,
 * meeting hôm nay của bản thân), tương tự convention `notification.read.self`/
 * `schedule.read.self` (xem spec §2.1). Mirror
 * 20260723000008-SeedCampusDashboardOverviewPermission.ts.
 */
export class SeedCampusDashboardEmployeeSummaryPermission20260729000004
  implements MigrationInterface
{
  name = 'SeedCampusDashboardEmployeeSummaryPermission20260729000004';

  private readonly permission = {
    code: 'campus_dashboard.employee_summary.read',
    name: 'Xem dashboard tổng hợp cá nhân',
    module: 'campus_dashboard',
    action: 'read',
    description:
      'Cho phép xem dashboard tổng hợp của chính bản thân: gate access hôm nay, trạng thái xe đăng ký, số meeting hôm nay',
  };

  private readonly roles = [
    'SYSTEM_ADMIN',
    'BUSINESS_ADMIN',
    'MANAGER',
    'EMPLOYEE',
  ];

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
