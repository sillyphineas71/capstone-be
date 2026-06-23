# API Contract - Lấy danh sách yêu cầu cuộc họp đang chờ duyệt

> Base URL: /api/v1

---

## 1. List Meeting Requests

### Request

```
GET /api/v1/meeting-requests
```

### Headers

| Header | Value | Bắt buộc |
|--------|-------|:--------:|
| Authorization | Bearer <jwt_token> | Có |

### Query Parameters

| Parameter | Type | Default | Mô tả | Validation |
|-----------|------|:-------:|-------|:----------:|
| page | integer | 1 | Số trang | >= 1 |
| limit | integer | 20 | Số item/trang | 1..100 |
| approvalStatus | string | pending | Trạng thái duyệt | pending,approved,rejected,applied,cancelled,all |
| requestType | string | - | Loại request | create_meeting,update_time,update_room,cancel_meeting,extend_meeting,book_room |
| targetRoomId | uuid | - | ID phòng | UUID v4 |
| requestedById | uuid | - | Người tạo | UUID v4 |
| from | ISO 8601 | - | Thời gian bắt đầu | from <= to |
| to | ISO 8601 | - | Thời gian kết thúc | from <= to |
| q | string | - | Tìm request_code | case-insensitive, partial match |
| sortBy | string | requested_at | Field sort | requested_at,created_at,approval_status,request_type |
| sortOrder | string | desc | Thứ tự sort | asc, desc |

### Response: 200 OK

```json
{
  "success": true,
  "message": "Danh sách yêu cầu cuộc họp",
  "data": [
    {
      "id": "uuid",
      "requestCode": "REQ-2026-001",
      "requestType": "create_meeting",
      "approvalStatus": "pending",
      "requestedAt": "2026-06-23T10:00:00.000Z",
      "requestedStartTime": "2026-06-25T09:00:00.000Z",
      "requestedEndTime": "2026-06-25T10:00:00.000Z",
      "conflictCheckStatus": "clear",
      "conflictSummary": null,
      "decisionBy": null,
      "decisionAt": null,
      "rejectionReason": null,
      "requestedBy": { "id": "uuid", "fullName": "Nguyen Van A", "email": "nva@company.com" },
      "targetRoom": { "id": "uuid", "roomName": "Phong 101" },
      "meeting": null
    }
  ],
  "meta": { "page": 1, "limit": 20, "total": 50, "totalPages": 3 }
}
```

### Response: 200 OK (empty)

```json
{
  "success": true,
  "message": "Danh sách yêu cầu cuộc họp",
  "data": [],
  "meta": { "page": 1, "limit": 20, "total": 0, "totalPages": 0 }
}
```

## 2. Error Responses

### 400 Bad Request

```json
{
  "success": false,
  "message": "Validation error",
  "error": { "code": "VALIDATION_ERROR" }
}
```

### 401 Unauthorized

```json
{
  "success": false,
  "message": "Vui lòng đăng nhập",
  "error": { "code": "UNAUTHORIZED" }
}
```

### 403 Forbidden

```json
{
  "success": false,
  "message": "Không có quyền",
  "error": { "code": "FORBIDDEN", "details": { "requiredPermission": "meeting_request.read" } }
}
```

### 422 Unprocessable Entity

```json
{
  "success": false,
  "message": "Invalid enum value",
  "error": { "code": "VALIDATION_ERROR", "details": { "reason": "invalid_enum" } }
}
```

### 500 Internal Server Error

```json
{
  "success": false,
  "message": "Lỗi hệ thống",
  "error": { "code": "INTERNAL_ERROR" }
}
```

## 3. Status Code Summary

| Status | Mô tả |
|:------:|-------|
| 200 | Thành công |
| 400 | Validation error |
| 401 | Unauthenticated |
| 403 | Forbidden |
| 422 | Invalid enum / sort field |
| 500 | Internal error |
