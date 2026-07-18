# API Contract: Update Single Meeting Agenda Item

## 📝 CHANGELOG & REVISION HISTORY
| Ngày cập nhật | Tóm tắt thay đổi | Các dòng thay đổi |
| :--- | :--- | :--- |
| 2026-07-17 | API contract cho UC-MM-10 (UC-28) | Toàn bộ file |

---

## Endpoint

**PATCH** `/api/v1/meetings/{meetingId}/agendas/{agendaId}`

## Path Parameters

| Parameter | Type | Required | Description |
|---|---|---|---|
| `meetingId` | UUID v4 | Yes | ID của cuộc họp |
| `agendaId` | UUID v4 | Yes | ID của agenda item cần sửa |

## Request Body

Tất cả field optional, nhưng phải có **tối thiểu 1 field hợp lệ**.

```json
{
  "title": "Báo cáo sprint - cập nhật",
  "description": "Nội dung chi tiết mới",
  "ownerId": "b2c3d4e5-f6a7-8901-bcde-f12345678901",
  "plannedDurationMinutes": 45,
  "agendaOrder": 2
}
```

### Request Schema

| Field | Type | Required | Validation |
|---|---|---|---|
| `title` | string | No | 1-255 ký tự sau trim nếu có mặt |
| `description` | string \| null | No | Tối đa 2000 ký tự |
| `ownerId` | UUID \| null | No | Phải thuộc `meeting_participants` của meeting nếu không null |
| `plannedDurationMinutes` | integer | No | > 0 nếu có mặt |
| `agendaOrder` | integer | No | Trong khoảng [1, tổng số item hiện có] |

**Lưu ý**: Body **không được** chứa `status`, `actualDurationMinutes`, `resultNote`, `id`, `meetingId` — các field này bị `ValidationPipe({ forbidNonWhitelisted: true })` từ chối với 400.

### Example Requests

**Request 1** — Sửa chỉ title:
```
PATCH /api/v1/meetings/a1b2c3d4-e5f6-7890-abcd-ef1234567890/agendas/c3d4e5f6-a7b8-9012-cdef-123456789012
Content-Type: application/json

{ "title": "Báo cáo sprint - v2" }
```

**Request 2** — Đổi vị trí:
```
PATCH /api/v1/meetings/a1b2c3d4-e5f6-7890-abcd-ef1234567890/agendas/c3d4e5f6-a7b8-9012-cdef-123456789012
Content-Type: application/json

{ "agendaOrder": 1 }
```

## Responses

### 200 OK — Update successful

```json
{
  "success": true,
  "message": "Cap nhat chuong trinh hop thanh cong",
  "data": {
    "id": "c3d4e5f6-a7b8-9012-cdef-123456789012",
    "meetingId": "a1b2c3d4-e5f6-7890-abcd-ef1234567890",
    "agendaOrder": 1,
    "title": "Báo cáo sprint - v2",
    "description": "Nội dung chi tiết mới",
    "ownerId": "b2c3d4e5-f6a7-8901-bcde-f12345678901",
    "ownerName": "Nguyen Van A",
    "plannedDurationMinutes": 30,
    "status": "planned",
    "updatedAt": "2026-07-17T10:00:00.000Z",
    "totalPlannedDurationMinutes": 80,
    "remainingDurationMinutes": 10
  }
}
```

### 400 Bad Request

```json
{
  "code": "AGENDA_UPDATE_PAYLOAD_EMPTY",
  "message": "Yêu cầu cập nhật phải chứa ít nhất một trường hợp lệ.",
  "details": {}
}
```

```json
{
  "code": "AGENDA_INVALID_PAYLOAD",
  "message": "Dữ liệu gửi lên không hợp lệ.",
  "details": { "rejectedFields": ["status"] }
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
  "details": { "meetingId": "uuid", "currentStatus": "completed", "allowedStatus": "scheduled" }
}
```

### 422 Unprocessable Entity

```json
{
  "code": "AGENDA_DURATION_OVERFLOW",
  "message": "Tổng thời lượng phân bổ đang vượt quá quỹ thời gian của cuộc họp.",
  "details": { "meetingDurationMinutes": 60, "totalPlannedDurationMinutes": 75, "overflowMinutes": 15 }
}
```

```json
{
  "code": "AGENDA_INVALID_ORDER",
  "message": "Vị trí agenda không hợp lệ.",
  "details": { "agendaOrder": 9, "maxAllowed": 4 }
}
```
