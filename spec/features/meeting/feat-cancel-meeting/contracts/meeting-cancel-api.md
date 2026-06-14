# API Contract: Cancel Scheduled Meeting

## 📝 CHANGELOG & REVISION HISTORY
| Ngày cập nhật | Tóm tắt thay đổi | Các dòng thay đổi |
| :--- | :--- | :--- |
| 2026-06-09 | API contract cho UC-MM-04 | Toàn bộ file |

---

## Endpoint

**POST** `/api/v1/meetings/{meetingId}/cancel`

## Path Parameters

| Parameter | Type | Required | Description |
|---|---|---|---|
| `meetingId` | UUID v4 | Yes | ID của cuộc họp cần hủy |

## Request Body

```json
{
  "cancellationReason": "Host có việc đột xuất nên cuộc họp bị hủy"
}
```

### Request Schema

| Field | Type | Required | Default | Validation |
|---|---|---|---|---|
| `cancellationReason` | string | No | `null` | Max 1000 ký tự, trim whitespace, optional |

### Example Requests

**Request 1** — With cancellation reason:
```
POST /api/v1/meetings/a1b2c3d4-e5f6-7890-abcd-ef1234567890/cancel
Content-Type: application/json

{
  "cancellationReason": "Lịch họp bị thay đổi do công việc khẩn cấp"
}
```

**Request 2** — Without cancellation reason (body = {}):
```
POST /api/v1/meetings/a1b2c3d4-e5f6-7890-abcd-ef1234567890/cancel
Content-Type: application/json

{}
```

## Responses

### 200 OK — Cancel successful

```json
{
  "success": true,
  "message": "Cuộc họp đã được hủy thành công",
  "data": {
    "meetingId": "a1b2c3d4-e5f6-7890-abcd-ef1234567890",
    "status": "cancelled",
    "cancelledAt": "2026-06-09T14:30:00.000Z",
    "cancelledBy": "f47ac10b-58cc-4372-a567-0e02b2c3d479",
    "roomReleased": true,
    "releasedBookingId": "b2c3d4e5-f6a7-8901-bcde-f12345678901",
    "notificationStatus": "queued"
  }
}
```

### 200 OK — Cancel successful (no room, no reason)

```json
{
  "success": true,
  "message": "Cuộc họp đã được hủy thành công",
  "data": {
    "meetingId": "a1b2c3d4-e5f6-7890-abcd-ef1234567890",
    "status": "cancelled",
    "cancelledAt": "2026-06-09T14:30:00.000Z",
    "cancelledBy": "f47ac10b-58cc-4372-a567-0e02b2c3d479",
    "roomReleased": false,
    "releasedBookingId": null,
    "notificationStatus": "queued"
  }
}
```

### 200 OK — Cancel successful (notification queue failed)

```json
{
  "success": true,
  "message": "Cuộc họp đã được hủy thành công",
  "data": {
    "meetingId": "a1b2c3d4-e5f6-7890-abcd-ef1234567890",
    "status": "cancelled",
    "cancelledAt": "2026-06-09T14:30:00.000Z",
    "cancelledBy": "f47ac10b-58cc-4372-a567-0e02b2c3d479",
    "roomReleased": true,
    "releasedBookingId": "b2c3d4e5-f6a7-8901-bcde-f12345678901",
    "notificationStatus": "failed_to_queue"
  }
}
```

### 400 Bad Request — Invalid UUID

```json
{
  "success": false,
  "message": "meetingId không đúng định dạng UUID",
  "error": {
    "code": "VALIDATION_ERROR",
    "details": {
      "meetingId": "Validation failed (uuid is expected)"
    }
  },
  "timestamp": "2026-06-09T14:30:00.000Z",
  "path": "/api/v1/meetings/invalid-uuid/cancel"
}
```

### 400 Bad Request — Unexpected field in body

```json
{
  "success": false,
  "message": "Body chứa field không được phép",
  "error": {
    "code": "VALIDATION_ERROR",
    "details": {
      "deleteMeeting": "property deleteMeeting should not exist"
    }
  },
  "timestamp": "2026-06-09T14:30:00.000Z",
  "path": "/api/v1/meetings/a1b2c3d4-e5f6-7890-abcd-ef1234567890/cancel"
}
```

### 401 Unauthorized

```json
{
  "success": false,
  "message": "Unauthorized",
  "error": {
    "code": "UNAUTHORIZED"
  },
  "timestamp": "2026-06-09T14:30:00.000Z",
  "path": "/api/v1/meetings/a1b2c3d4-e5f6-7890-abcd-ef1234567890/cancel"
}
```

