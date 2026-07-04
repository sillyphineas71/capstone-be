import { DataSource } from 'typeorm';

/**
 * Seed permission cho View Dashboard Overview (UC-AA-01):
 * - analytics.overview.read
 *
 * Pattern: SeedUserListPermission.ts
 */
export async function seedAnalyticsOverviewPermission(
  dataSource: DataSource,
): Promise<void> {
  const queryRunner = dataSource.createQueryRunner();
  await queryRunner.connect();
  await queryRunner.startTransaction();

  try {
    const code = 'analytics.overview.read';
    const name = 'Xem dashboard tong quan he thong';
    const moduleCode = 'analytics';
    const actionCode = 'overview.read';
    const desc =
      'Cho phep xem dashboard tong quan voi 8 KPI va trend theo ngay (read-only)';

    const permResult = await queryRunner.query(
      `INSERT INTO permissions (permission_code, permission_name, module_code, action_code, description, is_active)
       VALUES ($1, $2, $3, $4, $5, true)
       ON CONFLICT (permission_code) DO NOTHING
       RETURNING id;`,
      [code, name, moduleCode, actionCode, desc],
    );

    const permId = permResult[0]?.id;
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
