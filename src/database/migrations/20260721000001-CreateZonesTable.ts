import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * SAVP Zone scope — tạo bảng `zones` (không gian có kiểm soát: phòng họp, cổng, khu vực).
 *
 * Schema-only: KHÔNG controller/service/DTO/nghiệp vụ — nghiệp vụ làm ở UC sau.
 * DATA-02: CHỈ CREATE/DROP `zones` + 3 index của nó — KHÔNG đụng bảng khác.
 * Viết TAY (KHÔNG migration:generate). Mirror style 20260624000000-CreateVehicleRegistrationsTable.ts:
 * uuid_generate_v4(), timestamptz, PK đặt tên, partial index (WHERE deleted_at IS NULL).
 */
export class CreateZonesTable20260721000001 implements MigrationInterface {
  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE TABLE "zones" (
        "id" uuid NOT NULL DEFAULT uuid_generate_v4(),
        "zone_code" varchar(80) NOT NULL,
        "zone_name" varchar(150) NOT NULL,
        "zone_type" varchar(30) NOT NULL DEFAULT 'room',
        "building" varchar(100),
        "floor" varchar(30),
        "description" varchar(255),
        "metadata_json" jsonb,
        "status" varchar(30) NOT NULL DEFAULT 'active',
        "created_at" timestamptz NOT NULL DEFAULT now(),
        "updated_at" timestamptz NOT NULL DEFAULT now(),
        "deleted_at" timestamptz,
        CONSTRAINT "PK_zones_id" PRIMARY KEY ("id")
      )
    `);

    // Cột trap: chặn trùng zone_code ĐANG SỐNG; cho tái sử dụng code sau soft-delete.
    await queryRunner.query(`
      CREATE UNIQUE INDEX "UQ_zones_code_active"
        ON "zones" ("zone_code") WHERE "deleted_at" IS NULL
    `);

    await queryRunner.query(`
      CREATE INDEX "IDX_zones_type"
        ON "zones" ("zone_type") WHERE "deleted_at" IS NULL
    `);

    await queryRunner.query(`
      CREATE INDEX "IDX_zones_building_floor"
        ON "zones" ("building", "floor") WHERE "deleted_at" IS NULL
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP INDEX "IDX_zones_building_floor"`);
    await queryRunner.query(`DROP INDEX "IDX_zones_type"`);
    await queryRunner.query(`DROP INDEX "UQ_zones_code_active"`);
    await queryRunner.query(`DROP TABLE "zones"`);
  }
}
