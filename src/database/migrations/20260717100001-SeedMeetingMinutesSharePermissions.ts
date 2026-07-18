import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Seed 3 permissions cho feature share-meeting-minutes:
 * - meeting.minutes.share.create
 * - meeting.minutes.share.read
 * - meeting.minutes.share.delete
 *
 * Mirror pattern 20260702020000-SeedMeetingMinutesAttachmentPermissions.ts.
 * Cap cho INTERNAL_USER, MANAGER, BUSINESS_ADMIN, SYSTEM_ADMIN — so huu permission
 * la dieu kien can, service con kiem tra ownership (preparedBy/hostId) / Admin bypass.
 */
export class SeedMeetingMinutesSharePermissions20260717100001
  implements MigrationInterface
{
  name = 'SeedMeetingMinutesSharePermissions20260717100001';

  private readonly permissions = [
    {
      code: 'meeting.minutes.share.create',
      name: 'Chia se bien ban cho nguoi dung cu the',
      action: 'minutes.share.create',
      description:
        'Cho phep Host/Admin cap quyen xem bien ban da published cho 1 user noi bo',
    },
    {
      code: 'meeting.minutes.share.read',
      name: 'Xem danh sach chia se cua bien ban',
      action: 'minutes.share.read',
      description:
        'Cho phep Host/Admin xem danh sach user dang duoc chia se bien ban',
    },
    {
      code: 'meeting.minutes.share.delete',
      name: 'Thu hoi quyen xem bien ban da chia se',
      action: 'minutes.share.delete',
      description:
        'Cho phep Host/Admin thu hoi quyen xem bien ban da chia se cho 1 user',
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
