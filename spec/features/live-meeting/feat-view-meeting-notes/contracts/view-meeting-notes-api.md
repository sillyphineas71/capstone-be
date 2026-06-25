# API Contract: Xem ghi chú trong cuộc họp (View Meeting Notes)

## CHANGELOG

| Ngày | Tóm tắt |
|------|---------|
| 2026-06-18 | Tạo API contract cho UC-IMM-10 View Meeting Notes |

- **UC ID**: UC-IMM-10
- **Module**: `live-meeting`
- **Permission**: `meeting.note.read`
- **Async**: No (synchronous SELECT)

---

## Endpoint

`GET /api/v1/meetings/{meetingId}/notes`

---

## Path Parameters

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `meetingId` | UUID | Yes | ID cuộc họp cần xem ghi chú |

> Validate bằng `ParseUUIDPipe`. Sai format → 400 `VALIDATION_ERROR`.

---

## Query Parameters

| Field | Type | Required | Default | Rule |
|-------|------|----------|---------|------|
| `noteType` | string | No | — | Allowlist: `in_meeting` \| `private` \| `host_note` \| `system_note` |
| `visibility` | string | No | — | Allowlist: `private` \| `participants` \| `public_internal` \| `department` — áp SAU role-based visibility |
| `pinned` | boolean | No | — | `true` = chỉ ghim; `false` = chỉ không ghim |
| `from` | string (ISO 8601) | No | — | `created_at >= from` (inclusive); **có thể gửi độc lập không cần `to`** |
| `to` | string (ISO 8601) | No | — | `created_at <= to` (inclusive); **có thể gửi độc lập không cần `from`** |
| `includeSourceEvent` | boolean | No | `false` | `true` = enrich `sourceEventTime` + `sourceEventType` từ `meeting_events` |
| `page` | number | No | `1` | ≥ 1 |
| `limit` | number | No | `20` | 1..100 (400 nếu > 100) |
| `sort` | string | No | `timeline_asc` | `timeline_asc` \| `timeline_desc` |

> **`from`/`to` độc lập (CD-003)**: Chỉ `from` → filter `created_at >= from`. Chỉ `to` → filter `created_at <= to`. Cả hai → validate `from <= to`; nếu `from > to` → 400 `INVALID_DATE_RANGE`.

> **`includeSourceEvent` (CD-001)**: Mặc định `false` — không JOIN `meeting_events`. Khi `true` và note có `source_event_id`, response bổ sung `sourceEventTime` và `sourceEventType`.

---

## Response

### 200 — Thành công (có dữ liệu, không `includeSourceEvent`)

```json
{
  "success": true,
  "message": "Lấy danh sách ghi chú thành công",
  "data": [
    {
      "id": "3fa85f64-5717-4562-b3fc-2c963f66afa6",
      "meetingId": "7e1a2b3c-4d5e-6f7a-8b9c-0d1e2f3a4b5c",
      "noteType": "in_meeting",
      "content": "Quyết định: Triển khai module X vào Q3",
      "pinned": true,
      "visibilityLevel": "participants",
      "author": {
        "id": "1a2b3c4d-5e6f-7a8b-9c0d-1e2f3a4b5c6d",
        "fullName": "Nguyễn Văn A"
      },
      "sourceEventId": null,
      "noteTimestamp": "2026-06-18T09:45:00+07:00",
      "updatedAt": "2026-06-18T09:45:00+07:00"
    },
    {
      "id": "4fb96a75-6828-5673-c4gd-3d074g77bgb7",
      "meetingId": "7e1a2b3c-4d5e-6f7a-8b9c-0d1e2f3a4b5c",
      "noteType": "private",
      "content": "Ghi chú cá nhân của tôi về vấn đề X",
      "pinned": false,
      "visibilityLevel": "private",
      "author": {
        "id": "1a2b3c4d-5e6f-7a8b-9c0d-1e2f3a4b5c6d",
        "fullName": "Nguyễn Văn A"
      },
      "sourceEventId": null,
      "noteTimestamp": "2026-06-18T09:50:00+07:00",
      "updatedAt": "2026-06-18T09:50:00+07:00"
    }
  ],
  "meta": {
    "page": 1,
    "limit": 20,
    "total": 8,
    "totalPages": 1
  }
}
```

### 200 — Thành công (có dữ liệu, với `?includeSourceEvent=true`)

```json
{
  "success": true,
  "message": "Lấy danh sách ghi chú thành công",
  "data": [
    {
      "id": "3fa85f64-5717-4562-b3fc-2c963f66afa6",
      "meetingId": "7e1a2b3c-4d5e-6f7a-8b9c-0d1e2f3a4b5c",
      "noteType": "in_meeting",
      "content": "Quyết định ngay sau khi họp bắt đầu",
      "pinned": false,
      "visibilityLevel": "participants",
      "author": {
        "id": "1a2b3c4d-5e6f-7a8b-9c0d-1e2f3a4b5c6d",
        "fullName": "Nguyễn Văn A"
      },
      "sourceEventId": "5gc07b86-7939-6784-d5he-4e185h88chc8",
      "sourceEventTime": "2026-06-18T09:43:00+07:00",
      "sourceEventType": "meeting_started",
      "noteTimestamp": "2026-06-18T09:45:00+07:00",
      "updatedAt": "2026-06-18T09:45:00+07:00"
    }
  ],
  "meta": {
    "page": 1,
    "limit": 20,
    "total": 1,
    "totalPages": 1
  }
}
```

> Khi `source_event_id` có giá trị nhưng `meeting_events` record không tìm thấy: `sourceEventTime = null`, `sourceEventType = null`.

### 200 — Empty State

