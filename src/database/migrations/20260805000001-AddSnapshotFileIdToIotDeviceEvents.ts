import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * F-E — bổ sung snapshot ảnh cho `iot_device_events`, dùng chung cho 3 luồng: IVSS
 * unmatched_identity/unmatched_both (F-B), zone appear khả năng vi phạm (F-C), ANPR (F-D).
 *
 * DATA-02 pattern (mirror 20260721000003-AddZoneIdToIotDeviceEvents): CHỈ ADD/DROP cột
 * `snapshot_file_id` + FK của nó. KHÔNG đụng cột nào khác.
 *
 * FK → `media_files(id)` — TÁI DÙNG bảng file chung sẵn có (pattern
 * `face_profiles.primary_image_file_id`), KHÔNG tạo entity/bảng riêng, KHÔNG lưu
 * base64/storage_key thô trực tiếp trên `iot_device_events`. ON DELETE SET NULL: xoá
 * media_files (vd retention job sau này) KHÔNG kéo theo mất raw event.
 */
export class AddSnapshotFileIdToIotDeviceEvents20260805000001 implements MigrationInterface {
  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE "iot_device_events" ADD COLUMN IF NOT EXISTS "snapshot_file_id" uuid
    `);

    await queryRunner.query(`
      DO $$ BEGIN
        IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'FK_iot_device_events_snapshot_file') THEN
          ALTER TABLE "iot_device_events" ADD CONSTRAINT "FK_iot_device_events_snapshot_file"
            FOREIGN KEY ("snapshot_file_id") REFERENCES "media_files" ("id") ON DELETE SET NULL;
        END IF;
      END $$;
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "iot_device_events" DROP CONSTRAINT "FK_iot_device_events_snapshot_file"`,
    );
    await queryRunner.query(
      `ALTER TABLE "iot_device_events" DROP COLUMN "snapshot_file_id"`,
    );
  }
}
