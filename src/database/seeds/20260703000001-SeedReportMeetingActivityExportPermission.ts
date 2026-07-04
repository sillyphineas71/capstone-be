import { DataSource } from 'typeorm';

/**
 * Seed permission cho Export Meeting Activity Report (UC-AA-12 / UC-158):
 * - report.meeting_activity.export
 *
 * Gán cho 3 role: MANAGER, BUSINESS_ADMIN, SYSTEM_ADMIN (đúng API_CONTRACT UC-158).
 */
export async function seedReportMeetingActivityExportPermission(
  dataSource: DataSource,
): Promise<void> {
  const queryRunner = dataSource.createQueryRunner();
  await queryRunner.connect();
  await queryRunner.startTransaction();

  try {
    const code = 'report.meeting_activity.export';
    const name = 'Xuat bao cao hoat dong cuoc hop';
    const moduleCode = 'reports';
    const actionCode = 'meeting_activity.export';
    const desc =
      'Cho phep tao job xuat bao cao tong hop hoat dong cuoc hop (PDF hoac XLSX) va tai file qua background job';

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
