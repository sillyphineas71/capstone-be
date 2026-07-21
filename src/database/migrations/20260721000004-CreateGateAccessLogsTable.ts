import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * SAVP Zone scope — tạo bảng `gate_access_logs` (log ra/vào cổng theo zone).
 *
 * Schema-only: KHÔNG controller/service/DTO/nghiệp vụ (pairing in/out, tính duration = UC sau).
 * DATA-02: CHỈ CREATE/DROP `gate_access_logs` + 4 index của nó — KHÔNG đụng bảng khác.
 * KHÔNG soft-delete: đây là audit log, bản ghi không được xoá mềm.
 * `paired_log_id` là self-FK: nối bản ghi `in` với bản ghi `out` tương ứng.
 * Phụ thuộc: `zones`, `iot_devices`, `iot_device_events`, `users`, `vehicle_registrations`.
 */
export class CreateGateAccessLogsTable20260721000004
  implements MigrationInterface
{
  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE TABLE "gate_access_logs" (
        "id" uuid NOT NULL DEFAULT uuid_generate_v4(),
        "zone_id" uuid NOT NULL,
        "device_id" uuid,
        "event_id" uuid,
        "user_id" uuid,
        "vehicle_registration_id" uuid,
        "plate_number" varchar(16),
        "direction" varchar(10) NOT NULL,
        "access_time" timestamptz NOT NULL,
        "paired_log_id" uuid,
        "duration_seconds" integer,
        "metadata_json" jsonb,
        "created_at" timestamptz NOT NULL DEFAULT now(),
        CONSTRAINT "PK_gate_access_logs_id" PRIMARY KEY ("id"),
        CONSTRAINT "FK_gate_access_logs_zone" FOREIGN KEY ("zone_id")
          REFERENCES "zones" ("id") ON DELETE RESTRICT,
        CONSTRAINT "FK_gate_access_logs_device" FOREIGN KEY ("device_id")
          REFERENCES "iot_devices" ("id") ON DELETE SET NULL,
        CONSTRAINT "FK_gate_access_logs_event" FOREIGN KEY ("event_id")
          REFERENCES "iot_device_events" ("id") ON DELETE SET NULL,
        CONSTRAINT "FK_gate_access_logs_user" FOREIGN KEY ("user_id")
          REFERENCES "users" ("id") ON DELETE SET NULL,
        CONSTRAINT "FK_gate_access_logs_vehicle_registration" FOREIGN KEY ("vehicle_registration_id")
          REFERENCES "vehicle_registrations" ("id") ON DELETE SET NULL,
        CONSTRAINT "FK_gate_access_logs_paired_log" FOREIGN KEY ("paired_log_id")
          REFERENCES "gate_access_logs" ("id") ON DELETE SET NULL
      )
    `);

    await queryRunner.query(`
      CREATE INDEX "IDX_gate_logs_user_time"
        ON "gate_access_logs" ("user_id", "access_time" DESC)
    `);

    await queryRunner.query(`
      CREATE INDEX "IDX_gate_logs_zone_time"
        ON "gate_access_logs" ("zone_id", "access_time" DESC)
    `);

    await queryRunner.query(`
      CREATE INDEX "IDX_gate_logs_plate"
        ON "gate_access_logs" ("plate_number")
    `);

    // Hot path: tìm bản ghi chưa được ghép cặp in/out của một user.
    await queryRunner.query(`
      CREATE INDEX "IDX_gate_logs_unpaired"
        ON "gate_access_logs" ("user_id", "direction") WHERE "paired_log_id" IS NULL
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP INDEX "IDX_gate_logs_unpaired"`);
    await queryRunner.query(`DROP INDEX "IDX_gate_logs_plate"`);
    await queryRunner.query(`DROP INDEX "IDX_gate_logs_zone_time"`);
    await queryRunner.query(`DROP INDEX "IDX_gate_logs_user_time"`);
    await queryRunner.query(`DROP TABLE "gate_access_logs"`);
  }
}
