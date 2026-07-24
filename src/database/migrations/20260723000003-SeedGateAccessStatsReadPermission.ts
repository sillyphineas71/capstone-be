import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Seed permission `gate_access.stats.read` (VTS-001 / UC-114 — Thống kê lưu lượng phương tiện).
 *
 * SRS Primary Actor "System Admin / Manager" — 3 role `SYSTEM_ADMIN`, `BUSINESS_ADMIN`,
 * `MANAGER` (KHÔNG `EMPLOYEE`). Route admin-only, KHÔNG route self-service.
 *
 * Format 3 tầng `module.entity.action` (mirror `zones.zone.read`). Idempotent hoàn toàn.
 */
export class SeedGateAccessStatsReadPermission20260723000003
  implements MigrationInterface
{
  name = 'SeedGateAccessStatsReadPermission20260723000003';

  private readonly permission = {
    code: 'gate_access.stats.read',
    name: 'Xem thống kê lưu lượng phương tiện',
    module: 'gate_access',
    action: 'stats_read',
    description:
      'Cho phép Admin/Manager xem thống kê lưu lượng phương tiện ra/vào theo thời gian, cổng, loại xe (UC-114)',
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
