import { DataSource } from 'typeorm';

/**
 * Seed: permission department.read (liệt kê phòng ban — GET /departments).
 *
 * Role-set (ĐỀ XUẤT): ADMIN, MANAGER, SYSTEM_ADMIN, BUSINESS_ADMIN — hợp của sibling
 * department.create (ADMIN/MANAGER) và yêu cầu "vai trò quản trị: System Admin, Business Admin".
 * Mirror seedDepartmentPermission (20260608025436). Idempotent: ON CONFLICT DO NOTHING.
 */
export async function seedDepartmentReadPermission(
  dataSource: DataSource,
): Promise<void> {
  const queryRunner = dataSource.createQueryRunner();
  await queryRunner.connect();
  await queryRunner.startTransaction();

  try {
    const permResult = await queryRunner.query(
      'INSERT INTO permissions (permission_code, permission_name, module_code, action_code, description, is_active) ' +
        "VALUES ('department.read', 'Liệt kê phòng ban', 'accounts', 'read', 'Cho phép xem danh sách phòng ban trong module accounts', true) " +
        'ON CONFLICT (permission_code) DO NOTHING RETURNING id;',
    );

    const permissionId = permResult[0]?.id;

    if (!permissionId) {
      const existing = await queryRunner.query(
        "SELECT id FROM permissions WHERE permission_code = 'department.read';",
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
  const roles = ['ADMIN', 'MANAGER', 'SYSTEM_ADMIN', 'BUSINESS_ADMIN'];
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
