import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Seed permissions con thieu cho LiveMeetingController (UC-IMM-07/08):
 * - meeting.presence.read  (GET /live-meetings/:meetingId/present-attendees)
 * - attendance.read        (GET /meetings/:meetingId/attendance)
 *
 * Hai permission_code nay duoc @RequirePermissions() tham chieu trong
 * live-meeting.controller.ts nhung chua tung duoc seed o dau -> moi role
 * (ke ca SYSTEM_ADMIN) deu bi 403 khi goi 2 endpoint tren.
 */
export class SeedLiveMeetingAttendancePresencePermissions20260703010000 implements MigrationInterface {
  name = 'SeedLiveMeetingAttendancePresencePermissions20260703010000';

  private readonly permissions = [
    {
      code: 'meeting.presence.read',
      name: 'Xem danh sach nguoi tham du dang co mat',
      action: 'presence.read',
      description:
        'Cho phep xem danh sach nguoi tham du dang co mat trong phien hop dang dien ra',
    },
    {
      code: 'attendance.read',
      name: 'Xem trang thai diem danh cuoc hop',
      action: 'attendance.read',
      description:
        'Cho phep xem trang thai diem danh cua nguoi tham du trong cuoc hop',
    },
  ];

  private readonly roles = [
    'INTERNAL_USER',
    'MANAGER',
    'BUSINESS_ADMIN',
    'SYSTEM_ADMIN',
  ];

  public async up(queryRunner: QueryRunner): Promise<void> {
    for (const p of this.permissions) {
      const inserted: Array<{ id: string }> = await queryRunner.query(
        'INSERT INTO permissions (permission_code, permission_name, module_code, action_code, description, is_active) VALUES ($1, $2, $3, $4, $5, true) ON CONFLICT (permission_code) DO NOTHING RETURNING id;',
        [p.code, p.name, 'live-meeting', p.action, p.description],
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
        continue;
      }

      for (const roleCode of this.roles) {
        await queryRunner.query(
          'INSERT INTO role_permissions (role_id, permission_id, granted_at) SELECT r.id, $2, NOW() FROM roles r WHERE r.role_code = $1 AND r.is_active = true ON CONFLICT (role_id, permission_id) DO NOTHING;',
          [roleCode, permissionId],
        );
      }
    }
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    for (const p of this.permissions) {
      await queryRunner.query(
        'DELETE FROM role_permissions WHERE permission_id IN (SELECT id FROM permissions WHERE permission_code = $1);',
        [p.code],
      );
      await queryRunner.query(
        'DELETE FROM permissions WHERE permission_code = $1;',
        [p.code],
      );
    }
  }
}
