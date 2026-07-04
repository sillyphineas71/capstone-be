# API Contract: UC-AA-02 / UC-149 Room Usage Dashboard

> Nguồn: `docs/API_CONTRACT_v1.0_with_system_roles.md` mục 16 (UC-149) cho endpoint so sánh tổng quan.
> Endpoint chi tiết phòng (`{roomId}/detail`) là **bổ sung mới**, chưa có trong `API_CONTRACT` gốc — xem `spec.md` §0.5.
> Field `reservationUtilizationRate`/`roomOccupancyRate`/`hasActualData` là bổ sung/đổi tên so với `utilizationRate` gốc — xem `spec.md` §0.3.

## GET /api/v1/analytics/rooms/dashboard

**Permission**: `analytics.room.read`
**System Roles**: `MANAGER`, `BUSINESS_ADMIN`, `SYSTEM_ADMIN`

### Query Parameters

| Param | Type | Required | Default | Description |
|---|---|---|---|---|
| preset | string | No | `month` | `day`, `week`, `month`, `custom` |
| from | date | Chỉ khi `preset=custom` | - | Bắt đầu khoảng |
| to | date | Chỉ khi `preset=custom` | - | Kết thúc khoảng |
| roomId | UUID | No | - | Lọc 1 phòng |
| siteName | string | No | - | Lọc theo tòa nhà |

### Response 200

```json
{
  "success": true,
  "message": "Dashboard sử dụng phòng họp được truy xuất thành công",
  "data": {
    "period": { "from": "2026-06-01", "to": "2026-06-30" },
    "summary": {
      "reservationUtilizationRate": 45.2,
      "roomOccupancyRate": 68.5,
      "totalBookedHours": 520.5,
      "actualUsedHours": 390.2
    },
    "rooms": [
      {
        "roomId": "uuid",
        "roomName": "Phòng 101",
        "bookedHours": 45,
        "actualHours": 33.75,
        "reservationUtilizationRate": 18.75,
        "roomOccupancyRate": 75.0,
        "hasActualData": true
      },
      {
        "roomId": "uuid",
        "roomName": "Phòng 205 (mới)",
        "bookedHours": 12,
        "actualHours": null,
        "reservationUtilizationRate": 5.0,
        "roomOccupancyRate": null,
        "hasActualData": false
      }
    ],
    "trend": [{ "date": "2026-06-01", "meetingCount": 8 }]
  },
  "meta": {}
}
```

## GET /api/v1/analytics/rooms/{roomId}/detail

**Permission**: `analytics.room.read`
**System Roles**: `MANAGER`, `BUSINESS_ADMIN`, `SYSTEM_ADMIN`

### Query Parameters

Giống endpoint so sánh tổng quan (`preset`/`from`/`to`), không có `roomId`/`siteName` (đã cố định qua path param).

### Response 200

```json
{
  "success": true,
  "message": "Chi tiết phòng họp được truy xuất thành công",
  "data": {
    "room": { "roomId": "uuid", "roomName": "Phòng 101", "siteName": "Tòa A", "areaName": "Tầng 3", "capacity": 12 },
    "period": { "from": "2026-06-01", "to": "2026-06-30" },
    "bookedHours": 45,
    "actualHours": 33.75,
    "reservationUtilizationRate": 18.75,
    "roomOccupancyRate": 75.0,
    "hasActualData": true,
    "heatmap": [
      { "hourOfDay": 9, "actualMinutes": 320 },
      { "hourOfDay": 10, "actualMinutes": 410 }
    ],
    "meetings": [
      {
        "meetingId": "uuid",
        "title": "Họp sprint planning",
        "organizerName": "Nguyễn Văn A",
        "reservedStartTime": "2026-06-05T09:00:00+07:00",
        "reservedEndTime": "2026-06-05T10:00:00+07:00",
        "actualStartTime": "2026-06-05T09:05:00+07:00",
        "actualEndTime": "2026-06-05T09:58:00+07:00",
        "status": "completed"
      }
    ]
  },
  "meta": {}
}
```

### Error Codes (cả 2 endpoint)

| Status | Code | Description |
|---|---|---|
| 400 | VALIDATION_ERROR | `preset`/`from`/`to`/`roomId`/`siteName` không hợp lệ |
| 400 | DATE_RANGE_TOO_LARGE | Range vượt `analytics.dashboard_max_range_days` |
| 401 | (JWT error chuẩn) | Chưa đăng nhập |
| 403 | PERMISSION_DENIED | Không có permission `analytics.room.read` |
| 403 | ROOM_OUT_OF_SCOPE | MANAGER truy cập phòng ngoài scope (chỉ endpoint chi tiết) |
| 404 | ROOM_NOT_FOUND | `roomId` không tồn tại/soft-deleted (chỉ endpoint chi tiết) |
| 500 | INTERNAL_ERROR | Lỗi truy vấn hệ thống |

## Liên quan (không thuộc scope code feature này)

### POST /api/v1/rooms/usage-report/exports (UC-49, module `reports`, đã có sẵn)

Dùng cho AF1 "Xuất dữ liệu" — xem `docs/API_CONTRACT_v1.0_with_system_roles.md:1961-1993`.
