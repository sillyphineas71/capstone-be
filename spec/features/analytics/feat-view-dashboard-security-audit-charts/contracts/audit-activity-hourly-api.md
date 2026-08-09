# API Contract: Audit Log Hourly Activity

> Nguồn: `Docs/Nam_Sent/BE_API_REQUIREMENTS_Dashboard_Charts.md` §API 2.

## GET /api/v1/analytics/audit-activity/hourly

**Permission**: `analytics.audit_activity.read`
**System Roles**: `SYSTEM_ADMIN`

### Query Parameters

| Param | Type | Required | Default | Description |
|---|---|---|---|---|
| date | string (`YYYY-MM-DD`) | No | Hôm nay (UTC+7) | Ngày thống kê |

### Response 200

```json
{
  "success": true,
  "message": "Hoạt động audit log theo giờ được truy xuất thành công",
  "data": {
    "date": "2026-08-09",
    "buckets": [
      { "hour": "00:00", "count": 2 },
      { "hour": "01:00", "count": 0 }
    ],
    "totalToday": 2
  },
  "meta": {}
}
```

`buckets` luôn có đủ 24 phần tử (`00:00`..`23:00`).

### Error Codes

| Status | Code | Description |
|---|---|---|
| 400 | VALIDATION_ERROR | `date` sai định dạng `YYYY-MM-DD` hoặc không phải ngày hợp lệ |
| 401 | (JWT error chuẩn) | Chưa đăng nhập |
| 403 | PERMISSION_DENIED | Không có permission `analytics.audit_activity.read` |
| 500 | INTERNAL_ERROR | Lỗi truy vấn hệ thống |
