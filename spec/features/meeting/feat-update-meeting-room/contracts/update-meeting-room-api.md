# API Contract — UC-MM-03 Cập nhật phòng họp

**Base URL**: `/api/v1`
**Auth**: JWT Bearer token (header `Authorization: Bearer <token>`)

---

## 1. GET /meetings/:meetingId/available-rooms

Lấy danh sách phòng khả dụng trong khung thời gian của meeting.

### Request

| Parameter | Location | Type | Required | Default | Description |
|-----------|----------|------|----------|---------|-------------|
| meetingId | path | uuid | yes | — | ID của meeting |
| capacityWarningMode | query | boolean | no | false | Nếu true, tính capacityWarning cho mỗi phòng |
| includeCurrentRoom | query | boolean | no | false | Nếu true, vẫn include phòng hiện tại |

### Authorization

- `JwtAuthGuard` — yêu cầu authenticated user
- Không cần permission riêng (bất kỳ authenticated user nào cũng có thể xem)

### Response 200

```json
{
  "success": true,
  "message": "Danh sách phòng khả dụng",
  "data": [
    {
      "roomId": "uuid",
      "roomName": "Phòng Họp A",
      "roomCode": "PHA-01",
      "capacity": 20,
      "location": "Tầng 5, Tòa nhà Alpha",
      "equipmentFlags": ["projector", "whiteboard", "camera", "microphone"],
      "availabilityStatus": "available",
      "isCurrentRoom": false,
      "capacityWarning": null
    }
  ]
}
```

### Response 404

```json
{
  "success": false,
  "message": "Meeting không tồn tại",
  "error": { "code": "MEETING_NOT_FOUND", "details": {} }
}
```

---

## 2. PATCH /meetings/:meetingId/room

Cập nhật phòng họp cho meeting.

### Request

| Parameter | Location | Type | Required | Default | Description |
|-----------|----------|------|----------|---------|-------------|
| meetingId | path | uuid | yes | — | ID của meeting |
| newRoomId | body | uuid | yes | — | ID phòng mới |
| confirmCapacityOverride | body | boolean | no | false | Xác nhận override capacity warning |
| changeReason | body | string | no | null | Lý do đổi phòng, max 500 ký tự |

### Authorization

- `JwtAuthGuard` — yêu cầu authenticated user
- `PermissionsGuard` + `@RequirePermissions('meeting.room.update')` — yêu cầu permission
- Hoặc user là `organizer_id` / `host_id` của meeting

### Response 200 — Success

```json
{
  "success": true,
  "message": "Cập nhật phòng họp thành công",
  "data": {
    "meetingId": "uuid",
    "oldRoom": {
      "id": "uuid",
      "name": "Phòng Họp A"
    },
    "newRoom": {
      "id": "uuid",
      "name": "Phòng Họp B"
    },
    "oldBookingId": "uuid",
    "newBookingId": "uuid",
    "startTime": "2026-06-10T09:00:00.000Z",
    "endTime": "2026-06-10T10:00:00.000Z",
    "notificationStatus": "queued",
    "updatedAt": "2026-06-09T10:30:00.000Z"
  }
}
```

### Response 422 — Capacity Warning

```json
{
  "success": false,
  "message": "Sức chứa của phòng (8 người) nhỏ hơn số lượng người tham dự hiện tại (12 người).",
  "error": {
    "code": "ROOM_CAPACITY_WARNING",
    "details": {
      "roomCapacity": 8,
      "attendeeCount": 12,
      "requiresConfirmation": true
    }
  }
}
```

### Response 409 — Room Conflict

```json
{
  "success": false,
  "message": "Phòng họp này vừa được đặt bởi người khác. Vui lòng chọn một phòng khả dụng khác.",
  "error": {
    "code": "ROOM_CONFLICT",
    "details": {}
  }
}
```

### Response 409 — Recurring Series Not Supported

```json
{
  "success": false,
  "message": "Không thể đổi phòng cho chuỗi họp định kỳ.",
  "error": {
    "code": "RECURRING_SERIES_UPDATE_NOT_SUPPORTED",
    "details": {}
  }
}
```

### Response 422 — Room Capacity Not Configured

```json
{
  "success": false,
  "message": "Phòng họp này chưa được cấu hình sức chứa.",
  "error": {
    "code": "ROOM_CAPACITY_NOT_CONFIGURED",
    "details": { "roomId": "uuid" }
  }
}
```

### Response 422 — Same Room

```json
{
  "success": false,
  "message": "Phòng họp mới phải khác phòng họp hiện tại.",
  "error": {
    "code": "SAME_ROOM",
    "details": {}
  }
}
```

### Response 409 — Invalid Meeting Status

```json
{
  "success": false,
  "message": "Chỉ có thể đổi phòng cho cuộc họp đang ở trạng thái Đã lên lịch.",
  "error": {
    "code": "INVALID_MEETING_STATUS",
    "details": { "currentStatus": "completed" }
  }
}
```

### Response 403 — Forbidden

```json
{
  "success": false,
  "message": "Bạn không có quyền cập nhật phòng họp cho cuộc họp này.",
  "error": {
    "code": "FORBIDDEN",
    "details": {}
  }
}
```

### Response 401 — Unauthorized

```json
{
  "success": false,
  "message": "Token không hợp lệ hoặc đã hết hạn.",
  "error": {
    "code": "UNAUTHORIZED",
    "details": {}
  }
}
```

### Response 404 — Not Found

```json
{
  "success": false,
  "message": "Meeting không tồn tại.",
  "error": {
    "code": "MEETING_NOT_FOUND",
    "details": {}
  }
}
```

### Response 400 — Validation Error

```json
{
  "success": false,
  "message": "Dữ liệu không hợp lệ",
  "error": {
    "code": "VALIDATION_ERROR",
    "details": {
      "fields": [
        { "field": "newRoomId", "message": "newRoomId phải là uuid" },
        { "field": "changeReason", "message": "changeReason không được vượt quá 500 ký tự" }
      ]
    }
  }
}
```

## Transaction Flow

```
1. Validate input (DTO)
2. Check auth + permission (Guard)
3. Lock meeting row (pessimistic_write)
4. Validate meeting status = scheduled, now < start_time
5. Validate new room active, capacity not null
6. Check room conflict (exclude own meeting's old booking)
7. Check capacity vs attendee count
8. IF capacity warning AND !confirmCapacityOverride → return 422
9. BEGIN TRANSACTION:
   a. Release old booking (status → released)
   b. Create new booking (booking_type = relocated, status = approved)
   c. Update meeting.room_id, updated_by
   d. Insert meeting_events (room_changed)
   e. Insert room_events (room_released, room_reserved)
   f. Insert meeting_requests (optional audit snapshot)
   g. Insert audit_logs
10. COMMIT TRANSACTION
11. Queue notification (background job)
12. Return 200 response
```
