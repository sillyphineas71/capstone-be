# API Contract: UC-AA-04 / UC-151 Meeting Count By Period

> Nguồn: `docs/API_CONTRACT_v1.0_with_system_roles.md` mục 16 (UC-151). Bổ sung `roomId`/`meetingType` theo quyết định đã duyệt (xem `spec.md` §0.3).

## GET /api/v1/analytics/meetings/count-by-period

**Permission**: `analytics.meeting.read`
**System Roles**: `MANAGER`, `BUSINESS_ADMIN`, `SYSTEM_ADMIN`

### Query Parameters

| Param | Type | Required | Default | Description |
|---|---|---|---|---|
| from | date (ISO 8601) | No | Đầu tháng hiện tại | Bắt đầu khoảng (có thể ở tương lai — AF1) |
| to | date (ISO 8601) | No | Cuối tháng hiện tại | Kết thúc khoảng (`to >= from`, range ≤ `analytics.dashboard_max_range_days`) |
| granularity | string | No | `week` | `week` hoặc `month` |
| departmentId | UUID | No | - | Lọc theo phòng ban. MANAGER chỉ được truyền phòng ban mình quản lý |
| roomId | UUID | No | - | **Bổ sung** — lọc theo phòng họp |
| meetingType | string | No | - | **Bổ sung** — `normal`/`training`/`interview`/`emergency` |

### Response 200

```json
{
  "success": true,
  "message": "Thống kê số lượng cuộc họp được truy xuất thành công",
  "data": {
    "total": 145,
    "series": [
      { "period": "2026-W18", "count": 32 },
      { "period": "2026-W19", "count": 38 }
    ]
  },
  "meta": {}
}
```

### Empty state (EX1)

```json
{
  "success": true,
  "message": "Không tìm thấy dữ liệu cuộc họp nào thỏa mãn các tiêu chí lọc hiện tại",
  "data": {
    "total": 0,
    "series": [
      { "period": "2026-W18", "count": 0 },
      { "period": "2026-W19", "count": 0 }
    ]
  },
  "meta": {}
}
```

### Error Codes

| Status | Code | Description |
|---|---|---|
| 400 | VALIDATION_ERROR | `from`/`to`/`granularity`/`meetingType`/`departmentId`/`roomId` không hợp lệ |
| 400 | DATE_RANGE_TOO_LARGE | Range vượt `analytics.dashboard_max_range_days` |
| 401 | (JWT error chuẩn) | Chưa đăng nhập |
| 403 | PERMISSION_DENIED | Không có permission `analytics.meeting.read` |
| 403 | DEPARTMENT_OUT_OF_SCOPE | MANAGER truyền `departmentId` ngoài phạm vi |
| 500 | INTERNAL_ERROR | Lỗi truy vấn hệ thống |
