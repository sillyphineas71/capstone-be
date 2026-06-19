# API Contract: Search Meeting Notes (UC-IMM-11 / UC-104)

## Endpoint

`GET /api/v1/meetings/{meetingId}/notes`

**Permission**: `meeting.note.read`
**Auth**: JWT required (`JwtAuthGuard` + `PermissionsGuard`)
**Async**: No

## Path Parameters

| Field | Type | Validation |
|-------|------|------------|
| `meetingId` | UUID | `ParseUUIDPipe` → 400 nếu sai format |

## Query Parameters

| Field | Type | Required | Default | Validation |
|-------|------|----------|---------|------------|
| `q` | string | No | — | Max 255 ký tự sau trim; trim whitespace trước xử lý |
| `authorId` | UUID | No | — | ParseUUIDPipe |
| `createdFrom` | string (ISO 8601) | No | — | IsDateString |
| `createdTo` | string (ISO 8601) | No | — | IsDateString |
| `noteType` | string | No | — | IsIn('in_meeting','private','host_note','system_note') |
| `visibility` | string | No | — | IsIn('private','participants','public_internal','department') |
| `pinned` | boolean | No | — | IsBoolean + Transform |
| `sort` | string | No | `timeline_asc` | IsIn('timeline_asc','timeline_desc') |
| `page` | number | No | 1 | IsInt, Min(1) |
| `limit` | number | No | 20 | IsInt, Min(1), Max(100) |

## Response 200 — Có kết quả

```json
{
  "success": true,
  "message": "Tìm kiếm ghi chú thành công",
  "data": [
    {
      "id": "uuid",
      "meetingId": "uuid",
      "noteType": "in_meeting",
      "content": "Quyết định: Triển khai module X vào Q3",
      "pinned": false,
      "visibilityLevel": "participants",
      "author": { "id": "uuid", "fullName": "Nguyễn Văn A" },
      "sourceEventId": null,
      "noteTimestamp": "2026-06-18T09:45:00+07:00",
      "updatedAt": "2026-06-18T09:45:00+07:00"
    }
  ],
  "meta": {
    "page": 1,
    "limit": 20,
    "total": 3,
    "totalPages": 1
  }
}
```

## Response 200 — Không có kết quả (Empty State)

```json
{
  "success": true,
  "message": "Không tìm thấy ghi chú nào khớp với điều kiện tìm kiếm của bạn.",
  "data": [],
  "meta": {
    "page": 1,
    "limit": 20,
    "total": 0,
    "totalPages": 0
  }
}
```

## Response 200 — Không có `?q=` (trả toàn bộ, behavior như UC-103 view)

```json
{
  "success": true,
  "message": "Lấy danh sách ghi chú thành công",
  "data": [],
  "meta": {
    "page": 1,
    "limit": 20,
    "total": 5,
    "totalPages": 1
  }
}
```

## Error Codes

| HTTP | Error Code | Description |
|------|------------|-------------|
| 400 | `VALIDATION_ERROR` | meetingId/authorId invalid UUID; from/to sai format; limit > 100; q > 255; noteType/visibility/sort ngoài allowlist |
| 400 | `INVALID_DATE_RANGE` | createdFrom > createdTo (khi cả hai được cung cấp) |
| 401 | `UNAUTHORIZED` | Chưa xác thực / JWT hết hạn |
| 403 | `PERMISSION_DENIED` | Thiếu permission meeting.note.read |
| 403 | `NOT_A_MEETING_PARTICIPANT` | Có permission nhưng không phải Host/Co-host/Participant |
| 404 | `MEETING_NOT_FOUND` | meetingId không tồn tại hoặc soft-deleted |
| 422 | `MEETING_STATUS_NOT_VIEWABLE` | Meeting không ở in_progress hoặc completed |
| 500 | `INTERNAL_ERROR` | Lỗi server |
