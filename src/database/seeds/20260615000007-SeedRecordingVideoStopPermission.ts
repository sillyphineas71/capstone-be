import { DataSource } from 'typeorm';

/**
 * Seed permission cho REC-003 (Dừng ghi hình video).
 * Bám convention seed hiện có. (seed-runner chưa wire — vấn đề team-wide.)
 */
export async function seedRecordingVideoStopPermission(
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
        'recording.video.stop',
        'Dừng ghi hình từ IP camera',
        'recording',
        'video_stop',
        'Cho phép dừng ghi hình video (ffmpeg), chốt file media và phiên ghi.',
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
