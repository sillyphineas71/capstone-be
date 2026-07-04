# API Contract: UC-AA-06 / UC-153 Meeting Average Duration

> Nguồn: `docs/API_CONTRACT_v1.0_with_system_roles.md` mục 16 (UC-153).
> Đã bỏ `mode` (single-select) và `medianMinutes`, đổi `departmentId`→`departmentIds`, thêm `roomId`, response trả song song `plannedAverageMinutes`/`actualAverageMinutes` theo quyết định đã duyệt (xem `spec.md` §0.2, §0.8, §0.9).

## GET /api/v1/analytics/meetings/average-duration

**Permission**: `analytics.meeting.read` (dùng chung với UC-AA-04/UC-AA-05)
**System Roles**: `MANAGER`, `BUSINESS_ADMIN`, `SYSTEM_ADMIN`

### Query Parameters

| Param | Type | Required | Default | Description |
|---|---|---|---|---|
| from | date (ISO 8601) | No | Đầu tháng hiện tại | Bắt đầu khoảng |
| to | date (ISO 8601) | No | Cuối tháng hiện tại | Kết thúc khoảng (`to >= from`, range ≤ `analytics.dashboard_max_range_days`) |
| granularity | string | No | `week` | `day`, `week`, `month`, `quarter` |
| departmentIds | UUID[] | No | - | Lọc 1 hoặc nhiều phòng ban. MANAGER chỉ được truyền phòng ban mình quản lý |
| roomId | UUID | No | - | Lọc theo phòng họp |

### Response 200

```json
{
  "success": true,
  "message": "Thống kê thời lượng trung bình cuộc họp được truy xuất thành công",
  "data": {
    "period": { "from": "2026-06-01", "to": "2026-06-30" },
    "summary": {
      "plannedAverageMinutes": 65.0,
      "actualAverageMinutes": 58.2,
      "completedMeetingCount": 98
    },
    "series": [
      { "period": "2026-W18", "plannedAverageMinutes": 68.0, "actualAverageMinutes": 60.5, "completedMeetingCount": 32 },
      { "period": "2026-W19", "plannedAverageMinutes": null, "actualAverageMinutes": null, "completedMeetingCount": 0 }
    ]
  },
  "meta": {}
}
```

### Empty state (EX1/EX2 trong UC gốc)

```json
{
  "success": true,
  "message": "Không có dữ liệu thời lượng cuộc họp nào cho bộ lọc hiện tại",
  "data": {
    "period": { "from": "2026-06-01", "to": "2026-06-30" },
    "summary": { "plannedAverageMinutes": null, "actualAverageMinutes": null, "completedMeetingCount": 0 },
    "series": [
      { "period": "2026-W18", "plannedAverageMinutes": null, "actualAverageMinutes": null, "completedMeetingCount": 0 }
    ]
  },
  "meta": {}
}
```

### Error Codes

| Status | Code | Description |
|---|---|---|
| 400 | VALIDATION_ERROR | `from`/`to`/`granularity`/`departmentIds`/`roomId` không hợp lệ |
| 400 | DATE_RANGE_TOO_LARGE | Range vượt `analytics.dashboard_max_range_days` |
| 401 | (JWT error chuẩn) | Chưa đăng nhập |
| 403 | PERMISSION_DENIED | Không có permission `analytics.meeting.read` |
| 403 | DEPARTMENT_OUT_OF_SCOPE | MANAGER truyền `departmentIds` có phần tử ngoài phạm vi |
| 500 | INTERNAL_ERROR | Lỗi truy vấn hệ thống |
