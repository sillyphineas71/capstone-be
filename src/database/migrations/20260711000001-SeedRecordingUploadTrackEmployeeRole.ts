import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Gap fix 2026-07-11: migration gốc 20260701010001 seed permission
 * `recording.upload_track` cho role code `INTERNAL_USER` — nhưng role đó
 * KHÔNG tồn tại trong DB thật (roles thật: BUSINESS_ADMIN, EMPLOYEE, MANAGER,
 * SYSTEM_ADMIN). Migration cũ "chết" âm thầm (INSERT...SELECT không match
 * row nào, không báo lỗi) — participant role EMPLOYEE chưa từng có quyền
 * upload audio track của chính mình, dù đó là mục đích thiết kế gốc
 * (xem uploadAudioTrack trong recording-session.service.ts). Phát hiện qua
 * chạy thử thật end-to-end luồng channel_zone (2026-07-11).
 */
export class SeedRecordingUploadTrackEmployeeRole20260711000001 implements MigrationInterface {
  name = 'SeedRecordingUploadTrackEmployeeRole20260711000001';

  private readonly permissionCode = 'recording.upload_track';
  private readonly roleCode = 'EMPLOYEE';

  public async up(queryRunner: QueryRunner): Promise<void> {
    const permissionRows: Array<{ id: string }> = await queryRunner.query(
      'SELECT id FROM permissions WHERE permission_code = $1',
      [this.permissionCode],
    );
    const permissionId = permissionRows[0]?.id;
    if (!permissionId) return;

    await queryRunner.query(
      `INSERT INTO role_permissions (role_id, permission_id, granted_at)
       SELECT r.id, $2, NOW()
       FROM roles r
       WHERE r.role_code = $1 AND r.is_active = true
       ON CONFLICT (role_id, permission_id) DO NOTHING;`,
      [this.roleCode, permissionId],
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `DELETE FROM role_permissions
       WHERE permission_id IN (SELECT id FROM permissions WHERE permission_code = $1)
         AND role_id IN (SELECT id FROM roles WHERE role_code = $2);`,
      [this.permissionCode, this.roleCode],
    );
  }
}
