# API Contract: UC-AA-01 / UC-148 View Dashboard Overview

> Nguồn: `docs/API_CONTRACT_v1.0_with_system_roles.md` mục 16 (UC-148), bổ sung field `activeUserCount` theo yêu cầu trực tiếp UC-AA-01 (xem `spec.md` §0 RECON).

## GET /api/v1/analytics/dashboard/overview

**Permission**: `analytics.overview.read`
**System Roles**: `MANAGER`, `BUSINESS_ADMIN`, `SYSTEM_ADMIN`

### Query Parameters

| Param | Type | Required | Default | Description |
|---|---|---|---|---|
| from | date (ISO 8601) | No | today - 30 days | Bắt đầu khoảng thời gian |
| to | date (ISO 8601) | No | today | Kết thúc khoảng thời gian (`to >= from`, `to - from <= max_range_days`) |
| departmentId | UUID | No | - | Lọc theo phòng ban. MANAGER chỉ được truyền phòng ban mình quản lý |
| roomId | UUID | No | - | Lọc theo phòng họp |

### Response 200

```json
{
  "success": true,
  "message": "Dashboard tổng quan được truy xuất thành công",
  "data": {
    "period": { "from": "2026-06-01", "to": "2026-06-30" },
    "meetingCount": 145,
    "activeRooms": 12,
    "utilizationRate": 68.5,
    "noShowRate": 7.2,
    "onTimeRate": 85.3,
    "recordingCount": 38,
    "activeUserCount": 62,
    "trend": [
      { "date": "2026-06-01", "meetingCount": 8, "utilizationRate": 70.0 }
    ]
  },
  "meta": {}
}
```

### Empty state (EX1)

```json
{
  "success": true,
  "message": "Không có dữ liệu hoạt động trong khoảng thời gian này",
  "data": {
    "period": { "from": "2026-06-01", "to": "2026-06-30" },
    "meetingCount": 0,
    "activeRooms": 0,
    "utilizationRate": 0,
    "noShowRate": 0,
    "onTimeRate": 0,
    "recordingCount": 0,
    "activeUserCount": 0,
    "trend": []
  },
  "meta": {}
}
```

### Error Codes

| Status | Code | Description |
|---|---|---|
| 400 | VALIDATION_ERROR | `from`/`to` sai định dạng, `from > to`, hoặc `departmentId`/`roomId` không phải UUID |
| 400 | DATE_RANGE_TOO_LARGE | `to - from` vượt `analytics.dashboard_max_range_days` |
| 401 | (JWT error chuẩn) | Chưa đăng nhập |
| 403 | PERMISSION_DENIED | Không có permission `analytics.overview.read` |
| 403 | DEPARTMENT_OUT_OF_SCOPE | MANAGER truyền `departmentId` ngoài phòng ban mình quản lý |
| 500 | INTERNAL_ERROR | Lỗi truy vấn hệ thống |
