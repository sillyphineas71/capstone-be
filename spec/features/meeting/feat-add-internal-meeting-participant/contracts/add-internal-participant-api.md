# API Contract: Add Internal Participant

- **Endpoint**: `POST /api/v1/meetings/:meetingId/participants/internal`
- **Feature**: MEET-ADD-PARTICIPANT-001
- **Auth**: Required (JWT) + PermissionsGuard

---

## 1. Endpoint

### POST `/api/v1/meetings/:meetingId/participants/internal`

**Path Parameters**:
| Param | Type | Description |
|-------|------|-------------|
| `meetingId` | UUID | ID của cuộc họp |

**Request Headers**:
| Header | Value |
|--------|-------|
| `Authorization` | `Bearer <jwt-token>` |

**Request Body** (lần gọi đầu hoặc lần gọi override):
```json
{
  "userId": "3fa85f64-5717-4562-b3fc-2c963f66afa6",
  "overrideWarnings": false,
  "warningToken": null
}
```

| Field | Type | Required | Default | Description |
|-------|------|----------|---------|-------------|
| `userId` | UUID | **Yes** | — | User ID của nhân viên nội bộ cần thêm |
| `overrideWarnings` | boolean | No | `false` | Xác nhận bỏ qua cảnh báo (bắt buộc ở lần gọi thứ 2) |
| `warningToken` | string | No | `null` | Token nhận từ response 422 trước đó |

---

## 2. Responses

### 2.1 Success — 201 Created

```json
{
  "success": true,
  "message": "Thêm thành viên vào cuộc họp thành công",
  "data": {
    "participantId": "3fa85f64-5717-4562-b3fc-2c963f66afa6",
    "meetingId": "3fa85f64-5717-4562-b3fc-2c963f66afa6",
    "userId": "3fa85f64-5717-4562-b3fc-2c963f66afa6",
    "role": "attendee",
    "status": "pending"
  }
}
```

### 2.2 Warning Required — 422 Unprocessable Entity

Trả về khi có soft warning (schedule conflict hoặc capacity warning) ở lần gọi đầu tiên.

```json
{
  "success": false,
  "message": "Phát hiện xung đột lịch hoặc cảnh báo sức chứa. Vui lòng xác nhận.",
  "error": {
    "code": "WARNING_CONFIRMATION_REQUIRED",
    "details": {
      "warningToken": "eyJhbGciOiJIUzI1NiIs...",
      "warnings": [
        {
          "type": "SCHEDULE_CONFLICT",
          "message": "Người dùng đang có cuộc họp trùng giờ: 'Daily standup' (09:00-10:00)."
        }
      ]
    }
  }
}
```

### 2.3 Invalid Warning Token — 400 Bad Request

```json
{
  "success": false,
  "message": "warningToken không hợp lệ hoặc đã hết hạn",
  "error": {
    "code": "INVALID_WARNING_TOKEN",
    "details": {}
  }
}
```

### 2.4 Forbidden — 403 Forbidden

```json
{
  "success": false,
  "message": "Bạn không có quyền thêm thành viên vào cuộc họp này",
  "error": {
    "code": "FORBIDDEN_ACCESS",
    "details": {
      "reason": "Meeting là Private và bạn không phải Organizer/Host/Admin"
    }
  }
}
```

### 2.5 Capacity Exceeded (Hard Block) — 422 Unprocessable Entity

```json
{
  "success": false,
  "message": "Phòng họp đã đạt sức chứa tối đa. Chính sách hiện tại không cho phép thêm người.",
  "error": {
    "code": "ROOM_CAPACITY_EXCEEDED",
    "details": {
      "capacityPolicy": "block",
      "reason": "meeting.capacity_policy = 'block' hoặc người dùng không có quyền override_capacity"
    }
  }
}
```

### 2.6 Duplicate Participant — 409 Conflict

```json
{
  "success": false,
  "message": "Người dùng đã có trong danh sách tham gia cuộc họp",
  "error": {
    "code": "PARTICIPANT_ALREADY_EXISTS",
    "details": {}
  }
}
```

### 2.7 Invalid Meeting Status — 400 Bad Request

```json
{
  "success": false,
  "message": "Cuộc họp không ở trạng thái cho phép thêm thành viên",
  "error": {
    "code": "INVALID_MEETING_STATUS",
    "details": {
      "currentStatus": "completed",
      "allowedStatuses": ["scheduled", "in_progress"]
    }
  }
}
```

### 2.8 User Not Found or Inactive — 404 Not Found

```json
{
  "success": false,
  "message": "Người dùng không tồn tại hoặc không hoạt động",
  "error": {
    "code": "USER_NOT_FOUND",
    "details": {}
  }
}
```

### 2.9 Meeting Not Found — 404 Not Found

```json
{
  "success": false,
  "message": "Không tìm thấy cuộc họp",
  "error": {
    "code": "MEETING_NOT_FOUND",
    "details": {}
  }
}
```

---

## 3. Luồng 2 bước override (Sequence)

```
Client                          Server
  │                                │
  │  POST /meetings/:id/participants/internal │
  │  { userId, overrideWarnings: false }       │
  │ ─────────────────────────────> │
  │                                ├─ Check meeting status
  │                                ├─ Check permissions
  │                                ├─ Check user exists
  │                                ├─ Check duplicate
  │                                ├─ Check schedule conflict
  │                                ├─ Check capacity warning
  │                                │
  │  <── 422 WARNING_CONFIRMATION_REQUIRED ──┤
  │  { warningToken, warnings[] }            │
  │                                │
  │  (UI hiển thị warning, user confirm)     │
  │                                │
  │  POST /meetings/:id/participants/internal │
  │  { userId, overrideWarnings: true,       │
  │    warningToken: "token-from-above" }    │
  │ ─────────────────────────────> │
  │                                ├─ Verify warningToken
  │                                ├─ Check capacity override permission
  │                                ├─ Pessimistic lock
  │                                ├─ INSERT participant
  │                                ├─ INSERT audit_log
  │                                ├─ (outside txn) INSERT notification + bg_job
  │                                │
  │  <── 201 Created ─────────────┤
```

---

## 4. Error Codes Summary

| HTTP Status | Error Code | Khi nào xảy ra |
|-------------|-----------|----------------|
| 400 | `INVALID_WARNING_TOKEN` | warningToken missing, expired, hoặc không match meetingId/userId |
| 400 | `INVALID_MEETING_STATUS` | Meeting không ở scheduled/in_progress |
| 403 | `FORBIDDEN_ACCESS` | Không có quyền (private meeting, không phải organizer/host/admin) |
| 404 | `MEETING_NOT_FOUND` | meetingId không tồn tại |
| 404 | `USER_NOT_FOUND` | userId không tồn tại hoặc inactive |
| 409 | `PARTICIPANT_ALREADY_EXISTS` | User đã là participant |
| 422 | `WARNING_CONFIRMATION_REQUIRED` | Soft warning + lần gọi đầu |
| 422 | `ROOM_CAPACITY_EXCEEDED` | Hard block capacity |
