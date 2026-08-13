import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * VRS-001 / Setup-0 (ANPR) — tạo bảng `vehicle_registrations` (biển số ↔ user, 1-nhiều).
 *
 * Ngoại lệ no-migration ĐƯỢC DUYỆT (Phương án A): bảng mới riêng cho quan hệ biển↔user.
 * DATA-02: CHỈ CREATE/DROP `vehicle_registrations` + 2 index của nó — KHÔNG đụng bảng khác.
 * Viết TAY (KHÔNG migration:generate). Mirror style 1716800000000-CreateIotDevicesTable.ts:
 * uuid_generate_v4(), timestamptz, PK đặt tên, partial unique index (WHERE deleted_at IS NULL).
 */
export class CreateVehicleRegistrationsTable20260624000000 implements MigrationInterface {
  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS "vehicle_registrations" (
        "id" uuid NOT NULL DEFAULT uuid_generate_v4(),
        "user_id" uuid NOT NULL,
        "plate_number" varchar(16) NOT NULL,
        "plate_raw" varchar(20) NOT NULL,
        "vehicle_type" varchar(50),
        "note" varchar(255),
        "status" varchar(30) NOT NULL DEFAULT 'active',
        "created_at" timestamptz NOT NULL DEFAULT now(),
        "updated_at" timestamptz NOT NULL DEFAULT now(),
        "deleted_at" timestamptz,
        CONSTRAINT "PK_vehicle_registrations_id" PRIMARY KEY ("id"),
        CONSTRAINT "FK_vehicle_registrations_user" FOREIGN KEY ("user_id")
          REFERENCES "users" ("id") ON DELETE CASCADE
      )
    `);

    // Cột trap: chặn trùng biển ĐANG SỐNG; cho đăng ký lại sau soft-delete.
    await queryRunner.query(`
      CREATE UNIQUE INDEX IF NOT EXISTS "UQ_vehicle_plate_number_active"
        ON "vehicle_registrations" ("plate_number") WHERE "deleted_at" IS NULL
    `);

    await queryRunner.query(`
      CREATE INDEX IF NOT EXISTS "IDX_vehicle_registrations_user_id"
        ON "vehicle_registrations" ("user_id")
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP INDEX "IDX_vehicle_registrations_user_id"`);
    await queryRunner.query(`DROP INDEX "UQ_vehicle_plate_number_active"`);
    await queryRunner.query(`DROP TABLE "vehicle_registrations"`);
  }
}
