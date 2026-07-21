import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * SAVP Zone scope — tạo bảng `vehicle_control_list` (allowlist/blocklist biển số).
 *
 * Schema-only: KHÔNG controller/service/DTO/nghiệp vụ (kiểm tra khi qua cổng = UC sau).
 * DATA-02: CHỈ CREATE/DROP `vehicle_control_list` + 2 index của nó — KHÔNG đụng bảng khác.
 * - `plate_number` (normalized) + `list_type` là cặp TRAP: partial unique WHERE deleted_at IS NULL
 *   → một biển chỉ nằm 1 lần trong mỗi loại danh sách ĐANG SỐNG, vẫn cho thêm lại sau soft-delete.
 * - `plate_raw` giữ biển gốc admin nhập (hiển thị).
 * Mirror pattern soft-delete của `vehicle_registrations`.
 */
export class CreateVehicleControlListTable20260721000006
  implements MigrationInterface
{
  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE TABLE "vehicle_control_list" (
        "id" uuid NOT NULL DEFAULT uuid_generate_v4(),
        "plate_number" varchar(16) NOT NULL,
        "plate_raw" varchar(20),
        "list_type" varchar(20) NOT NULL DEFAULT 'blocklist',
        "reason" varchar(255),
        "active" boolean NOT NULL DEFAULT true,
        "created_by" uuid,
        "created_at" timestamptz NOT NULL DEFAULT now(),
        "updated_at" timestamptz NOT NULL DEFAULT now(),
        "deleted_at" timestamptz,
        CONSTRAINT "PK_vehicle_control_list_id" PRIMARY KEY ("id"),
        CONSTRAINT "FK_vehicle_control_list_created_by" FOREIGN KEY ("created_by")
          REFERENCES "users" ("id") ON DELETE SET NULL
      )
    `);

    await queryRunner.query(`
      CREATE UNIQUE INDEX "UQ_vehicle_control_plate_type_active"
        ON "vehicle_control_list" ("plate_number", "list_type") WHERE "deleted_at" IS NULL
    `);

    // Hot path: tra biển đang bật kiểm soát tại thời điểm xe qua cổng.
    await queryRunner.query(`
      CREATE INDEX "IDX_vehicle_control_lookup"
        ON "vehicle_control_list" ("plate_number")
        WHERE "deleted_at" IS NULL AND "active" = true
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP INDEX "IDX_vehicle_control_lookup"`);
    await queryRunner.query(`DROP INDEX "UQ_vehicle_control_plate_type_active"`);
    await queryRunner.query(`DROP TABLE "vehicle_control_list"`);
  }
}