```json
{
  "success": true,
  "message": "Cuộc họp này không có ghi chú nào được lưu lại.",
  "data": [],
  "meta": {
    "page": 1,
    "limit": 20,
    "total": 0,
    "totalPages": 0
  }
}
```

---

## Error Responses

### 400 — VALIDATION_ERROR

```json
{
  "success": false,
  "message": "Dữ liệu không hợp lệ",
  "error": {
    "code": "VALIDATION_ERROR",
    "details": { "field": "from", "message": "from must be a valid ISO 8601 date string" }
  },
  "timestamp": "2026-06-18T09:45:00.000Z",
  "path": "/api/v1/meetings/7e1a2b3c.../notes"
}
```

> Áp dụng khi: `meetingId` sai UUID format; `from`/`to` sai ISO datetime; `noteType`/`visibility`/`sort` ngoài allowlist; `limit > 100`.

### 400 — INVALID_DATE_RANGE (CD-003)

```json
{
  "success": false,
  "message": "Giá trị 'from' phải nhỏ hơn hoặc bằng 'to'",
  "error": {
    "code": "INVALID_DATE_RANGE",
    "details": { "from": "2026-06-18T11:00:00Z", "to": "2026-06-18T09:00:00Z" }
  },
  "timestamp": "2026-06-18T09:45:00.000Z",
  "path": "/api/v1/meetings/7e1a2b3c.../notes"
}
```

### 401 — UNAUTHORIZED

```json
{
  "success": false,
  "message": "Chưa xác thực",
  "error": { "code": "UNAUTHORIZED", "details": {} },
  "timestamp": "2026-06-18T09:45:00.000Z",
  "path": "/api/v1/meetings/7e1a2b3c.../notes"
}
```

### 403 — PERMISSION_DENIED

```json
{
  "success": false,
  "message": "Không có quyền thực hiện thao tác này",
  "error": { "code": "PERMISSION_DENIED", "details": {} },
  "timestamp": "2026-06-18T09:45:00.000Z",
  "path": "/api/v1/meetings/7e1a2b3c.../notes"
}
```

### 403 — NOT_A_MEETING_PARTICIPANT (CD-002)

```json
{
  "success": false,
  "message": "Bạn không có quyền xem ghi chú của cuộc họp này.",
  "error": {
    "code": "NOT_A_MEETING_PARTICIPANT",
    "details": { "meetingId": "7e1a2b3c-4d5e-6f7a-8b9c-0d1e2f3a4b5c" }
  },
  "timestamp": "2026-06-18T09:45:00.000Z",
  "path": "/api/v1/meetings/7e1a2b3c.../notes"
}
```

> Áp dụng kể cả với System Admin / Manager không phải Host hoặc Participant của meeting cụ thể này.

### 404 — MEETING_NOT_FOUND

```json
{
  "success": false,
  "message": "Không tìm thấy cuộc họp",
  "error": {
    "code": "MEETING_NOT_FOUND",
    "details": { "meetingId": "7e1a2b3c-4d5e-6f7a-8b9c-0d1e2f3a4b5c" }
  },
  "timestamp": "2026-06-18T09:45:00.000Z",
  "path": "/api/v1/meetings/7e1a2b3c.../notes"
}
```

### 422 — MEETING_STATUS_NOT_VIEWABLE

```json
{
  "success": false,
  "message": "Cuộc họp không ở trạng thái phù hợp để xem ghi chú",
  "error": {
    "code": "MEETING_STATUS_NOT_VIEWABLE",
    "details": {
      "meetingId": "7e1a2b3c-4d5e-6f7a-8b9c-0d1e2f3a4b5c",
      "currentStatus": "scheduled",
      "allowedStatuses": ["in_progress", "completed"]
    }
  },
  "timestamp": "2026-06-18T09:45:00.000Z",
  "path": "/api/v1/meetings/7e1a2b3c.../notes"
}
```

---

## Error Code Summary

| Code | HTTP | Mô tả |
|------|------|-------|
| `VALIDATION_ERROR` | 400 | Format sai, ngoài allowlist, `limit > 100`, `meetingId` sai UUID |
| `INVALID_DATE_RANGE` | 400 | Cả `from` và `to` được cung cấp nhưng `from > to` (CD-003) |
| `UNAUTHORIZED` | 401 | Chưa xác thực / JWT không hợp lệ |
| `PERMISSION_DENIED` | 403 | Thiếu permission `meeting.note.read` |
| `NOT_A_MEETING_PARTICIPANT` | 403 | Có permission nhưng không phải Host/Participant của meeting này (CD-002) |
| `MEETING_NOT_FOUND` | 404 | Meeting không tồn tại hoặc đã soft-deleted |
| `MEETING_STATUS_NOT_VIEWABLE` | 422 | Meeting không phải `in_progress` hoặc `completed` |
| `INTERNAL_ERROR` | 500 | Lỗi server không xác định |

---

## Notes

- Response field `noteTimestamp` ánh xạ từ `meeting_notes.created_at` (CD-001). **Không dùng `createdAt`**.
- `sourceEventTime` và `sourceEventType` chỉ xuất hiện trong response khi `?includeSourceEvent=true` (CD-001).
- `visibility` filter từ query param **không** override role-based visibility. Participant gửi `?visibility=private` chỉ nhận private notes của chính mình.
- `from` và `to` có thể gửi độc lập. Chỉ khi cả hai có giá trị mới validate cross-field (CD-003).
- Endpoint này dùng chung với UC-103 (GET notes `in_progress`) và UC-104 (FTS `?q`). UC-IMM-10 là spec canonical — mọi chi tiết implementation tham chiếu spec.md của UC-IMM-10.
