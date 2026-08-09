# Quickstart: AA-DASHBOARD-CHARTS-001 — Dashboard Chart APIs

## Test Scenarios

### API 1 — GET /analytics/security-alerts/daily-trend

1. Business Admin gọi API không tham số → `series` đủ 7 phần tử (mặc định `days=7`), sắp xếp tăng dần theo ngày, kết thúc ở hôm nay.
2. System Admin truyền `days=30` → `series` đủ 30 phần tử.
3. Tồn tại 1 `intrusion` + 2 `stranger` cùng ngày → phần tử ngày đó: `total=3, byType={"intrusion":1,"stranger":2}`.
4. Ngày không có alert nào → `total=0, byType={}`.
5. `totalInPeriod` luôn bằng tổng `series[].total`.
6. `days=0` hoặc `days=31` → 400 `VALIDATION_ERROR`.
7. Chưa đăng nhập → 401.
8. Role `MANAGER`/`EMPLOYEE` (không có permission `analytics.security_alerts.read`) → 403 `PERMISSION_DENIED`.

### API 2 — GET /analytics/audit-activity/hourly

9. System Admin gọi API không tham số → `buckets` đủ 24 phần tử `00:00..23:00` cho ngày hôm nay.
10. Truyền `date=2026-08-01` → `buckets` tính đúng cho ngày đó (UTC+7), không lẫn dữ liệu ngày khác.
11. Giờ không có audit log nào → `count=0`.
12. `totalToday` luôn bằng tổng `buckets[].count`.
13. `date` sai định dạng (`2026-13-99`, `not-a-date`) → 400 `VALIDATION_ERROR`.
14. Chưa đăng nhập → 401.
15. Business Admin (không có permission `analytics.audit_activity.read`) → 403 `PERMISSION_DENIED`.

### Audit logging (cả 2 API)

16. Gọi thành công → ghi audit log non-blocking `read_analytics_security_alerts_daily_trend`/`read_analytics_audit_activity_hourly`.
17. Nếu `AuditLogsService.logAction()` throw lỗi → response API vẫn trả về 200 bình thường (không bị chặn bởi audit log lỗi).

## Manual cURL (sau khi có JWT hợp lệ)

```bash
curl -H "Authorization: Bearer $TOKEN" \
  "http://localhost:3000/api/v1/analytics/security-alerts/daily-trend?days=7"

curl -H "Authorization: Bearer $TOKEN" \
  "http://localhost:3000/api/v1/analytics/audit-activity/hourly?date=2026-08-09"
```
