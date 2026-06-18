import { DataSource } from 'typeorm';

/**
 * Seed permission cho REC-006 (Media Files API): read / play / manage.
 * Bám convention seed hiện có. (seed-runner chưa wire — vấn đề team-wide.)
 */
const PERMISSIONS: Array<{
  code: string;
  name: string;
  action: string;
  description: string;
}> = [
  {
    code: 'recording.files.read',
    name: 'Xem danh sách/chi tiết file phương tiện',
    action: 'files_read',
    description: 'Cho phép liệt kê và xem chi tiết media_files.',
  },
  {
    code: 'recording.files.play',
    name: 'Phát lại file phương tiện',
    action: 'files_play',
    description: 'Cho phép stream/phát lại media_files.',
  },
  {
    code: 'recording.files.manage',
    name: 'Quản lý hiển thị file phương tiện',
    action: 'files_manage',
    description: 'Cho phép ẩn/xóa-mềm media_files (visibility).',
  },
];

export async function seedMediaFilesPermissions(
  dataSource: DataSource,
): Promise<void> {
  const queryRunner = dataSource.createQueryRunner();
  await queryRunner.connect();
  await queryRunner.startTransaction();

  try {
    const roleCodes = ['ADMIN', 'MANAGER'];
    for (const perm of PERMISSIONS) {
      const permissionResult = await queryRunner.query(
        `INSERT INTO permissions (permission_code, permission_name, module_code, action_code, description, is_active)
         VALUES ($1, $2, $3, $4, $5, true)
         ON CONFLICT (permission_code) DO NOTHING
         RETURNING id;`,
        [perm.code, perm.name, 'recording', perm.action, perm.description],
      );

      const permissionId = permissionResult[0]?.id;
      if (!permissionId) continue;

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
