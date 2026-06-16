# API Contract: Participant Conflict Check (UC-SM-04 / UC-53)

**Base URL**: /api/v1
**Auth**: JWT Bearer token

---

## 1. Check Participant Conflicts (Realtime)

| Field | Value |
|---|---|
| Method | POST |
| Endpoint | /api/v1/scheduling/participant-conflicts/check |
| Permission | scheduling.conflict.participant.check |
| System Roles | INTERNAL_USER, MANAGER, BUSINESS_ADMIN, SYSTEM_ADMIN |
| Async | No |

### Request Body

`json
{
  "startTime": "2026-06-16T14:00:00+07:00",
  "endTime": "2026-06-16T16:00:00+07:00",
  "timezone": "Asia/Ho_Chi_Minh",
  "participantUserIds": ["uuid1", "uuid2"],
  "excludeMeetingId": "uuid",
  "externalParticipantEmails": ["guest@external.com"]
}
`

### Response 200 (has conflict)

`json
{
  "success": true,
  "message": "Kiểm tra xung đột lịch hoàn tất",
  "data": {
    "hasConflict": true,
    "checkedAt": "2026-06-16T10:00:00+07:00",
    "participants": [
      {
        "userId": "uuid1",
        "status": "busy",
        "busySlots": [
          { "busyFrom": "2026-06-16T14:00:00+07:00", "busyTo": "2026-06-16T15:30:00+07:00" }
        ],
        "displayWarning": true,
        "warningMessage": "Bận từ 14:00 - 15:30"
      },
      {
        "userId": "uuid2",
        "status": "free",
        "busySlots": [],
        "displayWarning": false,
        "warningMessage": null
      }
    ],
    "externalParticipants": [
      {
        "email": "guest@external.com",
        "status": "unknown",
        "warningMessage": "Không rõ lịch trình"
      }
    ]
  }
}
`

### Response 200 (no conflict)

`json
{
  "success": true,
  "message": "Kiểm tra xung đột lịch hoàn tất",
  "data": {
    "hasConflict": false,
    "checkedAt": "2026-06-16T10:00:00+07:00",
    "participants": [
      {
        "userId": "uuid1",
        "status": "free",
        "busySlots": [],
        "displayWarning": false,
        "warningMessage": null
      }
    ],
    "externalParticipants": []
  }
}
`

### Error Responses

**400 Validation Error**:
`json
{
  "success": false,
  "message": "Dữ liệu đầu vào không hợp lệ",
  "error": {
    "code": "VALIDATION_ERROR",
    "details": { "startTime": "startTime không được để trống" }
  },
  "timestamp": "2026-06-16T10:00:00+07:00",
  "path": "/api/v1/scheduling/participant-conflicts/check"
}
`

**403 Forbidden**:
`json
{
  "success": false,
  "message": "Không đủ quyền truy cập",
  "error": { "code": "PERMISSION_DENIED", "details": {} },
  "timestamp": "2026-06-16T10:00:00+07:00",
  "path": "/api/v1/scheduling/participant-conflicts/check"
}
`

**500 Internal Error**:
`json
{
  "success": false,
  "message": "Lỗi hệ thống",
  "error": { "code": "INTERNAL_ERROR", "details": {} },
  "timestamp": "2026-06-16T10:00:00+07:00",
  "path": "/api/v1/scheduling/participant-conflicts/check"
}
`

---

## 2. Submit Booking Request — Participant Conflict Re-check

**Không phải endpoint riêng.** Logic này được gọi từ MeetingsService khi tạo meeting request.

### Behavior

1. MeetingsService nhận request tạo booking/meeting request.
2. Sau khi validation cơ bản pass, gọi SchedulingService.checkParticipantConflicts().
3. Nếu có conflict → conflictCheckStatus = warning, lưu snapshot.
4. Nếu không conflict → conflictCheckStatus = clear.
5. Tạo meeting request (luôn thành công nếu validation khác pass).
6. Response trả thêm warning.

### Response (trích xuất phần conflict từ Create Meeting Request response)

`json
{
  "success": true,
  "message": "Yêu cầu đặt phòng đã được gửi",
  "data": {
    "requestId": "uuid",
    "conflictCheckStatus": "warning",
    "participantWarnings": [
      {
        "userId": "uuid",
        "status": "busy",
        "warningMessage": "Bận từ 14:00 - 15:30"
      }
    ]
  }
}
`

---

## 3. Error Codes

| Error Code | HTTP | Mô tả |
|---|---|---|
| VALIDATION_ERROR | 400 | Input không hợp lệ |
| PARTICIPANT_CONFLICT_CHECK_LIMIT_EXCEEDED | 400 | Vượt quá 50 participants |
| PERMISSION_DENIED | 403 | Không có quyền scheduling.conflict.participant.check |
| RESOURCE_NOT_FOUND | 404 | excludeMeetingId không tồn tại hoặc user không có quyền |
| INTERNAL_ERROR | 500 | Lỗi hệ thống |
