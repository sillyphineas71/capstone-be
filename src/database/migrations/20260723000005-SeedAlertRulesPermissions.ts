import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Seed 4 permission alert_rules.create/read/update/delete cho feature
 * uc122-alert-rules-crud (ARL-001, CRUD cau hinh nguong/kenh/bat-tat canh bao).
 * Role mapping da chot: create/update/delete -> BUSINESS_ADMIN,SYSTEM_ADMIN;
 * read -> them MANAGER (mirror vehicle_control.* cua UC8). Idempotent: dung
 * WHERE NOT EXISTS de tranh trung lap khi chay lai.
 */
export class SeedAlertRulesPermissions20260723000005 implements MigrationInterface {
  name = 'SeedAlertRulesPermissions20260723000005';

  private readonly entries: Array<{
    code: string;
    name: string;
    action: string;
    roles: string[];
  }> = [
    {
      code: 'alert_rules.create',
      name: 'Tao rule canh bao',
      action: 'create',
      roles: ['BUSINESS_ADMIN', 'SYSTEM_ADMIN'],
    },
    {
      code: 'alert_rules.read',
      name: 'Xem rule canh bao',
      action: 'read',
      roles: ['MANAGER', 'BUSINESS_ADMIN', 'SYSTEM_ADMIN'],
    },
    {
      code: 'alert_rules.update',
      name: 'Sua rule canh bao',
      action: 'update',
      roles: ['BUSINESS_ADMIN', 'SYSTEM_ADMIN'],
    },
    {
      code: 'alert_rules.delete',
      name: 'Xoa rule canh bao',
      action: 'delete',
      roles: ['BUSINESS_ADMIN', 'SYSTEM_ADMIN'],
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
