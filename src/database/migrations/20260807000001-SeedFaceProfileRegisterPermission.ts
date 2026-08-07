import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Seed permission `account.face.register` cho FPE-001 (POST /users/:userId/face-profile).
 *
 * Bối cảnh: controller dùng MockPermissionsGuard (canActivate luôn true) thay vì
 * PermissionsGuard thật — bất kỳ user đăng nhập nào cũng enroll khuôn mặt hộ userId
 * bất kỳ. Đã gỡ Mock ở face-profile.controller.ts, wire PermissionsGuard +
 * @RequirePermissions('account.face.register') thật — nhưng permission này CHƯA từng
 * được seed (grep 0 kết quả trong migrations/), nên cần seed ngay để tránh 403 toàn bộ.
 *
 * Role-set: BUSINESS_ADMIN, SYSTEM_ADMIN — khớp docs/API_CONTRACT_v1.0_with_system_roles.md
 * dòng 862-863 (UC-17, System Role: BUSINESS_ADMIN, SYSTEM_ADMIN).
 *
 * Khuôn: 20260727000005-SeedUserExportPermission.ts (idempotent WHERE NOT EXISTS).
 */
export class SeedFaceProfileRegisterPermission20260807000001 implements MigrationInterface {
  name = 'SeedFaceProfileRegisterPermission20260807000001';

  private readonly entries: Array<{
    code: string;
    name: string;
    action: string;
    roles: string[];
  }> = [
    {
      code: 'account.face.register',
      name: 'Đăng ký ảnh chân dung khuôn mặt cho tài khoản',
      action: 'register',
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
