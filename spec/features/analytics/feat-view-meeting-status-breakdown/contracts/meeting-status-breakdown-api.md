# API Contract: UC-AA-05 / UC-152 Meeting Status Breakdown

> Nguồn: `docs/API_CONTRACT_v1.0_with_system_roles.md` mục 16 (UC-152).
> Đã đổi `departmentId` → `departmentIds` (mảng, multi-select) và `in_progress` → `no_show` trong response theo quyết định đã duyệt (xem `spec.md` §0.6, §0.8).

## GET /api/v1/analytics/meetings/status-breakdown

**Permission**: `analytics.meeting.read` (dùng chung với UC-AA-04)
**System Roles**: `MANAGER`, `BUSINESS_ADMIN`, `SYSTEM_ADMIN`

### Query Parameters

| Param | Type | Required | Default | Description |
|---|---|---|---|---|
| preset | string | No | `month` | `day`, `week`, `month`, `custom` |
| from | date | Chỉ khi `preset=custom` | - | Bắt đầu khoảng |
| to | date | Chỉ khi `preset=custom` | - | Kết thúc khoảng |
| departmentIds | UUID[] | No | - | Lọc 1 hoặc nhiều phòng ban. MANAGER chỉ được truyền phòng ban mình quản lý |

### Response 200

```json
{
  "success": true,
  "message": "Thống kê cuộc họp theo trạng thái được truy xuất thành công",
  "data": {
    "period": { "from": "2026-06-01", "to": "2026-06-30" },
    "total": 145,
    "items": [
      { "status": "scheduled", "count": 30, "percentage": 20.7 },
      { "status": "completed", "count": 98, "percentage": 67.6 },
      { "status": "cancelled", "count": 15, "percentage": 10.3 },
      { "status": "no_show", "count": 2, "percentage": 1.4 }
    ]
  },
  "meta": {}
}
```

### Empty state (EX1)

```json
{
  "success": true,
  "message": "Không có dữ liệu cuộc họp nào thỏa mãn bộ lọc hiện tại",
  "data": {
    "period": { "from": "2026-06-01", "to": "2026-06-30" },
    "total": 0,
    "items": [
      { "status": "scheduled", "count": 0, "percentage": 0 },
      { "status": "completed", "count": 0, "percentage": 0 },
      { "status": "cancelled", "count": 0, "percentage": 0 },
      { "status": "no_show", "count": 0, "percentage": 0 }
    ]
  },
  "meta": {}
}
```

### Error Codes

| Status | Code | Description |
|---|---|---|
| 400 | VALIDATION_ERROR | `preset`/`from`/`to`/`departmentIds` không hợp lệ |
| 400 | DATE_RANGE_TOO_LARGE | Range vượt `analytics.dashboard_max_range_days` |
| 401 | (JWT error chuẩn) | Chưa đăng nhập |
| 403 | PERMISSION_DENIED | Không có permission `analytics.meeting.read` |
| 403 | DEPARTMENT_OUT_OF_SCOPE | MANAGER truyền `departmentIds` có phần tử ngoài phạm vi |
| 500 | INTERNAL_ERROR | Lỗi truy vấn hệ thống |
