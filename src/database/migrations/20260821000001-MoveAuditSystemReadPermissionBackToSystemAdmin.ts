import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Chuyen quyen xem Nhat ky kiem toan (audit.system.read, UC-96/UC-AA-11) tu
 * BUSINESS_ADMIN nguoc lai SYSTEM_ADMIN theo yeu cau truc tiep 2026-08-21.
 *
 * QUAN TRONG: day la CHUYEN HAN, khong phai cap them — BUSINESS_ADMIN se MAT
 * quyen xem man /audit-logs sau migration nay, SYSTEM_ADMIN duoc cap lai.
 * Day la migration DAO NGUOC hoan toan 20260820000001-MoveAuditSystemReadPermissionToBusinessAdmin.ts.
 */
export class MoveAuditSystemReadPermissionBackToSystemAdmin20260821000001
  implements MigrationInterface
{
  name = 'MoveAuditSystemReadPermissionBackToSystemAdmin20260821000001';

  private readonly permissionCode = 'audit.system.read';
  private readonly fromRole = 'BUSINESS_ADMIN';
  private readonly toRole = 'SYSTEM_ADMIN';

  public async up(queryRunner: QueryRunner): Promise<void> {
    const permission: Array<{ id: string }> = await queryRunner.query(
      'SELECT id FROM permissions WHERE permission_code = $1',
      [this.permissionCode],
    );
    const permissionId = permission[0]?.id;
    if (!permissionId) {
      return;
    }

    await queryRunner.query(
      `DELETE FROM role_permissions
       WHERE permission_id = $1
         AND role_id IN (SELECT id FROM roles WHERE role_code = $2);`,
      [permissionId, this.fromRole],
    );

    await queryRunner.query(
      `INSERT INTO role_permissions (role_id, permission_id, granted_at)
       SELECT r.id, $2, NOW()
       FROM roles r
       WHERE r.role_code = $1 AND r.is_active = true
       ON CONFLICT (role_id, permission_id) DO NOTHING;`,
      [this.toRole, permissionId],
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    const permission: Array<{ id: string }> = await queryRunner.query(
      'SELECT id FROM permissions WHERE permission_code = $1',
      [this.permissionCode],
    );
    const permissionId = permission[0]?.id;
    if (!permissionId) {
      return;
    }

    await queryRunner.query(
      `DELETE FROM role_permissions
       WHERE permission_id = $1
         AND role_id IN (SELECT id FROM roles WHERE role_code = $2);`,
      [permissionId, this.toRole],
    );

    await queryRunner.query(
      `INSERT INTO role_permissions (role_id, permission_id, granted_at)
       SELECT r.id, $2, NOW()
       FROM roles r
       WHERE r.role_code = $1 AND r.is_active = true
       ON CONFLICT (role_id, permission_id) DO NOTHING;`,
      [this.fromRole, permissionId],
    );
  }
}
