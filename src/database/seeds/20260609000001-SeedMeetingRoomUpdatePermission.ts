import { DataSource } from 'typeorm';

export async function seedMeetingRoomUpdatePermission(
  dataSource: DataSource,
): Promise<void> {
  const queryRunner = dataSource.createQueryRunner();
  await queryRunner.connect();
  await queryRunner.startTransaction();

  try {
    const permResult = await queryRunner.query(
      `INSERT INTO permissions (permission_code, permission_name, module_code, action_code, description, is_active)
       VALUES ($1, $2, $3, $4, $5, true)
       ON CONFLICT (permission_code) DO NOTHING
       RETURNING id;`,
      [
        'meeting.room.update',
        'Cập nhật phòng họp',
        'meetings',
        'room_update',
        'Cho phép cập nhật phòng họp',
      ],
    );

    const permissionId = permResult[0]?.id;

    if (permissionId) {
      const adminResult = await queryRunner.query(
        `SELECT id FROM roles WHERE role_code = $1 AND is_active = true;`,
        ['ADMIN'],
      );

      if (adminResult[0]?.id) {
        await queryRunner.query(
          `INSERT INTO role_permissions (role_id, permission_id, granted_at)
           VALUES ($1, $2, NOW())
           ON CONFLICT (role_id, permission_id) DO NOTHING;`,
          [adminResult[0].id, permissionId],
        );
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
