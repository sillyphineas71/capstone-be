import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Bug 7.2 — 20260720000005-BackfillRolePermissions.ts chỉ cấp
 * recording.config.create/read/update cho MANAGER/SYSTEM_ADMIN, thiếu
 * BUSINESS_ADMIN (mirror recording.files.manage đã có BUSINESS_ADMIN) và
 * EMPLOYEE (cần để Host/Organizer của chính meeting đó cấu hình được recording
 * — xem check quyền sở hữu mới trong RecordingConfigService, mirror pattern
 * meeting.update.own của MeetingUpdateService: permission cấp rộng ở role,
 * ownership check ở service layer).
 *
 * Permission KHÔNG mới, chỉ thêm role_permissions. Idempotent qua ON CONFLICT.
 */
export class FixRecordingConfigEmployeeHostAndBusinessAdminPermissions20260731000001 implements MigrationInterface {
  name =
    'FixRecordingConfigEmployeeHostAndBusinessAdminPermissions20260731000001';

  private readonly grants: Array<{ role: string; permission: string }> = [
    { role: 'BUSINESS_ADMIN', permission: 'recording.config.create' },
    { role: 'BUSINESS_ADMIN', permission: 'recording.config.read' },
    { role: 'BUSINESS_ADMIN', permission: 'recording.config.update' },
    { role: 'EMPLOYEE', permission: 'recording.config.create' },
    { role: 'EMPLOYEE', permission: 'recording.config.read' },
    { role: 'EMPLOYEE', permission: 'recording.config.update' },
  ];

  public async up(queryRunner: QueryRunner): Promise<void> {
    for (const { role, permission } of this.grants) {
      await queryRunner.query(
        `INSERT INTO role_permissions (role_id, permission_id, granted_at)
         SELECT r.id, p.id, NOW()
         FROM roles r, permissions p
         WHERE r.role_code = $1 AND r.is_active = true AND p.permission_code = $2
         ON CONFLICT (role_id, permission_id) DO NOTHING;`,
        [role, permission],
      );
    }
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    for (const { role, permission } of this.grants) {
      await queryRunner.query(
        `DELETE FROM role_permissions
         WHERE role_id IN (SELECT id FROM roles WHERE role_code = $1)
           AND permission_id IN (SELECT id FROM permissions WHERE permission_code = $2);`,
        [role, permission],
      );
    }
  }
}
