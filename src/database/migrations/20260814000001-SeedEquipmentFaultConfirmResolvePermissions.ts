import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Seed permissions equipment.confirm_fault và equipment.resolve_fault cho feature EQUIP-FAULT-LIFECYCLE-001.
 * Idempotent: dùng WHERE NOT EXISTS để tránh trùng lặp khi chạy lại.
 * roles: SYSTEM_ADMIN, BUSINESS_ADMIN.
 * KHÔNG đặt trong src/database/seeds/ — migrations/ có runner chính thức.
 */
export class SeedEquipmentFaultConfirmResolvePermissions20260814000001 implements MigrationInterface {
  name = 'SeedEquipmentFaultConfirmResolvePermissions20260814000001';

  public async up(queryRunner: QueryRunner): Promise<void> {
    const permissions = [
      {
        code: 'equipment.confirm_fault',
        name: 'Xac nhan loi thiet bi la that',
        module: 'equipment',
        action: 'confirm_fault',
        description: 'Xac nhan thiet bi bi loi la thong tin dung va can xu ly',
      },
      {
        code: 'equipment.resolve_fault',
        name: 'Cap nhat thiet bi da sua xong',
        module: 'equipment',
        action: 'resolve_fault',
        description: 'Cap nhat thiet bi da duoc bao tri/khac phuc loi xong',
      },
    ];

    for (const p of permissions) {
      await queryRunner.query(
        `INSERT INTO permissions (permission_code, permission_name, module_code, action_code, description, is_active)
         SELECT $1::varchar, $2::varchar, $3::varchar, $4::varchar, $5::text, true
         WHERE NOT EXISTS (
           SELECT 1 FROM permissions WHERE permission_code = $1::varchar
         );`,
        [p.code, p.name, p.module, p.action, p.description],
      );

      const rows = (await queryRunner.query(
        `SELECT id FROM permissions WHERE permission_code = $1;`,
        [p.code],
      )) as Array<{ id: string }>;

      const permissionId = rows[0]?.id;
      if (!permissionId) continue;

      const roleCodes = ['SYSTEM_ADMIN', 'BUSINESS_ADMIN'];
      for (const roleCode of roleCodes) {
        await queryRunner.query(
          `INSERT INTO role_permissions (role_id, permission_id, granted_at)
           SELECT r.id, $2::uuid, NOW()
           FROM roles r
           WHERE r.role_code = $1 AND r.is_active = true
             AND NOT EXISTS (
               SELECT 1 FROM role_permissions rp2
               WHERE rp2.role_id = r.id AND rp2.permission_id = $2::uuid
             );`,
          [roleCode, permissionId],
        );
      }
    }
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    const codes = ['equipment.confirm_fault', 'equipment.resolve_fault'];
    await queryRunner.query(
      `DELETE FROM role_permissions
       WHERE permission_id IN (
         SELECT id FROM permissions WHERE permission_code = ANY($1)
       );`,
      [codes],
    );
    await queryRunner.query(
      `DELETE FROM permissions WHERE permission_code = ANY($1);`,
      [codes],
    );
  }
}
