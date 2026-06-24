import { DataSource } from 'typeorm';

export async function seedUserListPermission(
  dataSource: DataSource,
): Promise<void> {
  const queryRunner = dataSource.createQueryRunner();
  await queryRunner.connect();
  await queryRunner.startTransaction();

  try {
    const permission = {
      code: 'accounts.user.list',
      name: 'Tìm kiếm/danh sách người dùng',
      module: 'accounts',
      action: 'user_list',
      description:
        'Cho phép tìm kiếm và xem danh sách rút gọn người dùng nội bộ (ví dụ để mời tham gia cuộc họp)',
    };

    const permResult = await queryRunner.query(
      `INSERT INTO permissions (permission_code, permission_name, module_code, action_code, description, is_active)
       VALUES ($1, $2, $3, $4, $5, true)
       ON CONFLICT (permission_code) DO NOTHING
       RETURNING id;`,
      [
        permission.code,
        permission.name,
        permission.module,
        permission.action,
        permission.description,
      ],
    );

    const permissionId = permResult[0]?.id;

    if (permissionId) {
      const roleCodes = [
        'EMPLOYEE',
        'MANAGER',
        'BUSINESS_ADMIN',
        'SYSTEM_ADMIN',
      ];

      for (const roleCode of roleCodes) {
        const roleResult = await queryRunner.query(
          `SELECT id FROM roles WHERE role_code = $1 AND is_active = true;`,
          [roleCode],
        );

        if (roleResult[0]?.id) {
          await queryRunner.query(
            `INSERT INTO role_permissions (role_id, permission_id, granted_at)
             VALUES ($1, $2, NOW())
             ON CONFLICT (role_id, permission_id) DO NOTHING;`,
            [roleResult[0].id, permissionId],
          );
        }
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
