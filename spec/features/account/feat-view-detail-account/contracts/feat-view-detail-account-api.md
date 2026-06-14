# API Contract: Xem chi tiết hồ sơ tài khoản

> Feature ID: UC-AM-10 | UC-15 API Contract

---

## Endpoint

**GET** `/api/v1/users/:userId`

### Path Parameters

| Parameter | Type | Required | Description | Validation |
|---|---|---|---|---|
| `userId` | UUID | Yes | ID của tài khoản cần xem chi tiết | Must be valid UUID v4 |

### Headers

| Header | Required | Description |
|---|---|---|
| `Authorization: Bearer <token>` | Yes | JWT access token |

---

## Success Response

### HTTP 200 OK

```json
{
  "success": true,
  "message": "User detail retrieved successfully",
  "data": {
    "id": "uuid",
    "employeeCode": "EMP001",
    "email": "user@example.com",
    "fullName": "Nguyễn Văn A",
    "phoneNumber": "0909123456",
    "avatarUrl": "https://storage.example.com/avatars/uuid.jpg",
    "positionTitle": "Software Engineer",
    "department": {
      "id": "uuid",
      "departmentName": "IT Department"
    },
    "directManager": {
      "id": "uuid",
      "fullName": "Trần Văn B"
    },
    "accountStatus": "active",
    "employmentStatus": "active",
    "mustChangePassword": false,
    "lastLoginAt": "2026-06-07T10:30:00.000Z",
    "roles": [
      {
        "id": "uuid",
        "roleCode": "EMPLOYEE",
        "roleName": "Nhân viên"
      }
    ],
    "hasFaceProfile": true,
    "createdAt": "2026-01-15T08:00:00.000Z"
  }
}
```

### Field Notes

| Field | Nullable | Condition |
|---|---|---|
| `employeeCode` | Yes | Null if user has no employee code |
| `phoneNumber` | Yes | Null if not provided |
| `avatarUrl` | Yes | Null if `users.avatar_url` is null |
| `positionTitle` | Yes | Null if not provided |
| `department` | Yes | Null if `users.department_id` is null |
| `directManager` | Yes | Null if `users.direct_manager_id` is null. **Never omit field** |
| `lastLoginAt` | Yes | Null if user never logged in |
| `roles` | No | Empty array `[]` if user has no active roles |
| `hasFaceProfile` | No | Always returned, `true`/`false` |

---

## Error Responses

### 400 Bad Request — Invalid UUID

```json
{
  "success": false,
  "message": "Validation failed (uuid is expected)",
  "error": {
    "code": "INVALID_USER_ID",
    "details": {}
  },
  "timestamp": "2026-06-08T10:00:00.000Z",
  "path": "/api/v1/users/invalid-id"
}
```

### 401 Unauthorized — Missing/Invalid JWT

```json
{
  "success": false,
  "message": "Token not found",
  "error": {
    "code": "UNAUTHORIZED",
    "details": {}
  },
  "timestamp": "2026-06-08T10:00:00.000Z",
  "path": "/api/v1/users/uuid"
}
```

### 403 Forbidden — Missing Permission

```json
{
  "success": false,
  "message": "Bạn không có quyền thực hiện hành động này.",
  "error": {
    "code": "FORBIDDEN",
    "details": {}
  },
  "timestamp": "2026-06-08T10:00:00.000Z",
  "path": "/api/v1/users/uuid"
}
```

### 403 Forbidden — Out of Department Scope (Business Admin)

```json
{
  "success": false,
  "message": "Bạn không có quyền xem hồ sơ của nhân sự này.",
  "error": {
    "code": "FORBIDDEN",
    "details": {}
  },
  "timestamp": "2026-06-08T10:00:00.000Z",
  "path": "/api/v1/users/uuid"
}
```

### 404 Not Found — User Does Not Exist or Soft-Deleted

```json
{
  "success": false,
  "message": "Không tìm thấy tài khoản.",
  "error": {
    "code": "USER_NOT_FOUND",
    "details": {}
  },
  "timestamp": "2026-06-08T10:00:00.000Z",
  "path": "/api/v1/users/uuid"
}
```

### 500 Internal Server Error

```json
{
  "success": false,
  "message": "Internal server error",
  "error": {
    "code": "INTERNAL_ERROR",
    "details": {}
  },
  "timestamp": "2026-06-08T10:00:00.000Z",
  "path": "/api/v1/users/uuid"
}
```

---

## Error Code Summary

| HTTP Status | Error Code | Condition |
|---|---|---|
| 400 | `INVALID_USER_ID` | userId is not a valid UUID |
| 401 | `UNAUTHORIZED` | Missing/invalid JWT token |
| 403 | `FORBIDDEN` | Missing permission `account.user.read.detail` |
| 403 | `FORBIDDEN` | Business Admin out of department scope |
| 404 | `USER_NOT_FOUND` | User ID does not exist or soft-deleted |
| 500 | `INTERNAL_ERROR` | Unexpected server error |
