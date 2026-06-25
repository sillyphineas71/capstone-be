# API Contract: Remove External Meeting Participant

## Endpoint

```
DELETE /api/v1/meetings/{meetingId}/participants/external/{externalParticipantId}
```

## Headers

| Name | Value | Required |
|---|---|---|
| Authorization | Bearer {jwt_token} | Yes |
| Content-Type | application/json | No (only if body provided) |

## Path Parameters

| Name | Type | Required | Description |
|---|---|---|---|
| meetingId | UUID (v4) | Yes | ID of the meeting |
| externalParticipantId | UUID (v4) | Yes | ID of the `meeting_external_participants` row to remove |

## Optional Request Body

```json
{
  "reason": "Khách hàng báo bận, không thể tham dự",
  "scope": "instance"
}
```

| Field | Type | Required | Notes |
|---|---|---|---|
| reason | string (max 1000) | No | |
| scope | `"instance"` \| `"series"` | No | Default `"instance"`. `"series"` is rejected with 422. |

## Success Response

**HTTP 200 OK** — target has an email on file:

```json
{
  "success": true,
  "message": "Đã gỡ bỏ khách mời bên ngoài khỏi cuộc họp thành công",
  "data": {
    "meetingId": "3fa85f64-5717-4562-b3fc-2c963f66afa6",
    "removedExternalParticipantId": "6fa85f64-5717-4562-b3fc-2c963f66afa6",
    "removed": true,
    "removedAt": "2026-06-25T10:00:00.000Z",
    "notificationQueued": true,
    "notificationId": "8fa85f64-5717-4562-b3fc-2c963f66afa6",
    "backgroundJobId": "9fa85f64-5717-4562-b3fc-2c963f66afa6"
  }
}
```

**HTTP 200 OK** — target has no email on file:

```json
{
  "success": true,
  "message": "Đã gỡ bỏ khách mời bên ngoài khỏi cuộc họp thành công",
  "data": {
    "meetingId": "3fa85f64-5717-4562-b3fc-2c963f66afa6",
    "removedExternalParticipantId": "6fa85f64-5717-4562-b3fc-2c963f66afa6",
    "removed": true,
    "removedAt": "2026-06-25T10:00:00.000Z",
    "notificationQueued": false,
    "notificationId": null,
    "backgroundJobId": null
  }
}
```

## Error Responses Summary

| Status | Error Code | When |
|---|---|---|
| 200 | - | Success |
| 400 | INVALID_UUID | Invalid `meetingId` or `externalParticipantId` format |
| 400 | VALIDATION_ERROR | `reason` exceeds 1000 characters, or invalid `scope` value |
| 401 | UNAUTHENTICATED | Missing or expired JWT |
| 403 | FORBIDDEN | No `meeting.participant.remove.external` permission and not Organizer/Host |
| 404 | MEETING_NOT_FOUND | Meeting does not exist or is soft-deleted |
| 404 | EXTERNAL_PARTICIPANT_NOT_IN_MEETING | Target not found in this meeting's external participant list |
| 409 | MEETING_NOT_REMOVABLE | Meeting is not in `scheduled` status |
| 422 | RECURRING_SERIES_SCOPE_NOT_SUPPORTED | Series-wide removal requested |
| 500 | INTERNAL_ERROR | Unexpected server error |

## Full Error Response Schemas

### 400 INVALID_UUID
```json
{
  "success": false, "message": "Invalid UUID format",
  "error": { "code": "INVALID_UUID", "details": { "field": "externalParticipantId" } },
  "timestamp": "2026-06-25T10:00:00.000Z", "path": "/api/v1/meetings/{meetingId}/participants/external/{externalParticipantId}"
}
```

### 400 VALIDATION_ERROR
```json
{
  "success": false, "message": "Validation failed",
  "error": { "code": "VALIDATION_ERROR", "details": { "reason": "reason must be shorter than or equal to 1000 characters" } },
  "timestamp": "2026-06-25T10:00:00.000Z", "path": "/api/v1/meetings/{meetingId}/participants/external/{externalParticipantId}"
}
```

### 401 UNAUTHENTICATED
```json
{
  "success": false, "message": "Authentication required",
  "error": { "code": "UNAUTHENTICATED", "details": {} },
  "timestamp": "2026-06-25T10:00:00.000Z", "path": "/api/v1/meetings/{meetingId}/participants/external/{externalParticipantId}"
}
```

### 403 FORBIDDEN
```json
{
  "success": false, "message": "Bạn không có quyền gỡ khách mời bên ngoài khỏi cuộc họp này",
  "error": { "code": "FORBIDDEN", "details": {} },
  "timestamp": "2026-06-25T10:00:00.000Z", "path": "/api/v1/meetings/{meetingId}/participants/external/{externalParticipantId}"
}
```

### 404 MEETING_NOT_FOUND
```json
{
  "success": false, "message": "Không tìm thấy cuộc họp",
  "error": { "code": "MEETING_NOT_FOUND", "details": {} },
  "timestamp": "2026-06-25T10:00:00.000Z", "path": "/api/v1/meetings/{meetingId}/participants/external/{externalParticipantId}"
}
```

### 404 EXTERNAL_PARTICIPANT_NOT_IN_MEETING
```json
{
  "success": false, "message": "Khách mời bên ngoài không có trong cuộc họp này",
  "error": { "code": "EXTERNAL_PARTICIPANT_NOT_IN_MEETING", "details": {} },
  "timestamp": "2026-06-25T10:00:00.000Z", "path": "/api/v1/meetings/{meetingId}/participants/external/{externalParticipantId}"
}
```

### 409 MEETING_NOT_REMOVABLE
```json
{
  "success": false, "message": "Không thể gỡ khách mời: cuộc họp không ở trạng thái scheduled",
  "error": { "code": "MEETING_NOT_REMOVABLE", "details": { "currentStatus": "in_progress" } },
  "timestamp": "2026-06-25T10:00:00.000Z", "path": "/api/v1/meetings/{meetingId}/participants/external/{externalParticipantId}"
}
```

### 422 RECURRING_SERIES_SCOPE_NOT_SUPPORTED
```json
{
  "success": false, "message": "Không thể gỡ khách mời khỏi toàn bộ recurring series",
  "error": { "code": "RECURRING_SERIES_SCOPE_NOT_SUPPORTED", "details": {} },
  "timestamp": "2026-06-25T10:00:00.000Z", "path": "/api/v1/meetings/{meetingId}/participants/external/{externalParticipantId}"
}
```

### 500 INTERNAL_ERROR
```json
{
  "success": false, "message": "Internal server error",
  "error": { "code": "INTERNAL_ERROR", "details": {} },
  "timestamp": "2026-06-25T10:00:00.000Z", "path": "/api/v1/meetings/{meetingId}/participants/external/{externalParticipantId}"
}
```
