import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Seed permission meeting.update.own cho BE-03 (PATCH /api/v1/meetings/{meetingId},
 * chi title/description). Role mapping doi chieu dung meeting.cancel.own dang
 * seed cho role nao -> seed GIONG HET (theo PLAN_THUC_THI_P0_CODE_VA_SPEC_2026-07-26.md,
 * T-5.7): EMPLOYEE, MANAGER, SYSTEM_ADMIN (xem 20260720000005-BackfillRolePermissions.ts,
 * entry meeting.cancel.own). Idempotent: dung WHERE NOT EXISTS.
 */
export class SeedMeetingUpdateOwnPermission20260726000004 implements MigrationInterface {
  name = 'SeedMeetingUpdateOwnPermission20260726000004';

  private readonly entries: Array<{
    code: string;
    name: string;
    action: string;
    roles: string[];
  }> = [
    {
      code: 'meeting.update.own',
      name: 'Cap nhat thong tin co ban cuoc hop cua minh',
      action: 'update',
      roles: ['EMPLOYEE', 'MANAGER', 'SYSTEM_ADMIN'],
    },
  ];

  public async up(queryRunner: QueryRunner): Promise<void> {
    for (const e of this.entries) {
      await queryRunner.query(
        `INSERT INTO permissions (permission_code, permission_name, module_code, action_code, description, is_active)
         SELECT $1::varchar, $2::varchar, 'meetings', $3::varchar, $2::text, true
         WHERE NOT EXISTS (SELECT 1 FROM permissions WHERE permission_code = $1);`,
        [e.code, e.name, e.action],
      );

      const rows = (await queryRunner.query(
        `SELECT id FROM permissions WHERE permission_code = $1;`,
        [e.code],
      )) as Array<{ id: string }>;
      const permissionId = rows[0]?.id;
      if (!permissionId) continue;

      for (const roleCode of e.roles) {
        await queryRunner.query(
          `INSERT INTO role_permissions (role_id, permission_id, granted_at)
           SELECT r.id, $2::uuid, NOW()
           FROM roles r
           WHERE r.role_code = $1 AND r.is_active = true
             AND NOT EXISTS (
               SELECT 1 FROM role_permissions rp2 WHERE rp2.role_id = r.id AND rp2.permission_id = $2::uuid
             );`,
          [roleCode, permissionId],
        );
      }
    }
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    const codes = this.entries.map((e) => e.code);
    await queryRunner.query(
      `DELETE FROM role_permissions WHERE permission_id IN (SELECT id FROM permissions WHERE permission_code = ANY($1));`,
      [codes],
    );
    await queryRunner.query(
      `DELETE FROM permissions WHERE permission_code = ANY($1);`,
      [codes],
    );
  }
}
