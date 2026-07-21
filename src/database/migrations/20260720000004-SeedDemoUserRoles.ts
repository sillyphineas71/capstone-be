import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Gan role cho 14 user demo da tao o 20260720000003-SeedDemoUsers.ts:
 * 1 SYSTEM_ADMIN, 2 BUSINESS_ADMIN, 3 MANAGER, 8 EMPLOYEE.
 * assigned_by = user 'sysadmin' cho tat ca (tru chinh no, tu bootstrap = NULL).
 */
export class SeedDemoUserRoles20260720000004 implements MigrationInterface {
  name = 'SeedDemoUserRoles20260720000004';

  private readonly assignments: Array<{ username: string; roleCode: string }> =
    [
      { username: 'sysadmin', roleCode: 'SYSTEM_ADMIN' },
      { username: 'bizadmin.it', roleCode: 'BUSINESS_ADMIN' },
      { username: 'bizadmin.hr', roleCode: 'BUSINESS_ADMIN' },
      { username: 'manager.it', roleCode: 'MANAGER' },
      { username: 'manager.hr', roleCode: 'MANAGER' },
      { username: 'manager.sales', roleCode: 'MANAGER' },
      { username: 'emp.it1', roleCode: 'EMPLOYEE' },
      { username: 'emp.it2', roleCode: 'EMPLOYEE' },
      { username: 'emp.hr1', roleCode: 'EMPLOYEE' },
      { username: 'emp.hr2', roleCode: 'EMPLOYEE' },
      { username: 'emp.sales1', roleCode: 'EMPLOYEE' },
      { username: 'emp.sales2', roleCode: 'EMPLOYEE' },
      { username: 'emp.admin1', roleCode: 'EMPLOYEE' },
      { username: 'emp.facility1', roleCode: 'EMPLOYEE' },
    ];

  public async up(queryRunner: QueryRunner): Promise<void> {
    const sysAdminRow = (await queryRunner.query(
      `SELECT id FROM users WHERE lower(username) = 'sysadmin';`,
    )) as Array<{ id: string }>;
    const sysAdminId = sysAdminRow[0]?.id ?? null;

    for (const a of this.assignments) {
      const assignedBy = a.username === 'sysadmin' ? null : sysAdminId;
      await queryRunner.query(
        `INSERT INTO user_roles (user_id, role_id, assigned_by, is_active)
         SELECT u.id, r.id, $3, true
         FROM users u, roles r
         WHERE lower(u.username) = lower($1) AND r.role_code = $2
           AND NOT EXISTS (
             SELECT 1 FROM user_roles ur2
             WHERE ur2.user_id = u.id AND ur2.role_id = r.id AND ur2.is_active = true
           );`,
        [a.username, a.roleCode, assignedBy],
      );
    }
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    const usernames = this.assignments.map((a) => a.username.toLowerCase());
    await queryRunner.query(
      `DELETE FROM user_roles WHERE user_id IN (SELECT id FROM users WHERE lower(username) = ANY($1));`,
      [usernames],
    );
  }
}
