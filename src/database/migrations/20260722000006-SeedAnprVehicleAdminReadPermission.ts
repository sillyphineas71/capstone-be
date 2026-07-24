import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Seed permission `anpr.vehicle.admin_read` (UC-101 / VPL-002 — Admin xem & tra cuu phuong tien).
 *
 * Cong endpoint GET /api/v1/anpr/admin/vehicle-registrations (list xe cua MOI nguoi + loc
 * user_id/owner). Khac `anpr.vehicle.admin_register` (dang ky ho) — day la quyen DOC danh sach.
 *
 * ⚠ ROLES: 2 role — `SYSTEM_ADMIN` + `BUSINESS_ADMIN`, khop 3 permission ANPR hien co
 * (admin_register/history_view/unknown_view deu 2 role nay). KHONG them MANAGER/EMPLOYEE
 * (khac UC-93 zones.zone.read 4 role) — them nham se cap quyen doc toan bo bien so + ten/email
 * chu xe cho nhan vien thuong. KHONG seed ADMIN/INTERNAL_USER (ma loi thoi, WHERE role_code
 * khong khop -> im lang khong insert).
 *
 * Format permission 3 tang `module.entity.action`, `action_code='admin_read'` TUONG MINH.
 * Idempotent hoan toan. Mirror 20260722000005-SeedZoneAssignDevicePermission.ts.
 *
 * DATA: CHI ghi `permissions` + `role_permissions` — KHONG dung schema (khong them cot/index
 * cho vehicle_registrations du co sequential scan tren plate/owner/vehicle_type).
 */
export class SeedAnprVehicleAdminReadPermission20260722000006 implements MigrationInterface {
  name = 'SeedAnprVehicleAdminReadPermission20260722000006';

  private readonly permission = {
    code: 'anpr.vehicle.admin_read',
    name: 'Admin xem & tra cuu phuong tien',
    module: 'anpr',
    action: 'admin_read',
    description:
      'Cho phep admin xem & tra cuu danh sach bien so xe cua moi nguoi (loc theo user/chu xe)',
  };

  // 2 ROLE — co y khac 4 role cua zones.zone.read (xem JSDoc tren).
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
