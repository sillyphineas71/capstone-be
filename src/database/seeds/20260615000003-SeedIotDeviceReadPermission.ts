import { DataSource } from 'typeorm';

/**
 * Seed permission cho IOT-013 (List + Detail thiết bị IoT/Camera).
 *
 * LƯU Ý (NC-P2): dự án CHƯA có seed-runner wire các file `src/database/seeds/*.ts`
 * vào pipeline migration — vấn đề team-wide, NGOÀI phạm vi feature IOT-013.
 * File này bám convention seed hiện có (vd SeedIotDeviceUpdatePermission).
 */
export async function seedIotDeviceReadPermission(
  dataSource: DataSource,
): Promise<void> {
  const queryRunner = dataSource.createQueryRunner();
  await queryRunner.connect();
  await queryRunner.startTransaction();

  try {
    const permissionResult = await queryRunner.query(
      `INSERT INTO permissions (permission_code, permission_name, module_code, action_code, description, is_active)
       VALUES ($1, $2, $3, $4, $5, true)
       ON CONFLICT (permission_code) DO NOTHING
       RETURNING id;`,
      [
        'iot.device.read',
        'Xem danh sách / chi tiết thiết bị IoT',
        'iot',
        'device_read',
        'Cho phép liệt kê (list + filter + phân trang) và xem chi tiết thiết bị IoT/Camera. Read-only.',
      ],
    );

    const permissionId = permissionResult[0]?.id;

    if (permissionId) {
      const roleCodes = ['ADMIN', 'MANAGER'];

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
