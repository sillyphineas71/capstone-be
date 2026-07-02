# API Contract: Create Draft Meeting Minutes

## 📝 CHANGELOG & REVISION HISTORY
| Ngày cập nhật | Tóm tắt thay đổi | Các dòng thay đổi |
| :--- | :--- | :--- |
| 2026-07-02 | Khởi tạo contract cho feat-create-draft-meeting-minutes | Toàn bộ file |

## `POST /api/v1/meetings/:meetingId/minutes`

### Auth
- Header: `Authorization: Bearer <JWT>`
- Permission required: `meeting.minutes.create`
- Ownership required: caller phải là `meetings.host_id` của `meetingId`

### Path Params
| Param | Type | Bắt buộc | Mô tả |
| :--- | :--- | :--- | :--- |
| `meetingId` | UUID | Có | ID cuộc họp |

### Request Body
```jsonc
{
  "title": "string, optional, max 255"
}
```

### Success Response — `201 Created`
```jsonc
{
  "success": true,
  "message": "Bien ban hop nhap da duoc tao thanh cong",
  "data": {
    "id": "3f9c9a2e-....",
    "meetingId": "b1a2c3d4-....",
    "title": "Biên bản họp: Họp review Sprint 12",
    "status": "draft",
    "visibilityLevel": "private",
    "versionNo": 1,
    "minutesContent": "1. Thành phần tham dự\n2. Nội dung\n3. Kết luận\n4. Đầu việc",
    "preparedBy": "u-host-uuid",
    "createdAt": "2026-07-02T09:15:00.000Z",
    "meetingSnapshot": {
      "meetingTitle": "Họp review Sprint 12",
      "actualStartTime": "2026-07-02T09:00:00.000Z",
      "actualEndTime": null,
      "roomId": "room-uuid",
      "meetingStatus": "in_progress",
      "attendees": [
        {
          "userId": "u-1",
          "participantRole": "host",
          "attendanceStatus": "present",
          "joinedAt": "2026-07-02T09:00:00.000Z",
          "leftAt": null
        },
        {
          "userId": "u-2",
          "participantRole": "attendee",
          "attendanceStatus": "not_checked_in",
          "joinedAt": null,
          "leftAt": null
        }
      ]
    }
  }
}
```

### Error Responses

#### `400 Bad Request` — VALIDATION_ERROR
```jsonc
{
  "success": false,
  "message": "Du lieu khong hop le",
  "error": { "code": "VALIDATION_ERROR", "details": { "title": "must be shorter than or equal to 255 characters" } },
  "timestamp": "...",
  "path": "/api/v1/meetings/:meetingId/minutes"
}
```

#### `401 Unauthorized`
Không có/JWT không hợp lệ.

#### `403 Forbidden` — FORBIDDEN
Thiếu permission `meeting.minutes.create`.

#### `403 Forbidden` — NOT_MEETING_HOST
```jsonc
{
  "success": false,
  "message": "Chỉ Host của cuộc họp mới được tạo biên bản họp",
  "error": { "code": "NOT_MEETING_HOST", "details": { "meetingId": "..." } }
}
```

#### `404 Not Found` — MEETING_NOT_FOUND
```jsonc
{
  "success": false,
  "message": "Cuộc họp không tồn tại hoặc đã bị xóa",
  "error": { "code": "MEETING_NOT_FOUND", "details": { "meetingId": "..." } }
}
```

#### `409 Conflict` — MEETING_HOST_NOT_ASSIGNED
```jsonc
{
  "success": false,
  "message": "Cuộc họp chưa được gán Host, không thể tạo biên bản họp",
  "error": { "code": "MEETING_HOST_NOT_ASSIGNED", "details": { "meetingId": "..." } }
}
```

#### `409 Conflict` — MEETING_NOT_STARTED
```jsonc
{
  "success": false,
  "message": "Cuộc họp chưa bắt đầu, chưa thể tạo biên bản họp",
  "error": { "code": "MEETING_NOT_STARTED", "details": { "meetingId": "...", "currentStatus": "scheduled" } }
}
```

#### `409 Conflict` — MEETING_CANCELLED
```jsonc
{
  "success": false,
  "message": "Cuộc họp đã bị hủy, không thể tạo biên bản họp",
  "error": { "code": "MEETING_CANCELLED", "details": { "meetingId": "..." } }
}
```

#### `409 Conflict` — MINUTES_ALREADY_EXISTS
```jsonc
{
  "success": false,
  "message": "Cuộc họp này đã có biên bản họp",
  "error": { "code": "MINUTES_ALREADY_EXISTS", "details": { "meetingId": "...", "existingMinutesId": "..." } }
}
```

### HTTP Status Summary
| Status | Trường hợp |
| :--- | :--- |
| 201 | Tạo thành công |
| 400 | Validation error |
| 401 | Chưa đăng nhập |
| 403 | Không đủ quyền / không phải Host |
| 404 | Meeting không tồn tại |
| 409 | Conflict nghiệp vụ (status/host/duplicate) |
