import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Seed config `room_booking_buffer_minutes` (Nhóm B — xử lý xung đột thời gian/phòng họp,
 * xem KE_HOACH_XU_LY_XUNG_DOT_PHONG_GIO_HOP_2026-08-08.md ở root repo).
 *
 * Số phút đệm tối thiểu bắt buộc giữa endTime của một booking và startTime của booking kế
 * tiếp trong CÙNG một phòng — chỉ áp dụng khi so sánh với booking đã `approved`/`active`
 * (đồng nhất chính sách Nhóm A: booking `pending` không chặn, không cần buffer).
 *
 * Key này KHÔNG nằm trong SYSTEM_CONFIG_ALLOWLIST (`system-config-allowlist.ts`) — tương tự
 * `meeting_warning_conflict_buffer_minutes` (module live-meeting), đây là config nội bộ đọc
 * trực tiếp bởi các service liên quan (meetings, scheduling), KHÔNG chỉnh qua màn hình
 * SystemSettings.jsx / endpoint `/system-configurations`. Xem ghi chú "2 hệ tên song song"
 * ở `spec/features/administration/feat-system-configurations/spec.md` dòng 26 — không được
 * tự ý gộp 2 hệ tên nếu chưa có yêu cầu team.
 *
 * `config_key` KHÔNG có unique index/constraint trên RDS thật (chỉ PK trên `id`) — dùng
 * `WHERE NOT EXISTS` thay vì `ON CONFLICT`, mirror `20260723000001-SeedGateAccessClosingHourConfig.ts`.
 */
export class SeedRoomBookingBufferConfig20260808000002
  implements MigrationInterface
{
  name = 'SeedRoomBookingBufferConfig20260808000002';

  private readonly configKey = 'room_booking_buffer_minutes';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `INSERT INTO system_configs (config_key, config_value, value_type, config_group, description, is_active)
       SELECT $1::varchar, $2::text, 'number', 'room_booking', $3::text, true
       WHERE NOT EXISTS (SELECT 1 FROM system_configs WHERE config_key = $1::varchar);`,
      [
        this.configKey,
        '15',
        'Số phút đệm tối thiểu bắt buộc giữa 2 booking liền kề trong cùng phòng (chỉ tính với booking approved/active)',
      ],
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DELETE FROM system_configs WHERE config_key = $1;`, [
      this.configKey,
    ]);
  }
}
