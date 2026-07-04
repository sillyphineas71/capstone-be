import { DataSource } from 'typeorm';

/**
 * Seed: permission room.noshow.read (liệt kê no-show case — GET /no-show-cases).
 *
 * Role-set: SYSTEM_ADMIN, MANAGER, BUSINESS_ADMIN — nhất quán với room.utilization.read
 * trong RBAC_Camera_Decisions (đều là quyền đọc bảng giám sát phòng).
 * Idempotent: ON CONFLICT DO NOTHING + fallback SELECT-existing để re-run áp lại role.
 * Mirror SeedDepartmentReadPermission.
 */
export async function seedNoShowReadPermission(
  dataSource: DataSource,
): Promise<void> {
  const queryRunner = dataSource.createQueryRunner();
  await queryRunner.connect();
  await queryRunner.startTransaction();

  try {
    const permResult = await queryRunner.query(
      'INSERT INTO permissions (permission_code, permission_name, module_code, action_code, description, is_active) ' +
        "VALUES ('room.noshow.read', 'Liệt kê no-show case', 'rooms', 'noshow_read', 'Cho phép xem danh sách no-show case (bảng giám sát phòng). Read-only.', true) " +
        'ON CONFLICT (permission_code) DO NOTHING RETURNING id;',
    );

    let permissionId = permResult[0]?.id;

    if (!permissionId) {
      const existing = await queryRunner.query(
        "SELECT id FROM permissions WHERE permission_code = 'room.noshow.read';",
      );
      permissionId = existing[0]?.id;
    }

    if (permissionId) {
      const roles = ['SYSTEM_ADMIN', 'MANAGER', 'BUSINESS_ADMIN'];
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

    await queryRunner.commitTransaction();
  } catch (error) {
    await queryRunner.rollbackTransaction();
    throw error;
  } finally {
    await queryRunner.release();
  }
}
