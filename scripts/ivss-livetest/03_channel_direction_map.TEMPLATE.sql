-- ⚠️ THAY <CHANNEL_IN> (và thêm <CHANNEL_OUT> khi có cam 2) bằng số channel THẬT.
-- Lấy số channel thật: đi qua cam 1 lần rồi
--   SELECT DISTINCT payload_json->>'channelId' FROM iot_device_events WHERE event_type='ivss_face_event';
--
-- Schema note: system_configs.config_key + config_group là NOT NULL (không default) → phải điền.
-- config_key KHÔNG có unique constraint → dùng DELETE-then-INSERT (không dùng ON CONFLICT).
-- Bọc BEGIN/COMMIT để nếu INSERT lỗi (gõ nhầm placeholder) thì rollback, KHÔNG mất row cũ.
BEGIN;
DELETE FROM system_configs WHERE config_key = 'ivss.channel_direction_map';
INSERT INTO system_configs (config_key, config_group, config_json, value_type, is_active)
VALUES (
  'ivss.channel_direction_map',
  'ivss',
  '{"0": "leave"}'::jsonb,   -- , "<CHANNEL_OUT>": "leave"  ← thêm khi có cam 2
  'json',
  true
);
COMMIT;
-- kiểm:
SELECT config_key, config_group, config_json, is_active
FROM system_configs WHERE config_key = 'ivss.channel_direction_map';
