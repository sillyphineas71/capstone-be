-- GAW-001 / UC-105 — soi kết quả writer (plan §9.1 / A.3).
-- LEFT JOIN raw event ↔ gate log qua event_id (QĐ-6 luôn điền) để PHÂN BIỆT:
--   skip_reason NULL + gate_log_id có   = ✅ ghi thành công
--   skip_reason có   + gate_log_id NULL = ⏭ skip đúng thiết kế (đọc lý do: 6 giá trị)
--   skip_reason NULL + gate_log_id NULL = 🔴 GHI HỎNG (crash giữa Tx#1/Tx#2) — điều tra
SELECT e.id,
       e.event_time,
       e.payload_json->>'gateLogSkipped' AS skip_reason,
       g.id                              AS gate_log_id,
       g.direction,
       g.access_time,
       g.paired_log_id,
       g.duration_seconds,
       g.user_id,
       g.plate_number
FROM iot_device_events e
LEFT JOIN gate_access_logs g ON g.event_id = e.id
WHERE e.event_type = 'ivss_vehicle_event'
ORDER BY e.event_time DESC
LIMIT 20;

-- Đếm sự kiện/1 lượt xe (A.2): cho MỘT xe qua MỘT lần rồi chạy — kỳ vọng 1 dòng/lượt-chiều.
-- >1 ⇒ camera bắn multi-frame ⇒ cần cửa sổ thời gian (plan §5.1).
SELECT payload_json->>'channelId' AS channel,
       payload_json->>'plateNumber' AS plate,
       payload_json->>'direction'   AS direction,
       count(*)                     AS events
FROM iot_device_events
WHERE event_type = 'ivss_vehicle_event'
  AND event_time >= now() - interval '10 minutes'
GROUP BY 1, 2, 3
ORDER BY events DESC;
