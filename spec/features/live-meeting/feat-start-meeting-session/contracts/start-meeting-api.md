# API Contract — Bắt đầu phiên họp (UC-IMM-01)

## Endpoint: Start Meeting Session

| Field | Value |
|---|---|
| Method | `POST` |
| Endpoint | `/api/v1/live-meetings/{meetingId}/start` |
| Permission | `meeting.session.start` |
| System Role | `INTERNAL_USER`, `MANAGER`, `BUSINESS_ADMIN`, `SYSTEM_ADMIN` |
| Async | No |
| Auth | JWT Bearer token |

### Request
**Path Parameters**:
| Parameter | Type | Required | Description |
|---|---|---|---|
| `meetingId` | UUID | Yes | ID cuộc họp cần bắt đầu |

**Request Body**: None (empty body).

### Response 200 — Success (First Start)

```json
{
  "success": true,
  "message": "Phiên họp đã bắt đầu thành công",
  "data": {
    "meetingId": "uuid",
    "status": "in_progress",
    "actualStartTime": "2026-06-16T09:03:00+07:00",
    "alreadyStarted": false
  }
}
```

### Response 200 — Idempotent (Already Started)

```json
{
  "success": true,
  "message": "Phiên họp đã được bắt đầu trước đó",
  "data": {
    "meetingId": "uuid",
    "status": "in_progress",
    "actualStartTime": "2026-06-16T09:03:00+07:00",
    "alreadyStarted": true
  }
}
```

### Error Responses

**401 — Unauthenticated**
```json
{
  "success": false,
  "message": "Unauthenticated",
  "error": { "code": "UNAUTHENTICATED", "details": {} },
  "timestamp": "...",
  "path": "/api/v1/live-meetings/{meetingId}/start"
}
```

**403 — Forbidden (not Host/Organizer or missing permission)**
```json
{
  "success": false,
  "message": "Bạn không có quyền bắt đầu phiên họp này",
  "error": { "code": "FORBIDDEN", "details": {} },
  "timestamp": "...",
  "path": "/api/v1/live-meetings/{meetingId}/start"
}
```

**404 — Meeting Not Found**
```json
{
  "success": false,
  "message": "Không tìm thấy cuộc họp",
  "error": { "code": "MEETING_NOT_FOUND", "details": { "meetingId": "uuid" } },
  "timestamp": "...",
  "path": "/api/v1/live-meetings/{meetingId}/start"
}
```

**409 — Wrong Status**

```json
{
  "success": false,
  "message": "Cuộc họp không ở trạng thái scheduled",
  "error": { "code": "MEETING_NOT_IN_SCHEDULED_STATUS", "details": { "currentStatus": "completed" } },
  "timestamp": "...",
  "path": "/api/v1/live-meetings/{meetingId}/start"
}
```

**409 — Time Window Too Early**
```json
{
  "success": false,
  "message": "Chưa đến thời gian bắt đầu phiên họp",
  "error": { "code": "MEETING_START_TOO_EARLY", "details": { "allowedFrom": "2026-06-16T08:45:00+07:00" } },
  "timestamp": "...",
  "path": "/api/v1/live-meetings/{meetingId}/start"
}
```

**409 — Time Window Expired**
```json
{
  "success": false,
  "message": "Đã quá thời gian bắt đầu phiên họp",
  "error": { "code": "MEETING_START_WINDOW_EXPIRED", "details": { "expiredAt": "2026-06-16T10:00:00+07:00" } },
  "timestamp": "...",
  "path": "/api/v1/live-meetings/{meetingId}/start"
}
```

**409 — Meeting Already Completed**
```json
{
  "success": false,
  "message": "Cuộc họp đã kết thúc",
  "error": { "code": "MEETING_ALREADY_COMPLETED", "details": {} },
  "timestamp": "...",
  "path": "/api/v1/live-meetings/{meetingId}/start"
}
```

**409 — Meeting Cancelled**
```json
{
  "success": false,
  "message": "Cuộc họp đã bị hủy",
  "error": { "code": "MEETING_CANCELLED", "details": {} },
  "timestamp": "...",
  "path": "/api/v1/live-meetings/{meetingId}/start"
}
```

**409 — Meeting Pending Approval**
```json
{
  "success": false,
  "message": "Cuộc họp đang chờ phê duyệt",
  "error": { "code": "MEETING_PENDING_APPROVAL", "details": {} },
  "timestamp": "...",
  "path": "/api/v1/live-meetings/{meetingId}/start"
}
```

**409 — Meeting in Draft**
```json
{
  "success": false,
  "message": "Cuộc họp chưa được lên lịch",
  "error": { "code": "MEETING_IN_DRAFT_STATUS", "details": {} },
  "timestamp": "...",
  "path": "/api/v1/live-meetings/{meetingId}/start"
}
```

### Business Rules

- `meeting.session.start` permission + ownership check (Host/Organizer).
- Time window: `start_time - 15m <= now() < end_time`.
- Idempotent: nếu đã `in_progress`, trả 200 OK với `alreadyStarted=true`, không tạo thêm event/audit.
- DB row lock (`SELECT FOR UPDATE`) để chống race condition.

### Internal Service (cho AF1 Device flow)

| Field | Value |
|---|---|
| Method | Internal service method |
| Endpoint | `LiveMeetingService.startMeetingFromDeviceCheckIn(params)` |
| Auth | Internal call (không JWT — dùng InternalApiGuard) |

**Params**:
```json
{
  "deviceId": "uuid",
  "roomId": "uuid",
  "recognizedUserId": "uuid",
  "sourceType": "device"
}
```

**Logic**: Xác định meeting scheduled phù hợp với Host + room + time window. Nếu tìm thấy chính xác 1 meeting, start với `source_type = device`. Nếu 0 hoặc >1 meeting match, trả lỗi.
