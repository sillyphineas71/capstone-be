import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * FIX: `ux_users_email` / `ux_users_username` hiện là unique index TOÀN BẢNG
 * (không có `WHERE deleted_at IS NULL`), không khớp với business rule đã chốt
 * trong spec (feat-import-partner-accounts-excel/data-model.md §Duplicate email
 * check dùng deleted_at IS NULL) và với logic app (partner-account-import.service.ts,
 * users.service.ts) — cả hai đều chỉ coi email/username "đã dùng" khi user đó
 * CHƯA bị soft-delete.
 *
 * Hệ quả bug: sau khi soft-delete 1 tài khoản, app cho phép tạo lại tài khoản
 * mới với cùng email (pass validate), nhưng INSERT thật sự bị Postgres chặn bởi
 * unique index toàn bảng cũ → lộ raw error "duplicate key value violates unique
 * constraint ux_users_email" ra tới FE thay vì thông báo nghiệp vụ rõ ràng.
 *
 * Fix: đổi cả 2 index thành PARTIAL UNIQUE INDEX (WHERE deleted_at IS NULL),
 * đúng convention đã dùng cho ux_face_profiles_user_pending (migration
 * 20260624000001) và device_user_mappings (migration 20260721000007).
 *
 * Idempotent: DROP IF EXISTS / CREATE IF NOT EXISTS.
 */
export class FixUsersEmailUsernameUniqueIndexPartial20260816000001
  implements MigrationInterface
{
  name = 'FixUsersEmailUsernameUniqueIndexPartial20260816000001';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP INDEX IF EXISTS ux_users_email;`);
    await queryRunner.query(`DROP INDEX IF EXISTS ux_users_username;`);

    await queryRunner.query(
      `CREATE UNIQUE INDEX IF NOT EXISTS ux_users_email
         ON users (LOWER(email))
         WHERE deleted_at IS NULL;`,
    );
    await queryRunner.query(
      `CREATE UNIQUE INDEX IF NOT EXISTS ux_users_username
         ON users (LOWER(username))
         WHERE deleted_at IS NULL;`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP INDEX IF EXISTS ux_users_email;`);
    await queryRunner.query(`DROP INDEX IF EXISTS ux_users_username;`);

    await queryRunner.query(
      `CREATE UNIQUE INDEX IF NOT EXISTS ux_users_email
         ON users (LOWER(email));`,
    );
    await queryRunner.query(
      `CREATE UNIQUE INDEX IF NOT EXISTS ux_users_username
         ON users (LOWER(username));`,
    );
  }
}
