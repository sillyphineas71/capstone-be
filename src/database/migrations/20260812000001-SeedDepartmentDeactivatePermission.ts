import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Seed permission department.deactivate cho ACCT-DEPT-DEACTIVATE-001
 * (POST /departments/:id/deactivate + POST /departments/:id/reactivate).
 * Dùng chung 1 permission cho cả 2 chiều của vòng đời trạng thái phòng ban
 * (spec §2 — không tách department.reactivate riêng).
 * Role mapping doi chieu dung department.update trong
 * 20260727000001-SeedDepartmentUpdatePermission.ts (MANAGER, SYSTEM_ADMIN).
 * Khuon: 20260727000001-SeedDepartmentUpdatePermission.ts (idempotent WHERE NOT EXISTS).
 */
export class SeedDepartmentDeactivatePermission20260812000001 implements MigrationInterface {
  name = 'SeedDepartmentDeactivatePermission20260812000001';

  private readonly entries: Array<{
    code: string;
    name: string;
    action: string;
    roles: string[];
  }> = [
    {
      code: 'department.deactivate',
      name: 'Vo hieu hoa / kich hoat lai phong ban',
      action: 'deactivate',
      roles: ['MANAGER', 'SYSTEM_ADMIN'],
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
