import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Việc B (tái đánh giá 2026-08-21) — tách "Tôi vẫn đến" (snoozed, có hạn chót,
 * KHÔNG terminal) ra khỏi "Bỏ qua" (dismissed, admin xác nhận báo động giả,
 * VẪN terminal như cũ, KHÔNG đổi). `snooze_until` = mốc hết hạn gia hạn, đọc
 * bởi `NoShowLifecycleService.autoReleaseBatch()` — hết hạn mà vẫn không có
 * presence thật thì tự release qua đúng `release()` đã có (validSources mở
 * rộng, xem no-show-lifecycle.service.ts).
 *
 * [LƯU Ý NỢ KỸ THUẬT KẾ THỪA — đã xác nhận qua recon DB thật 2026-08-21]
 * Bảng `no_show_cases` (giống `room_booking_usages`) KHÔNG có migration
 * CREATE TABLE nào trong repo — chỉ 1 file duy nhất
 * (20260720000009-SeedDemoAttendancePresenceUsage.ts) từng nhắc tên bảng này,
 * và đó là INSERT/DELETE thuần, không CREATE TABLE. Bảng tồn tại thật trên RDS
 * production (khớp cột/FK/index đã đọc qua psql) nhưng được tạo NGOÀI LUỒNG
 * migration của repo (như `room_booking_usages`). Migration ALTER này chạy
 * ĐÚNG trên môi trường thật hiện tại (bảng đã có sẵn) nhưng SẼ LỖI nếu dựng
 * DB hoàn toàn mới chỉ từ migration trong repo — nợ kỹ thuật đã biết, KHÔNG
 * thuộc phạm vi sửa của thay đổi này.
 */
export class AddSnoozeUntilToNoShowCases20260821000001 implements MigrationInterface {
  name = 'AddSnoozeUntilToNoShowCases20260821000001';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "no_show_cases" ADD COLUMN "snooze_until" timestamptz NULL`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "no_show_cases" DROP COLUMN "snooze_until"`,
    );
  }
}
