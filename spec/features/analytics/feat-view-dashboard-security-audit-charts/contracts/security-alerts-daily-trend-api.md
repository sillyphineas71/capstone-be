# API Contract: Security Alerts Daily Trend

> Nguồn: `Docs/Nam_Sent/BE_API_REQUIREMENTS_Dashboard_Charts.md` §API 1.

## GET /api/v1/analytics/security-alerts/daily-trend

**Permission**: `analytics.security_alerts.read`
**System Roles**: `BUSINESS_ADMIN`, `SYSTEM_ADMIN`

### Query Parameters

| Param | Type | Required | Default | Description |
|---|---|---|---|---|
| days | integer | No | 7 | Số ngày lấy dữ liệu, hợp lệ 1..30 |

### Response 200

```json
{
  "success": true,
  "message": "Xu hướng cảnh báo an ninh theo ngày được truy xuất thành công",
  "data": {
    "series": [
      { "date": "2026-08-03", "total": 3, "byType": { "intrusion": 1, "stranger": 2 } },
      { "date": "2026-08-04", "total": 0, "byType": {} },
      { "date": "2026-08-05", "total": 1, "byType": { "vehicle_control_match": 1 } }
    ],
    "totalInPeriod": 4
  },
  "meta": {}
}
```

### Error Codes

| Status | Code | Description |
|---|---|---|
| 400 | VALIDATION_ERROR | `days` không phải số nguyên trong khoảng 1..30 |
| 401 | (JWT error chuẩn) | Chưa đăng nhập |
| 403 | PERMISSION_DENIED | Không có permission `analytics.security_alerts.read` |
| 500 | INTERNAL_ERROR | Lỗi truy vấn hệ thống |
