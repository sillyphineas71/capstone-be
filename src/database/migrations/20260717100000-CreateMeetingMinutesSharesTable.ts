import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * feat-share-meeting-minutes — tạo bảng `meeting_minutes_shares` (ACL: biên bản ↔
 * user được cấp quyền xem, nhiều-nhiều). Yêu cầu rõ ràng từ Product Owner (share
 * biên bản đã published cho user nội bộ bất kỳ ngoài participant).
 *
 * Hard-delete khi revoke (mirror role_permissions/meeting_participants) — bảng ACL
 * thuần túy, lịch sử grant/revoke lưu qua audit_logs. Viết TAY (KHÔNG migration:generate).
 * Mirror style 20260624000000-CreateVehicleRegistrationsTable.ts:
 * uuid_generate_v4(), timestamptz, PK/FK đặt tên rõ, index cho FK.
 */
export class CreateMeetingMinutesSharesTable20260717100000
  implements MigrationInterface
{
  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE TABLE "meeting_minutes_shares" (
        "id" uuid NOT NULL DEFAULT uuid_generate_v4(),
        "minutes_id" uuid NOT NULL,
        "user_id" uuid NOT NULL,
        "granted_by" uuid NOT NULL,
        "granted_at" timestamptz NOT NULL DEFAULT now(),
        CONSTRAINT "PK_meeting_minutes_shares_id" PRIMARY KEY ("id"),
        CONSTRAINT "FK_meeting_minutes_shares_minutes" FOREIGN KEY ("minutes_id")
          REFERENCES "meeting_minutes" ("id") ON DELETE CASCADE,
        CONSTRAINT "FK_meeting_minutes_shares_user" FOREIGN KEY ("user_id")
          REFERENCES "users" ("id") ON DELETE CASCADE,
        CONSTRAINT "FK_meeting_minutes_shares_granted_by" FOREIGN KEY ("granted_by")
          REFERENCES "users" ("id"),
        CONSTRAINT "uq_meeting_minutes_shares_minutes_user"
          UNIQUE ("minutes_id", "user_id")
      )
    `);

    await queryRunner.query(`
      CREATE INDEX "idx_meeting_minutes_shares_minutes_id"
        ON "meeting_minutes_shares" ("minutes_id")
    `);

    await queryRunner.query(`
      CREATE INDEX "idx_meeting_minutes_shares_user_id"
        ON "meeting_minutes_shares" ("user_id")
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `DROP INDEX "idx_meeting_minutes_shares_user_id"`,
    );
    await queryRunner.query(
      `DROP INDEX "idx_meeting_minutes_shares_minutes_id"`,
    );
    await queryRunner.query(`DROP TABLE "meeting_minutes_shares"`);
  }
}
