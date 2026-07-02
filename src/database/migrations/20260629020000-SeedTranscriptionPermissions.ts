import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Seed permission transcript.create/read/update (UC-125/126/127).
 * Gap đã xác nhận qua review codebase (xem tasks.md T-PERM-001): chưa có seed nào
 * cho 3 permission này, dù đã dùng trong @RequirePermissions của TranscriptionController.
 * Dùng migration (không dùng src/database/seeds/) vì seed-runner cho thư mục seeds/
 * chưa được wire vào đâu — migration là cơ chế seed duy nhất thực sự chạy được.
 */
export class SeedTranscriptionPermissions20260629020000 implements MigrationInterface {
  name = 'SeedTranscriptionPermissions20260629020000';

  private readonly permissions = [
    {
      code: 'transcript.create',
      name: 'Tao transcription job',
      action: 'create',
      description: 'Cho phep tao transcription job cho mot cuoc hop.',
    },
    {
      code: 'transcript.read',
      name: 'Xem transcript cuoc hop',
      action: 'read',
      description: 'Cho phep xem transcript cua cuoc hop.',
    },
    {
      code: 'transcript.update',
      name: 'Sua transcript thu cong',
      action: 'update',
      description: 'Cho phep sua noi dung segment transcript.',
    },
  ];

  private readonly roles = [
    'INTERNAL_USER',
    'MANAGER',
    'BUSINESS_ADMIN',
    'SYSTEM_ADMIN',
  ];

  public async up(queryRunner: QueryRunner): Promise<void> {
    for (const p of this.permissions) {
      const inserted: Array<{ id: string }> = await queryRunner.query(
        'INSERT INTO permissions (permission_code, permission_name, module_code, action_code, description, is_active) VALUES ($1, $2, $3, $4, $5, true) ON CONFLICT (permission_code) DO NOTHING RETURNING id;',
        [p.code, p.name, 'transcription', p.action, p.description],
      );
      const permissionId =
        inserted[0]?.id ??
        (
          await queryRunner.query(
            'SELECT id FROM permissions WHERE permission_code = $1',
            [p.code],
          )
        )[0]?.id;
      if (!permissionId) continue;

      for (const roleCode of this.roles) {
        await queryRunner.query(
          'INSERT INTO role_permissions (role_id, permission_id, granted_at) SELECT r.id, $2, NOW() FROM roles r WHERE r.role_code = $1 AND r.is_active = true ON CONFLICT (role_id, permission_id) DO NOTHING;',
          [roleCode, permissionId],
        );
      }
    }
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    const codes = this.permissions.map((p) => p.code);
    await queryRunner.query(
      'DELETE FROM role_permissions WHERE permission_id IN (SELECT id FROM permissions WHERE permission_code = ANY($1));',
      [codes],
    );
    await queryRunner.query(
      'DELETE FROM permissions WHERE permission_code = ANY($1);',
      [codes],
    );
  }
}