### 403 Forbidden

```json
{
  "success": false,
  "message": "Bạn không có quyền hủy cuộc họp này",
  "error": {
    "code": "FORBIDDEN",
    "details": {
      "requiredPermission": "meeting.cancel.own or meeting.cancel.any",
      "isOrganizer": false,
      "isHost": false,
      "isAdmin": false
    }
  },
  "timestamp": "2026-06-09T14:30:00.000Z",
  "path": "/api/v1/meetings/a1b2c3d4-e5f6-7890-abcd-ef1234567890/cancel"
}
```

### 404 Not Found

```json
{
  "success": false,
  "message": "Cuộc họp không tồn tại hoặc đã bị xóa",
  "error": {
    "code": "MEETING_NOT_FOUND",
    "details": {
      "meetingId": "a1b2c3d4-e5f6-7890-abcd-ef1234567890"
    }
  },
  "timestamp": "2026-06-09T14:30:00.000Z",
  "path": "/api/v1/meetings/a1b2c3d4-e5f6-7890-abcd-ef1234567890/cancel"
}
```

### 409 Conflict — Meeting already started

```json
{
  "success": false,
  "message": "Cuộc họp đã bắt đầu. Bạn không thể hủy mà chỉ có thể chọn 'Kết thúc sớm'.",
  "error": {
    "code": "MEETING_ALREADY_STARTED",
    "details": {
      "meetingId": "a1b2c3d4-e5f6-7890-abcd-ef1234567890",
      "startTime": "2026-06-09T13:00:00.000Z",
      "currentTime": "2026-06-09T14:30:00.000Z"
    }
  },
  "timestamp": "2026-06-09T14:30:00.000Z",
  "path": "/api/v1/meetings/a1b2c3d4-e5f6-7890-abcd-ef1234567890/cancel"
}
```

### 409 Conflict — Invalid meeting status

```json
{
  "success": false,
  "message": "Trạng thái cuộc họp không hợp lệ để thực hiện thao tác này.",
  "error": {
    "code": "INVALID_MEETING_STATUS",
    "details": {
      "meetingId": "a1b2c3d4-e5f6-7890-abcd-ef1234567890",
      "currentStatus": "completed",
      "expectedStatus": "scheduled"
    }
  },
  "timestamp": "2026-06-09T14:30:00.000Z",
  "path": "/api/v1/meetings/a1b2c3d4-e5f6-7890-abcd-ef1234567890/cancel"
}
```

### 409 Conflict — Concurrent modification

```json
{
  "success": false,
  "message": "Cuộc họp đã được hủy bởi một yêu cầu khác",
  "error": {
    "code": "CONCURRENT_MODIFICATION",
    "details": {
      "meetingId": "a1b2c3d4-e5f6-7890-abcd-ef1234567890"
    }
  },
  "timestamp": "2026-06-09T14:30:00.000Z",
  "path": "/api/v1/meetings/a1b2c3d4-e5f6-7890-abcd-ef1234567890/cancel"
}
```

### 422 Unprocessable Entity — Reason too long

```json
{
  "success": false,
  "message": "Lý do hủy không được vượt quá 1000 ký tự",
  "error": {
    "code": "VALIDATION_ERROR",
    "details": {
      "cancellationReason": "cancellationReason must be shorter than or equal to 1000 characters"
    }
  },
  "timestamp": "2026-06-09T14:30:00.000Z",
  "path": "/api/v1/meetings/a1b2c3d4-e5f6-7890-abcd-ef1234567890/cancel"
}
```

## Headers

| Header | Required | Description |
|---|---|---|
| `Authorization` | Yes | Bearer JWT token |
| `Content-Type` | Yes | `application/json` |
| `User-Agent` | No | Client user agent (for audit) |
| `X-Forwarded-For` | No | Client IP (for audit) |

## Guards

1. `JwtAuthGuard` — xác thực
2. `PermissionsGuard` + `@RequirePermissions('meeting.cancel.own')` — kiểm tra permission

## Error Codes Summary

| Code | HTTP Status | Description |
|---|---|---|
| `VALIDATION_ERROR` | 400 / 422 | Input validation failed |
| `UNAUTHORIZED` | 401 | Missing/invalid JWT |
| `FORBIDDEN` | 403 | Missing required permission |
| `MEETING_NOT_FOUND` | 404 | Meeting not found or soft-deleted |
| `INVALID_MEETING_STATUS` | 409 | Not in `scheduled` status |
| `MEETING_ALREADY_STARTED` | 409 | `start_time <= now` |
| `CONCURRENT_MODIFICATION` | 409 | Another request cancelled first |
