# 📝 CHANGELOG & REVISION HISTORY
| Ngày cập nhật | Tóm tắt thay đổi | Các dòng thay đổi |
| :--- | :--- | :--- |
| 2026-05-27 | Rà soát và cập nhật hoàn thành quickstart guide | Phần đầu |
| 2026-05-27 | Khởi tạo hướng dẫn kiểm thử nhanh (quickstart.md) | Toàn bộ tài liệu |

# Quickstart: AUTH-003 Password Reset with OTP

## Goal
Verify the password reset and OTP flow behavior end-to-end against the clarified spec and baseline DB compact v3.2 rules.

---

## Main Scenarios

### API 1: Yêu cầu gửi OTP (`POST /api/v1/auth/password-reset/request`)
1. **Success**: Nhập email active hợp lệ -> Gửi OTP email thành công, trả về 200 OK, tạo key trong Redis (TTL 10 phút).
2. **`400 VALIDATION_ERROR`**: Thiếu email hoặc sai định dạng email.
3. **`400 AUTH_ACCOUNT_RESTRICTED` (E1)**: Nhập email không tồn tại trong hệ thống, bị xóa mềm, nghỉ việc (resigned), locked, inactive, hoặc disabled.
4. **`429 AUTH_TOO_MANY_ATTEMPTS` (E4)**: Gửi request lần thứ 4 trong vòng 5 phút (block 60 phút).

### API 2: Đặt lại mật khẩu (`POST /api/v1/auth/password-reset/confirm`)
1. **Success**: Nhập đúng OTP, mật khẩu mới đáp ứng chuẩn bảo mật, xác nhận khớp -> Đặt mật khẩu mới thành công, must_change_password cập nhật thành `false`, password_updated_at cập nhật, các token JWT cũ bị thu hồi.
2. **`400 VALIDATION_ERROR`**: OTP sai format (không phải 6 chữ số), mật khẩu mới không khớp mật khẩu xác nhận.
3. **`400 Bad Request`**: Mật khẩu mới không đạt chuẩn (thiếu ký tự hoa/thường/số/đặc biệt hoặc dưới 8 ký tự).
4. **`400 AUTH_OTP_INVALID_OR_EXPIRED` (E2)**: OTP không đúng, hết hạn 10 phút, hoặc sai quá 5 lần (tự động xóa key trong Redis).

---

## Verification Notes
- Dữ liệu OTP lưu trong Redis **bắt buộc phải băm** (hashed SHA-256) trước khi lưu.
- Audit Log **không được lưu** plain OTP hoặc plain password.
- Auth Guard **bắt buộc phải từ chối** bất kỳ stateless JWT nào có `iat < users.password_updated_at` sau khi đổi thành công.
