import { DataSource } from 'typeorm';

export async function seedMeetingRequestPermissions(
  dataSource: DataSource,
): Promise<void> {
  const queryRunner = dataSource.createQueryRunner();
  await queryRunner.connect();
  await queryRunner.startTransaction();

  try {
    const permissions = [
      {
        code: 'meeting_request.approve',
        name: 'Phê duyệt yêu cầu cuộc họp',
        module: 'meetings',
        action: 'approve',
        description: 'Cho phép phê duyệt yêu cầu cuộc họp',
      },
      {
        code: 'meeting_request.reject',
        name: 'Từ chối yêu cầu cuộc họp',
        module: 'meetings',
        action: 'reject',
        description: 'Cho phép từ chối yêu cầu cuộc họp',
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
        const roleResult = await queryRunner.query(
          `SELECT id FROM roles WHERE role_code = $1 AND is_active = true;`,
          ['ADMIN'],
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
