import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Seed 3 permissions cho feature attach-minutes-document:
 * - meeting.minutes.attachment.create
 * - meeting.minutes.attachment.read
 * - meeting.minutes.attachment.delete
 *
 * Dung migration (khong dung src/database/seeds/) — nhat quan voi
 * SeedMeetingMinutesReadPermission20260702010000.
 */
export class SeedMeetingMinutesAttachmentPermissions20260702020000
  implements MigrationInterface
{
  name = 'SeedMeetingMinutesAttachmentPermissions20260702020000';

  private readonly permissions = [
    {
      code: 'meeting.minutes.attachment.create',
      name: 'Dinh kem tai lieu vao bien ban',
      action: 'minutes.attachment.create',
      description: 'Cho phep upload file dinh kem cho bien ban dang o trang thai draft',
    },
    {
      code: 'meeting.minutes.attachment.read',
      name: 'Xem danh sach tai lieu dinh kem cua bien ban',
      action: 'minutes.attachment.read',
      description: 'Cho phep xem danh sach file dinh kem cua bien ban',
    },
    {
      code: 'meeting.minutes.attachment.delete',
      name: 'Go tai lieu dinh kem khoi bien ban',
      action: 'minutes.attachment.delete',
      description: 'Cho phep soft-delete file dinh kem cua bien ban dang o trang thai draft',
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
        [p.code, p.name, 'minutes', p.action, p.description],
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
