import { DataSource } from 'typeorm';

/**
 * Seed permission cho IOT-014 (Active probe phát hiện thiết bị offline).
 *
 * LƯU Ý: dự án CHƯA có seed-runner wire các file `src/database/seeds/*.ts` vào
 * pipeline migration — vấn đề team-wide, NGOÀI phạm vi feature IOT-014.
 * File này bám convention seed hiện có (vd SeedIotDeviceUpdatePermission).
 */
export async function seedIotDeviceProbePermission(
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
        'iot.device.probe',
        'Probe trạng thái online/offline thiết bị IoT',
        'iot',
        'device_probe',
        'Cho phép chạy tay một lượt active probe (TCP) để cập nhật trạng thái online/offline của camera IP.',
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
