import { DataSource } from 'typeorm';

/**
 * Seed permission `meeting.timeline.read` (UC-99 — Xem timeline cuộc họp,
 * GET /api/v1/meetings/:meetingId/timeline).
 *
 * Role-set y hệt `meeting.note.read`: INTERNAL_USER, MANAGER, BUSINESS_ADMIN, SYSTEM_ADMIN.
 * Quyền thực tế còn bị giới hạn theo QUAN HỆ (host/participant) ở tầng service.
 * Mirror seedMeetingNotePermissions (20260618000001). Idempotent: ON CONFLICT DO NOTHING.
 *
 * ⚠️ Pattern seeds/*SeedXxxPermission*.ts hiện KHÔNG có runner tự động — file này CHƯA được
 * execute và CHƯA thêm vào bất kỳ runner nào. Chạy thủ công theo quy trình seed của dự án
 * sau khi được duyệt.
 */
export async function seedMeetingTimelinePermission(
  dataSource: DataSource,
): Promise<void> {
  const queryRunner = dataSource.createQueryRunner();
  await queryRunner.connect();
  await queryRunner.startTransaction();

  try {
    const code = 'meeting.timeline.read';
    const name = 'Xem timeline cuoc hop';
    const moduleCode = 'live-meeting';
    const actionCode = 'timeline.read';
    const description =
      'Cho phep host/participant xem timeline gop cac su kien cua cuoc hop (start/end/warning/check-in/note)';

    const result = await queryRunner.query(
      `INSERT INTO permissions (permission_code, permission_name, module_code, action_code, description, is_active)
       VALUES ($1, $2, $3, $4, $5, true)
       ON CONFLICT (permission_code) DO NOTHING
       RETURNING id;`,
      [code, name, moduleCode, actionCode, description],
    );

    let permissionId = result[0]?.id;
    if (!permissionId) {
      const existing = await queryRunner.query(
        `SELECT id FROM permissions WHERE permission_code = $1;`,
        [code],
      );
      permissionId = existing[0]?.id;
    }

    if (permissionId) {
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
