# API Contract: Thêm / Xem / Tìm kiếm ghi chú trong cuộc họp (In-Meeting Notes)

- **UC ID**: UC-102 (tạo), UC-103 (xem), UC-104 (tìm kiếm) — API_CONTRACT_v1.0_with_system_roles.md
- **Module**: live-meeting
- **System Role**: `INTERNAL_USER`, `MANAGER`, `BUSINESS_ADMIN`, `SYSTEM_ADMIN`
- **Async**: No (transactional cho POST)

---

## 1. UC-102 — Tạo ghi chú

`POST /api/v1/meetings/{meetingId}/notes`
**Permission**: `meeting.note.create`

### Path Parameters

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `meetingId` | UUID | Yes | ID cuộc họp đang `in_progress` |

### Request Body

| Field | Type | Required | Default | Rule |
|-------|------|----------|---------|------|
| `noteType` | string | Yes | — | `in_meeting` \| `private` \| `host_note` (cấm `system_note`) |
| `content` | string | Yes | — | không rỗng/whitespace; max 10.000 ký tự; sanitize XSS |
| `pinned` | boolean | No | `false` | `true` chỉ Host |
| `visibilityLevel` | string | No | theo `noteType` | `private` \| `participants` \| `department` \| `public_internal` |

```json
{
  "noteType": "in_meeting",
  "content": "Quyết định: Triển khai module X vào Q3",
  "pinned": false,
  "visibilityLevel": "participants"
}
```

> Các field như `createdAt`, `authorId`, `created_at`, `author_id` **không** được chấp nhận (global pipe `forbidNonWhitelisted` → 400). `created_at`/`author_id` do server gán (BR-002, FR-003).

### Response 201

```json
{
  "success": true,
  "message": "Tạo ghi chú thành công",
  "data": {
    "id": "uuid",
    "meetingId": "uuid",
    "noteType": "in_meeting",
    "content": "Quyết định: Triển khai module X vào Q3",
    "pinned": false,
    "visibilityLevel": "participants",
    "author": { "id": "uuid", "fullName": "Nguyễn Văn A" },
    "createdAt": "2026-06-17T09:45:00+07:00"
  }
}
```

---

## 2. UC-103 / UC-104 — Xem & Tìm kiếm ghi chú

`GET /api/v1/meetings/{meetingId}/notes`
**Permission**: `meeting.note.read`

> Một route phục vụ cả 2 UC: có `?q` ⇒ full-text search (UC-104); không có `?q` ⇒ list/filter (UC-103). Cả hai đều áp **visibility filter**.

### Query Parameters

| Field | Type | Required | Default | Rule |
|-------|------|----------|---------|------|
| `noteType` | string | No | — | filter theo loại note (FR-015) |
| `pinned` | boolean | No | — | filter theo ghim (FR-015) |
| `q` | string | No | — | từ khóa full-text (max 200 ký tự) (FR-017) |
| `page` | number | No | `1` | ≥ 1 |
| `limit` | number | No | `20` | 1..100 |

### Response 200

```json
{
  "success": true,
  "message": "Lấy danh sách ghi chú thành công",
  "data": [
    {
      "id": "uuid",
      "meetingId": "uuid",
      "noteType": "in_meeting",
      "content": "…",
      "pinned": true,
      "visibilityLevel": "participants",
      "author": { "id": "uuid", "fullName": "Nguyễn Văn A" },
      "createdAt": "2026-06-17T09:45:00+07:00"
    }
  ],
  "meta": { "page": 1, "limit": 20, "total": 12, "totalPages": 1 }
}
```

- Chỉ trả note user hiện tại được phép đọc theo `visibility_level` (BR-008, FR-014, FR-018).
- Không trả note `deleted_at IS NOT NULL` (BR-010, FR-016).

---

## Error Responses (dùng chung)

#### 400 — Validation Error
```json
{ "success": false, "message": "Dữ liệu không hợp lệ", "error": { "code": "VALIDATION_ERROR", "details": { "field": "content" } } }
```

#### 401 — Unauthorized
```json
{ "success": false, "message": "Chưa xác thực", "error": { "code": "UNAUTHORIZED", "details": {} } }
```

#### 403 — Forbidden (thiếu permission)
```json
{ "success": false, "message": "Không có quyền", "error": { "code": "PERMISSION_DENIED", "details": {} } }
```

#### 403 — Host only
```json
{ "success": false, "message": "Chỉ Host được tạo ghi chú loại host_note", "error": { "code": "NOTE_HOST_ONLY", "details": { "noteType": "host_note" } } }
```

#### 404 — Not Found
```json
{ "success": false, "message": "Không tìm thấy cuộc họp", "error": { "code": "MEETING_NOT_FOUND", "details": { "meetingId": "uuid" } } }
```

#### 409 — Meeting not in progress
```json
{ "success": false, "message": "Cuộc họp không ở trạng thái đang diễn ra", "error": { "code": "MEETING_NOT_IN_PROGRESS", "details": { "meetingId": "uuid", "currentStatus": "completed" } } }
```

#### 422 — System note forbidden
```json
{ "success": false, "message": "Không được tạo ghi chú loại system_note", "error": { "code": "NOTE_SYSTEM_TYPE_FORBIDDEN", "details": { "noteType": "system_note" } } }
```

---

## Error Codes

| Code | HTTP | Meaning |
|------|------|---------|
| VALIDATION_ERROR | 400 | `content` rỗng; `visibilityLevel`/`noteType` ngoài allowlist; query sai; field cấm |
| UNAUTHORIZED | 401 | Chưa đăng nhập |
| PERMISSION_DENIED | 403 | Thiếu `meeting.note.create` / `meeting.note.read` |
| NOTE_HOST_ONLY | 403 | Non-host gửi `noteType = host_note` |
| MEETING_NOT_FOUND | 404 | `meetingId` không tồn tại |
| MEETING_NOT_IN_PROGRESS | 409 | Meeting không ở `in_progress` (EC-001) |
| NOTE_SYSTEM_TYPE_FORBIDDEN | 422 | Client gửi `noteType = system_note` |
| INTERNAL_ERROR | 500 | Lỗi server không xác định |
