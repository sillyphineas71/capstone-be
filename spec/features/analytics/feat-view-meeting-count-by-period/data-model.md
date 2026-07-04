# Data Model: UC-AA-04 / UC-151 — Thống kê số lượng cuộc họp theo khoảng thời gian

## Entities (Read-only, không có entity mới)

- **meetings**: `id`, `organizerId`, `roomId`, `meetingType`, `status`, `startTime`, `deletedAt`
- **users**: `id`, `departmentId`
- **departments**: `id`, `managerUserId`
- **system_configs**: `analytics.dashboard_max_range_days` (tái dùng từ UC-AA-01)

## Scope resolution (Manager) — tĩnh, tái dùng nguyên UC-AA-01

```
resolvedScopeDepartmentIds =
  IF role IN (SYSTEM_ADMIN, BUSINESS_ADMIN) -> NULL (không giới hạn)
  IF role = MANAGER ->
    SELECT id FROM departments WHERE manager_user_id = :currentUserId
    -- không phụ thuộc from/to (khác UC-AA-02)
```

## Điều kiện lọc chính (áp dụng cho cả `total` và `series`)

```sql
meetings.status IN ('completed', 'scheduled')
AND meetings.deleted_at IS NULL
AND meetings.start_time BETWEEN :from AND :to
AND (:scopeDepartmentIds IS NULL OR meetings.organizer_id IN (
  SELECT id FROM users WHERE department_id = ANY(:scopeDepartmentIds)
))
AND (:departmentId IS NULL OR meetings.organizer_id IN (
  SELECT id FROM users WHERE department_id = :departmentId
))
AND (:roomId IS NULL OR meetings.room_id = :roomId)
AND (:meetingType IS NULL OR meetings.meeting_type = :meetingType)
```

## Bucket generation cho `series`

1. Tính danh sách bucket theo `granularity`:
   - `week`: mỗi bucket là 1 tuần ISO (Thứ 2 → Chủ nhật) chạm vào khoảng `[from,to]`, label `"YYYY-'W'WW"`.
   - `month`: mỗi bucket là 1 tháng dương lịch chạm vào khoảng `[from,to]`, label `"YYYY-MM"`.
2. Với mỗi bucket, đếm số `meetings` (theo điều kiện lọc ở trên) có `start_time` rơi vào đúng bucket đó.
3. Trả về `series` theo thứ tự thời gian tăng dần, **đủ mọi bucket** kể cả `count=0` (không rút gọn khi rỗng — §0.4 spec.md).
4. `total = SUM(series[].count)` (đảm bảo NFR-005 khớp nhau).

## Data Constraints

- Không ghi/sửa/xóa `meetings`.
- Không thêm bảng/cột/config key mới.
- `total` luôn bằng tổng `series[].count`.

## Data Lifecycle

- Không có lifecycle riêng — tính lại toàn bộ mỗi request (on-demand aggregation).
