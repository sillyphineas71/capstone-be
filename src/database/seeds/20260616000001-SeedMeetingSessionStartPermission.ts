import { DataSource } from 'typeorm';

export async function seedMeetingSessionStartPermission(
  dataSource: DataSource,
): Promise<void> {
  const queryRunner = dataSource.createQueryRunner();
  await queryRunner.connect();
  await queryRunner.startTransaction();

  try {
    const permissionCode = 'meeting.session.start';
    const permissionName = 'Bắt đầu phiên họp';
    const moduleCode = 'live-meeting';
    const actionCode = 'session.start';
    const description = 'Cho phép bắt đầu phiên họp';

    const permResult = await queryRunner.query(
      `INSERT INTO permissions (permission_code, permission_name, module_code, action_code, description, is_active)
       VALUES ($1, $2, $3, $4, $5, true)
       ON CONFLICT (permission_code) DO NOTHING
       RETURNING id;`,
      [permissionCode, permissionName, moduleCode, actionCode, description],
    );

    const permissionId = permResult[0]?.id;

    if (!permissionId) {
      // Permission already exists — skip role assignment
      await queryRunner.commitTransaction();
      return;
    }

    // Gán permission cho system roles: INTERNAL_USER, MANAGER, BUSINESS_ADMIN, SYSTEM_ADMIN
    const roleCodes = ['INTERNAL_USER', 'MANAGER', 'BUSINESS_ADMIN', 'SYSTEM_ADMIN'];

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

    await queryRunner.commitTransaction();
  } catch (error) {
    await queryRunner.rollbackTransaction();
    throw error;
  } finally {
    await queryRunner.release();
  }
}
