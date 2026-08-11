# Quickstart: Partner Temporary Account (PTA-001)

## 📝 CHANGELOG & REVISION HISTORY
| Ngày cập nhật | Tóm tắt thay đổi | Các dòng thay đổi |
| :--- | :--- | :--- |
| 2026-08-11 | Khởi tạo quickstart | Toàn bộ file |

## Mục tiêu kiểm thử nhanh

Xác minh việc tạo/đăng nhập/giới hạn phạm vi/hết hạn của tài khoản đối tác đúng theo `spec.md`, đặc biệt: mật khẩu = email không bị ép đổi, `PartnerAccountRestrictionGuard` mặc định chặn, `BiometricEnforcementGuard`/`MustChangePasswordGuard` không hề bị chạm, và user thường hoàn toàn không bị ảnh hưởng bởi các thay đổi ở `LoginService`/`RefreshTokenService`.

## Pre-conditions

- Có actor với permission `account.partner.manage` (ví dụ `SYSTEM_ADMIN`/`BUSINESS_ADMIN`/`MANAGER`).
- Đã chạy đủ 3 migration: thêm cột `account_expires_at`, seed department "Đối tác" (UUID cố định), seed permission `account.partner.manage`.
- Có ít nhất 1 ảnh hợp lệ (jpg/png, dưới giới hạn kích thước hiện có) để test upload.
- Có ít nhất 1 endpoint đã gắn `@AllowPartnerAccount()` (ví dụ `GET /api/v1/live-meetings/:meetingId`) và 1 endpoint chưa gắn (ví dụ `POST /api/v1/meetings`) để test cả 2 nhánh của guard.

## Happy path — S1: Tạo tài khoản đối tác

1. Gọi API tạo tài khoản với `accountType = 'partner'`, kèm `fullName`, `email`, `accountExpiresAt` (ví dụ `now() + 1 ngày`), và `avatarFile`.
2. Kỳ vọng:
   - `201 Created`.
   - `users.department_id` = UUID department "Đối tác".
   - `users.account_expires_at` đúng giá trị đã gửi.
   - `users.must_change_password = false`.
   - `users.password_hash` khớp `bcrypt.compare(email, password_hash) === true`.
   - Có 1 row `face_profiles` với `status = 'active'`, `enrolled_by` = actor tạo.
   - Có 1 row `audit_logs` với `action = 'account.partner.create'`.
   - Đối tác nhận được email chứa email đăng nhập + hạn dùng, KHÔNG chứa giá trị mật khẩu nào.

## S2: Đăng nhập tài khoản đối tác

1. Đăng nhập bằng `email` + `password = email` (cùng giá trị).
2. Kỳ vọng: `200`, nhận được `accessToken`/`refreshToken`, KHÔNG có flag/response nào yêu cầu đổi mật khẩu.

## S3: Giới hạn phạm vi — endpoint được phép

1. Dùng `accessToken` của đối tác gọi 1 endpoint có `@AllowPartnerAccount()` (ví dụ `GET /api/v1/live-meetings/:meetingId` — với `:meetingId` là cuộc họp đối tác được mời).
2. Kỳ vọng: `200`, xử lý bình thường.

## S4: Giới hạn phạm vi — endpoint bị chặn

1. Dùng `accessToken` của đối tác gọi 1 endpoint KHÔNG có `@AllowPartnerAccount()` (ví dụ `POST /api/v1/meetings` — tạo cuộc họp mới).
2. Kỳ vọng: `403 PARTNER_ACCOUNT_RESTRICTED`, KHÔNG có cuộc họp nào được tạo.

## S5: Tài khoản hết hạn — chặn ở login

1. Tạo tài khoản đối tác với `accountExpiresAt = now() - 1 phút` (giả lập đã hết hạn), hoặc gia hạn 1 tài khoản có sẵn về quá khứ.
2. Đăng nhập bằng đúng `email`/`password`.
3. Kỳ vọng: `403 AUTH_ACCOUNT_EXPIRED`.

## S6: Tài khoản hết hạn — chặn ở refresh token

1. Có 1 tài khoản đối tác đã đăng nhập (có `refreshToken` hợp lệ), sau đó admin đặt `account_expires_at` về quá khứ.
2. Gọi `POST /api/v1/auth/refresh` bằng `refreshToken` đó.
3. Kỳ vọng: `403 AUTH_ACCOUNT_EXPIRED`, không cấp `accessToken` mới.

## S7: Gia hạn tài khoản

1. Tài khoản đối tác đang hết hạn (S5), admin gọi API gia hạn với `accountExpiresAt` mới (tương lai).
2. Đăng nhập lại bằng tài khoản đó.
3. Kỳ vọng: `200`, đăng nhập thành công.

## S8: Mời đối tác vào cuộc họp — tái dùng API có sẵn

1. Host gọi `addInternalParticipant` hiện có với `userId` của tài khoản đối tác.
2. Kỳ vọng: thêm thành công như mời 1 nhân viên thường — không có lỗi/nhánh xử lý đặc biệt nào.

## S9: Bảo vệ department cố định

1. Actor bất kỳ (kể cả `SYSTEM_ADMIN`) gọi API sửa tên hoặc xoá mềm department "Đối tác".
2. Kỳ vọng: bị từ chối.

## S10: Regression — user thường hoàn toàn không bị ảnh hưởng

1. Tạo 1 user thường (không phải đối tác) qua luồng hiện có — xác nhận vẫn nhận mật khẩu ngẫu nhiên, `must_change_password = true`, `account_expires_at = NULL`.
2. Đăng nhập bằng user thường đó nhiều lần, gọi refresh token — xác nhận hành vi không đổi so với trước khi có feature này.
3. Gọi bất kỳ endpoint nào (có/không có `@AllowPartnerAccount()`) bằng user thường — xác nhận `PartnerAccountRestrictionGuard` luôn `return true` ngay từ bước 2 (early-return), không chặn user thường ở bất kỳ đâu.

## Edge scenarios

- Tạo tài khoản đối tác THIẾU ảnh sinh trắc học → validation error, KHÔNG tạo `users`.
- Tạo tài khoản đối tác với `accountExpiresAt` ở quá khứ ngay lúc submit → validation error (không cho tạo tài khoản đã hết hạn ngay từ đầu).
- Đối tác tự đổi mật khẩu qua `/auth/change-password` (tuỳ chọn, không bắt buộc) → vẫn hoạt động bình thường như user thường, không bị `PartnerAccountRestrictionGuard` chặn (endpoint auth cơ bản nằm trong danh sách `@AllowPartnerAccount()`, xem `plan.md` mục 5.1).
- Đối tác gọi endpoint `GET /api/v1/live-meetings/:meetingId` cho MỘT cuộc họp KHÁC (không phải cuộc họp họ được mời) → hành vi phụ thuộc kết quả audit ở `spec.md` mục 1.6; PHẢI bị từ chối (403/404 tuỳ convention hiện có của endpoint đó) — nếu không, đây là lỗ hổng cần sửa trước khi release, không phải hành vi chấp nhận được của feature này.
