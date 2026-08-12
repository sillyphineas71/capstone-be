import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Seed permission `anpr.vehicle.admin_delete` (VPT-001 / VPT-BE-05).
 *
 * Chức năng: cấp quyền admin xoá mềm bất kỳ biển số của bất kỳ user nào
 * (không cần là chủ xe) — route DELETE /api/v1/anpr/admin/vehicle-registrations/:id.
 *
 * Khác `anpr.vehicle.admin_register` (đăng ký hộ) và `anpr.vehicle.admin_read` (xem danh sách)
 * — tách permission theo hành động, nhất quán tiền lệ module anpr.
 *
 * ⚠ ROLES: 2 role — `SYSTEM_ADMIN` + `BUSINESS_ADMIN`, khớp toàn bộ permission ANPR hiện có
 * (admin_register/admin_read/history_view/unknown_view đều 2 role này).
 * KHÔNG thêm MANAGER/EMPLOYEE — tránh cấp quyền xoá xe của người khác cho nhân viên thường.
 *
 * Idempotent hoàn toàn (ON CONFLICT DO NOTHING). Mirror cấu trúc
 * 20260722000006-SeedAnprVehicleAdminReadPermission.ts.
 */
export class SeedAnprVehicleAdminDeletePermission20260812000004 implements MigrationInterface {
  name = 'SeedAnprVehicleAdminDeletePermission20260812000004';

  private readonly permission = {
    code: 'anpr.vehicle.admin_delete',
    name: 'Admin xoá biển số hộ user',
    module: 'anpr',
    action: 'admin_delete',
    description:
      'Cho phép admin xoá mềm bất kỳ biển số xe của bất kỳ user nào (không cần là chủ xe)',
  };

  // 2 ROLE — cố ý khác 4 role của zones (xem JSDoc trên).
  private readonly roles = ['SYSTEM_ADMIN', 'BUSINESS_ADMIN'];

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
