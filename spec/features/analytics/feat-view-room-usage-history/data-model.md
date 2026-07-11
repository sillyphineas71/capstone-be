# 📝 CHANGELOG & REVISION HISTORY
| Ngày cập nhật | Tóm tắt thay đổi | Các dòng thay đổi |
| :--- | :--- | :--- |
| 2026-07-10 | Tạo mới data-model.md cho UC-RUM-04 (bổ sung sau spec.md/plan.md/tasks.md) | Toàn bộ file |

---

# Data Model: UC-RUM-04 — Xem lịch sử sử dụng phòng họp theo khoảng thời gian

## 1. Entities Involved

### 1.1 `rooms` (RoomEntity)

| Field | Type | Vai trò trong feature |
|---|---|---|
| `id`, `room_code`, `room_name` | — | Resolve tên phòng cho mỗi dòng session |
| `site_name`, `area_name` | varchar | Filter `siteName`/`areaName` (FR-009) |
| `is_active` | boolean | Loại phòng inactive khỏi kết quả mặc định |

### 1.2 `room_bookings` (RoomBookingEntity)

| Field | Type | Vai trò trong feature |
|---|---|---|
| `id`, `booking_code` | — | Khoá join với `room_booking_usages` |
| `meeting_id`, `room_id` | uuid FK | Join `meetings`, filter `roomId` |
| `reserved_start_time` / `reserved_end_time` | timestamptz | `totalReservedHours`, cột "Thời gian đăng ký" |
| `status` | enum (pending/approved/active/completed/cancelled/released) | Xác định `cancelled`/`cancelled_late` (FR-DATA-002) — **KHÔNG loại trừ status nào** khỏi tập kết quả (khác UC-AA-02) |
| `updated_at` | timestamptz | Proxy thời điểm hủy (CL-1, không chính danh) |

### 1.3 `room_booking_usages` (RoomBookingUsageEntity)

| Field | Type | Vai trò trong feature |
|---|---|---|
| `booking_id`, `meeting_id`, `room_id` | uuid FK | Join |
| `actual_start_time` / `actual_end_time` | timestamptz | `totalActualHours` (ưu tiên 1), cột "Thời gian thực tế" |
| `first_presence_at` / `last_presence_at` | timestamptz | `totalActualHours` fallback |
| `usage_status` | enum `RoomUsageStatus` (NOT_STARTED/IN_USE/COMPLETED/NO_SHOW/EARLY_EMPTY/RELEASED) | Nguồn chính `sessionStatus` (§0.2 spec.md) |

### 1.4 `meetings` (MeetingEntity)

| Field | Type | Vai trò trong feature |
|---|---|---|
| `id`, `meeting_code`, `title` | — | Cột "Tên cuộc họp" |
| `host_id`, `organizer_id` | uuid FK | Resolve `hostName` (ưu tiên `host_id`, fallback `organizer_id` — FR-033) |

### 1.5 `users`, `departments`

| Field | Type | Vai trò trong feature |
|---|---|---|
| `users.full_name` | — | Resolve `hostName` |
| `departments.manager_user_id` | uuid FK | Cơ sở scope Manager (tái dùng `RoomUsageDashboardService.resolveScope()`) |

### 1.6 `system_configs`

| Key | Vai trò |
|---|---|
| `analytics.dashboard_max_range_days` | Tái dùng — guard `DATE_RANGE_TOO_LARGE` (FR-022) |
| `analytics.room_operating_hours_per_day` | Tái dùng — công thức `reservationUtilizationRate` |
| `analytics.late_cancellation_threshold_minutes` | **Mới** — ngưỡng phân biệt `cancelled_late`/`cancelled`, mặc định 60 phút (FR-DATA-003) |

## 2. Query Pattern

### 2.1 Danh sách phiên (phân trang, tách biệt summary — NFR-005)

```sql
-- Query 1: danh sách phân trang
SELECT rb.id AS booking_id, r.room_code, r.room_name, m.id AS meeting_id, m.title,
       COALESCE(hu.full_name, ou.full_name) AS host_name,
       rb.reserved_start_time, rb.reserved_end_time,
       rbu.actual_start_time, rbu.actual_end_time,
       rb.status AS booking_status, rb.updated_at, rbu.usage_status
FROM room_bookings rb
JOIN rooms r ON r.id = rb.room_id
LEFT JOIN meetings m ON m.id = rb.meeting_id
LEFT JOIN users hu ON hu.id = m.host_id
LEFT JOIN users ou ON ou.id = m.organizer_id
LEFT JOIN room_booking_usages rbu ON rbu.booking_id = rb.id
WHERE rb.reserved_start_time < $1 AND rb.reserved_end_time > $2  -- [from, to]
  AND ($3::uuid IS NULL OR rb.room_id = $3)                       -- roomId
  AND ($4::uuid[] IS NULL OR rb.room_id = ANY($4))                -- scope Manager
ORDER BY rb.reserved_start_time DESC
LIMIT $5 OFFSET $6;

-- Query 2: summary (KHÔNG limit/offset, cùng WHERE clause)
SELECT
  SUM(EXTRACT(EPOCH FROM (rb.reserved_end_time - rb.reserved_start_time))/3600) AS total_reserved_hours,
  SUM(EXTRACT(EPOCH FROM (COALESCE(rbu.actual_end_time - rbu.actual_start_time,
                                     rbu.last_presence_at - rbu.first_presence_at)))/3600) AS total_actual_hours,
  COUNT(*) FILTER (WHERE rbu.usage_status = 'no_show') AS no_show_count
FROM room_bookings rb
LEFT JOIN room_booking_usages rbu ON rbu.booking_id = rb.id
WHERE <cùng điều kiện WHERE ở trên>;
```

### 2.2 Derive `sessionStatus` (FR-DATA-002 — pseudocode)

```typescript
function deriveSessionStatus(booking, usage, lateCancellationThresholdMinutes, now) {
  if (booking.status === 'cancelled') {
    const minutesBeforeStart = (booking.reservedStartTime.getTime() - booking.updatedAt.getTime()) / 60000;
    return minutesBeforeStart <= lateCancellationThresholdMinutes ? 'cancelled_late' : 'cancelled';
  }
  if (usage) {
    return { COMPLETED: 'completed', NO_SHOW: 'no_show', EARLY_EMPTY: 'early_empty',
              RELEASED: 'released', NOT_STARTED: 'not_started', IN_USE: 'in_progress' }[usage.usageStatus];
  }
  if (booking.reservedEndTime < now) return 'pending_evaluation'; // CL-2: hiển thị, không ẩn
  return 'not_started';
}
```

## 3. Data Constraints

- `to - from <= system_configs['analytics.dashboard_max_range_days']`.
- `page >= 1`, `1 <= limit <= 100`.
- `summary` luôn tính trên toàn bộ tập kết quả khớp filter, độc lập với `page`/`limit` (NFR-005) — bắt buộc 2 query tách biệt như §2.1.
- Mẫu số = 0 (không có booking nào) → mọi rate trả `0`, `totalActualHours` trả `null` nếu không có usage nào có dữ liệu thực tế.

## 4. Không có thay đổi Schema

Không cần migration bảng/cột mới. Chỉ 1 key `system_configs` mới: `analytics.late_cancellation_threshold_minutes` (mặc định 60, precedence `system_configs → env ANALYTICS_LATE_CANCELLATION_THRESHOLD_MINUTES → default`).
