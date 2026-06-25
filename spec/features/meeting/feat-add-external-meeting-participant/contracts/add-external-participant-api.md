# API Contract: Add External Meeting Participant

## Endpoint

```
POST /api/v1/meetings/{meetingId}/participants/external
```

## Headers

| Name | Value | Required |
|---|---|---|
| Authorization | Bearer {jwt_token} | Yes |
| Content-Type | application/json | Yes |

## Path Parameters

| Name | Type | Required | Description |
|---|---|---|---|
| meetingId | UUID (v4) | Yes | ID of the meeting |

## Request Body

```json
{
  "fullName": "Nguyễn Văn Khách",
  "email": "khach@partner.com",
  "organizationName": "Công ty Đối tác ABC",
  "phoneNumber": "0901234567",
  "overrideWarnings": false,
  "warningToken": null
}
```

| Field | Type | Required | Notes |
|---|---|---|---|
| fullName | string (max 255) | Yes | Trimmed; rejected if empty/whitespace-only |
| email | string (email, max 255) | Yes | Used for duplicate check and as the only notification channel |
| organizationName | string (max 255) | No | |
| phoneNumber | string (max 30) | No | |
| overrideWarnings | boolean | No | Set `true` on the retry call after receiving a 422 `WARNING_CONFIRMATION_REQUIRED` |
| warningToken | string | No | Token returned in the first 422 response; required together with `overrideWarnings=true` |

## Success Response

**HTTP 201 Created**

```json
{
  "success": true,
  "message": "Đã thêm khách mời bên ngoài vào cuộc họp thành công",
  "data": {
    "externalParticipantId": "3fa85f64-5717-4562-b3fc-2c963f66afa6",
    "meetingId": "6fa85f64-5717-4562-b3fc-2c963f66afa6",
    "fullName": "Nguyễn Văn Khách",
    "email": "khach@partner.com",
    "organizationName": "Công ty Đối tác ABC",
    "phoneNumber": "0901234567",
    "role": "attendee",
    "status": "pending"
  }
}
```

## Warning Response (first call when over capacity, policy = warning)

**HTTP 422 Unprocessable Entity**

```json
{
  "success": false,
  "message": "Phát hiện cảnh báo sức chứa phòng. Vui lòng xác nhận.",
  "error": {
    "code": "WARNING_CONFIRMATION_REQUIRED",
    "details": {
      "warningToken": "eyJhbGciOiJIUzI1NiIs...",
      "warnings": [
        { "type": "ROOM_CAPACITY_WARNING", "message": "Sức chứa phòng (10 người) không đủ cho tổng số người tham dự (11 người)." }
      ]
    }
  },
  "timestamp": "2026-06-25T10:00:00.000Z",
  "path": "/api/v1/meetings/{meetingId}/participants/external"
}
```

## Error Responses Summary

| Status | Error Code | When |
|---|---|---|
| 201 | - | Success |
| 400 | VALIDATION_ERROR | `fullName`/`email` missing or invalid format |
| 400 | INVALID_MEETING_STATUS | Meeting is not `scheduled`/`in_progress` |
| 400 | INVALID_WARNING_TOKEN | `warningToken` invalid, expired, or mismatched |
| 401 | UNAUTHENTICATED | Missing or expired JWT |
| 403 | FORBIDDEN | No `meeting.participant.add.external` permission and not Organizer/Host |
| 403 | FORBIDDEN_ACCESS | Meeting is `private` and actor is not Organizer/Host/Admin |
| 404 | MEETING_NOT_FOUND | Meeting does not exist or is soft-deleted |
| 409 | EXTERNAL_PARTICIPANT_ALREADY_EXISTS | Email already in the meeting's external participant list |
| 422 | WARNING_CONFIRMATION_REQUIRED | Over capacity, policy=warning, no valid warningToken yet |
| 422 | ROOM_CAPACITY_EXCEEDED | Policy=block, or policy=warning without override permission |
| 500 | INTERNAL_ERROR | Unexpected server error |

## Full Error Response Schemas

