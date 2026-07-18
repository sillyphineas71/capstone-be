# API Contract: Delete Single Meeting Agenda Item

## 📝 CHANGELOG & REVISION HISTORY
| Ngày cập nhật | Tóm tắt thay đổi | Các dòng thay đổi |
| :--- | :--- | :--- |
| 2026-07-17 | API contract cho UC-MM-11 (UC-29) | Toàn bộ file |

---

## Endpoint

**DELETE** `/api/v1/meetings/{meetingId}/agendas/{agendaId}`

## Path Parameters

| Parameter | Type | Required | Description |
|---|---|---|---|
| `meetingId` | UUID v4 | Yes | ID của cuộc họp |
| `agendaId` | UUID v4 | Yes | ID của agenda item cần xóa |

## Request Body

Không có request body.

### Example Request

```
DELETE /api/v1/meetings/a1b2c3d4-e5f6-7890-abcd-ef1234567890/agendas/c3d4e5f6-a7b8-9012-cdef-123456789012
```

## Responses

### 200 OK — Delete successful

```json
{
  "success": true,
  "message": "Xoa muc agenda thanh cong",
  "data": {
    "deleted": true,
    "agendaId": "c3d4e5f6-a7b8-9012-cdef-123456789012",
    "meetingId": "a1b2c3d4-e5f6-7890-abcd-ef1234567890",
    "totalPlannedDurationMinutes": 35,
    "remainingDurationMinutes": 25,
    "remainingItemCount": 2
  }
}
```

### 401 Unauthorized

```json
{ "code": "UNAUTHORIZED", "message": "Vui lòng đăng nhập để tiếp tục." }
```

### 403 Forbidden

```json
{ "code": "AGENDA_WRITE_FORBIDDEN", "message": "Bạn không có quyền chỉnh sửa chương trình họp này." }
```

### 404 Not Found

```json
{
  "code": "MEETING_NOT_FOUND",
  "message": "Không tìm thấy cuộc họp."
}
```

```json
{
  "code": "AGENDA_ITEM_NOT_FOUND",
  "message": "Không tìm thấy mục agenda trong cuộc họp này.",
  "details": { "meetingId": "uuid", "agendaId": "uuid" }
}
```

### 409 Conflict

```json
{
  "code": "AGENDA_MEETING_STATUS_BLOCKED",
  "message": "Chỉ có thể chỉnh sửa chương trình họp khi cuộc họp đang ở trạng thái Đã lên lịch.",
  "details": { "meetingId": "uuid", "currentStatus": "in_progress", "allowedStatus": "scheduled" }
}
```

## Idempotency Note

Endpoint này **không** idempotent theo nghĩa "trả cùng kết quả 200" — gọi lần đầu trả `200` và xóa item; gọi lần thứ hai với cùng `agendaId` trả `404 AGENDA_ITEM_NOT_FOUND` vì item đã không còn tồn tại. Đây là hành vi có chủ đích (xem `spec.md` mục 18 CL-02) để tránh che giấu race condition/double-submit khỏi client.
