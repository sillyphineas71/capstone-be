import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Seed permission `zones.zone.assign_device` (ZNA-001 / UC-94 — Gan / go thiet bi cho khu vuc).
 *
 * 1 permission dung chung cho CA gan lan go (OQ-8): hai nua cua cung mot nghiep vu "quan ly
 * thiet bi cua khu vuc"; tach lam 2 luc nay la seed mot quyen khong ai dung khac di.
 *
 * ⚠ ROLES: 2 role — `SYSTEM_ADMIN` + `BUSINESS_ADMIN`. **KHAC UC-93**: `zones.zone.read`
 * (20260722000004) dung 4 role vi la thao tac DOC. Copy nham mang 4 phan tu se cap quyen
 * gan/go thiet bi cho MANAGER va EMPLOYEE — tuc nhan vien thuong sua duoc cau hinh dinh tuyen
 * su kien cua toan khuon vien.
 *
 * KHONG seed ADMIN/INTERNAL_USER (ma loi thoi, WHERE role_code khong khop -> im lang khong
 * insert).
 *
 * Format permission 3 tang `module.entity.action`. Idempotent hoan toan.
 * Mirror 20260722000003-SeedZoneDeletePermission.ts.
 *
 * DATA: CHI ghi `permissions` + `role_permissions` — KHONG dung schema (khong them cot toa do
 * cua UC-95, khong doi FK/index cua `iot_devices.zone_id`).
 */
export class SeedZoneAssignDevicePermission20260722000005 implements MigrationInterface {
  name = 'SeedZoneAssignDevicePermission20260722000005';

  private readonly permission = {
    code: 'zones.zone.assign_device',
    name: 'Gan thiet bi vao khu vuc',
    module: 'zones',
    action: 'assign_device',
    description:
      'Cho phep gan va go thiet bi (camera/cam bien) vao khu vuc de dinh tuyen su kien theo khu vuc',
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
