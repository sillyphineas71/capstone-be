import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Seed permission `zones.zone.update` (ZNU-001 / UC-91 — Cap nhat khu vuc).
 *
 * Roles: SYSTEM_ADMIN, BUSINESS_ADMIN (OQ-5 — CHI 1 permission cho ca thao tac sua thong tin
 * lan doi trang thai, vi route da gop lam mot; KHONG seed `zones.zone.set_status`).
 * KHONG seed ADMIN/INTERNAL_USER (ma loi thoi, WHERE role_code khong khop -> im lang khong
 * insert).
 *
 * Format permission 3 tang `module.entity.action` (OQ-1 cua UC-90). Idempotent hoan toan.
 * Mirror 20260722000001-SeedZoneCreatePermission.ts.
 *
 * DATA: CHI ghi `permissions` + `role_permissions` — KHONG dung schema (bang `zones` va 3
 * index da tao o 20260721000001).
 */
export class SeedZoneUpdatePermission20260722000002 implements MigrationInterface {
  name = 'SeedZoneUpdatePermission20260722000002';

  private readonly permission = {
    code: 'zones.zone.update',
    name: 'Cap nhat khu vuc',
    module: 'zones',
    action: 'update',
    description:
      'Cho phep cap nhat thong tin, loai va trang thai khu vuc (zone) trong module zones',
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
