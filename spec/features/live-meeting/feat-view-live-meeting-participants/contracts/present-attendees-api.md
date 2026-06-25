# API Contract: View Live Meeting Participants

**Endpoint**: GET /api/v1/live-meetings/{meetingId}/present-attendees
**Feature**: UC-IMM-07 | **Permission**: meeting.presence.read

---

## 1. Request

### Path Parameters

| Field | Type | Required | Description |
|---|---|---|---|
| meetingId | UUID (v4) | Yes | ID cua cuoc hop |

### Query Parameters

| Field | Type | Required | Default | Description | Validation |
|---|---|---|---|---|---|
| search | string | No | - | Tim kiem full_name/email | Trim, max 100 chars |
| departmentId | UUID | No | - | Loc phong ban | UUID format |
| page | integer | No | 1 | So trang | >= 1 |
| limit | integer | No | 20 | So ban ghi | 1-100 |
| sortBy | string | No | full_name | Truong sap xep | Allowlist |
| sortOrder | string | No | asc | asc/desc | asc, desc |

### Headers

Authorization: Bearer <JWT token>

---

## 2. Response 200 - Host/Admin full access

```json
{
  "success": true,
  "message": "Danh sach nguoi tham du dang co mat",
  "data": {
    "meetingId": "uuid",
    "occupancyCount": 5,
    "presentUsers": [
      {
        "userId": "uuid",
        "fullName": "Nguyen Van A",
        "email": "nva@company.com",
        "departmentId": "uuid",
        "departmentName": "Phong IT",
        "avatarUrl": "https://...",
        "participantRole": "host",
        "presenceStatus": "present",
        "presenceSource": "room_camera",
        "confidenceScore": 0.95,
        "checkInTime": "2026-06-17T09:00:00+07:00",
        "joinedAt": "2026-06-17T09:00:00+07:00",
        "lastSeenAt": "2026-06-17T09:50:30+07:00"
      }
    ],
    "updatedAt": "2026-06-17T09:50:30+07:00"
  },
  "meta": {
    "page": 1,
    "limit": 20,
    "total": 8,
    "totalPages": 1
  }
}
```

## 3. Response 200 - Participant limited view

```json
{
  "success": true,
  "message": "Danh sach nguoi tham du dang co mat",
  "data": {
    "meetingId": "uuid",
    "occupancyCount": 5,
    "presentUsers": [
      {
        "userId": "uuid",
        "fullName": "Nguyen Van A",
        "departmentName": "Phong IT",
        "avatarUrl": "https://...",
        "participantRole": "host",
        "presenceStatus": "present",
        "presenceSource": null,
        "confidenceScore": null,
        "checkInTime": null,
        "joinedAt": null,
        "lastSeenAt": null
      }
    ],
    "updatedAt": "2026-06-17T09:50:30+07:00"
  },
  "meta": {
    "page": 1,
    "limit": 20,
    "total": 8,
    "totalPages": 1
  }
}
```

## 4. Error Responses

### 400 INVALID_QUERY

```json
{
  "success": false, "message": "Search query vuot qua 100 ky tu",
  "error": { "code": "INVALID_QUERY", "details": { "field": "search", "reason": "max_length_100" } },
  "timestamp": "...", "path": "/api/v1/live-meetings/{meetingId}/present-attendees"
}
```

### 401 UNAUTHORIZED

```json
{
  "success": false, "message": "Chua xac thuc",
  "error": { "code": "UNAUTHORIZED", "details": {} },
  "timestamp": "...", "path": "..."
}
```

### 403 FORBIDDEN_LIVE_PARTICIPANTS_ACCESS

```json
{
  "success": false, "message": "Ban khong co quyen xem danh sach nguoi tham du",
  "error": { "code": "FORBIDDEN_LIVE_PARTICIPANTS_ACCESS", "details": {} },
  "timestamp": "...", "path": "..."
}
```

### 404 MEETING_NOT_FOUND

```json
{
  "success": false, "message": "Khong tim thay cuoc hop",
  "error": { "code": "MEETING_NOT_FOUND", "details": {} },
  "timestamp": "...", "path": "..."
}
```

### 409 MEETING_NOT_IN_PROGRESS

```json
{
  "success": false, "message": "Cuoc hop chua dien ra hoac da ket thuc",
  "error": { "code": "MEETING_NOT_IN_PROGRESS", "details": { "currentStatus": "scheduled" } },
  "timestamp": "...", "path": "..."
}
```

### 500 INTERNAL_ERROR

```json
{
  "success": false, "message": "Loi he thong",
  "error": { "code": "INTERNAL_ERROR", "details": {} },
  "timestamp": "...", "path": "..."
}
```

## 5. Business Rules

1. Chi Host cua meeting, Business Admin, System Admin moi co quyen xem full details
2. Participant thuong chi thay fullName, departmentName, participantRole, presenceStatus, avatarUrl
3. Participant thay presenceSource + checkInTime cua chinh minh
4. Khong thay confidenceScore cua bat ky ai (ke ca cua minh)
5. External participants bi loai khoi response
6. Meeting scheduled duoc xem neu now trong [start_time, end_time + 30m]
