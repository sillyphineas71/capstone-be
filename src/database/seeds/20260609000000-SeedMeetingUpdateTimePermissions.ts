import { DataSource } from 'typeorm';

export async function seedMeetingUpdateTimePermissions(
  dataSource: DataSource,
): Promise<void> {
  const queryRunner = dataSource.createQueryRunner();
  await queryRunner.connect();
  await queryRunner.startTransaction();

  try {
    const permissions = [
      {
        code: 'meeting.time.update',
        name: 'Cập nhật thời gian cuộc họp',
        module: 'meetings',
        action: 'time_update',
        description:
          'Cho phép cập nhật thời gian cuộc họp (kiểm tra quyền sở hữu)',
      },
      {
        code: 'meeting.time.update.any',
        name: 'Cập nhật thời gian mọi cuộc họp',
        module: 'meetings',
        action: 'time_update_any',
        description:
          'Cho phép cập nhật thời gian bất kỳ cuộc họp nào (bỏ qua quyền sở hữu)',
      },
    ];

    for (const perm of permissions) {
      const permResult = await queryRunner.query(
        `INSERT INTO permissions (permission_code, permission_name, module_code, action_code, description, is_active)
         VALUES ($1, $2, $3, $4, $5, true)
         ON CONFLICT (permission_code) DO NOTHING
         RETURNING id;`,
        [perm.code, perm.name, perm.module, perm.action, perm.description],
      );

      const permissionId = permResult[0]?.id;

      if (permissionId) {
        const adminResult = await queryRunner.query(
          `SELECT id FROM roles WHERE role_code = $1 AND is_active = true;`,
          ['ADMIN'],
        );

        if (adminResult[0]?.id) {
          await queryRunner.query(
            `INSERT INTO role_permissions (role_id, permission_id, granted_at)
             VALUES ($1, $2, NOW())
             ON CONFLICT (role_id, permission_id) DO NOTHING;`,
            [adminResult[0].id, permissionId],
          );
        }

        if (perm.code === 'meeting.time.update') {
          const managerResult = await queryRunner.query(
            `SELECT id FROM roles WHERE role_code = $1 AND is_active = true;`,
            ['MANAGER'],
          );

          if (managerResult[0]?.id) {
            await queryRunner.query(
              `INSERT INTO role_permissions (role_id, permission_id, granted_at)
               VALUES ($1, $2, NOW())
               ON CONFLICT (role_id, permission_id) DO NOTHING;`,
              [managerResult[0].id, permissionId],
            );
          }

          const employeeResult = await queryRunner.query(
            `SELECT id FROM roles WHERE role_code = $1 AND is_active = true;`,
            ['EMPLOYEE'],
          );

          if (employeeResult[0]?.id) {
            await queryRunner.query(
              `INSERT INTO role_permissions (role_id, permission_id, granted_at)
               VALUES ($1, $2, NOW())
               ON CONFLICT (role_id, permission_id) DO NOTHING;`,
              [employeeResult[0].id, permissionId],
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
