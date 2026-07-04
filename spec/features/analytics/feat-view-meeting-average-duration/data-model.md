# Data Model: UC-AA-06 / UC-153 — Thống kê thời lượng trung bình cuộc họp

## Entities (Read-only, không có entity mới)

- **meetings**: `id`, `organizerId`, `roomId`, `status`, `startTime`, `deletedAt`
- **room_bookings**: `id`, `meetingId`, `reservedStartTime`, `reservedEndTime`
- **room_booking_usages**: `meetingId`, `actualStartTime`, `actualEndTime`, `firstPresenceAt`, `lastPresenceAt`
- **users**: `id`, `departmentId`
- **departments**: `id`, `managerUserId`
- **system_configs**: `analytics.dashboard_max_range_days` (tái dùng)

## Scope resolution (Manager) — tĩnh, tái dùng nguyên UC-AA-01/04/05

```
resolvedScopeDepartmentIds =
  IF role IN (SYSTEM_ADMIN, BUSINESS_ADMIN) -> NULL
  IF role = MANAGER -> SELECT id FROM departments WHERE manager_user_id = :currentUserId
```

## Tập meeting hợp lệ (population)

```sql
SELECT m.id, m.start_time, rb.reserved_start_time, rb.reserved_end_time,
       rbu.actual_start_time, rbu.actual_end_time, rbu.first_presence_at, rbu.last_presence_at
FROM meetings m
JOIN room_bookings rb ON rb.meeting_id = m.id
LEFT JOIN room_booking_usages rbu ON rbu.meeting_id = m.id
WHERE m.status = 'completed'
  AND m.deleted_at IS NULL
  AND m.start_time BETWEEN :from AND :to
  AND (:scopeDepartmentIds IS NULL OR m.organizer_id IN (
    SELECT id FROM users WHERE department_id = ANY(:scopeDepartmentIds)
  ))
  AND (:departmentIds IS NULL OR m.organizer_id IN (
    SELECT id FROM users WHERE department_id = ANY(:departmentIds)
  ))
  AND (:roomId IS NULL OR m.room_id = :roomId)
```

- Nếu `rbu` (usage) không tồn tại HOẶC thiếu cả `actual_*` lẫn `presence_*` → loại bản ghi đó khỏi tính `actualAverageMinutes` **và** `plannedAverageMinutes` cho bucket đó (đồng bộ population — CL-2 spec.md).

## Công thức

| Field | Công thức |
|---|---|
| `plannedMinutes` (mỗi record) | `EXTRACT(EPOCH FROM (reserved_end_time - reserved_start_time))/60` |
| `actualMinutes` (mỗi record) | `EXTRACT(EPOCH FROM (actual_end_time - actual_start_time))/60`, fallback `EXTRACT(EPOCH FROM (last_presence_at - first_presence_at))/60`, loại nếu cả hai đều thiếu |
| `plannedAverageMinutes` (bucket/summary) | `AVG(plannedMinutes)` trên tập record hợp lệ (có cả planned và actual) trong bucket/kỳ; `NULL` nếu tập rỗng |
| `actualAverageMinutes` (bucket/summary) | `AVG(actualMinutes)` trên cùng tập record; `NULL` nếu tập rỗng |
| `completedMeetingCount` (bucket/summary) | `COUNT(*)` trên cùng tập record |

## Bucket generation

Mở rộng `generateBuckets()` đã có ở UC-AA-04, thêm `quarter`:
- `day`: mỗi bucket 1 ngày, label `"YYYY-MM-DD"`.
- `week`: mỗi bucket 1 tuần ISO, label `"YYYY-'W'WW"`.
- `month`: mỗi bucket 1 tháng dương lịch, label `"YYYY-MM"`.
- `quarter`: mỗi bucket 1 quý dương lịch (Q1=Jan-Mar, Q2=Apr-Jun, Q3=Jul-Sep, Q4=Oct-Dec), label `"YYYY-'Q'Q"`.

`series` luôn đủ bucket theo `[from,to]`, kể cả bucket có `completedMeetingCount=0` (giá trị `null` cho 2 field trung bình).

## Data Constraints

- Không ghi/sửa/xóa bảng nguồn.
- Không thêm bảng/cột/config key mới.
- `plannedAverageMinutes`/`actualAverageMinutes` luôn tính trên **cùng 1 tập N** (`completedMeetingCount`) trong mỗi bucket/summary.

## Data Lifecycle

- Không có lifecycle riêng — tính lại toàn bộ mỗi request (on-demand aggregation).
