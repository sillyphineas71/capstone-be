import { DataSource } from 'typeorm';

/**
 * Seed permissions cho In-Meeting Notes (UC-IMM-09):
 * - meeting.note.create
 * - meeting.note.read
 *
 * Pattern: SeedMeetingEndPermission.ts
 */
export async function seedMeetingNotePermissions(
  dataSource: DataSource,
): Promise<void> {
  const queryRunner = dataSource.createQueryRunner();
  await queryRunner.connect();
  await queryRunner.startTransaction();

  try {
    // === Permission: meeting.note.create ===
    const createCode = 'meeting.note.create';
    const createName = 'Tao ghi chu trong cuoc hop';
    const moduleCode = 'live-meeting';
    const actionCode = 'note.create';
    const createDesc = 'Cho phep tao ghi chu trong cuoc hop dang dien ra';

    const createResult = await queryRunner.query(
      `INSERT INTO permissions (permission_code, permission_name, module_code, action_code, description, is_active)
       VALUES ($1, $2, $3, $4, $5, true)
       ON CONFLICT (permission_code) DO NOTHING
       RETURNING id;`,
      [createCode, createName, moduleCode, actionCode, createDesc],
    );

    const createPermId = createResult[0]?.id;
    if (createPermId) {
      const createRoleCodes = ['INTERNAL_USER', 'MANAGER', 'BUSINESS_ADMIN', 'SYSTEM_ADMIN'];
      for (const roleCode of createRoleCodes) {
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

    // === Permission: meeting.note.read ===
    const readCode = 'meeting.note.read';
    const readName = 'Xem ghi chu trong cuoc hop';
    const readAction = 'note.read';
    const readDesc = 'Cho phep xem danh sach ghi chu cua cuoc hop';

    const readResult = await queryRunner.query(
      `INSERT INTO permissions (permission_code, permission_name, module_code, action_code, description, is_active)
       VALUES ($1, $2, $3, $4, $5, true)
       ON CONFLICT (permission_code) DO NOTHING
       RETURNING id;`,
      [readCode, readName, moduleCode, readAction, readDesc],
    );

    const readPermId = readResult[0]?.id;
    if (readPermId) {
      const readRoleCodes = ['INTERNAL_USER', 'MANAGER', 'BUSINESS_ADMIN', 'SYSTEM_ADMIN'];
      for (const roleCode of readRoleCodes) {
        const roleResult = await queryRunner.query(
          `SELECT id FROM roles WHERE role_code = $1 AND is_active = true;`,
          [roleCode],
        );
        if (roleResult[0]?.id) {
          await queryRunner.query(
            `INSERT INTO role_permissions (role_id, permission_id, granted_at)
             VALUES ($1, $2, NOW())
             ON CONFLICT (role_id, permission_id) DO NOTHING;`,
            [roleResult[0].id, readPermId],
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
