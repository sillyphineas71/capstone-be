# API Contract: UC-APM-02 View Meeting Attendance List

## GET /api/v1/meetings/{meetingId}/attendance

**Permission**: attendance.read
**System Roles**: INTERNAL_USER, MANAGER, BUSINESS_ADMIN, SYSTEM_ADMIN

### Query Parameters

| Param | Type | Required | Default | Description |
|---|---|---|---|---|
| status | string | No | all | Filter: all, present, late, absent, not_checked_in, left_early |
| search | string | No | - | Search name/email (max 100 chars) |
| page | integer | No | 1 | Page number (>= 1) |
| pageSize | integer | No | 20 | Items per page (1-100) |

### Response 200

{ "success": true, "message": "Danh sach diem danh duoc truy xuat thanh cong", "data": { "meeting": {...}, "permissions": {...}, "summary": {...}, "items": [...] }, "meta": {...} }

### Error Codes

| Status | Code | Description |
|---|---|---|
| 400 | VALIDATION_ERROR | Invalid input |
| 401 | TOKEN_EXPIRED | Unauthenticated |
| 403 | PERMISSION_DENIED | No permission |
| 404 | MEETING_NOT_FOUND | Not found/deleted |
| 409 | ATTENDANCE_NOT_OPEN_YET | Future meeting |
| 500 | INTERNAL_ERROR | System error |
