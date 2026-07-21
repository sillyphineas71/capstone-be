import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * SAVP Zone scope — thêm `zone_id` (nullable) vào `iot_device_events`.
 *
 * DATA-02: CHỈ ADD/DROP cột `zone_id` + FK + index của nó.
 * KHÔNG đụng `room_id`/`meeting_id` hay bất kỳ cột nào khác.
 * Index (zone_id, event_time DESC) phục vụ truy vấn timeline event theo zone.
 * Phụ thuộc: 20260721000001-CreateZonesTable phải chạy trước.
 */
export class AddZoneIdToIotDeviceEvents20260721000003
  implements MigrationInterface
{
  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE "iot_device_events" ADD COLUMN "zone_id" uuid
    `);

    await queryRunner.query(`
      ALTER TABLE "iot_device_events" ADD CONSTRAINT "FK_iot_device_events_zone"
        FOREIGN KEY ("zone_id") REFERENCES "zones" ("id") ON DELETE SET NULL
    `);

    await queryRunner.query(`
      CREATE INDEX "IDX_iot_device_events_zone_time"
        ON "iot_device_events" ("zone_id", "event_time" DESC)
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP INDEX "IDX_iot_device_events_zone_time"`);
    await queryRunner.query(
      `ALTER TABLE "iot_device_events" DROP CONSTRAINT "FK_iot_device_events_zone"`,
    );
    await queryRunner.query(
      `ALTER TABLE "iot_device_events" DROP COLUMN "zone_id"`,
    );
  }
}
