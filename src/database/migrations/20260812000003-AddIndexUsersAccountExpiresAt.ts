import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * VPT-002: Thêm partial index `idx_users_account_expires_at` trên cột `account_expires_at`
 * của bảng `users`.
 *
 * Mục đích:
 * - Hỗ trợ các truy vấn lọc tài khoản theo thời hạn (dashboard "tài khoản sắp hết hạn").
 * - Partial index (WHERE account_expires_at IS NOT NULL) — bỏ qua nhân viên thường (NULL phổ biến),
 *   chỉ index tài khoản đối tác có đặt hạn sử dụng.
 * - Lưu ý: resolveUserByPlate() dùng JOIN theo PK (u.id) + LIMIT 1, index này chủ yếu hỗ trợ
 *   các query khác lọc theo account_expires_at (xem spec §8 Residuals).
 *
 * Idempotent: IF NOT EXISTS / IF EXISTS.
 */
export class AddIndexUsersAccountExpiresAt20260812000003 implements MigrationInterface {
  name = 'AddIndexUsersAccountExpiresAt20260812000003';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `CREATE INDEX IF NOT EXISTS idx_users_account_expires_at
         ON users (account_expires_at)
         WHERE account_expires_at IS NOT NULL;`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `DROP INDEX IF EXISTS idx_users_account_expires_at;`,
    );
  }
}
