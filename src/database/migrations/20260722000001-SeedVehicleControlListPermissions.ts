import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Seed 4 permission vehicle_control.create/read/update/delete cho feature
 * uc8-control-list-crud (VCL-001, CRUD danh sach kiem soat phuong tien blocklist/watchlist).
 * Role mapping da chot: create/update/delete -> BUSINESS_ADMIN,SYSTEM_ADMIN;
 * read -> them MANAGER. Idempotent: dung WHERE NOT EXISTS de tranh trung lap khi chay lai.
 */
export class SeedVehicleControlListPermissions20260722000001 implements MigrationInterface {
  name = 'SeedVehicleControlListPermissions20260722000001';

  private readonly entries: Array<{
    code: string;
    name: string;
    action: string;
    roles: string[];
  }> = [
    {
      code: 'vehicle_control.create',
      name: 'Them bien so vao danh sach kiem soat',
      action: 'create',
      roles: ['BUSINESS_ADMIN', 'SYSTEM_ADMIN'],
    },
    {
      code: 'vehicle_control.read',
      name: 'Xem danh sach kiem soat phuong tien',
      action: 'read',
      roles: ['MANAGER', 'BUSINESS_ADMIN', 'SYSTEM_ADMIN'],
    },
    {
      code: 'vehicle_control.update',
      name: 'Sua bien so trong danh sach kiem soat',
      action: 'update',
      roles: ['BUSINESS_ADMIN', 'SYSTEM_ADMIN'],
    },
    {
      code: 'vehicle_control.delete',
      name: 'Xoa bien so khoi danh sach kiem soat',
      action: 'delete',
      roles: ['BUSINESS_ADMIN', 'SYSTEM_ADMIN'],
    },
  ];

  public async up(queryRunner: QueryRunner): Promise<void> {
    for (const e of this.entries) {
      await queryRunner.query(
        `INSERT INTO permissions (permission_code, permission_name, module_code, action_code, description, is_active)
         SELECT $1::varchar, $2::varchar, 'anpr', $3::varchar, $2::text, true
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
