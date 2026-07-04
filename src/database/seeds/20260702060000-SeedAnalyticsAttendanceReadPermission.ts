import { DataSource } from 'typeorm';

/**
 * Seed permission cho View On-time Attendance Rate (UC-AA-10 / UC-157):
 * - analytics.attendance.read
 */
export async function seedAnalyticsAttendanceReadPermission(
  dataSource: DataSource,
): Promise<void> {
  const queryRunner = dataSource.createQueryRunner();
  await queryRunner.connect();
  await queryRunner.startTransaction();

  try {
    const code = 'analytics.attendance.read';
    const name = 'Xem thong ke ty le tham du dung gio';
    const moduleCode = 'analytics';
    const actionCode = 'attendance.read';
    const desc =
      'Cho phep xem thong ke va lich su di muon tham du cuoc hop (read-only)';

    const permResult = await queryRunner.query(
      `INSERT INTO permissions (permission_code, permission_name, module_code, action_code, description, is_active)
       VALUES ($1, $2, $3, $4, $5, true)
       ON CONFLICT (permission_code) DO NOTHING
       RETURNING id;`,
      [code, name, moduleCode, actionCode, desc],
    );

    let permId = permResult[0]?.id;
    if (!permId) {
      const existing = await queryRunner.query(
        `SELECT id FROM permissions WHERE permission_code = $1;`,
        [code],
      );
      permId = existing[0]?.id;
    }

    if (permId) {
      const roleCodes = ['MANAGER', 'BUSINESS_ADMIN', 'SYSTEM_ADMIN'];
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
    }

    await queryRunner.commitTransaction();
  } catch (error) {
    await queryRunner.rollbackTransaction();
    throw error;
  } finally {
    await queryRunner.release();
  }
}
