# API Contract: POST /api/v1/reports/room-utilization/exports

**Permission**: `report.room_utilization.export` (BUSINESS_ADMIN, SYSTEM_ADMIN only)
**Auth**: `JwtAuthGuard` + `PermissionsGuard`

## Request

```http
POST /api/v1/reports/room-utilization/exports
Authorization: Bearer <token>
Content-Type: application/json

{
  "from": "2026-06-01",
  "to": "2026-06-30",
  "format": "xlsx",
  "scope": { "roomId": null },
  "delivery": "download"
}
```

## Response 202 — Job đã tạo

```json
{
  "success": true,
  "message": "Export job đã được tạo và đang xử lý.",
  "data": {
    "jobId": "b6b3...uuid",
    "status": "queued",
    "delivery": "download",
    "outputFileId": null
  },
  "meta": {}
}
```

Client poll `GET /api/v1/background-jobs/{jobId}` (endpoint đã có sẵn) cho tới khi `status='completed'`, sau đó tải file qua `outputFileId`/`media_files` URL đã trả về.

## Response 422 — Không có dữ liệu (Exception E1)

```json
{
  "success": false,
  "message": "Không có dữ liệu trong khoảng thời gian đã chọn. Không thể xuất báo cáo.",
  "error": { "code": "EMPTY_DATA_SET", "details": {} },
  "timestamp": "2026-07-10T09:00:00.000Z",
  "path": "/api/v1/reports/room-utilization/exports"
}
```

## Response 403 — Không đủ quyền (vd role MANAGER)

```json
{
  "success": false,
  "message": "Bạn không có quyền thực hiện thao tác này.",
  "error": { "code": "PERMISSION_DENIED", "details": {} },
  "timestamp": "2026-07-10T09:00:00.000Z",
  "path": "/api/v1/reports/room-utilization/exports"
}
```

## Cấu trúc nội dung file (khi job `completed`)

### PDF / XLSX — 4 phần cố định

1. Thông tin chung (kỳ báo cáo, phạm vi, người trích xuất)
2. Utilization Rate (`reservationUtilizationRate`, `roomOccupancyRate`, `bookedHours`, `actualHours`, `availableHours`)
3. No-show Rate (`noShowCount`, `totalBookings`, `noShowRate`)
4. Actual Usage theo phòng (bảng per-room)
5. Released Rooms (bảng sự kiện thu hồi phòng, auto + thủ công)

### CSV — row-level

```csv
bookingId,roomCode,roomName,meetingId,reservedStartTime,reservedEndTime,actualStartTime,actualEndTime,usageStatus,isNoShow,isReleased,releaseType,releasedAt
b1a2...,R-301,"Phòng họp 301",m1c3...,2026-06-05T09:00:00+07:00,2026-06-05T10:00:00+07:00,2026-06-05T09:05:00+07:00,2026-06-05T09:58:00+07:00,completed,false,false,,
b2b3...,R-105,"Phòng họp 105",m2d4...,2026-06-06T14:00:00+07:00,2026-06-06T15:00:00+07:00,,,no_show,true,true,room_auto_released,2026-06-06T14:20:00+07:00
```
