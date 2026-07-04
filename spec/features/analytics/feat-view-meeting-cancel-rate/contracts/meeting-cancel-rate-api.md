# API Contract: UC-AA-07 / UC-154 Meeting Cancel Rate

> Nguồn: `docs/API_CONTRACT_v1.0_with_system_roles.md` mục 16 (UC-154).
> Đã mở rộng thêm `preset`, `granularity`, `organizerEmail` ở query, và `topOrganizers`/`topDepartments` ở response (không có trong response mẫu gốc) theo quyết định đã duyệt (xem `spec.md` §0.1, §0.10-§0.13).

## GET /api/v1/analytics/meetings/cancel-rate

**Permission**: `analytics.meeting.read` (dùng chung với UC-AA-04/05/06)
**System Roles**: `MANAGER`, `BUSINESS_ADMIN`, `SYSTEM_ADMIN`

### Query Parameters

| Param | Type | Required | Default | Description |
|---|---|---|---|---|
| preset | string | No | `month_current` | `month_current`, `month_previous`, `quarter`, `custom` |
| from | date (ISO 8601) | Chỉ khi `preset=custom` | - | Bắt đầu khoảng |
| to | date (ISO 8601) | Chỉ khi `preset=custom` | - | Kết thúc khoảng (`to >= from`, range ≤ `analytics.dashboard_max_range_days`) |
| granularity | string | No | `week` | `week`, `month` — đơn vị nhóm bucket của `series` |
| departmentIds | UUID[] | No | - | Lọc 1 hoặc nhiều phòng ban. MANAGER chỉ được truyền phòng ban mình quản lý |
| roomId | UUID | No | - | Lọc theo phòng họp |
| organizerEmail | string | No | - | Lọc theo email người tổ chức (resolve server-side, so khớp không phân biệt hoa/thường) |

### Response 200

```json
{
  "success": true,
  "message": "Thống kê tỷ lệ cuộc họp bị hủy được truy xuất thành công",
  "data": {
    "period": { "from": "2026-06-01", "to": "2026-06-30" },
    "totalMeetingCount": 145,
    "cancelledCount": 15,
    "cancelRate": 10.3,
    "series": [
      { "period": "2026-W18", "totalCount": 34, "cancelledCount": 4, "cancelRate": 11.8 },
      { "period": "2026-W19", "totalCount": 28, "cancelledCount": 0, "cancelRate": 0.0 }
    ],
    "topOrganizers": [
      {
        "userId": "d290f1ee-6c54-4b01-90e6-d701748f0851",
        "email": "an.nguyen@company.com",
        "fullName": "Nguyễn Văn An",
        "organizedCount": 8,
        "cancelledCount": 5,
        "cancelRate": 62.5
      }
    ],
    "topDepartments": [
      {
        "departmentId": "b1a2c3d4-e5f6-7890-abcd-ef1234567890",
        "departmentName": "Kinh doanh",
        "organizedCount": 40,
        "cancelledCount": 12,
        "cancelRate": 30.0
      }
    ]
  },
  "meta": {}
}
```

> Lưu ý: khi `currentUser.role = MANAGER`, `topDepartments` luôn trả `[]` (§0.7 spec.md), `topOrganizers` chỉ gồm nhân sự trong phạm vi phòng ban Manager quản lý.

### Empty state (EX1)

```json
{
  "success": true,
  "message": "Không có dữ liệu thiết lập cuộc họp nào cho bộ lọc hiện tại",
  "data": {
    "period": { "from": "2026-06-01", "to": "2026-06-30" },
    "totalMeetingCount": 0,
    "cancelledCount": 0,
    "cancelRate": 0,
    "series": [
      { "period": "2026-W18", "totalCount": 0, "cancelledCount": 0, "cancelRate": 0 }
    ],
    "topOrganizers": [],
    "topDepartments": []
  },
  "meta": {}
}
```

### Error Codes

| Status | Code | Description |
|---|---|---|
| 400 | VALIDATION_ERROR | `preset`/`from`/`to`/`granularity`/`departmentIds`/`roomId`/`organizerEmail` không hợp lệ |
| 400 | DATE_RANGE_TOO_LARGE | Range vượt `analytics.dashboard_max_range_days` |
| 401 | (JWT error chuẩn) | Chưa đăng nhập |
| 403 | PERMISSION_DENIED | Không có permission `analytics.meeting.read` |
| 403 | DEPARTMENT_OUT_OF_SCOPE | MANAGER truyền `departmentIds` có phần tử ngoài phạm vi |
| 500 | INTERNAL_ERROR | Lỗi truy vấn hệ thống |
