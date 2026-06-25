import { DataSource } from 'typeorm';

export async function seedMeetingEndPermission(
  dataSource: DataSource,
): Promise<void> {
  const queryRunner = dataSource.createQueryRunner();
  await queryRunner.connect();
  await queryRunner.startTransaction();

  try {
    // ── Permission: meeting.session.end ──
    const permCode = 'meeting.session.end';
    const permName = 'Ket thuc phien hop';
    const moduleCode = 'live-meeting';
    const actionCode = 'session.end';
    const description = 'Cho phep Host ket thuc phien hop cua chinh minh';

    const permResult = await queryRunner.query(
      `INSERT INTO permissions (permission_code, permission_name, module_code, action_code, description, is_active)
       VALUES ($1, $2, $3, $4, $5, true)
       ON CONFLICT (permission_code) DO NOTHING
       RETURNING id;`,
      [permCode, permName, moduleCode, actionCode, description],
    );

    const permId = permResult[0]?.id;
    if (!permId) {
      // Permission already exists, skip role assignment
      await queryRunner.commitTransaction();
      return;
    }

    // Gan permission cho INTERNAL_USER, MANAGER, BUSINESS_ADMIN, SYSTEM_ADMIN
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
          [roleResult[0].id, permId],
        );
      }
    }

    // ── Permission: meeting.session.end.any (override) ──
    const overrideCode = 'meeting.session.end.any';
    const overrideName = 'Ket thuc phien hop - tat ca';
    const overrideAction = 'session.end.any';
    const overrideDesc = 'Cho phep Business Admin/SYSTEM_ADMIN ket thuc bat ky phien hop nao';

    const overrideResult = await queryRunner.query(
      `INSERT INTO permissions (permission_code, permission_name, module_code, action_code, description, is_active)
       VALUES ($1, $2, $3, $4, $5, true)
       ON CONFLICT (permission_code) DO NOTHING
       RETURNING id;`,
      [overrideCode, overrideName, moduleCode, overrideAction, overrideDesc],
    );

    const overrideId = overrideResult[0]?.id;
    if (overrideId) {
      // Chi gan override cho BUSINESS_ADMIN, SYSTEM_ADMIN
      const overrideRoles = ['BUSINESS_ADMIN', 'SYSTEM_ADMIN'];
      for (const roleCode of overrideRoles) {
        const roleResult = await queryRunner.query(
          `SELECT id FROM roles WHERE role_code = $1 AND is_active = true;`,
          [roleCode],
        );
        if (roleResult[0]?.id) {
          await queryRunner.query(
            `INSERT INTO role_permissions (role_id, permission_id, granted_at)
             VALUES ($1, $2, NOW())
             ON CONFLICT (role_id, permission_id) DO NOTHING;`,
            [roleResult[0].id, overrideId],
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
