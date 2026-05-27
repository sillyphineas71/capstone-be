# 📝 CHANGELOG & REVISION HISTORY
| Ngày cập nhật | Tóm tắt thay đổi | Các dòng thay đổi |
| :--- | :--- | :--- |
| 2026-05-27 | Khởi tạo tài liệu cấu trúc mô hình dữ liệu (data-model.md) | Toàn bộ tài liệu |

# Data Model: AUTH-003 Password Reset with OTP

## PostgreSQL Database Impact

### users
- Purpose: Nguồn dữ liệu kiểm tra tài khoản và lưu mật khẩu khôi phục mới.
- Fields used:
  - `id` (PK, UUID)
  - `email` (Unique, string) - Dùng để tra cứu (trim + lowercase)
  - `password_hash` (string) - Cập nhật mật khẩu băm mới sau khi đổi thành công
  - `password_updated_at` (timestamptz) - Cập nhật thời điểm đổi mật khẩu = `now()` để dùng cho cơ chế thu hồi token JWT
  - `must_change_password` (boolean) - Cập nhật thành `false` sau khi đổi thành công
  - `account_status` (string) - Đọc kiểm duyệt (yêu cầu active)
  - `employment_status` (string) - Đọc kiểm duyệt (yêu cầu không phải resigned)
  - `deleted_at` (timestamptz) - Kiểm duyệt loại trừ tài khoản đã bị xóa mềm

### audit_logs
- Purpose: Ghi nhận vết sự kiện bảo mật.
- Fields used:
  - `id` (PK, UUID)
  - `user_id` (UUID, nullable)
  - `action_type` (string, ví dụ: 'PASSWORD_RESET_OTP_REQUESTED', 'PASSWORD_RESET_SUCCESS')
  - `ip_address` (string)
  - `user_agent` (string)
  - `metadata_json` (jsonb) - Lưu IP, User-Agent, user ID, tuyệt đối không lưu plain password/plain OTP.
  - `created_at` (timestamptz)

---

## Redis Cache Model

### OTP Session Cache
- **Key**: `otp:password_reset:{email}`
- **TTL**: 10 phút (600 giây).
- **Structure**:
  ```json
  {
    "otp_hash": "sha256_hashed_otp_code",
    "expires_at": "timestamp",
    "failed_attempts": 0
  }
  ```
- **Validation**:
  - Hủy key khi `failed_attempts` >= 5.
  - Xóa key ngay lập tức sau khi đổi mật khẩu thành công.

### Rate Limit Counter
- **Key**: `otp_limit:password_reset:{email}`
- **TTL**: 5 phút (300 giây).
- **Structure**: Integer (số lần yêu cầu OTP thành công).
- **Threshold**: Vượt quá 3 lần sẽ chuyển sang block.

### Rate Limit Block Key
- **Key**: `otp_blocked:password_reset:{email}`
- **TTL**: 60 phút (3600 giây).
- **Structure**: String (cờ block `true`).

---

## Input / Output Models

### API 1: Request OTP Input
- `email: string` (required, valid format, trim + lowercase)

### API 1: Request OTP Output
- `success: boolean`
- `message: string`

### API 2: Confirm OTP & Reset Password Input
- `email: string` (required, valid format)
- `otp: string` (required, regex `^\d{6}$`)
- `newPassword: string` (required, >= 8 ký tự, 1 hoa, 1 thường, 1 số, 1 ký tự đặc biệt)
- `confirmPassword: string` (required, khớp với `newPassword`)

### API 2: Confirm OTP & Reset Password Output
- `success: boolean`
- `message: string`
