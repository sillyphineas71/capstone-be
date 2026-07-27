-- ZPW-001 / UC-109 — soi kết quả writer `appear` (nhánh B: link qua metadata_json.sourceEventId,
-- KHÔNG cột event_id). Nối raw face event ↔ zone_presence_events để phân biệt:
--   presenceSkipped NULL + có dòng presence = ✅ ghi appear thành công
--   presenceSkipped có   + KHÔNG dòng       = ⏭ skip đúng thiết kế (đọc lý do: 4 giá trị)
--   presenceSkipped NULL + KHÔNG dòng       = 🔴 ghi HỎNG — điều tra
--
-- ⚠ Nhánh B: nối qua z.metadata_json->>'sourceEventId' = e.id::text (KHÔNG LEFT JOIN ON event_id).
SELECT e.id,
       e.event_time,
       e.payload_json->>'presenceSkipped' AS skip_reason,
       e.payload_json->>'szUid'           AS sz_uid,
       z.id        AS presence_id,
       z.event_type,
       z.user_id,
       z.zone_id
FROM iot_device_events e
LEFT JOIN zone_presence_events z
       ON z.metadata_json->>'sourceEventId' = e.id::text
WHERE e.event_type = 'ivss_face_event'
ORDER BY e.event_time DESC
LIMIT 20;

-- Chỉ các dòng appear đã ghi (cho restricted-zone quét):
SELECT id, zone_id, user_id, event_type, event_time, metadata_json
FROM zone_presence_events
WHERE event_type = 'appear'
ORDER BY event_time DESC
LIMIT 20;
