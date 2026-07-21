import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * SAVP Zone scope — tạo bảng `zone_presence_events` (sự kiện hiện diện theo zone).
 *
 * Schema-only: KHÔNG controller/service/DTO/nghiệp vụ (ingestion, đánh giá occupancy = UC sau).
 * DATA-02: CHỈ CREATE/DROP `zone_presence_events` + 3 index của nó — KHÔNG đụng bảng khác.
 * KHÔNG soft-delete: đây là event log.
 * Phụ thuộc: `zones`, `iot_devices`, `users`.
 */
export class CreateZonePresenceEventsTable20260721000005
  implements MigrationInterface
{
  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE TABLE "zone_presence_events" (
        "id" uuid NOT NULL DEFAULT uuid_generate_v4(),
        "zone_id" uuid NOT NULL,
        "device_id" uuid,
        "user_id" uuid,
        "event_type" varchar(20) NOT NULL,
        "occupancy_count" integer,
        "confidence_score" numeric(5,4),
        "event_time" timestamptz NOT NULL,
        "source_type" varchar(30) NOT NULL DEFAULT 'ivss',
        "metadata_json" jsonb,
        "created_at" timestamptz NOT NULL DEFAULT now(),
        CONSTRAINT "PK_zone_presence_events_id" PRIMARY KEY ("id"),
        CONSTRAINT "FK_zone_presence_events_zone" FOREIGN KEY ("zone_id")
          REFERENCES "zones" ("id") ON DELETE RESTRICT,
        CONSTRAINT "FK_zone_presence_events_device" FOREIGN KEY ("device_id")
          REFERENCES "iot_devices" ("id") ON DELETE SET NULL,
        CONSTRAINT "FK_zone_presence_events_user" FOREIGN KEY ("user_id")
          REFERENCES "users" ("id") ON DELETE SET NULL
      )
    `);

    await queryRunner.query(`
      CREATE INDEX "IDX_zpe_zone_time"
        ON "zone_presence_events" ("zone_id", "event_time" DESC)
    `);

    // Phần lớn event là room-level (user_id NULL) — partial index giữ index nhỏ.
    await queryRunner.query(`
      CREATE INDEX "IDX_zpe_user_time"
        ON "zone_presence_events" ("user_id", "event_time" DESC) WHERE "user_id" IS NOT NULL
    `);

    // Truy vấn occupancy count mới nhất theo zone.
    await queryRunner.query(`
      CREATE INDEX "IDX_zpe_count"
        ON "zone_presence_events" ("zone_id", "event_time" DESC) WHERE "event_type" = 'count'
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP INDEX "IDX_zpe_count"`);
    await queryRunner.query(`DROP INDEX "IDX_zpe_user_time"`);
    await queryRunner.query(`DROP INDEX "IDX_zpe_zone_time"`);
    await queryRunner.query(`DROP TABLE "zone_presence_events"`);
  }
}
