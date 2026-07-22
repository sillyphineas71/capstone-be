import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Seed permission `zones.zone.create` (ZNC-001 / UC-90 — Tạo khu vực).
 *
 * Roles: SYSTEM_ADMIN, BUSINESS_ADMIN (OQ-2 — chỉ 4 role code tồn tại thật trong hệ thống;
 * KHÔNG seed ADMIN/INTERNAL_USER vì là mã lỗi thời, WHERE role_code sẽ không khớp và im lặng
 * không insert).
 *
 * Format permission 3 tầng `module.entity.action` (OQ-1). Idempotent hoàn toàn: chạy lại
 * nhiều lần không lỗi, không nhân bản. Mirror 20260718000008-SeedRoleReadPermission.ts.
 *
 * DATA: CHỈ ghi `permissions` + `role_permissions` — KHÔNG đụng schema (bảng `zones` và 3
 * index đã tạo ở 20260721000001).
 */
export class SeedZoneCreatePermission20260722000001 implements MigrationInterface {
  name = 'SeedZoneCreatePermission20260722000001';

  private readonly permission = {
    code: 'zones.zone.create',
    name: 'Tao khu vuc',
    module: 'zones',
    action: 'create',
    description: 'Cho phep tao khu vuc (zone) trong module zones',
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
