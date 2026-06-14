import { DataSource } from 'typeorm';

/**
 * Seed permission cho IOT-011 (Cập nhật thông tin thiết bị IoT/Camera).
 *
 * LƯU Ý (NC-P1): hiện dự án CHƯA có seed-runner/orchestrator wire các file
 * `src/database/seeds/*.ts` vào pipeline migration. Đây là vấn đề team-wide,
 * NẰM NGOÀI phạm vi feature IOT-011. File này bám đúng convention seed hiện có
 * (vd SeedRemoveParticipantPermissions) để team áp dụng theo cơ chế chung.
 */
export async function seedIotDeviceUpdatePermission(
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
        'iot.device.update',
        'Cập nhật thông tin thiết bị IoT',
        'iot',
        'device_update',
        'Cho phép cập nhật thông tin mô tả/kết nối của thiết bị IoT (device_name, ip_address, mac_address, network_identifier). Không gồm gán phòng, RTSP, Face Server, status/health.',
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
