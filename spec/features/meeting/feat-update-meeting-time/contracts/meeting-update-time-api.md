# API Contract: PATCH /api/v1/meetings/{meetingId}/time

## CHANGELOG & REVISION HISTORY
| Ngày cập nhật | Tóm tắt thay đổi | Các dòng thay đổi |
| :--- | :--- | :--- |
| 2026-06-09 | Initial API contract from spec v1 | All |

---

## 1. Overview

- **Method**: `PATCH`
- **Path**: `/api/v1/meetings/{meetingId}/time`
- **Auth**: JWT Bearer token (required)
- **Content-Type**: `application/json`
- **Module**: meetings
- **Permission**: `meeting.time.update` hoặc `meeting.time.update.any`

---

## 2. Path Parameters

| Parameter | Type | Required | Description |
|---|---|---|---|
| `meetingId` | `uuid` | Yes | ID của cuộc họp cần cập nhật thời gian |

---

## 3. Request Body

```json
{
  "startTime": "2026-07-01T09:00:00+07:00",
  "endTime": "2026-07-01T10:30:00+07:00",
  "newRoomId": "550e8400-e29b-41d4-a716-446655440000",
  "overrideParticipantConflict": false,
  "changeReason": "Host bận đột xuất"
}
```

### 3.1 Field Details

| Field | Type | Required | Default | Validation |
|---|---|---|---|---|
| `startTime` | string (ISO-8601) | Yes | — | Phải có timezone, không trong quá khứ, < endTime |
| `endTime` | string (ISO-8601) | Yes | — | Phải có timezone, > startTime, duration 15p-8h |
| `newRoomId` | uuid | No | — | Nếu có: room tồn tại, active, capacity đủ |
| `overrideParticipantConflict` | boolean | No | `false` | Phải là boolean nếu có |
| `changeReason` | string | No | — | Max 500 ký tự |

---

## 4. Responses

### 4.1 Success — HTTP 200

```json
{
  "success": true,
  "data": {
    "meetingId": "550e8400-e29b-41d4-a716-446655440000",
    "oldStartTime": "2026-07-01T08:00:00+07:00",
    "oldEndTime": "2026-07-01T09:00:00+07:00",
    "newStartTime": "2026-07-01T09:00:00+07:00",
    "newEndTime": "2026-07-01T10:30:00+07:00",
    "oldRoomId": "550e8400-e29b-41d4-a716-446655440001",
    "newRoomId": "550e8400-e29b-41d4-a716-446655440002",
    "bookingId": "550e8400-e29b-41d4-a716-446655440003",
    "notificationStatus": "queued",
    "updatedAt": "2026-06-09T10:00:00+07:00"
  },
  "meta": {
    "requestId": "req-001"
  }
}
```

### 4.2 Participant Conflict Warning — HTTP 409

```json
{
  "success": false,
  "error": {
    "code": "PARTICIPANT_TIME_CONFLICT_WARNING",
    "message": "Khung giờ mới trùng lịch với một hoặc nhiều người tham gia. Vui lòng xác nhận nếu vẫn muốn tiếp tục.",
    "details": {
      "blocking": false,
      "requiresConfirmation": true,
      "conflicts": [
        {
          "userId": "550e8400-e29b-41d4-a716-446655440010",
          "fullName": "Nguyen Van A",
          "overlappingMeetings": [
            {
              "meetingId": "550e8400-e29b-41d4-a716-446655440020",
              "title": "Weekly Sync",
              "startTime": "2026-07-01T09:30:00+07:00",
              "endTime": "2026-07-01T10:00:00+07:00"
            }
          ]
        }
      ]
    }
  }
}
```

### 4.3 Room Conflict — HTTP 409

```json
{
  "success": false,
  "error": {
    "code": "ROOM_TIME_CONFLICT",
    "message": "Phòng họp hiện tại không khả dụng trong khung giờ mới.",
    "details": {
      "blocking": true,
      "conflictedRoomId": "550e8400-e29b-41d4-a716-446655440001",
      "requestedStartTime": "2026-07-01T09:00:00+07:00",
      "requestedEndTime": "2026-07-01T10:30:00+07:00",
      "conflicts": [
        {
          "conflictingBookingId": "550e8400-e29b-41d4-a716-446655440030",
          "conflictingMeetingId": "550e8400-e29b-41d4-a716-446655440040",
          "conflictingStartTime": "2026-07-01T09:00:00+07:00",
          "conflictingEndTime": "2026-07-01T10:00:00+07:00",
          "conflictingTitle": "Sprint Planning"
        }
      ],
      "suggestedRooms": [
        {
          "roomId": "550e8400-e29b-41d4-a716-446655440050",
          "name": "Phòng họp A.02",
          "capacity": 12
        },
        {
          "roomId": "550e8400-e29b-41d4-a716-446655440051",
          "name": "Phòng họp A.03",
          "capacity": 8
        }
      ]
    }
  }
}
```

### 4.4 Error Response Matrix

| HTTP | Error Code | When |
|---|---|---|
| 400 | `INVALID_UUID` | meetingId không phải UUID |
| 400 | `INVALID_BOOLEAN` | overrideParticipantConflict không phải boolean |
| 401 | `UNAUTHORIZED` | Không có JWT token hoặc token hết hạn |
| 403 | `MEETING_TIME_UPDATE_FORBIDDEN` | User không có quyền |
| 404 | `MEETING_NOT_FOUND` | Meeting không tồn tại / bị soft delete |
| 404 | `ROOM_NOT_FOUND` | newRoomId không tồn tại |
| 409 | `MEETING_STATUS_NOT_EDITABLE` | Meeting không ở trạng thái `scheduled` |
| 409 | `ROOM_TIME_CONFLICT` | Room conflict (blocking=true) |
| 409 | `ROOM_NOT_AVAILABLE` | Phòng inactive/maintenance |
| 409 | `ROOM_CAPACITY_INSUFFICIENT` | Phòng không đủ sức chứa |
| 409 | `PARTICIPANT_TIME_CONFLICT_WARNING` | Participant conflict (blocking=false) |
| 422 | `INVALID_DATE_FORMAT` | startTime/endTime sai định dạng ISO-8601 |
| 422 | `INVALID_TIME_RANGE` | startTime >= endTime |
| 422 | `MEETING_TIME_IN_PAST` | startTime/endTime trong quá khứ |
| 422 | `MEETING_DURATION_OUT_OF_RANGE` | Duration < 15p hoặc > 8h |
| 422 | `FIELD_TOO_LONG` | changeReason > 500 ký tự |
| 500 | `INTERNAL_SERVER_ERROR` | Lỗi database không xác định hoặc unexpected error |

### 4.5 General Error Format

```json
{
  "success": false,
  "error": {
    "code": "ERROR_CODE",
    "message": "Thông báo lỗi chi tiết",
    "details": {}
  }
}
```
