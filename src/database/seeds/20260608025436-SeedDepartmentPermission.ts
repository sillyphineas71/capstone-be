import { DataSource } from 'typeorm';

/**
 * Seed: permission department.create cho roles ADMIN và MANAGER.
 * Chạy sau khi migration xong và có dữ liệu roles/permissions gốc.
 */
export async function seedDepartmentPermission(
  dataSource: DataSource,
): Promise<void> {
  const queryRunner = dataSource.createQueryRunner();
  await queryRunner.connect();
  await queryRunner.startTransaction();

  try {
    // 1. Tạo permission department.create
    const permResult = await queryRunner.query(
      'INSERT INTO permissions (permission_code, permission_name, module_code, action_code, description, is_active) ' +
        "VALUES ('department.create', 'Tạo phòng ban', 'accounts', 'create', 'Cho phép tạo phòng ban mới trong module accounts', true) " +
        'ON CONFLICT (permission_code) DO NOTHING RETURNING id;',
    );

    const permissionId = permResult[0]?.id;

    if (!permissionId) {
      const existing = await queryRunner.query(
        "SELECT id FROM permissions WHERE permission_code = 'department.create';",
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
  const roles = ['ADMIN', 'MANAGER'];
  for (const roleCode of roles) {
    const roleResult = await queryRunner.query(
      'SELECT id FROM roles WHERE role_code =  AND is_active = true;',
      [roleCode],
    );

    if (roleResult[0]?.id) {
      await queryRunner.query(
        'INSERT INTO role_permissions (role_id, permission_id, granted_at) VALUES (, , NOW()) ON CONFLICT (role_id, permission_id) DO NOTHING;',
        [roleResult[0].id, permissionId],
      );
    }
  }
}
