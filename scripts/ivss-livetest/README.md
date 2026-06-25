# IVSS live-test runbook (cắm-là-chạy)

> Chuẩn bị sẵn cho phiên live-test khi thiết bị IVSS có điện trở lại.
> Tất cả file là `.sql` rời, chạy bằng `psql -f` (né lỗi quote PowerShell). KHÔNG có migration.
> Patch code liên quan đã merge: szUid nested (Task A, d27f9c7) + channel-direction (Task B, f6ddead).

## Thứ tự chạy khi có điện

1. **Bật bridge IVSS + backend** (BE NestJS). Đảm bảo cron `ivss-sync` đang chạy
   (gate `SCHEDULER_IVSS_SYNC_ENABLED=true` trong `.env` của phiên test).
2. **Arm group trên web IVSS** — bật nhận diện cho group đã enroll.
3. **Gia hạn meeting + reset mapping admin** (qua điều kiện enroll/presence):
   ```
   psql -f 01_extend_meeting.sql
   psql -f 02_reset_admin_mapping.sql
   ```
   ⏳ **Sau `02`, cron `ivss-sync` chỉ enroll lại ở TICK KẾ TIẾP — đợi ≤ 60s rồi mới query mapping mới.**
   Đừng query ngay sau DELETE rồi tưởng hỏng (lúc đó mapping cũ đã xóa, mapping mới chưa kịp tạo).
   Mapping mới ĐÚNG kỳ vọng:
   - `device_person_id` = số IVSS gán (vd `620`) — **KHÔNG phải sha256** (`68e3...`); nếu vẫn ra sha256 → Task A chưa lấy được szUid (xem cảnh báo dưới).
   - `sync_status = 'synced'`.
4. **Đi qua cam** (cam 1) vài lần.
5. **Kiểm event đã vào DB**:
   ```
   psql -f 04_check_events.sql
   ```
6. **Đọc channel THẬT** từ cột `channel` (hoặc:
   `SELECT DISTINCT payload_json->>'channelId' FROM iot_device_events WHERE event_type='ivss_face_event';`)
   → điền vào `03_channel_direction_map.TEMPLATE.sql` (thay `<CHANNEL_IN>`; thêm `<CHANNEL_OUT>` khi có cam 2)
   → chạy:
   ```
   psql -f 03_channel_direction_map.TEMPLATE.sql
   ```
7. **Đi qua cam lại** → chạy lại `04_check_events.sql` → cột `direction` phải ra `enter`
   (kênh đã map). Có cam 2 (leave) thì kiểm cặp enter/leave.

## Đọc kết quả `match_state` (cột đầu của 04)

- `matched` → ✅ luồng đúng (có cả userId + roomId + meetingId).
- `unmatched_identity` → szUid event KHÔNG khớp mapping. So `event_szuid` (cột 2) với
  `device_person_id` trong `device_user_mappings` (chạy lại `02`'s SELECT). Lệch → **Task A**
  (`extractSzUid`) có thể cần chỉnh theo shape response bridge thật.
- `unmatched_location` → channel KHÔNG map ra room. Sai/thiếu **`ivss.channel_room_map`**
  (config riêng, KHÁC `channel_direction_map`). Kiểm:
  `SELECT config_json FROM system_configs WHERE config_key='ivss.channel_room_map' AND is_active=true;`
- `unmatched_both` → cả hai (szUid lạ + channel chưa map).

## File trong thư mục

| File | Vai trò |
|---|---|
| `01_extend_meeting.sql` | Gia hạn `IVSS-TEST-001` (end_time > now, status in_progress). |
| `02_reset_admin_mapping.sql` | Xóa mapping `source='ivss'` của admin (chừa row FaceGate) để cron enroll lại sạch. |
| `03_channel_direction_map.TEMPLATE.sql` | TEMPLATE — điền channel thật rồi chạy (BEGIN/COMMIT, DELETE-then-INSERT). |
| `04_check_events.sql` | Query 10 event IVSS gần nhất để soi match_state/direction. |
