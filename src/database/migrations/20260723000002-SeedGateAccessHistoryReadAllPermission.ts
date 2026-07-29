import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Seed permission `gate_access.history.read_all` (GAH-001 / UC-117 — Xem & tra cứu lịch sử
 * ra vào cổng, route admin xem của nhân sự khác).
 *
 * BR1 SRS: "chỉ Admin/Manager mới có quyền tra cứu lịch sử của nhân sự khác" — 3 role
 * `SYSTEM_ADMIN`, `BUSINESS_ADMIN`, `MANAGER` (KHÔNG `EMPLOYEE`). Route own (xem của chính
 * mình) KHÔNG cần permission riêng — chỉ `JwtAuthGuard`.
 *
 * Format 3 tầng `module.entity.action` (mirror `zones.zone.read`). Idempotent hoàn toàn.
 */
export class SeedGateAccessHistoryReadAllPermission20260723000002 implements MigrationInterface {
  name = 'SeedGateAccessHistoryReadAllPermission20260723000002';

  private readonly permission = {
    code: 'gate_access.history.read_all',
    name: 'Xem lịch sử ra vào cổng của nhân sự khác',
    module: 'gate_access',
    action: 'history_read_all',
    description:
      'Cho phép Admin/Manager tra cứu lịch sử ra/vào cổng của bất kỳ nhân sự nào (khác route own chỉ xem của chính mình)',
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
