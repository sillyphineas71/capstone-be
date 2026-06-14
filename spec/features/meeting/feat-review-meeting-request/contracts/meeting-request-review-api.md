# API Contract — Duyệt hoặc từ chối yêu cầu cuộc họp

> Base URL: `/api/v1`

---

## 1. Approve Meeting Request

Phê duyệt yêu cầu cuộc họp đang pending.

### Request

```
POST /api/v1/meeting-requests/{requestId}/approve
```

### Headers

| Header | Value | Bắt buộc |
|--------|-------|:--------:|
| `Authorization` | `Bearer <jwt_token>` | Có |

### Path Parameters

| Parameter | Type | Mô tả |
|-----------|------|-------|
| `requestId` | uuid | ID của meeting request |

### Request Body

```json
{
  "decisionNote": "Ghi chú quyết định (optional, max 500 ký tự)"
}
```

### Response: 200 OK

```json
{
  "success": true,
  "message": "Yêu cầu cuộc họp đã được phê duyệt thành công",
  "data": {
    "requestId": "uuid",
    "approvalStatus": "approved",
    "meetingId": "uuid",
    "bookingId": "uuid",
    "appliedAt": "2026-06-08T10:00:00.000Z"
  }
}
```

---

## 2. Reject Meeting Request

Từ chối yêu cầu cuộc họp đang pending.

### Request

```
POST /api/v1/meeting-requests/{requestId}/reject
```

### Headers

| Header | Value | Bắt buộc |
|--------|-------|:--------:|
| `Authorization` | `Bearer <jwt_token>` | Có |

### Path Parameters

| Parameter | Type | Mô tả |
|-----------|------|-------|
| `requestId` | uuid | ID của meeting request |

### Request Body

```json
{
  "rejectionReason": "Lý do từ chối (required, max 1000 ký tự)"
}
```

### Response: 200 OK

```json
{
  "success": true,
  "message": "Yêu cầu cuộc họp đã bị từ chối",
  "data": {
    "requestId": "uuid",
    "approvalStatus": "rejected",
    "decisionAt": "2026-06-08T10:00:00.000Z"
  }
}
```

---

## 3. Error Responses

### 400 Bad Request — Validation Error

```json
{
  "success": false,
  "message": "requestId không đúng định dạng UUID",
  "error": {
    "code": "VALIDATION_ERROR",
    "details": {
      "field": "requestId",
      "reason": "uuid_expected"
    }
  }
}
```

```json
{
  "success": false,
  "message": "rejectionReason không được để trống",
  "error": {
    "code": "VALIDATION_ERROR",
    "details": {
      "field": "rejectionReason",
      "reason": "required"
    }
  }
}
```

```json
{
  "success": false,
  "message": "decisionNote không được vượt quá 500 ký tự",
  "error": {
    "code": "VALIDATION_ERROR",
    "details": {
      "field": "decisionNote",
      "reason": "max_length_exceeded",
      "max": 500
    }
  }
}
```

### 401 Unauthorized

```json
{
  "success": false,
  "message": "Vui lòng đăng nhập để tiếp tục",
  "error": {
    "code": "UNAUTHORIZED"
  }
}
```

### 403 Forbidden — Insufficient Permission

```json
{
  "success": false,
  "message": "Bạn không có quyền thực hiện thao tác này",
  "error": {
    "code": "FORBIDDEN",
    "details": {
      "requiredPermission": "meeting_request.approve"
    }
  }
}
```

### 403 Forbidden — Self Approval

```json
{
  "success": false,
  "message": "Bạn không thể tự duyệt yêu cầu cuộc họp do chính mình tạo",
  "error": {
    "code": "SELF_APPROVAL_NOT_ALLOWED"
  }
}
```

### 404 Not Found

```json
{
  "success": false,
  "message": "Không tìm thấy yêu cầu cuộc họp",
  "error": {
    "code": "RESOURCE_NOT_FOUND",
    "details": {
      "entityType": "meeting_request",
      "entityId": "uuid"
    }
  }
}
```

### 409 Conflict — Invalid State

```json
{
  "success": false,
  "message": "Yêu cầu cuộc họp không còn ở trạng thái chờ duyệt",
  "error": {
    "code": "INVALID_STATE",
    "details": {
      "currentStatus": "approved",
      "expectedStatus": "pending"
    }
  }
}
```

### 409 Conflict — Room Conflict

```json
{
  "success": false,
  "message": "Phòng họp đã có booking khác trong khung giờ này",
  "error": {
    "code": "ROOM_CONFLICT",
    "details": {
      "conflictingBookings": ["uuid1", "uuid2"]
    }
  }
}
```

### 409 Conflict — Already Processed (Pessimistic Lock)

```json
{
  "success": false,
  "message": "Yêu cầu đã được xử lý bởi một phiên khác",
  "error": {
    "code": "REQUEST_ALREADY_PROCESSED"
  }
}
```

### 422 Unprocessable Entity — Unsupported Request Type

```json
{
  "success": false,
  "message": "Loại yêu cầu không được hỗ trợ",
  "error": {
    "code": "UNSUPPORTED_REQUEST_TYPE",
    "details": {
      "requestType": "cancel_meeting",
      "supportedTypes": ["create_meeting"]
    }
  }
}
```

### 500 Internal Server Error

```json
{
  "success": false,
  "message": "Đã xảy ra lỗi hệ thống, vui lòng thử lại sau",
  "error": {
    "code": "INTERNAL_ERROR"
  }
}
```

---

## 4. Status Code Summary

| Status | Mô tả |
|:------:|-------|
| 200 | Thành công (approve/reject) |
| 400 | Validation error (UUID, missing field, length) |
| 401 | Unauthenticated |
| 403 | Forbidden (permission, self-approval) |
| 404 | Not found (request, meeting, booking) |
| 409 | Conflict (invalid state, room conflict, already processed) |
| 422 | Unsupported request type |
| 500 | Internal server error |
