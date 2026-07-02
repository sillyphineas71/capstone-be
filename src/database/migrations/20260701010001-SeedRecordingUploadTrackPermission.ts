import { MigrationInterface, QueryRunner } from 'typeorm';

export class SeedRecordingUploadTrackPermission20260701010001 implements MigrationInterface {
  name = 'SeedRecordingUploadTrackPermission20260701010001';

  private readonly permissionCode = 'recording.upload_track';

  private readonly roles = [
    'INTERNAL_USER',
    'MANAGER',
    'BUSINESS_ADMIN',
    'SYSTEM_ADMIN',
  ];

  public async up(queryRunner: QueryRunner): Promise<void> {
    const inserted: Array<{ id: string }> = await queryRunner.query(
      `INSERT INTO permissions (permission_code, permission_name, module_code, action_code, description, is_active)
       VALUES ($1, $2, $3, $4, $5, true)
       ON CONFLICT (permission_code) DO NOTHING
       RETURNING id;`,
      [
        this.permissionCode,
        'Upload audio track cho meeting',
        'recording',
        'create',
        'Cho phep participant upload file audio ghi am cua chinh minh sau khi meeting ket thuc.',
      ],
    );

    const permissionId =
      inserted[0]?.id ??
      (
        await queryRunner.query(
          'SELECT id FROM permissions WHERE permission_code = $1',
          [this.permissionCode],
        )
      )[0]?.id;
    if (!permissionId) return;

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
      `DELETE FROM role_permissions WHERE permission_id IN (SELECT id FROM permissions WHERE permission_code = $1);`,
      [this.permissionCode],
    );
    await queryRunner.query(
      `DELETE FROM permissions WHERE permission_code = $1;`,
      [this.permissionCode],
    );
  }
}
