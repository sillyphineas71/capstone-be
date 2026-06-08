# 📝 CHANGELOG & REVISION HISTORY
| Ngày cập nhật | Tóm tắt thay đổi | Các dòng thay đổi |
| :--- | :--- | :--- |
| 2026-06-08 | Tạo contract lần đầu | Toàn bộ file |

# API Contract: Tạo cuộc họp mới thủ công

**Feature**: MEETING-CREATE-MANUAL-001
**Date**: 2026-06-08
**Module**: meetings

---

## 1. Create Meeting Request

### POST /api/v1/meetings

Tạo một yêu cầu cuộc họp mới ở trạng thái chờ duyệt (pending_approval).

**Authentication**: Required
**Authorization**: `meeting.create`

### Request Body

```json
{
  "title": "Họp dự án Q1",
  "description": "Bàn về kế hoạch quý 1",
  "host_id": "uuid-v4-optional",
  "start_time": "2026-06-10T09:00:00.000Z",
  "end_time": "2026-06-10T10:00:00.000Z",
  "room_id": "uuid-phong-hop",
  "meeting_type": "normal",
  "meeting_mode": "offline",
  "expected_attendee_count": 10,
  "capacity_override_confirmed": false,
  "participant_user_ids": [
    "uuid-user-1",
    "uuid-user-2"
  ],
  "external_participants": [
    {
      "full_name": "Nguyễn Văn A",
      "email": "a@example.com",
      "organization": "Công ty XYZ"
    }
  ]
}
```

### Field Validation

| Field | Type | Required | Validation |
|-------|------|----------|------------|
| `title` | string | ✅ | 1-255 chars, not blank |
| `description` | string | ❌ | Max 2000 chars |
| `host_id` | uuid | ❌ | If provided, must be active user; defaults to authenticated user |
| `start_time` | ISO 8601 | ✅ | Must be in future (> now) |
| `end_time` | ISO 8601 | ✅ | Must be > start_time |
| `room_id` | uuid | ✅ | Must exist, active, and available |
| `meeting_type` | enum | ❌ | Default `normal` |
| `meeting_mode` | enum | ❌ | Default `offline` |
| `expected_attendee_count` | integer | ❌ | >= 1 |
| `capacity_override_confirmed` | boolean | ❌ | Default `false` |
| `participant_user_ids` | array[uuid] | ❌ | Can be empty (host auto-added); each UUID must be valid |
| `external_participants` | array[object] | ❌ | Each: `full_name` (string), `email` (valid format), `organization` (optional) |

### Success Response (201)

```json
{
  "success": true,
  "message": "Yêu cầu cuộc họp đã được tạo thành công và đang chờ duyệt",
  "data": {
    "id": "uuid-meeting",
    "meeting_code": "MT-20260608-001",
    "title": "Họp dự án Q1",
    "status": "pending_approval",
    "approval_status": "pending",
    "start_time": "2026-06-10T09:00:00.000Z",
    "end_time": "2026-06-10T10:00:00.000Z",
    "room_id": "uuid-phong-hop",
    "room_name": "Phòng họp A",
    "organizer_id": "uuid-nguoi-tao",
    "host_id": "uuid-host",
    "participant_count": 4,
    "booking_status": "pending",
    "booking_code": "BK-20260608-001",
    "created_at": "2026-06-08T12:00:00.000Z"
  }
}
```

### Error Responses

#### 400 — Validation Error
```json
{
  "success": false,
  "message": "Dữ liệu đầu vào không hợp lệ",
  "error": {
    "code": "VALIDATION_ERROR",
    "details": {
      "title": "Tiêu đề cuộc họp không được để trống",
      "start_time": "Thời gian bắt đầu phải ở định dạng ISO 8601"
    }
  },
  "timestamp": "2026-06-08T12:00:00.000Z",
  "path": "/api/v1/meetings"
}
```

#### 401 — Unauthenticated
```json
{
  "success": false,
  "message": "Unauthenticated",
  "error": {
    "code": "UNAUTHENTICATED",
    "details": {}
  },
  "timestamp": "2026-06-08T12:00:00.000Z",
  "path": "/api/v1/meetings"
}
```

#### 403 — Forbidden (missing permission)
```json
{
  "success": false,
  "message": "Forbidden",
  "error": {
    "code": "FORBIDDEN",
    "details": {}
  },
  "timestamp": "2026-06-08T12:00:00.000Z",
  "path": "/api/v1/meetings"
}
```

#### 404 — Room Not Found
```json
{
  "success": false,
  "message": "Phòng họp không tồn tại hoặc không khả dụng",
  "error": {
    "code": "ROOM_NOT_FOUND",
    "details": {}
  },
  "timestamp": "2026-06-08T12:00:00.000Z",
  "path": "/api/v1/meetings"
}
```

#### 409 — Room Conflict
```json
{
  "success": false,
  "message": "Phòng họp này vừa được đặt. Vui lòng chọn một phòng khác hoặc đổi khung giờ.",
  "error": {
    "code": "ROOM_CONFLICT",
    "details": {
      "conflicting_booking_id": "uuid"
    }
  },
  "timestamp": "2026-06-08T12:00:00.000Z",
  "path": "/api/v1/meetings"
}
```

#### 422 — Capacity Exceeded
```json
{
  "success": false,
  "message": "Số lượng người tham dự vượt quá sức chứa của phòng",
  "error": {
    "code": "CAPACITY_EXCEEDED",
    "details": {
      "capacity": 10,
      "participant_count": 12
    }
  },
  "timestamp": "2026-06-08T12:00:00.000Z",
  "path": "/api/v1/meetings"
}
```

#### 500 — Internal Server Error
```json
{
  "success": false,
  "message": "Đã xảy ra lỗi hệ thống. Vui lòng thử lại sau.",
  "error": {
    "code": "INTERNAL_ERROR",
    "details": {}
  },
  "timestamp": "2026-06-08T12:00:00.000Z",
  "path": "/api/v1/meetings"
}
```

---

## 2. Check Room Availability

### GET /api/v1/rooms/available?start_time=...&end_time=...&room_id=...

Used by frontend to filter available rooms when selecting time.

**Response (200):**
```json
{
  "success": true,
  "message": "Danh sách phòng khả dụng",
  "data": [
    {
      "id": "uuid",
      "name": "Phòng họp A",
      "capacity": 10,
      "floor": "2",
      "equipment": ["projector", "speakerphone"]
    }
  ]
}
```

---

## 3. Error Codes Reference

| HTTP | Code | Condition |
|------|------|-----------|
| 400 | `VALIDATION_ERROR` | Input validation failed |
| 401 | `UNAUTHENTICATED` | No valid JWT |
| 403 | `FORBIDDEN` | Missing `meeting.create` permission |
| 404 | `ROOM_NOT_FOUND` | Room doesn't exist or inactive |
| 409 | `ROOM_CONFLICT` | Room already booked in time range |
| 422 | `CAPACITY_EXCEEDED` | Participant count > room capacity (without override) |
| 500 | `INTERNAL_ERROR` | Unexpected system error |
