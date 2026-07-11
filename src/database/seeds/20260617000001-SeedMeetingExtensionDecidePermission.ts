import { DataSource } from 'typeorm';

export async function seedMeetingExtensionDecidePermission(
  dataSource: DataSource,
): Promise<void> {
  const queryRunner = dataSource.createQueryRunner();
  await queryRunner.connect();
  await queryRunner.startTransaction();

  try {
    const permissions = [
      {
        code: 'meeting.session.extension.decide',
        name: 'Phê duyệt/từ chối yêu cầu gia hạn',
        module: 'live-meeting',
        action: 'session.extension.decide',
        description:
          'Cho phép phê duyệt hoặc từ chối yêu cầu gia hạn phiên họp (cần nằm trong approver list)',
        roles: ['MANAGER', 'BUSINESS_ADMIN', 'SYSTEM_ADMIN'],
      },
      {
        code: 'meeting.session.extension.override',
        name: 'Override yêu cầu gia hạn',
        module: 'live-meeting',
        action: 'session.extension.override',
        description:
          'Cho phép override phê duyệt/từ chối yêu cầu gia hạn phiên họp (không cần trong approver list)',
        roles: ['BUSINESS_ADMIN', 'SYSTEM_ADMIN'],
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
        continue; // Permission already exists — skip role assignment
      }

      for (const roleCode of perm.roles) {
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
