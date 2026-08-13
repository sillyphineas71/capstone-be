import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * [FIX 2026-08-13] Mở rộng permission `ivss.access_log.read` (seed ở
 * 20260804000001-SeedIvssAccessLogReadPermission.ts, sau đó
 * 20260809000001-GrantAccessLogReadToBusinessAdminManager.ts đã thêm
 * BUSINESS_ADMIN + MANAGER) sang thêm EMPLOYEE — modal chi tiết presence (Employee tự
 * xem chính mình, đã mở ở ivss.presence.read cùng ngày) cần hiển thị ảnh camera vào/ra
 * qua route GET /ivss/device-events/:eventId/snapshot, vốn dùng chung permission này.
 *
 * Ownership-check RIÊNG (chặn Employee xem ảnh của người khác) nằm ở
 * DeviceEventSnapshotService.getSnapshot() — permission này CHỈ mở cửa route, không tự
 * giới hạn phạm vi.
 *
 * KHÔNG tạo lại permission (đã tồn tại) — chỉ INSERT thêm 1 dòng role_permissions.
 * Idempotent: fallback SELECT permission id + ON CONFLICT DO NOTHING, mirror đúng
 * pattern 20260809000001-GrantAccessLogReadToBusinessAdminManager.ts.
 *
 * Role code dùng đúng 4 mã thật trong 20260720000002-SeedCoreRoles.ts.
 */
export class GrantAccessLogReadToEmployee20260813000002 implements MigrationInterface {
  name = 'GrantAccessLogReadToEmployee20260813000002';

  private readonly permissionCode = 'ivss.access_log.read';

  /** Chỉ thêm EMPLOYEE — SYSTEM_ADMIN/BUSINESS_ADMIN/MANAGER đã có từ 2 migration trước. */
  private readonly roles = ['EMPLOYEE'];

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
    // CHỈ gỡ EMPLOYEE — KHÔNG đụng 3 role kia (do 2 migration khác quản lý) và KHÔNG
    // xoá permission (không phải migration tạo ra nó).
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
