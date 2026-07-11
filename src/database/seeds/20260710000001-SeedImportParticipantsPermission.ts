import { DataSource } from 'typeorm';

/**
 * Seed permission `meeting.participant.import` cho tính năng import thành viên
 * cuộc họp bằng Excel (MEET-IMPORT-PARTICIPANT-001).
 * Gán cho các role: ADMIN, MANAGER, EMPLOYEE (khớp tập role của add.internal).
 */
export async function seedImportParticipantsPermission(
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
        'meeting.participant.import',
        'Import thành viên cuộc họp bằng Excel',
        'meetings',
        'participant_import',
        'Cho phép import hàng loạt thành viên nội bộ và khách ngoài vào cuộc họp từ tệp Excel',
      ],
    );

    let permissionId = permissionResult[0]?.id as string | undefined;

    // Nếu đã tồn tại (ON CONFLICT DO NOTHING không trả về id), lấy lại id.
    if (!permissionId) {
      const existing = await queryRunner.query(
        `SELECT id FROM permissions WHERE permission_code = $1;`,
        ['meeting.participant.import'],
      );
      permissionId = existing[0]?.id as string | undefined;
    }

    if (permissionId) {
      const roleCodes = ['ADMIN', 'MANAGER', 'EMPLOYEE'];
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
