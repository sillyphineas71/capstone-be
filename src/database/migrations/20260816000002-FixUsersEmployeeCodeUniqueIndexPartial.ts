import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * FIX (cùng gốc với migration 20260816000001): `idx_users_employee_code_unique`
 * cũng là unique index TOÀN BẢNG (chỉ loại trừ NULL, không loại trừ soft-delete),
 * trong khi app code (account-import.service.ts dòng ~600) chỉ coi employee_code
 * "đã dùng" khi user đó CHƯA bị soft-delete (`deletedAt: IsNull()`).
 *
 * Hệ quả bug (báo lỗi thực tế 2026-08-16): xóa 1 nhân viên có employee_code, sau đó
 * import lại 1 dòng BẤT KỲ dùng đúng employee_code đó (kể cả cho email khác) → app
 * validate qua (không thấy trùng vì lọc theo user active), nhưng INSERT thật bị Postgres
 * chặn bởi index toàn bảng cũ → lộ raw error "duplicate key value violates unique
 * constraint idx_users_employee_code_unique" ra ngoài thay vì thông báo nghiệp vụ.
 *
 * Fix: đổi thành PARTIAL UNIQUE INDEX (WHERE employee_code IS NOT NULL AND
 * deleted_at IS NULL), đúng convention đã dùng cho ux_users_email/ux_users_username
 * (migration 20260816000001).
 *
 * Idempotent: DROP IF EXISTS / CREATE IF NOT EXISTS.
 */
export class FixUsersEmployeeCodeUniqueIndexPartial20260816000002 implements MigrationInterface {
  name = 'FixUsersEmployeeCodeUniqueIndexPartial20260816000002';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `DROP INDEX IF EXISTS idx_users_employee_code_unique;`,
    );
    await queryRunner.query(
      `CREATE UNIQUE INDEX IF NOT EXISTS idx_users_employee_code_unique
         ON users (employee_code)
         WHERE employee_code IS NOT NULL AND deleted_at IS NULL;`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `DROP INDEX IF EXISTS idx_users_employee_code_unique;`,
    );
    await queryRunner.query(
      `CREATE UNIQUE INDEX IF NOT EXISTS idx_users_employee_code_unique
         ON users (employee_code)
         WHERE employee_code IS NOT NULL;`,
    );
  }
}
