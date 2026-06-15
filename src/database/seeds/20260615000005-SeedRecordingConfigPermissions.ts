import { DataSource } from 'typeorm';

/**
 * Seed permission cho REC-001 (Cấu hình recording cho cuộc họp).
 *
 * LƯU Ý: seed-runner chưa được wire (vấn đề team-wide, ngoài phạm vi feature).
 * Bám convention seed hiện có (vd SeedIotDeviceUpdatePermission).
 */
export async function seedRecordingConfigPermissions(
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
        code: 'recording.config.create',
        name: 'Tạo cấu hình ghi âm/ghi hình',
        action: 'config_create',
        description:
          'Cho phép tạo cấu hình recording cho cuộc họp (recording_configs).',
      },
      {
        code: 'recording.config.read',
        name: 'Xem cấu hình ghi âm/ghi hình',
        action: 'config_read',
        description: 'Cho phép xem cấu hình recording của cuộc họp.',
      },
      {
        code: 'recording.config.update',
        name: 'Cập nhật cấu hình ghi âm/ghi hình',
        action: 'config_update',
        description: 'Cho phép cập nhật cấu hình recording của cuộc họp.',
      },
    ];

    const roleCodes = ['ADMIN', 'MANAGER'];

    for (const perm of permissions) {
      const permissionResult = await queryRunner.query(
        `INSERT INTO permissions (permission_code, permission_name, module_code, action_code, description, is_active)
         VALUES ($1, $2, $3, $4, $5, true)
         ON CONFLICT (permission_code) DO NOTHING
         RETURNING id;`,
        [perm.code, perm.name, 'recording', perm.action, perm.description],
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
