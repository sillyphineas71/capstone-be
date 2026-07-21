import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * SAVP Zone scope — thêm `zone_id` (nullable) vào `iot_devices`.
 *
 * DATA-02: CHỈ ADD/DROP cột `zone_id` + FK + index của nó.
 * KHÔNG đụng `room_id` hay bất kỳ cột nào khác — `room_id` giữ nguyên, cùng tồn tại với `zone_id`.
 * Nullable + ON DELETE SET NULL: xoá zone không làm mất thiết bị.
 * Phụ thuộc: 20260721000001-CreateZonesTable phải chạy trước.
 */
export class AddZoneIdToIotDevices20260721000002 implements MigrationInterface {
  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE "iot_devices" ADD COLUMN "zone_id" uuid
    `);

    await queryRunner.query(`
      ALTER TABLE "iot_devices" ADD CONSTRAINT "FK_iot_devices_zone"
        FOREIGN KEY ("zone_id") REFERENCES "zones" ("id") ON DELETE SET NULL
    `);

    await queryRunner.query(`
      CREATE INDEX "IDX_iot_devices_zone_id" ON "iot_devices" ("zone_id")
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP INDEX "IDX_iot_devices_zone_id"`);
    await queryRunner.query(
      `ALTER TABLE "iot_devices" DROP CONSTRAINT "FK_iot_devices_zone"`,
    );
    await queryRunner.query(`ALTER TABLE "iot_devices" DROP COLUMN "zone_id"`);
  }
}
