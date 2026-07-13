import { DataSource } from 'typeorm';

/**
 * Seed permission cho UC-62 (Cập nhật trạng thái lỗi thiết bị).
 *
 * LƯU Ý: dự án CHƯA có seed-runner wire các file `src/database/seeds/*.ts`
 * vào pipeline migration — vấn đề team-wide, NGOÀI phạm vi UC-62.
 * File này bám convention seed hiện có (SeedEquipmentCreatePermission).
 * KHÔNG được execute tự động trong phạm vi UC-62.
 *
 * Permission: equipment.report_fault
 * → gán [SYSTEM_ADMIN, BUSINESS_ADMIN, MANAGER, INTERNAL_USER] (spec §8, P1).
 */
export async function seedEquipmentReportFaultPermission(
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
        'equipment.report_fault',
        'Báo lỗi / chuyển bảo trì thiết bị',
        'equipment',
        'report_fault',
        'Cho phép báo lỗi và chuyển thiết bị sang bảo trì.',
      ],
    );

    const permissionId = permissionResult[0]?.id;

    if (permissionId) {
      const roleCodes = [
        'SYSTEM_ADMIN',
        'BUSINESS_ADMIN',
        'MANAGER',
        'INTERNAL_USER',
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
