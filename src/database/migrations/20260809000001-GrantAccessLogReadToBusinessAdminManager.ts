import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * [FIX 2026-08-09] Mở rộng permission `ivss.access_log.read` (seed ở
 * 20260804000001-SeedIvssAccessLogReadPermission.ts, lúc đó CHỈ SYSTEM_ADMIN) sang thêm
 * BUSINESS_ADMIN và MANAGER — 2 role này cần xem User Journey (GET /campus/user-journey,
 * gate-access.module.ts) và bấm xem ảnh sự kiện mà không bị 403.
 *
 * KHÔNG tạo lại permission (đã tồn tại) — chỉ INSERT thêm 2 dòng role_permissions.
 * Idempotent: ON CONFLICT DO NOTHING + fallback SELECT permission id, mirror đúng pattern
 * migration seed permission trước đó trong repo này.
 *
 * Role code dùng đúng 4 mã thật trong 20260720000002-SeedCoreRoles.ts.
 */
export class GrantAccessLogReadToBusinessAdminManager20260809000001 implements MigrationInterface {
  name = 'GrantAccessLogReadToBusinessAdminManager20260809000001';

  private readonly permissionCode = 'ivss.access_log.read';

  /** Thêm 2 role — SYSTEM_ADMIN đã có từ migration trước, KHÔNG lặp lại ở đây. */
  private readonly roles = ['BUSINESS_ADMIN', 'MANAGER'];

  public async up(queryRunner: QueryRunner): Promise<void> {
    const existing: Array<{ id: string }> = await queryRunner.query(
      `SELECT id FROM permissions WHERE permission_code = $1 LIMIT 1;`,
      [this.permissionCode],
    );
    const permissionId = existing[0]?.id;
    if (!permissionId) {
      // Permission chưa tồn tại (migration seed trước chưa chạy) — không có gì để gán.
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
    // CHỈ gỡ 2 role thêm ở đây — KHÔNG đụng SYSTEM_ADMIN (do migration khác quản lý)
    // và KHÔNG xoá permission (không phải migration tạo ra nó).
    await queryRunner.query(
      `DELETE FROM role_permissions
       WHERE permission_id IN (
         SELECT id FROM permissions WHERE permission_code = $1
       )
       AND role_id IN (
         SELECT id FROM roles WHERE role_code = ANY($2::text[])
       );`,
      [this.permissionCode, this.roles],
    );
  }
}
