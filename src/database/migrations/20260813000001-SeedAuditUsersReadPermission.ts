import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Seed permission audit.users.read — cho phép xem lịch sử hoạt động của MỘT
 * tài khoản (đối tượng bị tác động) qua GET /api/v1/users/:userId/audit-logs
 * (be-user-activity-log-requirement.md, 13/08/2026 — Option B).
 *
 * Khác audit.system.read (toàn bộ audit log, chỉ SYSTEM_ADMIN): quyền này giới
 * hạn ở log entity_type='users' và được cấp cho CẢ BUSINESS_ADMIN lẫn
 * SYSTEM_ADMIN — vì PermissionsGuard yêu cầu ALL (không hỗ trợ OR), nên cấp
 * cùng một quyền cho cả hai role thay vì để controller kiểm tra OR.
 */
export class SeedAuditUsersReadPermission20260813000001 implements MigrationInterface {
  name = 'SeedAuditUsersReadPermission20260813000001';

  private readonly permission = {
    code: 'audit.users.read',
    name: 'Xem lich su hoat dong cua tai khoan',
    moduleCode: 'audit',
    actionCode: 'users.read',
    description:
      'Cho phep xem lich su hoat dong (audit log) cua mot tai khoan voi tu cach doi tuong bi tac dong (read-only)',
  };

  private readonly roles = ['BUSINESS_ADMIN', 'SYSTEM_ADMIN'];

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
