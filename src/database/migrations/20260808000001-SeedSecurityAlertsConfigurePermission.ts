import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Seed permission security_alerts.configure cho tinh nang auto-resolve
 * security_alerts (nguong timeout cau hinh qua UI SysAdmin). Mirror pattern
 * room.noshow.configure: CHI SYSTEM_ADMIN (hep hon alert_rules.update von
 * con cap ca BUSINESS_ADMIN). Idempotent: dung WHERE NOT EXISTS de tranh
 * trung lap khi chay lai.
 */
export class SeedSecurityAlertsConfigurePermission20260808000001
  implements MigrationInterface
{
  name = 'SeedSecurityAlertsConfigurePermission20260808000001';

  private readonly entries: Array<{
    code: string;
    name: string;
    action: string;
    roles: string[];
  }> = [
    {
      code: 'security_alerts.configure',
      name: 'Cau hinh nguong auto-resolve canh bao an ninh',
      action: 'configure',
      roles: ['SYSTEM_ADMIN'],
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
