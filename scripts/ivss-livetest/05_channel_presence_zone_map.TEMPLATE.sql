-- ZPW-001 / UC-109 — seed ivss.channel_presence_zone_map: channel camera KHU VỰC → zone (UUID).
--
-- ⚠ KEY RIÊNG với ivss.channel_zone_map (UC-105, cổng) và ivss.channel_room_map (phòng họp).
--   Camera một-vai-một-channel: nếu một channel nằm trong cả hai map, writer VẪN ghi nhưng log
--   WARN "camera nên một vai" — kiểm cấu hình.
-- ⚠ THAY <CHANNEL> bằng channel THẬT của camera hành lang/sảnh/bãi xe,
--   <AREA_ZONE_ID> bằng id zone type='corridor'/'lobby'/'parking' (tạo qua API UC-90).
--   Trỏ nhầm vào zone gate/room → writer skip presenceSkipped='zone_wrong_type' (QC-5).
--
-- config_key KHÔNG unique → DELETE-then-INSERT. Reader chỉ nhận value là UUID hợp lệ.
BEGIN;
DELETE FROM system_configs WHERE config_key = 'ivss.channel_presence_zone_map';
INSERT INTO system_configs (config_key, config_group, config_json, value_type, is_active)
VALUES (
  'ivss.channel_presence_zone_map',
  'ivss',
  '{"<CHANNEL>": "<AREA_ZONE_ID>"}'::jsonb,
  'json',
  true
);
COMMIT;

-- kiểm:
SELECT config_key, config_group, config_json, is_active
FROM system_configs WHERE config_key = 'ivss.channel_presence_zone_map';
