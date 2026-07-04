import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Seed 3 permissions còn thiếu cho module minutes:
 * - meeting.minutes.update (dành cho INTERNAL_USER, MANAGER, BUSINESS_ADMIN, SYSTEM_ADMIN)
 * - meeting.minutes.delete (dành cho INTERNAL_USER, MANAGER, BUSINESS_ADMIN, SYSTEM_ADMIN)
 * - meeting.minutes.search_by_person (dành cho MANAGER, BUSINESS_ADMIN, SYSTEM_ADMIN)
 */
export class SeedMissingMeetingMinutesPermissions20260702040000
  implements MigrationInterface
{
  name = 'SeedMissingMeetingMinutesPermissions20260702040000';

  private readonly permissions = [
    {
      code: 'meeting.minutes.update',
      name: 'Cap nhat bien ban hop nhap',
      action: 'minutes.update',
      description: 'Cho phep Host hoac nguoi soan thao cap nhat bien ban hop o trang thai draft',
      roles: ['INTERNAL_USER', 'MANAGER', 'BUSINESS_ADMIN', 'SYSTEM_ADMIN'],
    },
    {
      code: 'meeting.minutes.delete',
      name: 'Xoa bien ban hop nhap',
      action: 'minutes.delete',
      description: 'Cho phep Host, nguoi soan thao hoac Admin xoa bien ban hop o trang thai draft',
      roles: ['INTERNAL_USER', 'MANAGER', 'BUSINESS_ADMIN', 'SYSTEM_ADMIN'],
    },
    {
      code: 'meeting.minutes.search_by_person',
      name: 'Tim kiem bien ban hop theo nhan su',
      action: 'minutes.search_by_person',
      description: 'Cho phep Manager hoac Admin tim kiem cac bien ban hop lien quan den mot nhan su',
      roles: ['MANAGER', 'BUSINESS_ADMIN', 'SYSTEM_ADMIN'],
    },
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

      for (const roleCode of p.roles) {
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
