# Data Model: UC-AA-05 / UC-152 — Thống kê cuộc họp theo trạng thái

## Entities (Read-only, không có entity mới)

- **meetings**: `id`, `organizerId`, `roomId`, `status`, `startTime`, `deletedAt`
- **room_bookings**: `id`, `meetingId`, `roomId`, `status`
- **no_show_cases**: `id`, `bookingId`, `meetingId`, `detectionStatus`
- **users**: `id`, `departmentId`
- **departments**: `id`, `managerUserId`
- **system_configs**: `analytics.dashboard_max_range_days` (tái dùng từ UC-AA-01)

## Scope resolution (Manager) — tĩnh, tái dùng nguyên UC-AA-01/UC-AA-04

```
resolvedScopeDepartmentIds =
  IF role IN (SYSTEM_ADMIN, BUSINESS_ADMIN) -> NULL (không giới hạn)
  IF role = MANAGER -> SELECT id FROM departments WHERE manager_user_id = :currentUserId
```

## Phân loại theo thứ tự ưu tiên (precedence)

```sql
CASE
  WHEN m.status = 'cancelled' THEN 'cancelled'
  WHEN EXISTS (
    SELECT 1 FROM room_bookings rb
    JOIN no_show_cases nsc ON nsc.booking_id = rb.id
    WHERE rb.meeting_id = m.id
      AND nsc.detection_status IN ('confirmed', 'released')
  ) THEN 'no_show'
  WHEN m.status = 'completed' THEN 'completed'
  WHEN m.status = 'scheduled' THEN 'scheduled'
  ELSE NULL  -- draft/pending_approval/in_progress -> loại khỏi thống kê
END AS classified_status
```

Điều kiện WHERE chung: `m.deleted_at IS NULL`, `m.start_time BETWEEN :from AND :to`, scope + `departmentIds` filter qua `m.organizer_id IN (SELECT id FROM users WHERE department_id = ANY(...))`.

## Công thức đầu ra

| Field | Công thức |
|---|---|
| `items[].count` | `COUNT(meetings)` với `classified_status` tương ứng, trong scope + kỳ + filter |
| `total` | `SUM(items[].count)` — chỉ 4 nhóm hợp lệ, không tính `NULL` (loại) |
| `items[].percentage` | `count ÷ total × 100`, làm tròn 1 chữ số thập phân; `total=0` → `0` |

`items` luôn có đúng 4 phần tử theo thứ tự cố định: `scheduled, completed, cancelled, no_show` (kể cả khi `count=0`).

## Data Constraints

- Không ghi/sửa/xóa bảng nguồn.
- Không thêm bảng/cột/config key mới.
- Mỗi meeting chỉ được đếm vào đúng 1 nhóm (hoặc 0 nhóm nếu bị loại) — không đếm trùng.

## Data Lifecycle

- Không có lifecycle riêng — tính lại toàn bộ mỗi request (on-demand aggregation).
