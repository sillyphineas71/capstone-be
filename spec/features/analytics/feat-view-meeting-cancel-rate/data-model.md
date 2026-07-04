# Data Model: UC-AA-07 / UC-154 — Thống kê tỷ lệ cuộc họp bị hủy

## Entities (Read-only, không có entity mới)

- **meetings**: `id`, `organizerId`, `roomId`, `status`, `startTime`, `deletedAt`
- **users**: `id`, `email`, `fullName`, `departmentId`
- **departments**: `id`, `departmentName`, `managerUserId`
- **system_configs**: `analytics.dashboard_max_range_days` (tái dùng)

## Scope resolution (Manager) — tĩnh, tái dùng nguyên UC-AA-01/04/05/06

```
resolvedScopeDepartmentIds =
  IF role IN (SYSTEM_ADMIN, BUSINESS_ADMIN) -> NULL
  IF role = MANAGER -> SELECT id FROM departments WHERE manager_user_id = :currentUserId
```

## Resolve `preset` → `from`/`to`

| preset | Cách tính |
|---|---|
| `month_current` (default) | Đầu tháng hiện tại → cuối tháng hiện tại (timezone `Asia/Ho_Chi_Minh`) |
| `month_previous` | Đầu tháng trước → cuối tháng trước |
| `quarter` | Đầu quý dương lịch hiện tại → cuối quý dương lịch hiện tại (Q1=Jan-Mar, Q2=Apr-Jun, Q3=Jul-Sep, Q4=Oct-Dec), tính theo ngày gọi API |
| `custom` | Dùng đúng `from`/`to` truyền vào (bắt buộc khi `preset=custom`) |

Nếu `preset` khác `custom` mà vẫn có `from`/`to` kèm theo → bỏ qua `from`/`to`, chỉ dùng giá trị tính từ `preset` (tái dùng nguyên tắc UC-AA-02/05).

## Resolve `organizerEmail` → `organizerId`

```sql
SELECT id FROM users WHERE LOWER(email) = LOWER(:organizerEmail)
```

Không tìm thấy → coi như không có meeting nào khớp (trả response rỗng theo EX1), không phải lỗi.

## Tập meeting hợp lệ cho tổng số / tỷ lệ hủy (population)

```sql
SELECT m.id, m.organizer_id, m.status, m.start_time, u.department_id
FROM meetings m
JOIN users u ON u.id = m.organizer_id
WHERE m.status <> 'draft'
  AND m.deleted_at IS NULL
  AND m.start_time BETWEEN :from AND :to
  AND (:scopeDepartmentIds IS NULL OR u.department_id = ANY(:scopeDepartmentIds))
  AND (:departmentIds IS NULL OR u.department_id = ANY(:departmentIds))
  AND (:roomId IS NULL OR m.room_id = :roomId)
  AND (:organizerId IS NULL OR m.organizer_id = :organizerId)
```

- `totalMeetingCount` = `COUNT(*)` trên tập trên.
- `cancelledCount` = `COUNT(*) WHERE status = 'cancelled'` trên cùng tập.
- `cancelRate` = `cancelledCount / totalMeetingCount * 100`, làm tròn 1 chữ số thập phân; `0` nếu mẫu số bằng 0.

## Series (trend theo bucket)

Tái dùng nguyên `generateBuckets(from, to, granularity)` đã có ở UC-AA-04 (`week`/`month`, **không** thêm `quarter` — khác UC-AA-06, vì `quarter` ở feature này chỉ là 1 giá trị của `preset` tổng thể).

```sql
SELECT date_trunc(:granularity, m.start_time) AS bucket,
       COUNT(*) AS total_count,
       COUNT(*) FILTER (WHERE m.status = 'cancelled') AS cancelled_count
FROM meetings m
JOIN users u ON u.id = m.organizer_id
WHERE <cùng điều kiện population ở trên>
GROUP BY bucket
```

`series` luôn đủ bucket theo `[from,to]` (kể cả `totalCount=0`), map từ kết quả GROUP BY vào danh sách bucket đã generate trước — bucket không có dữ liệu → `totalCount=0, cancelledCount=0, cancelRate=0`.

## Top Organizers

```sql
SELECT m.organizer_id, u.email, u.full_name,
       COUNT(*) AS organized_count,
       COUNT(*) FILTER (WHERE m.status = 'cancelled') AS cancelled_count
FROM meetings m
JOIN users u ON u.id = m.organizer_id
WHERE <cùng điều kiện population>
GROUP BY m.organizer_id, u.email, u.full_name
HAVING COUNT(*) >= 3
ORDER BY cancelled_count DESC, (COUNT(*) FILTER (WHERE m.status='cancelled'))::numeric / COUNT(*) DESC
LIMIT 10
```

`cancelRate` mỗi phần tử = `cancelled_count / organized_count * 100`, làm tròn 1 chữ số thập phân.

## Top Departments

**Chỉ tính khi `currentUser.role <> MANAGER`** (MANAGER luôn nhận `topDepartments=[]` — spec.md §0.7).

```sql
SELECT u.department_id, d.department_name,
       COUNT(*) AS organized_count,
       COUNT(*) FILTER (WHERE m.status = 'cancelled') AS cancelled_count
FROM meetings m
JOIN users u ON u.id = m.organizer_id
JOIN departments d ON d.id = u.department_id
WHERE <cùng điều kiện population>
GROUP BY u.department_id, d.department_name
HAVING COUNT(*) >= 3
ORDER BY cancelled_count DESC, (COUNT(*) FILTER (WHERE m.status='cancelled'))::numeric / COUNT(*) DESC
LIMIT 10
```

## Data Constraints

- Không ghi/sửa/xóa bảng nguồn.
- Không thêm bảng/cột/config key mới.
- `series` luôn đủ bucket theo `[from,to]`, kể cả `totalCount=0`.
- `topOrganizers`/`topDepartments` tối đa 10 phần tử, chỉ gồm đối tượng có `organizedCount >= 3`.
- `topDepartments` luôn `[]` khi `currentUser.role = MANAGER`.
- `totalMeetingCount = SUM(series[].totalCount)` và `cancelledCount = SUM(series[].cancelledCount)` phải khớp trong cùng 1 response.

## Data Lifecycle

- Không có lifecycle riêng — tính lại toàn bộ mỗi request (on-demand aggregation), không cache/materialized view.
