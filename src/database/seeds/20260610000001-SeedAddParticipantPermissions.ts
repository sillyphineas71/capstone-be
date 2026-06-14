import { DataSource } from 'typeorm';

export async function seedAddParticipantPermissions(
  dataSource: DataSource,
): Promise<void> {
  const queryRunner = dataSource.createQueryRunner();
  await queryRunner.connect();
  await queryRunner.startTransaction();

  try {
    const permissionResult1 = await queryRunner.query(
      `INSERT INTO permissions (permission_code, permission_name, module_code, action_code, description, is_active)
       VALUES ($1, $2, $3, $4, $5, true)
       ON CONFLICT (permission_code) DO NOTHING
       RETURNING id;`,
      [
        'meeting.participant.add.internal',
        'Thêm thành viên nội bộ cuộc họp',
        'meetings',
        'participant_add_internal',
        'Cho phép thêm nhân viên nội bộ vào cuộc họp',
      ],
    );

    const permissionId1 = permissionResult1[0]?.id;

    if (permissionId1) {
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
            [roleResult[0].id, permissionId1],
          );
        }
      }
    }

    const permissionResult2 = await queryRunner.query(
      `INSERT INTO permissions (permission_code, permission_name, module_code, action_code, description, is_active)
       VALUES ($1, $2, $3, $4, $5, true)
       ON CONFLICT (permission_code) DO NOTHING
       RETURNING id;`,
      [
        'meeting.participant.override_capacity',
        'Ghi đè sức chứa phòng họp',
        'meetings',
        'participant_override_capacity',
        'Cho phép ghi đè giới hạn sức chứa phòng khi thêm thành viên',
      ],
    );

    const permissionId2 = permissionResult2[0]?.id;

    if (permissionId2) {
      const roleCodes = ['ADMIN', 'ROOM_ADMIN'];

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
            [roleResult[0].id, permissionId2],
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
