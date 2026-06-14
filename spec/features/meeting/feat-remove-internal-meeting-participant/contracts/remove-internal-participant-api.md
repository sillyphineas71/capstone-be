# API Contract: Remove Internal Meeting Participant

## Endpoint

```
DELETE /api/v1/meetings/{meetingId}/participants/{participantUserId}
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
| participantUserId | UUID (v4) | Yes | ID of the participant to remove |

## Optional Request Body

```json
{
  "reason": "Reason for removal (max 1000 characters)"
}
```

## Success Response

**HTTP 200 OK**

```json
{
  "success": true,
  "message": "Participant removed from meeting successfully",
  "data": {
    "meetingId": "3fa85f64-5717-4562-b3fc-2c963f66afa6",
    "removedParticipantUserId": "6fa85f64-5717-4562-b3fc-2c963f66afa6",
    "removed": true,
    "removedAt": "2026-06-11T10:00:00.000Z",
    "notificationQueued": true,
    "notificationId": "8fa85f64-5717-4562-b3fc-2c963f66afa6",
    "backgroundJobId": "9fa85f64-5717-4562-b3fc-2c963f66afa6"
  }
}
```

## Error Responses Summary

| Status | Error Code | When |
|---|---|---|
| 200 | - | Success |
| 400 | INVALID_UUID | Invalid UUID format |
| 400 | VALIDATION_ERROR | Reason exceeds 1000 characters |
| 401 | UNAUTHENTICATED | Missing or expired JWT |
| 403 | FORBIDDEN | No delete permission |
| 404 | MEETING_NOT_FOUND | Meeting does not exist |
| 404 | PARTICIPANT_NOT_IN_MEETING | Participant not found in meeting |
| 409 | MEETING_NOT_REMOVABLE | Meeting is not scheduled |
| 409 | CANNOT_REMOVE_HOST_OR_ORGANIZER | Target is Host/Organizer |
| 409 | PARTICIPANT_OWNS_AGENDA_ITEMS | Target owns agenda items |
| 422 | RECURRING_SERIES_SCOPE_NOT_SUPPORTED | Series-wide removal requested |
| 500 | INTERNAL_ERROR | Internal server error |

## Full Error Response Schemas

### 400 INVALID_UUID
```json
{
  "success": false, "message": "Invalid UUID format",
  "error": { "code": "INVALID_UUID", "details": { "field": "meetingId" } },
  "timestamp": "2026-06-11T10:00:00.000Z", "path": "/api/v1/meetings/{meetingId}/participants/{participantUserId}"
}
```

### 400 VALIDATION_ERROR
```json
{
  "success": false, "message": "Validation failed",
  "error": { "code": "VALIDATION_ERROR", "details": { "reason": "reason must be shorter than or equal to 1000 characters" } },
  "timestamp": "2026-06-11T10:00:00.000Z", "path": "/api/v1/meetings/{meetingId}/participants/{participantUserId}"
}
```

### 401 UNAUTHENTICATED
```json
{
  "success": false, "message": "Authentication required",
  "error": { "code": "UNAUTHENTICATED", "details": {} },
  "timestamp": "2026-06-11T10:00:00.000Z", "path": "/api/v1/meetings/{meetingId}/participants/{participantUserId}"
}
```

### 403 FORBIDDEN
```json
{
  "success": false, "message": "Insufficient permissions",
  "error": { "code": "FORBIDDEN", "details": {} },
  "timestamp": "2026-06-11T10:00:00.000Z", "path": "/api/v1/meetings/{meetingId}/participants/{participantUserId}"
}
```

### 404 MEETING_NOT_FOUND
```json
{
  "success": false, "message": "Meeting not found",
  "error": { "code": "MEETING_NOT_FOUND", "details": {} },
  "timestamp": "2026-06-11T10:00:00.000Z", "path": "/api/v1/meetings/{meetingId}/participants/{participantUserId}"
}
```

### 404 PARTICIPANT_NOT_IN_MEETING
```json
{
  "success": false, "message": "Participant is not in this meeting",
  "error": { "code": "PARTICIPANT_NOT_IN_MEETING", "details": {} },
  "timestamp": "2026-06-11T10:00:00.000Z", "path": "/api/v1/meetings/{meetingId}/participants/{participantUserId}"
}
```

### 409 MEETING_NOT_REMOVABLE
```json
{
  "success": false, "message": "Meeting is not in scheduled status",
  "error": { "code": "MEETING_NOT_REMOVABLE", "details": { "currentStatus": "in_progress" } },
  "timestamp": "2026-06-11T10:00:00.000Z", "path": "/api/v1/meetings/{meetingId}/participants/{participantUserId}"
}
```

### 409 CANNOT_REMOVE_HOST_OR_ORGANIZER
```json
{
  "success": false, "message": "Cannot remove Host or Organizer from the meeting",
  "error": { "code": "CANNOT_REMOVE_HOST_OR_ORGANIZER", "details": { "targetRole": "host" } },
  "timestamp": "2026-06-11T10:00:00.000Z", "path": "/api/v1/meetings/{meetingId}/participants/{participantUserId}"
}
```

### 409 PARTICIPANT_OWNS_AGENDA_ITEMS
```json
{
  "success": false, "message": "Participant owns one or more agenda items",
  "error": { "code": "PARTICIPANT_OWNS_AGENDA_ITEMS", "details": { "agendaItemIds": ["uuid1", "uuid2"] } },
  "timestamp": "2026-06-11T10:00:00.000Z", "path": "/api/v1/meetings/{meetingId}/participants/{participantUserId}"
}
```

### 422 RECURRING_SERIES_SCOPE_NOT_SUPPORTED
```json
{
  "success": false, "message": "Series-wide removal is not supported",
  "error": { "code": "RECURRING_SERIES_SCOPE_NOT_SUPPORTED", "details": {} },
  "timestamp": "2026-06-11T10:00:00.000Z", "path": "/api/v1/meetings/{meetingId}/participants/{participantUserId}"
}
```

### 500 INTERNAL_ERROR
```json
{
  "success": false, "message": "Internal server error",
  "error": { "code": "INTERNAL_ERROR", "details": {} },
  "timestamp": "2026-06-11T10:00:00.000Z", "path": "/api/v1/meetings/{meetingId}/participants/{participantUserId}"
}
```