-- GAW-001 / UC-105 — seed ivss.channel_zone_map: channelId camera cổng → zone_id (UUID).
--
-- ⚠ THAY <CHANNEL_IN>/<CHANNEL_OUT> bằng số channel THẬT của camera ANPR ở cổng,
--   và <GATE_ZONE_ID> bằng id zone type='gate' (từ 01_seed_gate_zone.sql hoặc API UC-90).
-- Lấy số channel thật: cho xe qua 1 lần rồi
--   SELECT DISTINCT payload_json->>'channelId' FROM iot_device_events WHERE event_type='ivss_vehicle_event';
--
-- Schema note: system_configs.config_key + config_group NOT NULL (không default) → phải điền.
-- config_key KHÔNG có unique constraint → dùng DELETE-then-INSERT (KHÔNG ON CONFLICT).
-- Bọc BEGIN/COMMIT: INSERT lỗi (gõ nhầm) thì rollback, KHÔNG mất row cũ.
--
-- Reader (vehicle-resolve.service.ts) chỉ nhận value là UUID hợp lệ; entry sai bị bỏ.
BEGIN;
DELETE FROM system_configs WHERE config_key = 'ivss.channel_zone_map';
INSERT INTO system_configs (config_key, config_group, config_json, value_type, is_active)
VALUES (
  'ivss.channel_zone_map',
  'ivss',
  '{"<CHANNEL_IN>": "<GATE_ZONE_ID>"}'::jsonb,  -- , "<CHANNEL_OUT>": "<GATE_ZONE_ID>"  ← thêm khi có cam 2
  'json',
  true
);
COMMIT;

-- kiểm:
SELECT config_key, config_group, config_json, is_active
FROM system_configs WHERE config_key = 'ivss.channel_zone_map';
