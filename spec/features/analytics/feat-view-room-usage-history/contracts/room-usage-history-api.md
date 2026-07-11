# API Contract: GET /api/v1/analytics/rooms/usage-history

**Permission**: `analytics.room.read` (tái dùng, đã seed ở UC-AA-02)
**Auth**: `JwtAuthGuard` + `PermissionsGuard`

## Request

```http
GET /api/v1/analytics/rooms/usage-history?preset=month&sortBy=reservedStartTime&sortOrder=desc&page=1&limit=20
Authorization: Bearer <token>
```

Hoặc tùy chỉnh khoảng ngày + lọc phòng:

```http
GET /api/v1/analytics/rooms/usage-history?preset=custom&from=2026-06-01&to=2026-06-30&roomId=b1a2...&sortBy=sessionStatus&sortOrder=asc&page=1&limit=50
Authorization: Bearer <token>
```

## Response 200 — Có dữ liệu

```json
{
  "success": true,
  "message": "Lịch sử sử dụng phòng họp",
  "data": {
    "period": { "from": "2026-06-01T00:00:00+07:00", "to": "2026-06-30T23:59:59+07:00" },
    "summary": {
      "totalReservedHours": 342.5,
      "totalActualHours": 298.2,
      "noShowCount": 7,
      "reservationUtilizationRate": 45.3,
      "roomOccupancyRate": 87.1
    },
    "sessions": [
      {
        "roomId": "r1a2...", "roomName": "Phòng họp 301",
        "meetingId": "m1c3...", "meetingTitle": "Họp giao ban tuần",
        "hostName": "Nguyễn Văn A",
        "reservedStartTime": "2026-06-05T09:00:00+07:00",
        "reservedEndTime": "2026-06-05T10:00:00+07:00",
        "actualStartTime": "2026-06-05T09:05:00+07:00",
        "actualEndTime": "2026-06-05T09:58:00+07:00",
        "sessionStatus": "completed"
      },
      {
        "roomId": "r2b3...", "roomName": "Phòng họp 105",
        "meetingId": "m2d4...", "meetingTitle": "Phỏng vấn ứng viên",
        "hostName": "Trần Thị B",
        "reservedStartTime": "2026-06-06T14:00:00+07:00",
        "reservedEndTime": "2026-06-06T15:00:00+07:00",
        "actualStartTime": null,
        "actualEndTime": null,
        "sessionStatus": "no_show"
      }
    ]
  },
  "meta": { "page": 1, "limit": 20, "total": 87, "totalPages": 5 }
}
```

## Response 200 — Không có dữ liệu (Exception E1)

```json
{
  "success": true,
  "message": "Không có dữ liệu sử dụng phòng họp nào được ghi nhận trong khoảng thời gian từ 01/06/2026 đến 30/06/2026.",
  "data": {
    "period": { "from": "2026-06-01T00:00:00+07:00", "to": "2026-06-30T23:59:59+07:00" },
    "summary": { "totalReservedHours": 0, "totalActualHours": null, "noShowCount": 0, "reservationUtilizationRate": 0, "roomOccupancyRate": null },
    "sessions": []
  },
  "meta": { "page": 1, "limit": 20, "total": 0, "totalPages": 0 }
}
```

## Response 400 — Khoảng thời gian quá dài (Exception E2)

```json
{
  "success": false,
  "message": "Khoảng thời gian tra cứu tối đa cho mỗi lần là 6 tháng. Vui lòng thu hẹp lại phạm vi.",
  "error": { "code": "DATE_RANGE_TOO_LARGE", "details": {} },
  "timestamp": "2026-07-10T09:00:00.000Z",
  "path": "/api/v1/analytics/rooms/usage-history"
}
```
