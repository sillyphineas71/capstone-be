import { DataSource } from 'typeorm';

/**
 * Seed: permission `accounts.user.update_status` (UC-11 — Cập nhật trạng thái
 * tài khoản ACTIVE/INACTIVE, PATCH /api/v1/users/:userId/status).
 *
 * Role-set: `SYSTEM_ADMIN` + `BUSINESS_ADMIN`. Business Admin bị giới hạn department
 * scope ở tầng service.
 * Mirror cấu trúc seedDepartmentReadPermission (20260704000001). Idempotent: ON CONFLICT DO NOTHING.
 *
 * ⚠️ Pattern seeds/*SeedXxxPermission*.ts hiện KHÔNG có runner tự động — file này CHƯA được
 * execute và CHƯA thêm vào bất kỳ runner nào. Chạy thủ công theo quy trình seed của dự án
 * sau khi được duyệt.
 */
export async function seedUserUpdateStatusPermission(
  dataSource: DataSource,
): Promise<void> {
  const queryRunner = dataSource.createQueryRunner();
  await queryRunner.connect();
  await queryRunner.startTransaction();

  try {
    const permResult = await queryRunner.query(
      'INSERT INTO permissions (permission_code, permission_name, module_code, action_code, description, is_active) ' +
        "VALUES ('accounts.user.update_status', 'Cập nhật trạng thái tài khoản', 'accounts', 'update', 'Cho phép cập nhật trạng thái tài khoản (active/inactive) trong module accounts', true) " +
        'ON CONFLICT (permission_code) DO NOTHING RETURNING id;',
    );

    const permissionId = permResult[0]?.id;

    if (!permissionId) {
      const existing = await queryRunner.query(
        "SELECT id FROM permissions WHERE permission_code = 'accounts.user.update_status';",
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
  // SYSTEM_ADMIN (toàn hệ thống) + BUSINESS_ADMIN (giới hạn scope ở service) — UC-11.
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
