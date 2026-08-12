import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Fix: `department.deactivate` (20260812000001) chỉ seed cho MANAGER, SYSTEM_ADMIN
 * — thiếu BUSINESS_ADMIN, trong khi 3 permission chị em cùng resource
 * (`department.create`, `department.read`, `department.update`) đều có
 * BUSINESS_ADMIN (xác nhận bằng query trực tiếp trên RDS chung, 2026-08-12).
 * Trang FE tiêu thụ tính năng này là `/business-admin/departments`, nên
 * BUSINESS_ADMIN phải dùng được deactivate/reactivate như create/read/update.
 * Idempotent: WHERE NOT EXISTS, có down().
 */
export class GrantDepartmentDeactivateToBusinessAdmin20260812000002
  implements MigrationInterface
{
  name = 'GrantDepartmentDeactivateToBusinessAdmin20260812000002';

  private readonly permissionCode = 'department.deactivate';
  private readonly roleCode = 'BUSINESS_ADMIN';

  public async up(queryRunner: QueryRunner): Promise<void> {
    const rows = (await queryRunner.query(
      `SELECT id FROM permissions WHERE permission_code = $1;`,
      [this.permissionCode],
    )) as Array<{ id: string }>;
    const permissionId = rows[0]?.id;
    if (!permissionId) return;

    await queryRunner.query(
      `INSERT INTO role_permissions (role_id, permission_id, granted_at)
       SELECT r.id, $2::uuid, NOW()
       FROM roles r
       WHERE r.role_code = $1 AND r.is_active = true
         AND NOT EXISTS (
           SELECT 1 FROM role_permissions rp2 WHERE rp2.role_id = r.id AND rp2.permission_id = $2::uuid
         );`,
      [this.roleCode, permissionId],
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `DELETE FROM role_permissions
       WHERE permission_id IN (SELECT id FROM permissions WHERE permission_code = $1)
         AND role_id IN (SELECT id FROM roles WHERE role_code = $2);`,
      [this.permissionCode, this.roleCode],
    );
  }
}
