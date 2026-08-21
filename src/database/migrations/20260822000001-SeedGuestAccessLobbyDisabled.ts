import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Seed config `guest_access.lobby_enabled = false` (global) — bỏ bước host duyệt khách
 * trong phòng chờ (GLA lobby). Quyết định 2026-08-22: magic link đã giới hạn thông tin
 * khách được xem, và bước host duyệt đang phát sinh lỗi, nên chuyển sang cho khách vào
 * thẳng ngay khi xác thực OTP thành công (`GuestOtpService.verifyOtp` →
 * `GuestLobbyService.admitDirectly`, xem FR-GLA-019 trong
 * `spec/features/guest-access/feat-external-guest-live-meeting-access/spec.md`).
 *
 * Trước migration này KHÔNG có row `guest_access.lobby_enabled` nào trong `system_configs`
 * (không migration nào từng seed key này) nên hệ thống đang fallback về env default
 * `GUEST_ACCESS_LOBBY_ENABLED_DEFAULT=true`. Seed row global này để override rõ ràng qua
 * DB, không phụ thuộc env — mirror thứ tự ưu tiên đọc trong `GuestLobbyService.isLobbyEnabled()`
 * (meeting override → global system_configs → env default).
 *
 * `config_key` KHÔNG có unique index/constraint trên RDS thật (chỉ PK trên `id`) — dùng
 * `WHERE NOT EXISTS` thay vì `ON CONFLICT`, mirror `20260808000002-SeedRoomBookingBufferConfig.ts`.
 */
export class SeedGuestAccessLobbyDisabled20260822000001
  implements MigrationInterface
{
  name = 'SeedGuestAccessLobbyDisabled20260822000001';

  private readonly configKey = 'guest_access.lobby_enabled';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `INSERT INTO system_configs (config_key, config_value, value_type, config_group, description, is_active)
       SELECT $1::varchar, $2::text, 'boolean', 'guest_access', $3::text, true
       WHERE NOT EXISTS (SELECT 1 FROM system_configs WHERE config_key = $1::varchar);`,
      [
        this.configKey,
        'false',
        'Bat/tat phong cho (lobby) cho khach ngoai truy cap magic link. false = khach vao thang sau khi xac thuc OTP, khong can host duyet.',
      ],
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DELETE FROM system_configs WHERE config_key = $1;`, [
      this.configKey,
    ]);
  }
}
