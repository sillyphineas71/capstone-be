import { DataSource } from 'typeorm';

/**
 * Seed permission cho IOT-012 (Disable/Re-enable thiết bị IoT/Camera).
 *
 * LƯU Ý (NC-P1): dự án CHƯA có seed-runner wire các file `src/database/seeds/*.ts`
 * vào pipeline migration — đây là vấn đề team-wide, NGOÀI phạm vi feature IOT-012.
 * File này bám convention seed hiện có (vd SeedIotDeviceUpdatePermission).
 */
export async function seedIotDeviceDisableEnablePermissions(
  dataSource: DataSource,
): Promise<void> {
  const queryRunner = dataSource.createQueryRunner();
  await queryRunner.connect();
  await queryRunner.startTransaction();

  try {
    const permissions: Array<{
      code: string;
      name: string;
      action: string;
      description: string;
    }> = [
      {
        code: 'iot.device.disable',
        name: 'Vô hiệu hóa thiết bị IoT',
        action: 'device_disable',
        description:
          'Cho phép vô hiệu hóa (status -> disabled) thiết bị IoT/Camera. Soft theo ADR-008, không hard-delete.',
      },
      {
        code: 'iot.device.enable',
        name: 'Kích hoạt lại thiết bị IoT',
        action: 'device_enable',
        description:
          'Cho phép kích hoạt lại (disabled -> offline) thiết bị IoT/Camera.',
      },
    ];

    const roleCodes = ['ADMIN', 'MANAGER'];

    for (const perm of permissions) {
      const permissionResult = await queryRunner.query(
        `INSERT INTO permissions (permission_code, permission_name, module_code, action_code, description, is_active)
         VALUES ($1, $2, $3, $4, $5, true)
         ON CONFLICT (permission_code) DO NOTHING
         RETURNING id;`,
        [perm.code, perm.name, 'iot', perm.action, perm.description],
      );

      const permissionId = permissionResult[0]?.id;

      if (permissionId) {
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
    }

    await queryRunner.commitTransaction();
  } catch (error) {
    await queryRunner.rollbackTransaction();
    throw error;
  } finally {
    await queryRunner.release();
  }
}
