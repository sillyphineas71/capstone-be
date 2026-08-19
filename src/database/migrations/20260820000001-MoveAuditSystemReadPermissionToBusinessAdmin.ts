import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Chuyen quyen xem Nhat ky kiem toan (audit.system.read, UC-96/UC-AA-11) tu
 * SYSTEM_ADMIN sang BUSINESS_ADMIN theo yeu cau truc tiep 2026-08-20.
 *
 * QUAN TRONG: day la CHUYEN HAN, khong phai cap them — SYSTEM_ADMIN se MAT
 * quyen xem man /audit-logs sau migration nay, BUSINESS_ADMIN duoc cap moi.
 * Nguoc voi quyet dinh ban dau trong 20260703000000-SeedAuditSystemReadPermission.ts
 * ("Chi gan cho SYSTEM_ADMIN — KHONG gan MANAGER/BUSINESS_ADMIN") — quyet dinh
 * do da bi ghi de boi yeu cau moi cua team.
 */
export class MoveAuditSystemReadPermissionToBusinessAdmin20260820000001
  implements MigrationInterface
{
  name = 'MoveAuditSystemReadPermissionToBusinessAdmin20260820000001';

  private readonly permissionCode = 'audit.system.read';
  private readonly fromRole = 'SYSTEM_ADMIN';
  private readonly toRole = 'BUSINESS_ADMIN';

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
