import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Seed 3 permission security_alert.read/acknowledge/resolve cho feature
 * uc123-alert-center (ASC-001, Trung tam canh bao an ninh). Role mapping da chot:
 * ca 3 quyen -> MANAGER,BUSINESS_ADMIN,SYSTEM_ADMIN (khong EMPLOYEE, chot qua
 * AskUserQuestion voi Thieu Chu). Idempotent: dung WHERE NOT EXISTS de tranh trung
 * lap khi chay lai.
 */
export class SeedSecurityAlertPermissions20260723000006 implements MigrationInterface {
  name = 'SeedSecurityAlertPermissions20260723000006';

  private readonly entries: Array<{
    code: string;
    name: string;
    action: string;
    roles: string[];
  }> = [
    {
      code: 'security_alert.read',
      name: 'Xem trung tam canh bao an ninh',
      action: 'read',
      roles: ['MANAGER', 'BUSINESS_ADMIN', 'SYSTEM_ADMIN'],
    },
    {
      code: 'security_alert.acknowledge',
      name: 'Nhan xu ly canh bao an ninh',
      action: 'acknowledge',
      roles: ['MANAGER', 'BUSINESS_ADMIN', 'SYSTEM_ADMIN'],
    },
    {
      code: 'security_alert.resolve',
      name: 'Dong canh bao an ninh',
      action: 'resolve',
      roles: ['MANAGER', 'BUSINESS_ADMIN', 'SYSTEM_ADMIN'],
    },
  ];

  public async up(queryRunner: QueryRunner): Promise<void> {
    for (const e of this.entries) {
      await queryRunner.query(
        `INSERT INTO permissions (permission_code, permission_name, module_code, action_code, description, is_active)
         SELECT $1::varchar, $2::varchar, 'alerts', $3::varchar, $2::text, true
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
