import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Seed permission admin.manage_config cho BE-09
 * (GET/PATCH /api/v1/system-configurations).
 * Chi doi chieu SystemSettings.jsx nam trong systemAdmin/ (chi danh cho System Admin)
 * -> chi seed SYSTEM_ADMIN, KHONG cap BUSINESS_ADMIN (khac voi department.update/
 * meeting.read.all - nhung permission do co ca BUSINESS_ADMIN vi la nghiep vu chung,
 * con day la cau hinh he thong nhay cam - PLAN_THUC_THI_P1_CODE_VA_SPEC_2026-07-27.md T-4.9).
 * Khuon: 20260726000003-SeedMeetingReadAllPermission.ts (idempotent WHERE NOT EXISTS).
 */
export class SeedSystemConfigManagePermission20260727000003 implements MigrationInterface {
  name = 'SeedSystemConfigManagePermission20260727000003';

  private readonly entries: Array<{
    code: string;
    name: string;
    action: string;
    roles: string[];
  }> = [
    {
      code: 'admin.manage_config',
      name: 'Quan tri cau hinh he thong',
      action: 'manage',
      roles: ['SYSTEM_ADMIN'],
    },
  ];

  public async up(queryRunner: QueryRunner): Promise<void> {
    for (const e of this.entries) {
      await queryRunner.query(
        `INSERT INTO permissions (permission_code, permission_name, module_code, action_code, description, is_active)
         SELECT $1::varchar, $2::varchar, 'administration', $3::varchar, $2::text, true
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
