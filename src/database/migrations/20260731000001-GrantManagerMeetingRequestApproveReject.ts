import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * MTG-GAP-01 — grant `meeting_request.approve` + `meeting_request.reject` (da ton tai,
 * tao boi 20260720000005-BackfillRolePermissions) cho role MANAGER.
 *
 * Ly do: man `/manager/meeting-approvals` la man DUY NHAT co UI duyet/tu choi yeu cau
 * dat phong, nhung backfill chi gan 2 quyen nay cho SYSTEM_ADMIN (dong 358-375) —
 * SYSTEM_ADMIN lai khong co man approvals. Ket qua: Manager thay danh sach
 * (`meeting_request.read` da co MANAGER) nhung moi nut duyet/tu choi tra 403, khong ai
 * duyet duoc yeu cau dat phong.
 *
 * Mirror 20260729000006-GrantBusinessAdminIotDeviceReadPermission.ts — permission KHONG
 * moi, chi them dong role_permissions. Dung WHERE NOT EXISTS (nhu backfill) thay
 * ON CONFLICT de idempotent ma khong phu thuoc unique constraint.
 */
export class GrantManagerMeetingRequestApproveReject20260731000001
  implements MigrationInterface
{
  name = 'GrantManagerMeetingRequestApproveReject20260731000001';

  private readonly permissionCodes = [
    'meeting_request.approve',
    'meeting_request.reject',
  ];

  public async up(queryRunner: QueryRunner): Promise<void> {
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
        ['MANAGER', code],
      );
    }
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    for (const code of this.permissionCodes) {
      await queryRunner.query(
        `DELETE FROM role_permissions
         WHERE role_id IN (SELECT id FROM roles WHERE role_code = $1)
           AND permission_id IN (SELECT id FROM permissions WHERE permission_code = $2);`,
        ['MANAGER', code],
      );
    }
  }
}
