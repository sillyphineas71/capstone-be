-- GAW-001 / UC-105 — tạo zone type='gate' (CHỈ dùng cho môi trường DEV).
-- Ưu tiên tạo qua API UC-90 (POST /api/v1/zones) để đi đúng luồng nghiệp vụ/audit.
-- SQL tay dưới đây chỉ để dựng nhanh trên DB local; KHÔNG chạy trên RDS chung.
--
-- Lấy id trả về để điền vào 02_channel_zone_map.TEMPLATE.sql.
INSERT INTO zones (zone_code, zone_name, zone_type, status)
VALUES ('GATE-MAIN', 'Cổng chính', 'gate', 'active')
ON CONFLICT DO NOTHING;

SELECT id, zone_code, zone_type, status
FROM zones
WHERE zone_type = 'gate' AND deleted_at IS NULL
ORDER BY created_at DESC;
