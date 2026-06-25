# API Contract: Ket thuc phien hop (End Meeting)

- **UC ID**: UC-98 (API_CONTRACT_v1.0)
- **Module**: live-meeting
- **Endpoint**: `POST /api/v1/live-meetings/{meetingId}/end`
- **Permission**: `meeting.session.end`
- **System Role**: `INTERNAL_USER`, `MANAGER`, `BUSINESS_ADMIN`, `SYSTEM_ADMIN`
- **Async**: No (transactional)

## Request

### Path Parameters

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| meetingId | UUID (v4) | Yes | ID cua cuoc hop can ket thuc |

### Request Body

Khong co request body cho manual flow.

## Response

### 200 - Thanh cong

```json
{
  "success": true,
  "message": "Phien hop da ket thuc thanh cong",
  "data": {
    "meetingId": "uuid",
    "status": "completed",
    "actualEndTime": "2026-06-10T10:28:00+07:00",
    "duration": 85,
    "roomReleased": true
  }
}
```

### Error Responses

#### 401 - Unauthorized
```json
{ "success": false, "message": "Chua xac thuc", "error": { "code": "UNAUTHORIZED", "details": {} } }
```

#### 403 - Forbidden
```json
{ "success": false, "message": "Khong co quyen", "error": { "code": "PERMISSION_DENIED", "details": {} } }
```

#### 404 - Not Found
```json
{ "success": false, "message": "Khong tim thay cuoc hop", "error": { "code": "MEETING_NOT_FOUND", "details": { "meetingId": "uuid" } } }
```

#### 409 - Business Rule Violation
```json
{
  "success": false,
  "message": "Cuoc hop da ket thuc truoc do",
  "error": {
    "code": "MEETING_ALREADY_COMPLETED",
    "details": {
      "meetingId": "uuid",
      "currentStatus": "completed",
      "actualEndTime": "2026-06-10T10:28:00+07:00"
    }
  }
}
```

#### 422 - Validation Error
```json
{ "success": false, "message": "ID cuoc hop khong hop le", "error": { "code": "VALIDATION_ERROR", "details": { "field": "meetingId" } } }
```

## Error Codes

| Code | HTTP | Meaning |
|------|------|---------|
| VALIDATION_ERROR | 422 | meetingId invalid format |
| UNAUTHORIZED | 401 | Chua dang nhap |
| PERMISSION_DENIED | 403 | Khong du quyen hoac khong phai Host |
| MEETING_NOT_FOUND | 404 | Meeting khong ton tai |
| MEETING_NOT_IN_PROGRESS | 409 | Meeting khong o trang thai IN_PROGRESS |
| MEETING_ALREADY_COMPLETED | 409 | Meeting da ket thuc truoc do (idempotent) |
| MEETING_NOT_STARTED | 409 | Meeting chua bat dau (SCHEDULED) |
| MEETING_CANCELLED | 409 | Meeting da bi huy |
| STATE_INVALID | 409 | Khong tim thay active room booking |
| INTERNAL_ERROR | 500 | Loi server khong xac dinh |
