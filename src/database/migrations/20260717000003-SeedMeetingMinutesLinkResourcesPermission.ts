import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Seed permission cho feature UC-141 (feat-link-minutes-resources):
 * - meeting.minutes.link_resources
 *
 * Dung role code THAT ngay tu dau (EMPLOYEE, khong dung INTERNAL_USER)
 * — bai hoc rut ra tu gap fix 20260717000001-FixMinutesAttachmentEmployeeRole.ts
 * va tien le 20260711000001-SeedRecordingUploadTrackEmployeeRole.ts.
 */
export class SeedMeetingMinutesLinkResourcesPermission20260717000003 implements MigrationInterface {
  name = 'SeedMeetingMinutesLinkResourcesPermission20260717000003';

  private readonly permission = {
    code: 'meeting.minutes.link_resources',
    name: 'Lien ket recording/transcript voi bien ban',
    action: 'minutes.link_resources',
    description:
      'Cho phep Host lien ket/huy lien ket 1 file recording va/hoac 1 transcript voi bien ban dang draft',
  };

  private readonly roles = [
    'EMPLOYEE',
    'MANAGER',
    'BUSINESS_ADMIN',
    'SYSTEM_ADMIN',
  ];

  public async up(queryRunner: QueryRunner): Promise<void> {
    const p = this.permission;
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
      return;
    }

    for (const roleCode of this.roles) {
      await queryRunner.query(
        'INSERT INTO role_permissions (role_id, permission_id, granted_at) SELECT r.id, $2, NOW() FROM roles r WHERE r.role_code = $1 AND r.is_active = true ON CONFLICT (role_id, permission_id) DO NOTHING;',
        [roleCode, permissionId],
      );
    }
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    const code = this.permission.code;
    await queryRunner.query(
      'DELETE FROM role_permissions WHERE permission_id IN (SELECT id FROM permissions WHERE permission_code = $1);',
      [code],
    );
    await queryRunner.query(
      'DELETE FROM permissions WHERE permission_code = $1;',
      [code],
    );
  }
}
