import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * REC-GAP-01 — grant 6 quyen ghi hinh (da ton tai, tao boi
 * 20260720000005-BackfillRolePermissions) cho EMPLOYEE va BUSINESS_ADMIN.
 *
 * Ly do: backfill chi gan nhom recording.config.* + recording.video.* cho
 * MANAGER + SYSTEM_ADMIN (dong 647-704), nhung host cua cuoc hop thuong la
 * EMPLOYEE (man dat phong /employee/book) va man InMeetingRoom duoc mount cho
 * ca 4 role. Ket qua: Employee/Business Admin bat ghi hinh luc dat phong ->
 * recording-config 403 (mat cau hinh am tham), bam Start/Stop trong phong hop
 * -> recording-video 403.
 *
 * Da duoc Thieu Chu chot: Employee (host) DUOC phep ghi hinh.
 *
 * Mirror 20260729000006-GrantBusinessAdminIotDeviceReadPermission.ts — permission
 * KHONG moi, chi them dong role_permissions. Idempotent bang WHERE NOT EXISTS.
 */
export class GrantEmployeeBusinessAdminRecordingPermissions20260731000002
  implements MigrationInterface
{
  name = 'GrantEmployeeBusinessAdminRecordingPermissions20260731000002';

  private readonly roleCodes = ['EMPLOYEE', 'BUSINESS_ADMIN'];

  private readonly permissionCodes = [
    'recording.config.create',
    'recording.config.read',
    'recording.config.update',
    'recording.video.start',
    'recording.video.stop',
    'recording.video.status',
  ];

  public async up(queryRunner: QueryRunner): Promise<void> {
    for (const roleCode of this.roleCodes) {
      for (const code of this.permissionCodes) {
        await queryRunner.query(
          `INSERT INTO role_permissions (role_id, permission_id, granted_at)
           SELECT r.id, p.id, NOW()
           FROM roles r, permissions p
           WHERE r.role_code = $1 AND r.is_active = true
             AND p.permission_code = $2
             AND NOT EXISTS (
               SELECT 1 FROM role_permissions rp
               WHERE rp.role_id = r.id AND rp.permission_id = p.id
             );`,
          [roleCode, code],
        );
      }
    }
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    for (const roleCode of this.roleCodes) {
      for (const code of this.permissionCodes) {
        await queryRunner.query(
          `DELETE FROM role_permissions
           WHERE role_id IN (SELECT id FROM roles WHERE role_code = $1)
             AND permission_id IN (SELECT id FROM permissions WHERE permission_code = $2);`,
          [roleCode, code],
        );
      }
    }
  }
}
