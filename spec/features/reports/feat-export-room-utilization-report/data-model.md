# 📝 CHANGELOG & REVISION HISTORY
| Ngày cập nhật | Tóm tắt thay đổi | Các dòng thay đổi |
| :--- | :--- | :--- |
| 2026-07-10 | Tạo mới data-model.md cho UC-RUM-16 | Toàn bộ file |

---

# Data Model: UC-RUM-16 — Xuất báo cáo sử dụng phòng họp

## 1. Entities Involved

### 1.1 `room_bookings`

| Field | Type | Vai trò trong feature |
|---|---|---|
| `id` | uuid PK | Join khoá chính cho `room_booking_usages` |
| `room_id` | uuid FK | Lọc theo `scope.roomId` |
| `reserved_start_time` / `reserved_end_time` | timestamptz | `bookedHours`, kiểm tra empty-data (FR-017), lọc `totalBookings` theo `[from,to]` |
| `status` | varchar | Chỉ tính `approved/active/completed/released` |

### 1.2 `room_booking_usages`

| Field | Type | Vai trò trong feature |
|---|---|---|
| `booking_id` | uuid FK | Join với `room_bookings`, `no_show_cases` |
| `actual_start_time` / `actual_end_time` | timestamptz | `actualHours` (ưu tiên 1) |
| `first_presence_at` / `last_presence_at` | timestamptz | `actualHours` (fallback nếu thiếu actual_*) |
| `usage_status` | enum | Cột `usageStatus` trong CSV |
| `auto_released` | boolean | Cờ tham khảo (nguồn chính của Released rooms là `room_events`, xem §0.4 spec.md) |

### 1.3 `no_show_cases`

| Field | Type | Vai trò trong feature |
|---|---|---|
| `booking_id` | uuid FK | Join để tính `isNoShow` (CSV) và `noShowCount` |
| `detection_status` | enum | `noShowCount`/`isNoShow` chỉ tính `confirmed`/`released` |

### 1.4 `room_events`

| Field | Type | Vai trò trong feature |
|---|---|---|
| `room_id` | uuid FK | Lọc theo `scope.roomId` |
| `event_type` | varchar(60) | Nguồn Phần "Released Rooms": `room_auto_released`, `room_manual_released` |
| `event_time` | timestamptz | Lọc `[from,to]` |
| `actor_user_id` | uuid, nullable | `null` nếu event tự động (auto-release) |
| `old_status` / `new_status` | varchar | Hiển thị trong bảng Released Rooms |

### 1.5 `rooms`

| Field | Type | Vai trò trong feature |
|---|---|---|
| `id`, `room_code`, `room_name` | — | Resolve tên phòng cho mọi phần báo cáo |
| `is_active` | boolean | Loại phòng inactive khỏi `availableHours`/scope mặc định |

## 2. Query Pattern

### 2.1 Empty-data check (FR-017) — chạy đồng bộ trước khi tạo job

```sql
SELECT EXISTS (
  SELECT 1 FROM room_bookings
  WHERE status IN ('approved','active','completed','released')
    AND reserved_start_time < $1  -- to
    AND reserved_end_time > $2    -- from
    AND ($3::uuid IS NULL OR room_id = $3)  -- scope.roomId
) AS has_data;
```

### 2.2 CSV row-level query (FR-025 → FR-027)

```sql
SELECT
  rbu.booking_id, r.room_code, r.room_name, rb.meeting_id,
  rb.reserved_start_time, rb.reserved_end_time,
  rbu.actual_start_time, rbu.actual_end_time, rbu.usage_status,
  (nsc.id IS NOT NULL AND nsc.detection_status IN ('confirmed','released')) AS is_no_show,
  (re.id IS NOT NULL) AS is_released,
  re.event_type AS release_type,
  re.event_time AS released_at
FROM room_booking_usages rbu
JOIN room_bookings rb ON rb.id = rbu.booking_id
JOIN rooms r ON r.id = rb.room_id
LEFT JOIN no_show_cases nsc ON nsc.booking_id = rbu.booking_id
  AND nsc.detection_status IN ('confirmed','released')
LEFT JOIN room_events re ON re.room_id = rb.room_id
  AND re.event_type IN ('room_auto_released','room_manual_released')
  AND re.event_time BETWEEN rb.reserved_start_time AND rb.reserved_end_time
WHERE rb.reserved_start_time < $1 AND rb.reserved_end_time > $2
  AND ($3::uuid IS NULL OR rb.room_id = $3)
ORDER BY rb.reserved_start_time ASC;
```

> Lưu ý: điều kiện JOIN `room_events` theo khoảng thời gian booking là một xấp xỉ hợp lý (event thu hồi phòng xảy ra trong lúc booking đang active) — cần xác nhận lại với FK/quan hệ thật giữa `room_events` và booking/usage khi implement (Open Item ở `plan.md` mục 4).

## 3. Data Constraints

- `to - from <= system_configs['analytics.dashboard_max_range_days']`.
- `scope.roomId` (nếu có) phải trỏ tới `rooms.id` tồn tại và `is_active = true`.
- Response 4-phần (PDF/XLSX) và response row-level (CSV) đều PHẢI truy vấn từ cùng snapshot thời điểm worker chạy — không tách 2 lần query cách nhau (tránh lệch dữ liệu giữa lúc tạo job và lúc worker chạy nếu có ghi nhận mới).

## 4. Không có thay đổi Schema

Không cần migration bảng/cột/enum mới. Chỉ cần 1 migration+seed cho permission `report.room_utilization.export`, theo đúng khuôn mẫu `20260703000001-SeedReportMeetingActivityExportPermission.ts`.
