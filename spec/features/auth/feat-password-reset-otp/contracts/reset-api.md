# 📝 CHANGELOG & REVISION HISTORY
| Ngày cập nhật | Tóm tắt thay đổi | Các dòng thay đổi |
| :--- | :--- | :--- |
| 2026-05-27 | Khởi tạo tài liệu hợp đồng API khôi phục mật khẩu (reset-api.md) | Toàn bộ tài liệu |

# Contract: Password Reset with OTP APIs

---

## 1. Request OTP (Gửi mã xác thực)

### Request
```http
POST /api/v1/auth/password-reset/request
Content-Type: application/json
```
```json
{
  "email": "employee@company.com"
}
```

### Success Response (200 OK)
```json
{
  "success": true,
  "message": "Mã xác thực đã được gửi tới email của bạn. Vui lòng kiểm tra hộp thư."
}
```

### Error Responses
* `400 VALIDATION_ERROR` (Thiếu email hoặc email không hợp lệ)
* `400 AUTH_ACCOUNT_RESTRICTED` (E1 - Email không tồn tại hoặc bị khóa/disabled/resigned/deleted)
* `429 AUTH_TOO_MANY_ATTEMPTS` (E4 - Gửi yêu cầu quá 3 lần trong 5 phút)
* `500 AUTH_EMAIL_DISPATCH_FAILED` (Lỗi gửi SMTP mail server)

---

## 2. Confirm Reset (Xác thực và đặt lại mật khẩu)

### Request
```http
POST /api/v1/auth/password-reset/confirm
Content-Type: application/json
```
```json
{
  "email": "employee@company.com",
  "otp": "123456",
  "newPassword": "SecurePassword123!",
  "confirmPassword": "SecurePassword123!"
}
```

### Success Response (200 OK)
```json
{
  "success": true,
  "message": "Đổi mật khẩu thành công. Vui lòng đăng nhập lại bằng mật khẩu mới."
}
```

### Error Responses
* `400 VALIDATION_ERROR` (Thiếu trường dữ liệu, OTP không chứa đúng 6 chữ số, mật khẩu mới không khớp mật khẩu xác nhận)
* `400 Bad Request` (Mật khẩu mới không đạt chuẩn bảo mật)
* `400 AUTH_OTP_INVALID_OR_EXPIRED` (E2 - OTP sai, hết hạn 10 phút, hoặc thử sai quá 5 lần)
* `500 Internal Server Error` (Lỗi cơ sở dữ liệu hoặc hệ thống)
