import { DataSource } from "typeorm";

export async function seedMeetingRequestReadPermission(
  dataSource: DataSource,
): Promise<void> {
  const queryRunner = dataSource.createQueryRunner();
  await queryRunner.connect();
  await queryRunner.startTransaction();

  try {
    const permission = {
      code: "meeting_request.read",
      name: "Xem yêu cầu cuộc họp",
      module: "meetings",
      action: "read",
      description: "Cho phép xem danh sách yêu cầu cuộc họp",
    };

    const permResult = await queryRunner.query(
      `INSERT INTO permissions (permission_code, permission_name, module_code, action_code, description, is_active)
       VALUES ($1, $2, $3, $4, $5, true)
       ON CONFLICT (permission_code) DO NOTHING
       RETURNING id;`,
      [permission.code, permission.name, permission.module, permission.action, permission.description],
    );

    const permissionId = permResult[0]?.id;

    if (permissionId) {
      const adminRole = await queryRunner.query(
        `SELECT id FROM roles WHERE role_code = $1 AND is_active = true;`,
        ["ADMIN"],
      );

      if (adminRole[0]?.id) {
        await queryRunner.query(
          `INSERT INTO role_permissions (role_id, permission_id, granted_at)
           VALUES ($1, $2, NOW())
           ON CONFLICT (role_id, permission_id) DO NOTHING;`,
          [adminRole[0].id, permissionId],
        );
      }

      const managerRole = await queryRunner.query(
        `SELECT id FROM roles WHERE role_code = $1 AND is_active = true;`,
        ["MANAGER"],
      );

      if (managerRole[0]?.id) {
        await queryRunner.query(
          `INSERT INTO role_permissions (role_id, permission_id, granted_at)
           VALUES ($1, $2, NOW())
           ON CONFLICT (role_id, permission_id) DO NOTHING;`,
          [managerRole[0].id, permissionId],
        );
      }

      const businessAdminRole = await queryRunner.query(
        `SELECT id FROM roles WHERE role_code = $1 AND is_active = true;`,
        ["BUSINESS_ADMIN"],
      );

      if (businessAdminRole[0]?.id) {
        await queryRunner.query(
          `INSERT INTO role_permissions (role_id, permission_id, granted_at)
           VALUES ($1, $2, NOW())
           ON CONFLICT (role_id, permission_id) DO NOTHING;`,
          [businessAdminRole[0].id, permissionId],
        );
      }

      const systemAdminRole = await queryRunner.query(
        `SELECT id FROM roles WHERE role_code = $1 AND is_active = true;`,
        ["SYSTEM_ADMIN"],
      );

      if (systemAdminRole[0]?.id) {
        await queryRunner.query(
          `INSERT INTO role_permissions (role_id, permission_id, granted_at)
           VALUES ($1, $2, NOW())
           ON CONFLICT (role_id, permission_id) DO NOTHING;`,
          [systemAdminRole[0].id, permissionId],
        );
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
