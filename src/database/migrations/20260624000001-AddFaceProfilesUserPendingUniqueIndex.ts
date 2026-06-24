import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * ACCT-AVATAR-SUBMIT-001 (DM-01 / BR-010): Partial unique index đảm bảo mỗi user
 * chỉ có tối đa 1 row face_profiles ở status = 'pending_review' (chưa soft-delete).
 *
 * Đây là lưới an toàn ở tầng DB chống race condition khi 2 request submit gửi
 * gần như đồng thời (spec.md EC-003). Không tạo bảng mới, chỉ thêm index.
 */
export class AddFaceProfilesUserPendingUniqueIndex20260624000001
  implements MigrationInterface
{
  name = 'AddFaceProfilesUserPendingUniqueIndex20260624000001';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `CREATE UNIQUE INDEX IF NOT EXISTS ux_face_profiles_user_pending
       ON face_profiles(user_id)
       WHERE status = 'pending_review' AND deleted_at IS NULL;`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      'DROP INDEX IF EXISTS ux_face_profiles_user_pending;',
    );
  }
}
