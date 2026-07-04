import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Seed permission audit.system.read (UC-AA-11).
 * Dùng migration vì migration là cơ chế seed duy nhất thực sự chạy được.
 *
 * QUAN TRỌNG: Chỉ gán cho SYSTEM_ADMIN — KHÔNG gán MANAGER/BUSINESS_ADMIN.
 * Đây là permission xem toàn bộ audit log hệ thống, chỉ dành cho
 * System Administrator (§0.4 spec.md).
 */
export class SeedAuditSystemReadPermission20260703000000 implements MigrationInterface {
  name = 'SeedAuditSystemReadPermission20260703000000';

  private readonly permission = {
    code: 'audit.system.read',
    name: 'Xem nhat ky kiem tra he thong',
    moduleCode: 'audit',
    actionCode: 'system.read',
    description:
      'Cho phep SYSTEM_ADMIN xem toan bo danh sach audit log phan trang co bo loc (UC-AA-11, read-only)',
  };

  /**
   * CHỈ gán cho SYSTEM_ADMIN — tuyệt đối không gán MANAGER/BUSINESS_ADMIN.
   */
  private readonly roles = ['SYSTEM_ADMIN'];

  public async up(queryRunner: QueryRunner): Promise<void> {
    const p = this.permission;

    const inserted: Array<{ id: string }> = await queryRunner.query(
      `INSERT INTO permissions (permission_code, permission_name, module_code, action_code, description, is_active)
       VALUES ($1, $2, $3, $4, $5, true)
       ON CONFLICT (permission_code) DO NOTHING
       RETURNING id;`,
      [p.code, p.name, p.moduleCode, p.actionCode, p.description],
    );

    let permissionId = inserted[0]?.id;
    if (!permissionId) {
      const existing: Array<{ id: string }> = await queryRunner.query(
        'SELECT id FROM permissions WHERE permission_code = $1',
        [p.code],
      );
      permissionId = existing[0]?.id;
    }

    if (!permissionId) {
      return;
    }

    for (const roleCode of this.roles) {
      await queryRunner.query(
        `INSERT INTO role_permissions (role_id, permission_id, granted_at)
         SELECT r.id, $2, NOW()
         FROM roles r
         WHERE r.role_code = $1 AND r.is_active = true
         ON CONFLICT (role_id, permission_id) DO NOTHING;`,
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