### 400 VALIDATION_ERROR
```json
{
  "success": false, "message": "Validation failed",
  "error": { "code": "VALIDATION_ERROR", "details": { "email": "email must be a valid email address" } },
  "timestamp": "2026-06-25T10:00:00.000Z", "path": "/api/v1/meetings/{meetingId}/participants/external"
}
```

### 400 INVALID_MEETING_STATUS
```json
{
  "success": false, "message": "Cuộc họp không ở trạng thái cho phép thêm khách mời bên ngoài",
  "error": { "code": "INVALID_MEETING_STATUS", "details": { "currentStatus": "completed", "allowedStatuses": ["scheduled", "in_progress"] } },
  "timestamp": "2026-06-25T10:00:00.000Z", "path": "/api/v1/meetings/{meetingId}/participants/external"
}
```

### 400 INVALID_WARNING_TOKEN
```json
{
  "success": false, "message": "warningToken không hợp lệ hoặc đã hết hạn",
  "error": { "code": "INVALID_WARNING_TOKEN", "details": {} },
  "timestamp": "2026-06-25T10:00:00.000Z", "path": "/api/v1/meetings/{meetingId}/participants/external"
}
```

### 401 UNAUTHENTICATED
```json
{
  "success": false, "message": "Authentication required",
  "error": { "code": "UNAUTHENTICATED", "details": {} },
  "timestamp": "2026-06-25T10:00:00.000Z", "path": "/api/v1/meetings/{meetingId}/participants/external"
}
```

### 403 FORBIDDEN
```json
{
  "success": false, "message": "Bạn không có quyền thêm khách mời bên ngoài vào cuộc họp này",
  "error": { "code": "FORBIDDEN", "details": {} },
  "timestamp": "2026-06-25T10:00:00.000Z", "path": "/api/v1/meetings/{meetingId}/participants/external"
}
```

### 403 FORBIDDEN_ACCESS
```json
{
  "success": false, "message": "Bạn không có quyền thêm khách mời bên ngoài vào cuộc họp này",
  "error": { "code": "FORBIDDEN_ACCESS", "details": { "reason": "Meeting là Private và bạn không phải Organizer/Host/Admin" } },
  "timestamp": "2026-06-25T10:00:00.000Z", "path": "/api/v1/meetings/{meetingId}/participants/external"
}
```

### 404 MEETING_NOT_FOUND
```json
{
  "success": false, "message": "Không tìm thấy cuộc họp",
  "error": { "code": "MEETING_NOT_FOUND", "details": { "meetingId": "uuid" } },
  "timestamp": "2026-06-25T10:00:00.000Z", "path": "/api/v1/meetings/{meetingId}/participants/external"
}
```

### 409 EXTERNAL_PARTICIPANT_ALREADY_EXISTS
```json
{
  "success": false, "message": "Email này đã có trong danh sách khách mời bên ngoài của cuộc họp",
  "error": { "code": "EXTERNAL_PARTICIPANT_ALREADY_EXISTS", "details": { "email": "khach@partner.com" } },
  "timestamp": "2026-06-25T10:00:00.000Z", "path": "/api/v1/meetings/{meetingId}/participants/external"
}
```

### 422 ROOM_CAPACITY_EXCEEDED
```json
{
  "success": false, "message": "Phòng họp đã đạt sức chứa tối đa. Chính sách hiện tại không cho phép thêm người.",
  "error": { "code": "ROOM_CAPACITY_EXCEEDED", "details": { "capacityPolicy": "block", "reason": "meeting.capacity_policy = 'block'" } },
  "timestamp": "2026-06-25T10:00:00.000Z", "path": "/api/v1/meetings/{meetingId}/participants/external"
}
```

### 500 INTERNAL_ERROR
```json
{
  "success": false, "message": "Internal server error",
  "error": { "code": "INTERNAL_ERROR", "details": {} },
  "timestamp": "2026-06-25T10:00:00.000Z", "path": "/api/v1/meetings/{meetingId}/participants/external"
}
```
