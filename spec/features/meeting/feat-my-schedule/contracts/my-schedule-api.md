# API Contract: UC-MM-05 My Schedule

> Base URL: `/api/v1`
> Auth: JWT Bearer token required for all endpoints
> Permission: `schedule.read.self`

---

## 1. GET /me/schedule

Tra cứu danh sách lịch trình cá nhân.

### Request

**Query Parameters:**

| Param | Type | Required | Default | Description |
|---|---|---|---|---|
| `view` | enum | Yes | — | `day`, `week`, `month` |
| `from` | string (ISO-8601) | Yes | — | Inclusive boundary. Must include UTC offset, e.g. `2026-06-08T00:00:00+07:00` |
| `to` | string (ISO-8601) | Yes | — | Exclusive boundary. Must include UTC offset |
| `timezone` | string | No | `Asia/Ho_Chi_Minh` | IANA timezone for response metadata/display context |
| `status` | string | No | — | Comma-separated: `scheduled,in_progress,cancelled,completed` |
| `role` | enum | No | — | Filter by `effectiveUserRole`: `organizer`, `host`, `attendee` |
| `roomId` | string (UUID) | No | — | Filter by room |
| `q` | string | No | — | Case-insensitive search on `title` and `meeting_code`. Max 200 chars. Trimmed; if empty → filter ignored |

### Response 200

```json
{
  "success": true,
  "message": "Schedule retrieved successfully",
  "data": {
    "items": [
      {
        "meetingId": "3a7e2c91-8f4b-4d2e-9c1f-2a5b6c7d8e9f",
        "meetingCode": "MTG-2026-001",
        "title": "Sprint Planning",
        "startTime": "2026-06-10T09:00:00+07:00",
        "endTime": "2026-06-10T10:30:00+07:00",
        "timezone": "Asia/Ho_Chi_Minh",
        "status": "scheduled",
        "userRole": "organizer",
        "room": {
          "id": "4b8f3d72-1e5a-4c6f-9d0b-3e7a8f9c0d1e",
          "roomName": "Phòng họp A",
          "roomCode": "RM-A",
          "location": "Tầng 5, Tòa nhà B"
        },
        "colorKey": "scheduled",
        "isCurrent": false,
        "isPast": false
      }
    ],
    "range": {
      "view": "week",
      "from": "2026-06-08T00:00:00+07:00",
      "to": "2026-06-14T23:59:59+07:00",
      "timezone": "Asia/Ho_Chi_Minh"
    },
    "empty": false
  }
}
```

### Error Responses

| HTTP | Body |
|---|---|
| **400** | `{ "success": false, "message": "...", "error": { "code": "MISSING_REQUIRED_PARAM", "details": { "field": "from" } } }` |
| **400** | `{ "success": false, "message": "...", "error": { "code": "INVALID_DATETIME_FORMAT", "details": { "field": "from", "value": "2026-06-08T00:00:00" } } }` |
| **400** | `{ "success": false, "message": "...", "error": { "code": "INVALID_TIMEZONE", "details": { "value": "ABC" } } }` |
| **400** | `{ "success": false, "message": "...", "error": { "code": "INVALID_VIEW_PARAM", "details": { "value": "year" } } }` |
| **400** | `{ "success": false, "message": "...", "error": { "code": "INVALID_UUID", "details": { "field": "roomId" } } }` |
| **401** | `{ "success": false, "message": "Unauthenticated", "error": { "code": "UNAUTHENTICATED" } }` |
| **422** | `{ "success": false, "message": "...", "error": { "code": "INVALID_DATE_RANGE", "details": { "from": "...", "to": "..." } } }` |
| **422** | `{ "success": false, "message": "...", "error": { "code": "DATE_RANGE_TOO_WIDE", "details": { "maxDays": 31, "view": "month" } } }` |

---

## 2. GET /me/schedule/{meetingId}

Xem chi tiết một cuộc họp. Chỉ trả về nếu user là organizer, host hoặc participant.

### Request

**Path Parameters:**

| Param | Type | Required | Description |
|---|---|---|---|
| `meetingId` | string (UUID) | Yes | ID của cuộc họp |

### Response 200

```json
{
  "success": true,
  "message": "Meeting detail retrieved successfully",
  "data": {
    "meeting": {
      "meetingId": "3a7e2c91-8f4b-4d2e-9c1f-2a5b6c7d8e9f",
      "meetingCode": "MTG-2026-001",
      "title": "Sprint Planning",
      "description": "Kế hoạch sprint 12",
      "startTime": "2026-06-10T09:00:00+07:00",
      "endTime": "2026-06-10T10:30:00+07:00",
      "timezone": "Asia/Ho_Chi_Minh",
      "status": "scheduled",
      "recurrenceRuleId": null,
      "parentMeetingId": null
    },
    "room": {
      "id": "4b8f3d72-1e5a-4c6f-9d0b-3e7a8f9c0d1e",
      "roomName": "Phòng họp A",
      "roomCode": "RM-A",
      "siteName": "Tòa nhà B",
      "areaName": "Khu vực 1",
      "location": "Tầng 5"
    },
    "organizer": {
      "id": "uuid-org",
      "fullName": "Nguyễn Văn A",
      "email": "a@company.com"
    },
    "host": {
      "id": "uuid-host",
      "fullName": "Trần Thị B",
      "email": "b@company.com"
    },
    "participants": [
      {
        "id": "uuid-p1",
        "fullName": "Lê Văn C",
        "email": "c@company.com",
        "participantRole": "member",
        "invitationStatus": "accepted",
        "attendanceStatus": "not_yet"
      }
    ],
    "externalParticipants": [
      {
        "name": "Khách mời ngoài",
        "email": "guest@external.com"
      }
    ],
    "agendas": [
      {
        "id": "uuid-ag1",
        "title": "Review sprint",
        "durationMinutes": 30,
        "sortOrder": 1
      }
    ],
    "attachments": [
      {
        "id": "uuid-file1",
        "fileName": "sprint-planning.pptx",
        "fileUrl": "/media/xxx.pptx",
        "fileType": "application/vnd.openxmlformats-officedocument.presentationml.presentation",
        "fileSize": 2048000
      }
    ],
    "recordingConfig": {
      "autoRecord": false,
      "allowRecording": true
    },
    "userRole": "organizer"
  }
}
```

### Error Responses

| HTTP | Body |
|---|---|
| **400** | `{ "success": false, "message": "...", "error": { "code": "INVALID_UUID", "details": { "field": "meetingId" } } }` |
| **401** | `{ "success": false, "message": "Unauthenticated", "error": { "code": "UNAUTHENTICATED" } }` |
| **403** | `{ "success": false, "message": "...", "error": { "code": "FORBIDDEN_NOT_PARTICIPANT", "details": { "meetingId": "..." } } }` |
| **404** | `{ "success": false, "message": "...", "error": { "code": "MEETING_NOT_FOUND", "details": { "meetingId": "..." } } }` |
