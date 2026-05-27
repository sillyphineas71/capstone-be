# 📝 CHANGELOG & REVISION HISTORY
| Ngày cập nhật | Tóm tắt thay đổi | Các dòng thay đổi |
| :--- | :--- | :--- |
| 2026-05-27 | Khởi tạo quickstart guide cho feat-change-password | Toàn bộ tài liệu |

# Quickstart: AUTH-004 Change Password

## Goal

Xác minh toàn bộ luồng đổi mật khẩu hoạt động đúng theo spec đã clarify — bao gồm happy path, validation, rate-limit, `must_change_password` guard, và passive JWT invalidation.

---

## Prerequisite

- Có user `active` với JWT hợp lệ.
- Redis đang chạy (cần cho rate-limit counter và JWT invalidation key).
- PostgreSQL có trường `password_updated_at`, `must_change_password` trong bảng `users`.

---

## Main Scenarios

### API: `PATCH /api/v1/auth/change-password`

**1. Happy Path — Đổi mật khẩu thành công**
- Login → lấy JWT → gọi `PATCH /auth/change-password` với `currentPassword` đúng, `newPassword` đạt chuẩn, `confirmPassword` khớp.
- **Expected**: HTTP 200. `users.password_updated_at` cập nhật. `must_change_password` = false (nếu trước là true).
- **Verify**: Gọi lại API bất kỳ với JWT cũ → phải nhận HTTP 401. Login lại bằng mật khẩu mới → JWT mới → gọi API thành công (HTTP 200).

**2. `currentPassword` sai — HTTP 400 + tăng counter**
- Gọi với `currentPassword` sai.
- **Expected**: HTTP 400, `error.code = CURRENT_PASSWORD_INCORRECT`.
- **Verify Redis**: Key `change_password:failed:{userId}` tồn tại với value = 1.

**3. Rate-limit block sau 5 lần sai — HTTP 429**
- Gọi với `currentPassword` sai 5 lần liên tiếp.
- Lần thứ 6: **Expected**: HTTP 429, `error.code = CHANGE_PASSWORD_RATE_LIMITED`, `details.retryAfterMinutes = 15`.
- **Verify Redis**: Key `change_password:block:{userId}` tồn tại (TTL ~ 15 phút).
- Trong thời gian block, dù nhập đúng cũng nhận 429.

**4. `newPassword` trùng `currentPassword` — HTTP 422**
- Nhập `currentPassword` = `newPassword` = mật khẩu hiện tại.
- **Expected**: HTTP 422, `error.code = SAME_AS_CURRENT_PASSWORD`.

**5. `confirmPassword` không khớp — HTTP 400**
- `newPassword = NewPass@456`, `confirmPassword = NewPass@999`.
- **Expected**: HTTP 400, `error.code = CONFIRM_PASSWORD_MISMATCH`.

**6. `newPassword` không đạt chuẩn — HTTP 400**
- `newPassword = simple` (chỉ 6 ký tự thường).
- **Expected**: HTTP 400, `error.code = PASSWORD_POLICY_VIOLATION`.

**7. `newPassword` vượt maxLength 72 — HTTP 400**
- `newPassword` = chuỗi 80 ký tự.
- **Expected**: HTTP 400, `error.code = VALIDATION_ERROR`.

**8. Không có JWT — HTTP 401**
- Gọi không có header `Authorization`.
- **Expected**: HTTP 401.

**9. `must_change_password = true` — chặn API nghiệp vụ**
- Set `users.must_change_password = true` cho user.
- Login → gọi `GET /api/v1/meetings`.
- **Expected**: HTTP 403, `error.code = MUST_CHANGE_PASSWORD`.
- Gọi `PATCH /auth/change-password` → **vẫn phải được phép** (whitelist route).
- Sau khi đổi thành công → `must_change_password = false` → `GET /meetings` hoạt động bình thường.

**10. Passive JWT invalidation — verify positive case**
- Đổi mật khẩu thành công → `password_updated_at` cập nhật.
- Login lại bằng mật khẩu mới → nhận JWT mới (`iat > password_updated_at`).
- Gọi `GET /api/v1/meetings` với JWT mới → **Expected**: HTTP 200 (không bị block).

---

## Verification Notes

- `password_hash` trong `users` **phải là bcrypt hash**, không bao giờ plain text.
- `password_updated_at` **phải được update** cùng lúc với `password_hash` trong cùng một transaction.
- Audit log `audit_logs` **phải có bản ghi** `password_change_success` sau happy path.
- Audit log `audit_logs` **phải có bản ghi** `password_change_rate_limited` khi bị block (lần sai thứ 5).
- Audit log **tuyệt đối không chứa** plain password hay bcrypt hash.
- `user_id` trong audit log phải khớp với `users.id` của người thực hiện (lấy từ JWT, không từ body).
- Redis key `auth:user:{userId}:invalid_after` **phải được set** sau khi đổi thành công.
