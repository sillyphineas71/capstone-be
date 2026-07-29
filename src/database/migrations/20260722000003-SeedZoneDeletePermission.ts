import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Seed permission `zones.zone.delete` (ZND-001 / UC-92 — Xoa khu vuc).
 *
 * Roles: SYSTEM_ADMIN, BUSINESS_ADMIN (OQ-6). BUSINESS_ADMIN da sua duoc zone_code/zone_type/
 * status o UC-91 nen cam xoa la khong nhat quan; soft-delete + chan-theo-thiet-bi da gioi han
 * muc pha huy. KHONG seed ADMIN/INTERNAL_USER (ma loi thoi, WHERE role_code khong khop -> im
 * lang khong insert).
 *
 * Format permission 3 tang `module.entity.action`. Idempotent hoan toan.
 * Mirror 20260722000002-SeedZoneUpdatePermission.ts.
 *
 * DATA: CHI ghi `permissions` + `role_permissions` — KHONG dung schema (khong them cot
 * `deleted_by`, khong doi FK/ON DELETE cua cac bang tham chieu `zones`).
 */
export class SeedZoneDeletePermission20260722000003 implements MigrationInterface {
  name = 'SeedZoneDeletePermission20260722000003';

  private readonly permission = {
    code: 'zones.zone.delete',
    name: 'Xoa khu vuc',
    module: 'zones',
    action: 'delete',
    description:
      'Cho phep xoa mem khu vuc (zone) trong module zones; bi chan neu zone con thiet bi duoc gan',
  };

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
