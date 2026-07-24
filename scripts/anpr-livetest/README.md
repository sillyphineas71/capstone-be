# anpr-livetest — GAW-001 / UC-105 (ghi nhận ra/vào khuôn viên)

Bộ script **VẬN HÀNH** để nghiệm thu writer gate log qua webhook thật (không phần cứng).
KHÔNG phải migration, KHÔNG hook vào npm script — chạy tay khi cần.

## Tiền điều kiện (làm THEO THỨ TỰ)
1. Đã chạy migration `20260725000001-AddGateLogsContentUniqueIndex` (index chống trùng B′).
2. **Tạo zone `type='gate'`** qua API UC-90 (`POST /api/v1/zones`) — hoặc SQL tay (`01_seed_gate_zone.sql`, chỉ cho môi trường dev).
3. **Seed `ivss.channel_zone_map`** trỏ `channelId` camera cổng → `id` zone gate (`02_channel_zone_map.TEMPLATE.sql`).
4. (Khuyến nghị) seed `ivss.channel_direction_map` cho channel vào/ra (mirror `scripts/ivss-livetest/03_*`).
5. **⚠ Kiểm đồng hồ camera/IVSS** — lệch > 1h so với server ⇒ MỌI sự kiện ra `bad_utc` ⇒ không dòng gate log nào. Chỉnh NTP TRƯỚC buổi nghiệm thu.

## Chạy
- `03_curl_examples.sh` — bắn 2 sự kiện vào/ra qua webhook (`X-Internal-Token: $IVSS_BRIDGE_TOKEN`).
- `04_check_gate_logs.sql` — soi kết quả: raw event ↔ gate log (LEFT JOIN), đọc `gateLogSkipped`.

## Kỳ vọng
- 2 dòng `gate_access_logs` (enter + leave), leave có `paired_log_id` + `duration_seconds` > 0.
- Biển KHÔNG đăng ký: vẫn có dòng gate log, `user_id = NULL`, không ghép cặp.

## ⚠ Sau nghiệm thu — đếm sự kiện/1 lượt xe (A.2)
Cho MỘT xe qua MỘT lần, đếm số dòng `iot_device_events` (event_type='ivss_vehicle_event').
`=1` → B′ đủ. `>1` → camera bắn multi-frame ⇒ cần bổ sung cửa sổ thời gian tại guard trước
`writeGateLog` (KHÔNG đập kiến trúc). Xem plan.md §5.1.

## ⚠ Chẩn đoán: thấy `zone_unmapped` thì kiểm LUÔN đồng hồ camera
`preSkip` ưu tiên `zone_unmapped` cao nhất ⇒ nếu VỪA chưa map zone VỪA lệch đồng hồ, chỉ thấy
`zone_unmapped`; sửa map xong chạy lại mới lòi `bad_utc` — tốn thêm một vòng. Khi thấy
`zone_unmapped`, **kiểm đồng hồ camera cùng lúc** với việc sửa `channel_zone_map`.

---

# TRÌNH TỰ CHẠY LẦN ĐẦU (copy-paste)

> ⚠ Người phụ trách chạy trên môi trường ĐÃ thống nhất. KHÔNG chạy lên RDS chung nếu chưa duyệt.

### 0. Boot app xác nhận không lỗi khởi tạo module (trước khi tin cậy các bước sau)
```bash
npm run start:dev
# thấy "Nest application successfully started" (KHÔNG UnknownDependenciesException / circular) → Ctrl+C tắt
```

### 1. Chạy migration + kiểm index
```bash
npm run migration:run
```
Kiểm index tồn tại (chạy trên DB đích):
```sql
SELECT indexname FROM pg_indexes
WHERE tablename = 'gate_access_logs' AND indexname = 'UQ_gate_logs_content';
```

