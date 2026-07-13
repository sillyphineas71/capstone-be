import { DataSource } from 'typeorm';

/**
 * Seed: permission `accounts.user.manage` (UC-14 — Lọc danh sách tài khoản,
 * GET /api/v1/users/manage).
 *
 * Role-set: `SYSTEM_ADMIN` + `BUSINESS_ADMIN`. Business Admin bị giới hạn department
 * scope ở tầng service.
 * Mirror cấu trúc seedDepartmentReadPermission (20260704000001). Idempotent: ON CONFLICT DO NOTHING.
 *
 * ⚠️ Pattern seeds/*SeedXxxPermission*.ts hiện KHÔNG có runner tự động — file này CHƯA được
 * execute và CHƯA thêm vào bất kỳ runner nào. Chạy thủ công theo quy trình seed của dự án
 * sau khi được duyệt.
 */
export async function seedUserManagePermission(
  dataSource: DataSource,
): Promise<void> {
  const queryRunner = dataSource.createQueryRunner();
  await queryRunner.connect();
  await queryRunner.startTransaction();

  try {
    const permResult = await queryRunner.query(
      'INSERT INTO permissions (permission_code, permission_name, module_code, action_code, description, is_active) ' +
        "VALUES ('accounts.user.manage', 'Quản trị/lọc danh sách tài khoản', 'accounts', 'read', 'Cho phép lọc/duyệt danh sách tài khoản (theo phòng ban, vai trò, trạng thái) trong module accounts', true) " +
        'ON CONFLICT (permission_code) DO NOTHING RETURNING id;',
    );

    const permissionId = permResult[0]?.id;

    if (!permissionId) {
      const existing = await queryRunner.query(
        "SELECT id FROM permissions WHERE permission_code = 'accounts.user.manage';",
      );
      if (existing[0]?.id) {
        await assignPermissionToRoles(queryRunner, existing[0].id);
      }
    } else {
      await assignPermissionToRoles(queryRunner, permissionId);
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
  // SYSTEM_ADMIN (toàn hệ thống) + BUSINESS_ADMIN (giới hạn scope ở service) — UC-14.
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
