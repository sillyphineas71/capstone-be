import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Seed 3 permissions cho feat-external-guest-live-meeting-access (GLA-001):
 * - meeting.guest.invite.manage  (gui lai link / thu hoi loi moi khach)
 * - meeting.guest.session.read   (xem danh sach khach dang online)
 * - meeting.guest.admit          (duyet/tu choi khach o phong cho)
 *
 * KHACH KHONG duoc cap bat ky permission nao trong so nay — day la permission
 * cho HOST/ADMIN quan ly loi moi, khach di duong rieng /api/v1/guest/... khong
 * qua PermissionsGuard (xem spec.md muc 2.2/FR-GLA-023).
 *
 * Mirror pattern 20260717100001-SeedMeetingMinutesSharePermissions.ts.
 * Cap cho INTERNAL_USER, MANAGER, BUSINESS_ADMIN, SYSTEM_ADMIN — so huu
 * permission la dieu kien can, service con kiem tra ownership (meeting.hostId)
 * / Admin bypass.
 */
export class SeedGuestAccessPermissions20260807000003
  implements MigrationInterface
{
  name = 'SeedGuestAccessPermissions20260807000003';

  private readonly permissions = [
    {
      code: 'meeting.guest.invite.manage',
      name: 'Quan ly loi moi khach ngoai cong ty',
      action: 'guest.invite.manage',
      description:
        'Cho phep Host/Admin gui lai link moi hoac thu hoi quyen truy cap cua khach ngoai cong ty',
    },
    {
      code: 'meeting.guest.session.read',
      name: 'Xem danh sach khach dang truy cap',
      action: 'guest.session.read',
      description:
        'Cho phep Host/Admin xem danh sach khach ngoai cong ty dang truy cap/da duoc moi',
    },
    {
      code: 'meeting.guest.admit',
      name: 'Duyet khach ngoai cong ty vao phong cho',
      action: 'guest.admit',
      description:
        'Cho phep Host/Admin duyet hoac tu choi khach ngoai cong ty dang o phong cho',
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
        [p.code, p.name, 'guest-access', p.action, p.description],
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
