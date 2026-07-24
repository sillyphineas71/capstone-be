import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Seed config `gate_access.closing_hour_local` (GAP-001 / UC-116).
 *
 * Dùng để xác định "giờ đóng cửa quy định" — mốc thời gian mà một phiên ra/vào cổng còn
 * thiếu "Ra" được coi là "Chưa hoàn tất" (derived tại tầng đọc UC-117, KHÔNG lưu cột riêng).
 *
 * ⚠️ SỬA SAU KHI CHẠY THẬT TRÊN RDS (2026-07-23): `database_v3_2_compact_39_tables.sql:1060`
 * ghi `ux_system_configs_key` nhưng bảng THẬT trên RDS **KHÔNG có unique index/constraint
 * nào trên `config_key`** (đã kiểm tra trực tiếp `pg_constraint`/`pg_indexes` — chỉ có PK
 * trên `id`). File `.sql` đó là tài liệu thiết kế, không phải nguồn xác nhận schema sống —
 * dùng `WHERE NOT EXISTS` (mirror `20260720000011-SeedDemoNotificationsJobsAuditVehicles.ts`)
 * thay vì `ON CONFLICT`, tránh lỗi `42P10 no unique or exclusion constraint`.
 */
export class SeedGateAccessClosingHourConfig20260723000001
  implements MigrationInterface
{
  name = 'SeedGateAccessClosingHourConfig20260723000001';

  private readonly configKey = 'gate_access.closing_hour_local';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `INSERT INTO system_configs (config_key, config_value, value_type, config_group, description, is_active)
       SELECT $1::varchar, $2::text, 'string', 'gate_access', $3::text, true
       WHERE NOT EXISTS (SELECT 1 FROM system_configs WHERE config_key = $1::varchar);`,
      [
        this.configKey,
        '22:00',
        'Giờ đóng cửa quy định dùng để coi phiên ra/vào cổng thiếu "Ra" là Chưa hoàn tất (UC-116)',
      ],
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `DELETE FROM system_configs WHERE config_key = $1;`,
      [this.configKey],
    );
  }
}
