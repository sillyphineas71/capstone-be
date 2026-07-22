import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Seed permission `zones.zone.read` (ZNL-001 / UC-93 — Xem & tra cuu khu vuc).
 *
 * ⚠ ROLES: 4 role — KHAC 3 UC truoc (`zones.zone.create`/`update`/`delete` chi 2 role admin).
 * Ly do (OQ-6): zone la DU LIEU NEN, nhieu man hinh FE can dropdown chon zone (bao cao, loc
 * dashboard, cau hinh) nen MANAGER va EMPLOYEE phai doc duoc; ghi/sua/xoa van chi 2 role admin
 * nen rui ro thap. Copy nham mang 2 phan tu se khien nhan vien khong doc duoc zone va loi hien
 * ra duoi dang 403 rat kho doan.
 *
 * KHONG seed ADMIN/INTERNAL_USER (ma loi thoi, WHERE role_code khong khop -> im lang khong
 * insert).
 *
 * Format permission 3 tang `module.entity.action`. Idempotent hoan toan.
 * Mirror 20260722000003-SeedZoneDeletePermission.ts.
 *
 * DATA: CHI ghi `permissions` + `role_permissions` — KHONG dung schema (khong them index du
 * `status`/`floor`/`search` gay sequential scan; toi uu index la task rieng).
 */
export class SeedZoneReadPermission20260722000004 implements MigrationInterface {
  name = 'SeedZoneReadPermission20260722000004';

  private readonly permission = {
    code: 'zones.zone.read',
    name: 'Xem khu vuc',
    module: 'zones',
    action: 'read',
    description:
      'Cho phep xem danh sach va chi tiet khu vuc (zone) trong module zones',
  };

  // 4 ROLE — co y khac 2 role cua create/update/delete (xem JSDoc tren).
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
