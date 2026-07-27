import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Seed permission accounts.user.export cho BE-04 (GET /api/v1/users/export).
 * Doi chieu accounts.user.import trong 20260720000005-BackfillRolePermissions.ts
 * (BUSINESS_ADMIN, SYSTEM_ADMIN) -> seed giong het: export toan bo du lieu nguoi dung
 * la hanh dong quan tri, KHONG cap EMPLOYEE/MANAGER (khac accounts.user.list rong hon,
 * xem PLAN_THUC_THI_P1_CODE_VA_SPEC_2026-07-27.md T-5.12).
 * Khuon: 20260726000003-SeedMeetingReadAllPermission.ts (idempotent WHERE NOT EXISTS).
 */
export class SeedUserExportPermission20260727000005 implements MigrationInterface {
  name = 'SeedUserExportPermission20260727000005';

  private readonly entries: Array<{
    code: string;
    name: string;
    action: string;
    roles: string[];
  }> = [
    {
      code: 'accounts.user.export',
      name: 'Xuat danh sach nguoi dung ra file',
      action: 'export',
      roles: ['BUSINESS_ADMIN', 'SYSTEM_ADMIN'],
    },
  ];

  public async up(queryRunner: QueryRunner): Promise<void> {
    for (const e of this.entries) {
      await queryRunner.query(
        `INSERT INTO permissions (permission_code, permission_name, module_code, action_code, description, is_active)
         SELECT $1::varchar, $2::varchar, 'accounts', $3::varchar, $2::text, true
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
