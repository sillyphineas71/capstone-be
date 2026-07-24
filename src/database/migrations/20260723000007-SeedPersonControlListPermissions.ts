import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Seed 4 permission person_control_list.create/read/update/delete cho feature
 * uc125-person-watchlist (PWL-001, CRUD watchlist nguoi). Role mapping mirror
 * vehicle_control.* cua UC8: create/update/delete -> BUSINESS_ADMIN,SYSTEM_ADMIN;
 * read -> them MANAGER. Idempotent: dung WHERE NOT EXISTS de tranh trung lap khi chay lai.
 */
export class SeedPersonControlListPermissions20260723000007 implements MigrationInterface {
  name = 'SeedPersonControlListPermissions20260723000007';

  private readonly entries: Array<{
    code: string;
    name: string;
    action: string;
    roles: string[];
  }> = [
    {
      code: 'person_control_list.create',
      name: 'Them nguoi vao danh sach kiem soat',
      action: 'create',
      roles: ['BUSINESS_ADMIN', 'SYSTEM_ADMIN'],
    },
    {
      code: 'person_control_list.read',
      name: 'Xem danh sach kiem soat nguoi',
      action: 'read',
      roles: ['MANAGER', 'BUSINESS_ADMIN', 'SYSTEM_ADMIN'],
    },
    {
      code: 'person_control_list.update',
      name: 'Sua ban ghi trong danh sach kiem soat nguoi',
      action: 'update',
      roles: ['BUSINESS_ADMIN', 'SYSTEM_ADMIN'],
    },
    {
      code: 'person_control_list.delete',
      name: 'Xoa nguoi khoi danh sach kiem soat',
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
