import { DataSource } from 'typeorm';

/**
 * Seed: 2 permission cho UC-12 — Khóa/Mở khóa tài khoản.
 *  - `accounts.user.lock`   (PATCH /api/v1/users/:userId/lock)
 *  - `accounts.user.unlock` (PATCH /api/v1/users/:userId/unlock)
 *
 * Role-set (cho mỗi permission): `SYSTEM_ADMIN` + `BUSINESS_ADMIN`. Business Admin bị
 * giới hạn department scope ở tầng service.
 * Mirror cấu trúc seedDepartmentReadPermission (20260704000001). Idempotent: ON CONFLICT DO NOTHING.
 *
 * ⚠️ Pattern seeds/*SeedXxxPermission*.ts hiện KHÔNG có runner tự động — file này CHƯA được
 * execute và CHƯA thêm vào bất kỳ runner nào. Chạy thủ công theo quy trình seed của dự án
 * sau khi được duyệt.
 */
export async function seedUserLockPermissions(
  dataSource: DataSource,
): Promise<void> {
  const queryRunner = dataSource.createQueryRunner();
  await queryRunner.connect();
  await queryRunner.startTransaction();

  try {
    const permissions = [
      {
        code: 'accounts.user.lock',
        name: 'Khóa tài khoản',
        description:
          'Cho phép khóa (LOCKED) một tài khoản người dùng trong module accounts',
      },
      {
        code: 'accounts.user.unlock',
        name: 'Mở khóa tài khoản',
        description:
          'Cho phép mở khóa một tài khoản người dùng đang bị khóa trong module accounts',
      },
    ];

    for (const perm of permissions) {
      const permResult = await queryRunner.query(
        'INSERT INTO permissions (permission_code, permission_name, module_code, action_code, description, is_active) ' +
          'VALUES ($1, $2, $3, $4, $5, true) ' +
          'ON CONFLICT (permission_code) DO NOTHING RETURNING id;',
        [perm.code, perm.name, 'accounts', 'update', perm.description],
      );

      let permissionId = permResult[0]?.id;
      if (!permissionId) {
        const existing = await queryRunner.query(
          'SELECT id FROM permissions WHERE permission_code = $1;',
          [perm.code],
        );
        permissionId = existing[0]?.id;
      }

      if (permissionId) {
        await assignPermissionToRoles(queryRunner, permissionId);
      }
    }

    await queryRunner.commitTransaction();
  } catch (error) {
    await queryRunner.rollbackTransaction();
    throw error;
  } finally {
    await queryRunner.release();
  }
}

async function assignPermissionToRoles(
  queryRunner: any,
  permissionId: string,
): Promise<void> {
  // Khóa/mở khóa: SYSTEM_ADMIN (toàn hệ thống) + BUSINESS_ADMIN (giới hạn scope ở service).
  const roles = ['SYSTEM_ADMIN', 'BUSINESS_ADMIN'];
  for (const roleCode of roles) {
    const roleResult = await queryRunner.query(
      'SELECT id FROM roles WHERE role_code = $1 AND is_active = true;',
      [roleCode],
    );

    if (roleResult[0]?.id) {
      await queryRunner.query(
        'INSERT INTO role_permissions (role_id, permission_id, granted_at) VALUES ($1, $2, NOW()) ON CONFLICT (role_id, permission_id) DO NOTHING;',
        [roleResult[0].id, permissionId],
      );
    }
  }
}
