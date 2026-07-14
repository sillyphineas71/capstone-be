import { DataSource } from 'typeorm';

/**
 * Seed permission cho UC-65 (Phân bổ thiết bị vào phòng họp).
 *
 * LƯU Ý: dự án CHƯA có seed-runner wire các file `src/database/seeds/*.ts`
 * vào pipeline migration — vấn đề team-wide, NGOÀI phạm vi UC-65.
 * File này bám convention seed hiện có (SeedEquipmentCreatePermission).
 * KHÔNG được execute tự động trong phạm vi UC-65.
 *
 * Permission: equipment.assign → gán [SYSTEM_ADMIN, BUSINESS_ADMIN]
 * (mirror role-set equipment.create/delete; gán tài sản là admin-level).
 */
export async function seedEquipmentAssignPermission(
  dataSource: DataSource,
): Promise<void> {
  const queryRunner = dataSource.createQueryRunner();
  await queryRunner.connect();
  await queryRunner.startTransaction();

  try {
    const permissionResult = await queryRunner.query(
      `INSERT INTO permissions (permission_code, permission_name, module_code, action_code, description, is_active)
       VALUES ($1, $2, $3, $4, $5, true)
       ON CONFLICT (permission_code) DO NOTHING
       RETURNING id;`,
      [
        'equipment.assign',
        'Phân bổ thiết bị vào phòng',
        'equipment',
        'assign',
        'Cho phép gán thiết bị vào phòng họp.',
      ],
    );

    const permissionId = permissionResult[0]?.id;

    if (permissionId) {
      const roleCodes = ['SYSTEM_ADMIN', 'BUSINESS_ADMIN'];

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

    await queryRunner.commitTransaction();
  } catch (error) {
    await queryRunner.rollbackTransaction();
    throw error;
  } finally {
    await queryRunner.release();
  }
}
