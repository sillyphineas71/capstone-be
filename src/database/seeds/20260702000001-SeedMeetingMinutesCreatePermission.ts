import { DataSource } from 'typeorm';

/**
 * Seed permission cho Create Draft Meeting Minutes (UC-MKM-01):
 * - meeting.minutes.create
 *
 * Pattern: SeedMeetingNotePermissions.ts
 */
export async function seedMeetingMinutesCreatePermission(
  dataSource: DataSource,
): Promise<void> {
  const queryRunner = dataSource.createQueryRunner();
  await queryRunner.connect();
  await queryRunner.startTransaction();

  try {
    const createCode = 'meeting.minutes.create';
    const createName = 'Tao bien ban hop nhap';
    const moduleCode = 'minutes';
    const actionCode = 'minutes.create';
    const createDesc =
      'Cho phep Host cua cuoc hop tao bien ban hop o trang thai nhap (draft)';

    const createResult = await queryRunner.query(
      `INSERT INTO permissions (permission_code, permission_name, module_code, action_code, description, is_active)
       VALUES ($1, $2, $3, $4, $5, true)
       ON CONFLICT (permission_code) DO NOTHING
       RETURNING id;`,
      [createCode, createName, moduleCode, actionCode, createDesc],
    );

    const createPermId = createResult[0]?.id;
    if (createPermId) {
      const roleCodes = [
        'INTERNAL_USER',
        'MANAGER',
        'BUSINESS_ADMIN',
        'SYSTEM_ADMIN',
      ];
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
            [roleResult[0].id, createPermId],
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
