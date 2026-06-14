import { DataSource } from 'typeorm';

export async function seedMeetingCancelPermissions(
  dataSource: DataSource,
): Promise<void> {
  const queryRunner = dataSource.createQueryRunner();
  await queryRunner.connect();
  await queryRunner.startTransaction();

  try {
    const permissions = [
      {
        code: 'meeting.cancel.own',
        name: 'Hủy cuộc họp của mình',
        module: 'meetings',
        action: 'cancel.own',
        description: 'Cho phép hủy cuộc họp khi user là organizer hoặc host',
      },
      {
        code: 'meeting.cancel.any',
        name: 'Hủy bất kỳ cuộc họp nào',
        module: 'meetings',
        action: 'cancel.any',
        description: 'Cho phép hủy bất kỳ cuộc họp nào (bỏ qua quyền sở hữu)',
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

      if (!permissionId) {
        continue;
      }

      if (perm.code === 'meeting.cancel.any') {
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
      }

      if (perm.code === 'meeting.cancel.own') {
        const roleCodes = ['ADMIN', 'MANAGER', 'EMPLOYEE'];

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
