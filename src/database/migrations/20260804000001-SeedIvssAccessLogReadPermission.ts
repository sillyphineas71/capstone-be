import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * ALS-002: seed permission `ivss.access_log.read` — xem nhật ký ra/vào phòng
 * (GET /ivss/access-log, GET /ivss/rooms/:roomId/access-log).
 *
 * Vì sao KHÔNG tái dùng `ivss.presence.read` (permission mà 2 route này dùng trước
 * đây): `ivss.presence.read` phục vụ Màn 1 — presence trong PHẠM VI MỘT CUỘC HỌP, và
 * đang được grant cho cả MANAGER (20260720000005-BackfillRolePermissions.ts:353-357).
 * Access-log là dữ liệu DI CHUYỂN CÁ NHÂN toàn khuôn viên theo ngày, kể cả người
 * không dự cuộc họp nào — phạm vi rộng hơn hẳn. Chỉ grant SYSTEM_ADMIN, KHÔNG grant
 * rộng; muốn mở thêm role thì làm migration riêng có chủ đích.
 *
 * Idempotent theo pattern các migration seed permission trước đó: ON CONFLICT DO
 * NOTHING + fallback SELECT (bảng `permissions` có `ux_permissions_code`,
 * `role_permissions` có `ux_role_permissions_pair` — đã kiểm trên DB thật).
 *
 * Role code dùng đúng 4 mã thật trong 20260720000002-SeedCoreRoles.ts.
 */
export class SeedIvssAccessLogReadPermission20260804000001
  implements MigrationInterface
{
  name = 'SeedIvssAccessLogReadPermission20260804000001';

  private readonly permission = {
    code: 'ivss.access_log.read',
    name: 'Xem nhat ky ra/vao phong (IVSS access log)',
    action: 'read',
    description:
      'Cho phep xem nhat ky ra/vao phong tu su kien nhan dien khuon mat IVSS (toan he thong hoac theo tung phong). Du lieu di chuyen ca nhan — chi cap cho quan tri he thong.',
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
