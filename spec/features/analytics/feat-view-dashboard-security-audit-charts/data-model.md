# Data Model: AA-DASHBOARD-CHARTS-001 — Dashboard Chart APIs

## Entities (Read-only, không có entity mới)

- **security_alerts**: `id`, `alert_type`, `triggered_at`. Không soft-delete.
- **audit_logs**: `id`, `created_at`. Không lọc `action_type`/`severity`.
- **permissions** / **role_permissions** / **roles**: chỉ thêm dữ liệu seed (2 permission mới), không đổi schema.

## API 1 — Security Alerts Daily Trend

### Điều kiện lọc

```sql
security_alerts.triggered_at >= :fromUtc  -- (hôm nay - (days-1)) 00:00:00 UTC+7, quy đổi UTC
  AND security_alerts.triggered_at < :toUtcExclusive -- (hôm nay + 1) 00:00:00 UTC+7, quy đổi UTC
```

### Truy vấn tổng hợp

```sql
SELECT
  (triggered_at AT TIME ZONE 'Asia/Ho_Chi_Minh')::date AS alert_date,
  alert_type,
  COUNT(*) AS cnt
FROM security_alerts
WHERE triggered_at >= :fromUtc AND triggered_at < :toUtcExclusive
GROUP BY 1, 2
```

### Bucket generation cho `series`

1. Tính danh sách `days` ngày liên tiếp từ `hôm nay - (days-1)` đến `hôm nay` (UTC+7), định dạng `YYYY-MM-DD`.
2. Với mỗi ngày, gom các dòng kết quả truy vấn có `alert_date` trùng khớp thành `byType = { [alert_type]: cnt }` (chỉ liệt kê `cnt > 0` — luôn đúng vì query GROUP BY chỉ trả dòng có dữ liệu thật).
3. `total` của ngày = tổng `cnt` của mọi `alert_type` trong ngày đó = `Object.values(byType).reduce(sum)`.
4. `series` trả theo thứ tự thời gian tăng dần, đủ đúng `days` phần tử kể cả ngày không có alert (`total:0, byType:{}`).
5. `totalInPeriod = SUM(series[].total)`.

## API 2 — Audit Activity Hourly

### Điều kiện lọc

```sql
audit_logs.created_at >= :dayStartUtc   -- :date 00:00:00 UTC+7, quy đổi UTC
  AND audit_logs.created_at < :dayEndUtcExclusive -- (:date + 1) 00:00:00 UTC+7, quy đổi UTC
```

### Truy vấn tổng hợp

```sql
SELECT
  EXTRACT(HOUR FROM (created_at AT TIME ZONE 'Asia/Ho_Chi_Minh'))::int AS hour_of_day,
  COUNT(*) AS cnt
FROM audit_logs
WHERE created_at >= :dayStartUtc AND created_at < :dayEndUtcExclusive
GROUP BY 1
```

### Bucket generation cho `buckets`

1. Sinh đủ 24 giờ `0..23`, label `"HH:00"` (2 chữ số, ví dụ `"07:00"`).
2. Map kết quả truy vấn vào đúng giờ theo `hour_of_day`; giờ không có dữ liệu giữ `count:0`.
3. `buckets` trả theo thứ tự `00:00 → 23:00`.
4. `totalToday = SUM(buckets[].count)`.

## Data Constraints

- Không ghi/sửa/xóa `security_alerts`/`audit_logs`.
- Không thêm bảng/cột mới — chỉ thêm dữ liệu seed `permissions`/`role_permissions` qua migration.
- `series` luôn đủ đúng `days` phần tử; `buckets` luôn đủ đúng 24 phần tử.
- Quy đổi ranh giới ngày/giờ giữa UTC+7 và UTC PHẢI thực hiện ở tầng ứng dụng (JS `Date`) trước khi truyền tham số vào raw SQL, để tránh phụ thuộc timezone session của DB connection.

## Data Lifecycle

- Không có lifecycle riêng — tính lại toàn bộ mỗi request (on-demand aggregation), không cache/pre-aggregate.

## Permission Seed Data (migration)

| permission_code | module_code | action_code | roles |
|---|---|---|---|
| `analytics.security_alerts.read` | `analytics` | `security_alerts.read` | `BUSINESS_ADMIN`, `SYSTEM_ADMIN` |
| `analytics.audit_activity.read` | `analytics` | `audit_activity.read` | `SYSTEM_ADMIN` |
