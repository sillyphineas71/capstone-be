import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Phương án c, phần 2: seed permission `ivss.portrait.manage` — cho phép
 * admin force re-sync mapping portrait 1 user (POST
 * /admin/ivss/portrait/:userId/resync) khi user bị nhận nhầm "Người lạ" dù
 * đã có mặt trong kho chân dung thường trực (szUID lệch trên thiết bị).
 *
 * Đã kiểm codebase trước khi tạo mới: các permission `ivss.*` hiện có đều là
 * read-only (`ivss.health.read`, `ivss.presence.read`, `ivss.access_log.read`
 * — xem 20260720000005-BackfillRolePermissions.ts,
 * 20260804000001-SeedIvssAccessLogReadPermission.ts). Không có permission
 * dạng `ivss.*.manage`/write nào để tái dùng.
 *
 * Idempotent theo đúng pattern 20260804000001 (ON CONFLICT DO NOTHING +
 * fallback SELECT). CHỈ SYSTEM_ADMIN — đây là thao tác quản trị thiết bị,
 * cùng mức nhạy cảm với access_log.read.
 */
export class SeedIvssPortraitManagePermission20260807000002
  implements MigrationInterface
{
  name = 'SeedIvssPortraitManagePermission20260807000002';

  private readonly permission = {
    code: 'ivss.portrait.manage',
    name: 'Quan tri dong bo kho chan dung thuong truc (IVSS portrait)',
    action: 'manage',
    description:
      'Cho phep force re-sync mapping portrait cua 1 user (danh dau sync_status=pending de reconcile enroll lai) khi phat hien nhan dien sai do szUID lech tren thiet bi. Thao tac quan tri thiet bi — chi cap cho quan tri he thong.',
  };

  /** CHỈ SYSTEM_ADMIN — xem lý do ở doc đầu file. */
  private readonly roles = ['SYSTEM_ADMIN'];

  public async up(queryRunner: QueryRunner): Promise<void> {
    const inserted: Array<{ id: string }> = await queryRunner.query(
      `INSERT INTO permissions (permission_code, permission_name, module_code, action_code, description, is_active)
       VALUES ($1, $2, 'ivss', $3, $4, true)
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