### 2. Tạo zone type='gate' (API UC-90 — cần quyền `zones.zone.create`)
```bash
curl -s -X POST "$BASE_URL/api/v1/zones" \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer $ADMIN_JWT" \
  -d '{"zone_code":"GATE-MAIN","zone_name":"Cong chinh","zone_type":"gate"}'
# → lấy data.id (UUID) cho bước 3
```

### 3. Seed `ivss.channel_zone_map` (DELETE-then-INSERT)
```sql
BEGIN;
DELETE FROM system_configs WHERE config_key = 'ivss.channel_zone_map';
INSERT INTO system_configs (config_key, config_group, config_json, value_type, is_active)
VALUES ('ivss.channel_zone_map', 'ivss', '{"<CHANNEL>": "<GATE_ZONE_ID>"}'::jsonb, 'json', true);
COMMIT;
```

### 4. Seed `ivss.channel_direction_map` — **BẮT BUỘC cho camera ANPR IPC**
Camera ANPR IPC đi đường sự kiện `TRAFFICJUNCTION 0x17` → bridge hard-code `eventAction='seen'`.
Nếu KHÔNG seed map này, chiều rơi về `eventAction='seen'` → `direction_seen` → **KHÔNG ghi gate log**.
Chiều PHẢI quyết bởi KÊNH, không phải thiết bị (QĐ-3).
```sql
BEGIN;
DELETE FROM system_configs WHERE config_key = 'ivss.channel_direction_map';
INSERT INTO system_configs (config_key, config_group, config_json, value_type, is_active)
VALUES ('ivss.channel_direction_map', 'ivss', '{"<CHANNEL_IN>": "enter", "<CHANNEL_OUT>": "leave"}'::jsonb, 'json', true);
COMMIT;
```

### 5. Kiểm đồng hồ camera/IVSS
So giờ camera với server. **Lệch > 1h ⇒ MỌI sự kiện ra `bad_utc` ⇒ không dòng gate log nào.**
Chỉnh NTP trước khi bắn thử.

### 6. Bắn 2 sự kiện vào/ra
```bash
IVSS_BRIDGE_TOKEN=<token> CHANNEL_IN=<ch> PLATE=51F-12345 bash 03_curl_examples.sh
```

### 7. Kiểm kết quả
```bash
psql "$DATABASE_URL" -f 04_check_gate_logs.sql
```
| `gateLogSkipped` | có dòng gate log | Nghĩa |
| :--- | :--- | :--- |
| NULL | có | ✅ thành công |
| có giá trị | không | ⏭ skip đúng thiết kế — đọc lý do (6 giá trị) |
| NULL | không | 🔴 **ghi HỎNG** — điều tra (crash giữa Tx#1/Tx#2) |

### 8. CÂU HỎI CHO BUỔI NGHIỆM THU PHẦN CỨNG
Cho **một** xe chạy qua **một** lần, đếm số dòng `iot_device_events`:
```sql
SELECT payload_json->>'channelId' AS channel,
       payload_json->>'plateNumber' AS plate,
       payload_json->>'direction'   AS direction,
       count(*) AS events
FROM iot_device_events
WHERE event_type = 'ivss_vehicle_event'
  AND event_time >= now() - interval '10 minutes'
GROUP BY 1,2,3 ORDER BY events DESC;
```
`= 1` → chống trùng B′ đủ. `> 1` → camera bắn nhiều lần/lượt ⇒ bổ sung **cửa sổ thời gian**
tại guard đã bố trí trước `writeGateLog` (KHÔNG đập kiến trúc — plan §5.1).

### 9. TẮT KHẨN CẤP (không revert code, không restart)
```sql
UPDATE system_configs SET is_active = false WHERE config_key = 'ivss.channel_zone_map';
-- hoặc: DELETE FROM system_configs WHERE config_key = 'ivss.channel_zone_map';
```
→ mọi sự kiện ra `zone_unmapped` → writer ngừng ghi hoàn toàn. Reader KHÔNG cache nên có hiệu lực
ngay. Luồng `iot_device_events` vẫn chạy như trước UC-105.
