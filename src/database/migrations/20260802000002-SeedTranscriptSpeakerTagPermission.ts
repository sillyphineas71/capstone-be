import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * feat-speaker-tagging-post-meeting (T-TAG-002): seed permission
 * transcript.speaker_tag — cho phép gán tên hàng loạt cho cụm giọng
 * (Speaker_N) sau khi cuộc họp kết thúc.
 *
 * ⚠️ Role list PHẢI dùng 4 mã role thật (SYSTEM_ADMIN, BUSINESS_ADMIN, MANAGER,
 * EMPLOYEE) — xem 20260720000002-SeedCoreRoles.ts. Migration seed gốc cho
 * transcript.create/read/update (20260629020000-SeedTranscriptionPermissions.ts)
 * từng gán nhầm role 'INTERNAL_USER' — mã KHÔNG tồn tại thật trong bảng roles,
 * khiến role_permissions cho EMPLOYEE (Host thường là nhân viên bình thường)
 * bị thiếu hoàn toàn (JOIN rỗng, không báo lỗi). Bug đó được vá bởi
 * 20260720000005-BackfillRolePermissions.ts (role đúng: BUSINESS_ADMIN,
 * EMPLOYEE, MANAGER, SYSTEM_ADMIN, module_code='transcription'). Migration này
 * dùng ĐÚNG role list đã vá ngay từ đầu, không lặp lại bug INTERNAL_USER.
 *
 * Idempotent theo đúng pattern các migration permission trước đó (ON CONFLICT
 * DO NOTHING + fallback SELECT).
 *
 * Xem spec/features/transcription/feat-speaker-tagging-post-meeting/plan.md.
 */
export class SeedTranscriptSpeakerTagPermission20260802000002 implements MigrationInterface {
  name = 'SeedTranscriptSpeakerTagPermission20260802000002';

  private readonly permission = {
    code: 'transcript.speaker_tag',
    name: 'Gan ten hang loat cho cum giong noi',
    action: 'speaker_tag',
    description:
      'Cho phep gan ten that (user he thong hoac khach ngoai) hang loat cho cum giong Speaker_N cua transcript, thay vi sua tung cau.',
  };

  private readonly roles = [
    'EMPLOYEE',
    'MANAGER',
    'BUSINESS_ADMIN',
    'SYSTEM_ADMIN',
  ];

  public async up(queryRunner: QueryRunner): Promise<void> {
    const inserted: Array<{ id: string }> = await queryRunner.query(
      `INSERT INTO permissions (permission_code, permission_name, module_code, action_code, description, is_active)
       VALUES ($1, $2, 'transcription', $3, $4, true)
       ON CONFLICT (permission_code) DO NOTHING
       RETURNING id;`,
      [
        this.permission.code,
        this.permission.name,
        this.permission.action,
        this.permission.description,
      ],
    );

    let permissionId: string | undefined = inserted[0]?.id;
    if (!permissionId) {
      const existing: Array<{ id: string }> = await queryRunner.query(
        `SELECT id FROM permissions WHERE permission_code = $1 LIMIT 1;`,
        [this.permission.code],
      );
      permissionId = existing[0]?.id;
    }
    if (!permissionId) {
      return;
    }

    for (const roleCode of this.roles) {
      await queryRunner.query(
        `INSERT INTO role_permissions (role_id, permission_id, granted_at)
         SELECT r.id, $2, NOW()
         FROM roles r
         WHERE r.role_code = $1 AND r.is_active = true
         ON CONFLICT (role_id, permission_id) DO NOTHING;`,
        [roleCode, permissionId],
      );
    }
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `DELETE FROM role_permissions
       WHERE permission_id IN (
         SELECT id FROM permissions WHERE permission_code = $1
       );`,
      [this.permission.code],
    );
    await queryRunner.query(
      `DELETE FROM permissions WHERE permission_code = $1;`,
      [this.permission.code],
    );
  }
}
