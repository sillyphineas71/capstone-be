# 📝 CHANGELOG & REVISION HISTORY

| Ngày cập nhật | Tóm tắt thay đổi                               | Các dòng thay đổi |
| :------------ | :--------------------------------------------- | :---------------- |
| 2026-05-27    | Khởi tạo API contract cho feat-change-password | Toàn bộ tài liệu  |

# Contract: Change Password API

**Feature**: AUTH-CHPWD-004
**Endpoint**: `PATCH /api/v1/auth/change-password`
**Authentication**: Bearer JWT bắt buộc

---

## Request

```http
PATCH /api/v1/auth/change-password
Authorization: Bearer <jwt_access_token>
Content-Type: application/json
```

```json
{
  "currentPassword": "OldPass@123",
  "newPassword": "NewPass@456",
  "confirmPassword": "NewPass@456"
}
```

### Request Fields

| Field             | Type     | Required | Constraints                                                                                                                      |
| ----------------- | -------- | -------- | -------------------------------------------------------------------------------------------------------------------------------- |
| `currentPassword` | `string` | ✅       | Not empty. MaxLength: **72** ký tự. Không check complexity.                                                                      |
| `newPassword`     | `string` | ✅       | Not empty. MinLength: **8**. MaxLength: **72**. Phải có: chữ hoa, chữ thường, số, ký tự đặc biệt. Không trùng `currentPassword`. |
| `confirmPassword` | `string` | ✅       | Not empty. MaxLength: **72**. Phải bằng `newPassword`.                                                                           |

> ⚠️ `user_id` **không** nhận từ body — lấy từ JWT payload `sub`.

---

## Responses

### ✅ 200 OK — Thành công

```json
{
  "success": true,
  "message": "Thay đổi mật khẩu thành công. Vui lòng đăng nhập lại bằng mật khẩu mới."
}
```

**Side effects sau khi nhận 200**:

- Các JWT cũ (có `iat < password_updated_at`) sẽ bị Auth Guard reject với 401 ở request tiếp theo.
- `must_change_password` được set về `false` nếu trước đó là `true`.
- Bản ghi `PASSWORD_CHANGE_SUCCESS` được ghi vào `audit_logs`.

---

### ❌ 400 Bad Request — Validation / Business Rule

**Trường bỏ trống:**

```json
{
  "success": false,
  "message": "Validation failed",
  "error": {
    "code": "VALIDATION_ERROR",
    "details": [
      {
        "field": "confirmPassword",
        "message": "confirmPassword should not be empty"
      }
    ]
  },
  "timestamp": "2026-05-27T10:00:00.000Z",
  "path": "/api/v1/auth/change-password"
}
```

**Mật khẩu hiện tại sai (E2):**

```json
{
  "success": false,
  "message": "Mật khẩu hiện tại không chính xác. Vui lòng kiểm tra lại.",
  "error": {
    "code": "CURRENT_PASSWORD_INCORRECT",
    "details": {}
  },
  "timestamp": "2026-05-27T10:00:00.000Z",
  "path": "/api/v1/auth/change-password"
}
```

**Mật khẩu xác nhận không khớp (E4):**

```json
{
  "success": false,
  "message": "Mật khẩu xác nhận không trùng khớp.",
  "error": {
    "code": "CONFIRM_PASSWORD_MISMATCH",
    "details": {}
  },
  "timestamp": "2026-05-27T10:00:00.000Z",
  "path": "/api/v1/auth/change-password"
}
```

**Mật khẩu mới không đạt chuẩn (E3):**

```json
{
  "success": false,
  "message": "Mật khẩu mới không đạt tiêu chuẩn bảo mật. Vui lòng dùng ít nhất 8 ký tự bao gồm chữ hoa, chữ thường, số và ký tự đặc biệt.",
  "error": {
    "code": "PASSWORD_POLICY_VIOLATION",
    "details": {}
  },
  "timestamp": "2026-05-27T10:00:00.000Z",
  "path": "/api/v1/auth/change-password"
}
```

---

### ❌ 401 Unauthorized

```json
{
  "success": false,
  "message": "Invalid or expired token",
  "error": { "code": "UNAUTHORIZED" },
  "timestamp": "2026-05-27T10:00:00.000Z",
  "path": "/api/v1/auth/change-password"
}
```

**Khi nào**: Không có JWT, JWT hết hạn, JWT có `iat < password_updated_at` (bị passive invalidate).

---

### ❌ 403 Forbidden — Tài khoản bị khóa

```json
{
  "success": false,
  "message": "Tài khoản của bạn đã bị khóa hoặc vô hiệu hóa. Vui lòng liên hệ quản trị viên.",
  "error": { "code": "ACCOUNT_RESTRICTED" },
  "timestamp": "2026-05-27T10:00:00.000Z",
  "path": "/api/v1/auth/change-password"
}
```

**Khi nào**: `account_status` = `locked` hoặc `inactive` (phát hiện trong DB transaction).

---

### ❌ 422 Unprocessable Entity — Mật khẩu mới trùng cũ (E5)

```json
{
  "success": false,
  "message": "Mật khẩu mới không được trùng với mật khẩu hiện tại.",
  "error": { "code": "SAME_AS_CURRENT_PASSWORD" },
  "timestamp": "2026-05-27T10:00:00.000Z",
  "path": "/api/v1/auth/change-password"
}
```

---

### ❌ 429 Too Many Requests — Rate Limited

```json
{
  "success": false,
  "message": "Bạn đã nhập sai mật khẩu quá nhiều lần. Vui lòng thử lại sau 15 phút.",
  "error": {
    "code": "CHANGE_PASSWORD_RATE_LIMITED",
    "details": { "retryAfterMinutes": 15 }
  },
  "timestamp": "2026-05-27T10:00:00.000Z",
  "path": "/api/v1/auth/change-password"
}
```

**Khi nào**: Nhập sai `currentPassword` ≥ 5 lần trong vòng 15 phút. Block tiếp theo 15 phút.

---

### ❌ 500 Internal Server Error

```json
{
  "success": false,
  "message": "Internal server error",
  "error": { "code": "INTERNAL_SERVER_ERROR" },
  "timestamp": "2026-05-27T10:00:00.000Z",
  "path": "/api/v1/auth/change-password"
}
```

**Khi nào**: DB transaction thất bại, Redis unavailable, lỗi không xử lý được.

---

## Error Code Summary

| HTTP | error.code                     | Trường hợp                                 |
| ---- | ------------------------------ | ------------------------------------------ |
| 400  | `VALIDATION_ERROR`             | Thiếu trường, empty, vượt maxLength        |
| 400  | `PASSWORD_POLICY_VIOLATION`    | `newPassword` không đạt complexity         |
| 400  | `CONFIRM_PASSWORD_MISMATCH`    | `newPassword ≠ confirmPassword`            |
| 400  | `CURRENT_PASSWORD_INCORRECT`   | `currentPassword` sai                      |
| 401  | `UNAUTHORIZED`                 | JWT không hợp lệ / hết hạn / bị invalidate |
| 403  | `ACCOUNT_RESTRICTED`           | Tài khoản locked/inactive                  |
| 422  | `SAME_AS_CURRENT_PASSWORD`     | `newPassword` trùng với mật khẩu hiện tại  |
| 429  | `CHANGE_PASSWORD_RATE_LIMITED` | Sai > 5 lần / 15 phút                      |
| 500  | `INTERNAL_SERVER_ERROR`        | Lỗi hệ thống                               |
