import { MigrationInterface, QueryRunner } from 'typeorm';

export class CreateIotDevicesTable1716800000000 implements MigrationInterface {
  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS "iot_devices" (
        "id" uuid NOT NULL DEFAULT uuid_generate_v4(),
        "device_code" varchar NOT NULL,
        "device_name" varchar(255) NOT NULL,
        "device_type" varchar(50) NOT NULL,
        "ip_address" varchar,
        "mac_address" varchar,
        "status" varchar NOT NULL DEFAULT 'offline',
        "health_status" varchar NOT NULL DEFAULT 'unknown',
        "last_seen_at" timestamptz,
        "metadata_json" jsonb,
        "created_by" uuid,
        "created_at" timestamptz NOT NULL DEFAULT now(),
        "updated_at" timestamptz NOT NULL DEFAULT now(),
        CONSTRAINT "PK_iot_devices_id" PRIMARY KEY ("id")
      )
    `);

    await queryRunner.query(`
      DO $$ BEGIN
        IF to_regclass('public."UQ_device_code"') IS NULL AND NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'UQ_device_code') THEN
          ALTER TABLE "iot_devices" ADD CONSTRAINT "UQ_device_code" UNIQUE ("device_code");
        END IF;
      END $$;
    `);

    await queryRunner.query(`
      CREATE UNIQUE INDEX IF NOT EXISTS "IDX_mac_address_partial" ON "iot_devices" ("mac_address") WHERE "mac_address" IS NOT NULL
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP INDEX "IDX_mac_address_partial"`);
    await queryRunner.query(
      `ALTER TABLE "iot_devices" DROP CONSTRAINT "UQ_device_code"`,
    );
    await queryRunner.query(`DROP TABLE "iot_devices"`);
  }
}
