import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * SAVP Zone scope — partial unique index cho `device_user_mappings` (device_id, user_id).
 *
 * DATA-02: CHỈ CREATE/DROP index — KHÔNG đụng cột, KHÔNG đụng bảng nào khác.
 * Mục đích: chặn map trùng một user vào cùng một device khi bản ghi ĐANG SỐNG;
 * vẫn cho map lại sau soft-delete (mirror pattern `UQ_vehicle_plate_number_active`).
 *
 * ⚠️ CẢNH BÁO CHO NGƯỜI REVIEW — migration này SẼ FAIL nếu DB đích đang tồn tại
 * cặp (device_id, user_id) trùng nhau với `deleted_at IS NULL`.
 * Phải TỰ kiểm tra và dọn dữ liệu trùng TRƯỚC khi chạy. Migration này KHÔNG tự dọn,
 * KHÔNG tự soft-delete, KHÔNG tự merge bản ghi — mọi quyết định giữ/xoá là của người review.
 *
 * Câu lệnh kiểm tra trùng (chạy thủ công, chỉ đọc):
 *   SELECT "device_id", "user_id", COUNT(*)
 *   FROM "device_user_mappings"
 *   WHERE "deleted_at" IS NULL
 *   GROUP BY "device_id", "user_id"
 *   HAVING COUNT(*) > 1;
 */
export class AddUniqueIndexDeviceUserMappings20260721000007
  implements MigrationInterface
{
  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE UNIQUE INDEX "UQ_device_user_mappings_active"
        ON "device_user_mappings" ("device_id", "user_id") WHERE "deleted_at" IS NULL
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP INDEX "UQ_device_user_mappings_active"`);
  }
}
