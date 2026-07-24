import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Seed permission `zones.gate_log.read` (GAL-001 / UC-107 — Admin xem & tra cuu lich su ra/vao cong).
 *
 * Cong route admin GET /api/v1/admin/gate-access-logs (log cua moi nguoi + loc user_id/plate).
 * Route user GET /gate-access-logs chi JwtAuthGuard (khong permission).
 *
 * ⚠ ROLES: 3 role — `SYSTEM_ADMIN` + `BUSINESS_ADMIN` + `MANAGER`. **KHAC CA HAI tien le**:
 * - `zones.zone.read` dung 4 role (+EMPLOYEE) — danh muc zone it nhay cam.
 * - Cac thao tac ghi zone va `anpr.vehicle.admin_read` dung 2 role (SYSTEM_ADMIN+BUSINESS_ADMIN).
 * Du lieu ra/vao toan khuon vien nhay cam hon danh muc zone (co MANAGER cho bo phan an ninh),
 * nhung khong mo toi EMPLOYEE. Copy nham mang 4 hoac 2 phan tu deu sai.
 * KHONG seed ADMIN/INTERNAL_USER (ma loi thoi, WHERE role_code khong khop -> im lang khong insert).
 *
 * Format permission 3 tang `module.entity.action`, `action_code='read'` TUONG MINH.
 * Idempotent hoan toan. Mirror 20260722000005-SeedZoneAssignDevicePermission.ts.
 *
 * DATA: CHI ghi `permissions` + `role_permissions` — KHONG dung schema (khong them cot/index/CHECK
 * cho gate_access_logs; `direction` ep o application qua GATE_DIRECTIONS + @IsIn).
 */
export class SeedGateLogReadPermission20260722000007 implements MigrationInterface {
  name = 'SeedGateLogReadPermission20260722000007';

  private readonly permission = {
    code: 'zones.gate_log.read',
    name: 'Admin xem & tra cuu lich su ra/vao cong',
    module: 'zones',
    action: 'read',
    description:
      'Cho phep admin xem & tra cuu lich su ra/vao cong cua moi nguoi (loc theo user/bien so/thoi gian)',
  };

  // 3 ROLE — co y khac 4 role (zones.zone.read) va 2 role (thao tac ghi zone). Xem JSDoc tren.
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
