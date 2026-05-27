# 📝 CHANGELOG & REVISION HISTORY
| Ngày cập nhật | Tóm tắt thay đổi | Các dòng thay đổi |
| :--- | :--- | :--- |
| 2026-05-27 | Khởi tạo tài liệu kế hoạch triển khai (plan.md) cho tính năng Password Reset OTP | Toàn bộ tài liệu |

# Implementation Plan: AUTH-003 Password Reset with OTP

**Branch**: `001-password-reset-otp` | **Date**: 2026-05-27 | **Spec**: [spec.md](file:///c:/Users/Admin/Desktop/Capstone/capstone-be/spec/features/auth/feat-password-reset-otp/spec.md)
**Input**: Feature specification from `/spec/features/auth/feat-password-reset-otp/spec.md`

---

## 1. Feature Summary

Feature này triển khai `UC-AUTH-03` cho phép người dùng tự khôi phục quyền truy cập tài khoản khi quên mật khẩu thông qua mã xác thực OTP gửi qua Email. 
Luồng cốt lõi đã được thống nhất:
1. **Yêu cầu khôi phục**: Người dùng gửi email -> Hệ thống kiểm tra sự tồn tại & trạng thái hoạt động của tài khoản -> Kiểm tra Rate Limit phòng chống spam -> Khởi tạo mã OTP 6 chữ số ngẫu nhiên lưu trong Redis (TTL 10 phút) -> Gửi Email OTP tiếng Việt.
2. **Xác thực & Đặt lại mật khẩu**: Người dùng cung cấp OTP và mật khẩu mới -> Xác thực OTP khớp & còn hiệu lực (không quá 5 lần nhập sai) -> Đặt lại mật khẩu mới (hash và lưu vào cơ sở dữ liệu), cập nhật cờ `must_change_password = false` và `password_updated_at` -> Thu hồi (invalidate) toàn bộ các stateless JWT cũ bằng cơ chế kiểm tra `iat < password_updated_at` trong Auth Guard -> Xóa sạch session OTP trên Redis để tránh tái sử dụng.

---

## 2. Technical Context

* **Language/Version**: TypeScript 5.x on NestJS 11
* **Primary Dependencies**: `@nestjs/common`, `@nestjs/core`, `@nestjs/platform-express`, `bcrypt` hoặc `argon2` cho băm mật khẩu, `@nestjs-modules/mailer` hoặc thư viện nodemailer để gửi mail, `ioredis` hoặc `@nestjs/cache-manager` với Redis store cho lưu trữ OTP runtime.
* **Storage**:
  * **Database**: PostgreSQL theo baseline v3.2 Compact. Chỉ tác động lên bảng `users` và `audit_logs`. **Tuyệt đối không tạo bảng mới `password_reset_requests`**.
  * **Cache Store**: Redis Cache quản lý TTL lưu trữ OTP và Rate Limit chống spam.
* **Testing**: Jest cho unit test services/controllers, supertest cho e2e test các endpoints.
* **Target Platform**: Linux server backend API (NestJS modular monolith).
* **Performance Goals**: Gửi email OTP trong vòng 1 giây; Xác thực & cập nhật DB dưới 500ms ở điều kiện tải thông thường.
* **Constraints**: 
  * Không trả về OTP trong response body của bất kỳ API nào.
  * OTP sinh ra bằng cơ chế an toàn mã hóa.
  * Toàn bộ tài khoản bị xóa mềm (`deleted_at IS NOT NULL`), nghỉ việc (`resigned`), bị khóa (`locked`), hoặc vô hiệu hóa (`inactive/disabled`) đều trả cùng một mã lỗi và thông báo chung (E1) để tránh lộ thông tin nội bộ (account enumeration).

---

## 3. Scope Confirmation

### Trong Scope:
- **API 1**: `POST /api/v1/auth/password-reset/request` - Yêu cầu gửi mã OTP.
- **API 2**: `POST /api/v1/auth/password-reset/confirm` - Xác thực OTP và đặt lại mật khẩu mới.
- **Strict Validation**: Kiểm tra tính hợp lệ của email, format OTP (6 chữ số), chuẩn độ bảo mật mật khẩu mới, trùng khớp mật khẩu xác nhận.
- **Spam Protection**: Giới hạn tối đa 3 lần yêu cầu OTP/resend trong 5 phút. Lần thứ 4 sẽ bị block trong 60 phút và trả về lỗi HTTP 429.
- **Brute Force Protection**: Giới hạn tối đa 5 lần nhập sai OTP cho mỗi OTP session. Lần thứ 5 sẽ hủy OTP trong Redis.
- **Stateless JWT Revocation**: Thực thi kiểm tra trong Auth Guard chung, bác bỏ bất kỳ JWT nào có thời điểm phát hành (`iat`) nhỏ hơn thời điểm cập nhật mật khẩu (`users.password_updated_at`).
- **Audit Logs**: Ghi lại lịch sử yêu cầu OTP (`PASSWORD_RESET_OTP_REQUESTED`) và đặt lại mật khẩu thành công (`PASSWORD_RESET_SUCCESS`) cùng IP/User-Agent.
- **Email Delivery**: Gửi email tiếng Việt mặc định có nội dung an toàn bảo mật.

### Ngoài Scope:
- Gửi OTP qua SMS hay ứng dụng bên thứ ba (chỉ hỗ trợ Email).
- Giao diện/API đổi mật khẩu khi người dùng đã đăng nhập (thuộc module Account Management).
- Tự động đăng nhập sau khi khôi phục thành công (bắt buộc người dùng quay lại Login và tự điền mật khẩu).
- Đa ngôn ngữ đối với template email gửi OTP (chỉ mặc định tiếng Việt).
- Tích hợp vector database, AI Document, SSO, face login trong luồng này.

---

## 4. Data Model Impact

### Tác động Database (PostgreSQL)
* **Bảng `users`**:
  * Đọc thông tin: `email` (đã trim + lowercase), `password_hash`, `account_status`, `must_change_password`, `employment_status`.
  * Cập nhật thông tin khi khôi phục thành công: `password_hash` (mật khẩu đã hash mới), `password_updated_at` (thời điểm cập nhật mới = `now()`), `must_change_password` (cập nhật thành `false` nếu đang là `true`).
* **Bảng `audit_logs`**:
  * Insert bản ghi mới khi yêu cầu gửi OTP (`PASSWORD_RESET_OTP_REQUESTED`) và khi khôi phục mật khẩu thành công (`PASSWORD_RESET_SUCCESS`).
  * Các trường ghi nhận trong `metadata_json`: IP address, User-Agent, user ID, tuyệt đối không lưu plain OTP hay plain password.

### Tác động Cache (Redis Runtime)
* **OTP Session Key**: `otp:password_reset:{email}`
  * TTL: 10 phút.
  * Kiểu dữ liệu: JSON string (hoặc hash map) chứa: `{ "otp_hash": "...", "expires_at": "...", "failed_attempts": 0 }`.
  * Mã OTP được băm (hash) trước khi lưu để phòng tránh rò rỉ bộ nhớ.
* **Rate Limit Limit Key**: `otp_limit:password_reset:{email}`
  * TTL: 5 phút.
  * Kiểu dữ liệu: String (integer counter) đếm số lần gửi OTP thành công.
* **Rate Limit Block Key**: `otp_blocked:password_reset:{email}`
  * TTL: 60 phút.
  * Kiểu dữ liệu: String (cờ đánh dấu block) có tồn tại key nghĩa là đang bị block.

### Transaction Boundary
* **Transaction 1 (Yêu cầu OTP - Read Only DB & Write Redis)**:
  * Đọc `users` kiểm tra email và account status (không ghi DB).
  * Kiểm tra và tăng số lần yêu cầu trên Redis Cache.
  * Lưu trữ OTP đã băm vào Redis Cache.
  * Ghi `audit_logs` non-blocking sự kiện yêu cầu OTP.
* **Transaction 2 (Xác thực & Cập nhật mật khẩu - Write DB & Delete Redis)**:
  * critical DB write transaction:
    ```sql
    BEGIN;
    UPDATE users 
    SET password_hash = $1, password_updated_at = now(), must_change_password = false 
    WHERE id = $2 AND deleted_at IS NULL;
    COMMIT;
    ```
  * Xóa session OTP trong Redis ngay sau khi update DB thành công (hoặc thực hiện tuần tự với cam kết xóa tuyệt đối).
  * Ghi `audit_logs` non-blocking cho sự kiện đặt lại thành công.

---

## 5. API / Contract Plan

### API 1: Yêu cầu khôi phục mật khẩu (Gửi OTP)
* **Endpoint**: `POST /api/v1/auth/password-reset/request`
* **Request Body**:
  ```json
  {
    "email": "employee@company.com"
  }
  ```
* **Success Response (200 OK)**:
  ```json
  {
    "success": true,
    "message": "Mã xác thực đã được gửi tới email của bạn. Vui lòng kiểm tra hộp thư."
  }
  ```
* **Error Responses**:
  * `400 Bad Request` (Email format invalid hoặc missing email).
  * `400 Bad Request` (E1 - "Email không tồn tại hoặc tài khoản đã bị khóa. Vui lòng kiểm tra lại" cho email không tồn tại/xóa mềm/locked/inactive/resigned).
  * `429 Too Many Requests` (E4 - "Bạn đã thao tác quá nhiều lần. Vui lòng thử lại sau 60 phút" khi request lần 4 trong 5 phút).
  * `500 Internal Server Error` (Lỗi gửi SMTP kết nối mail server).

### API 2: Đặt lại mật khẩu (Xác nhận OTP)
* **Endpoint**: `POST /api/v1/auth/password-reset/confirm`
* **Request Body**:
  ```json
  {
    "email": "employee@company.com",
    "otp": "123456",
    "newPassword": "SecurePassword123!",
    "confirmPassword": "SecurePassword123!"
  }
  ```
* **Success Response (200 OK)**:
  ```json
  {
    "success": true,
    "message": "Đổi mật khẩu thành công. Vui lòng đăng nhập lại bằng mật khẩu mới."
  }
  ```
* **Error Responses**:
  * `400 Bad Request` (OTP format invalid, thiếu trường, newPassword không khớp confirmPassword).
  * `400 Bad Request` (Mật khẩu không đáp ứng quy chuẩn bảo mật).
  * `400 Bad Request` (E2 - "Mã xác nhận không hợp lệ hoặc đã hết hạn" cho OTP sai/hết hạn/nhập sai quá 5 lần).
  * `500 Internal Server Error` (Lỗi hệ thống).

---

## 6. Authorization Plan

* **Quyền truy cập**: Cả hai API khôi phục mật khẩu đều ở trạng thái `public` (không cần Bearer token bảo vệ).
* **JWT Revocation Guard (Cơ chế thu hồi Token)**:
  * Khi người dùng khôi phục mật khẩu thành công, `users.password_updated_at` được cập nhật.
  * Tầng Auth Guard (`JwtAuthGuard`) khi kiểm tra access token từ request bất kỳ sẽ so sánh trường `iat` (issued at) trong payload JWT với trường `password_updated_at` trong cơ sở dữ liệu (hoặc cache profile).
  * **Quy tắc**: `IF JWT.iat < users.password_updated_at THEN reject the request` (Token không còn hợp lệ, ép buộc người dùng đăng nhập lại).

---

## 7. Business Logic Plan

### Luồng xử lý chi tiết:

#### Luồng 1 - Yêu cầu gửi OTP:
1. Nhận request `POST /api/v1/auth/password-reset/request`.
2. Validate định dạng `email` (trim + lowercase).
3. Kiểm tra spam rate-limit trong Redis:
   - Tăng key đếm `otp_limit:password_reset:{email}`.
   - Nếu số lần yêu cầu > 3 trong vòng 5 phút, lập tức tạo key block `otp_blocked:password_reset:{email}` thời hạn 60 phút và ném lỗi `429 Too Many Requests`.
4. Tìm kiếm người dùng trong PostgreSQL:
   - Tìm theo email đã lowercase, loại bỏ tài khoản bị xóa mềm (`deleted_at IS NOT NULL`).
   - Kiểm tra `account_status` (active) và `employment_status` (không phải resigned).
   - **Bảo mật**: Nếu không tìm thấy hoặc tài khoản không thỏa dụng, **không ném lỗi 404** hay chi tiết trạng thái mà trả về mã lỗi HTTP 400 chung: "Email không tồn tại hoặc tài khoản đã bị khóa. Vui lòng kiểm tra lại." (Mã lỗi nội bộ: `AUTH_ACCOUNT_RESTRICTED`).
5. Sinh mã OTP:
   - Sử dụng bộ sinh ngẫu nhiên mã hóa mạnh của Node.js (`crypto.randomInt(100000, 999999)`).
6. Băm OTP bằng SHA-256 (hoặc mã hóa nhẹ) và lưu vào Redis Cache dưới key `otp:password_reset:{email}` cùng thời gian TTL 10 phút, đặt `failed_attempts` = 0.
7. Gửi email OTP bằng tiếng Việt mặc định thông qua Email Service adapter.
8. Ghi nhận audit log sự kiện `PASSWORD_RESET_OTP_REQUESTED` non-blocking.
9. Trả về response thành công.

#### Luồng 2 - Xác nhận OTP và đặt lại mật khẩu:
1. Nhận request `POST /api/v1/auth/password-reset/confirm`.
2. Validate dữ liệu đầu vào:
   - Kiểm tra email, định dạng OTP (6 chữ số).
   - Kiểm tra độ an toàn của `newPassword` (đáp ứng rule BR2).
   - Kiểm tra `newPassword` khớp `confirmPassword`.
3. Kiểm tra OTP trên Redis:
   - Đọc dữ liệu cache từ key `otp:password_reset:{email}`.
   - Nếu không tồn tại -> Trả lỗi `400 Bad Request` ("Mã xác nhận không hợp lệ hoặc đã hết hạn").
   - Nếu `failed_attempts` >= 5 -> Hủy key Redis, trả lỗi `400 Bad Request` ("Mã xác nhận không hợp lệ hoặc đã hết hạn").
4. So sánh OTP:
   - Băm OTP người dùng nhập và so khớp với OTP hash trong Redis.
   - **IF không khớp**: Tăng `failed_attempts` thêm 1 trong Redis, ném lỗi `400 Bad Request` ("Mã xác nhận không hợp lệ hoặc đã hết hạn").
5. Băm mật khẩu mới bằng bcrypt/argon2.
6. Thực thi DB write transaction cập nhật bảng `users`:
   - Cập nhật `password_hash`.
   - Cập nhật `password_updated_at = now()`.
   - Đặt `must_change_password = false`.
7. Xóa key OTP `otp:password_reset:{email}` và key rate-limit trong Redis ngay lập tức.
8. Ghi nhận audit log sự kiện `PASSWORD_RESET_SUCCESS` non-blocking (lưu IP & User-Agent, không lưu plain pass/plain OTP).
9. Trả về response thành công.

---

## 8. Validation Plan

* **Dữ liệu đầu vào (API 1)**:
  * `email`: Phải có, đúng định dạng RFC 5322 email, trim whitespace, lowercase trước khi truy vấn.
* **Dữ liệu đầu vào (API 2)**:
  * `email`: Phải có, đúng định dạng.
  * `otp`: Phải có, định dạng regex `^\d{6}$`.
  * `newPassword` & `confirmPassword`: Phải có, trùng khớp nhau.
  * Độ phức tạp mật khẩu (`newPassword`):
    * Độ dài tối thiểu 8 ký tự.
    * Chứa ít nhất 1 chữ hoa, 1 chữ thường, 1 số, 1 ký tự đặc biệt.
* **Quy tắc đếm Rate Limit**:
  * Lưu trữ bộ đếm Redis tăng dần theo từng lượt gửi OTP thành công.
  * Chặn rate limit ở mức API 1 trước khi tiến hành tra cứu PostgreSQL để giảm thiểu rủi ro tấn công từ chối dịch vụ (DoS) vào database.

---

## 9. Error Handling Plan

* **Lỗi Validation**: `400 Bad Request` (Mã lỗi: `VALIDATION_ERROR`).
* **Lỗi Tài khoản không hợp lệ (E1)**: `400 Bad Request` (Mã lỗi: `AUTH_ACCOUNT_RESTRICTED`) - Dành chung cho mọi trường hợp email không tồn tại, bị xóa mềm, tài khoản locked, resigned, disabled để đảm bảo an toàn thông tin tối đa.
* **Lỗi OTP không hợp lệ/Hết hạn (E2)**: `400 Bad Request` (Mã lỗi: `AUTH_OTP_INVALID_OR_EXPIRED`) - Dành cho các lỗi OTP không tồn tại, hết hạn TTL, nhập sai quá 5 lần hoặc sai ký tự.
* **Lỗi Spam requests (E4)**: `429 Too Many Requests` (Mã lỗi: `AUTH_TOO_MANY_ATTEMPTS`) - Trả về khi gửi quá 3 lần trong 5 phút.
* **Lỗi Hệ thống gửi mail**: `500 Internal Server Error` (Mã lỗi: `AUTH_EMAIL_DISPATCH_FAILED`) - Ghi nhận log chi tiết lỗi SMTP nhưng không làm thay đổi trạng thái user trong DB.

---

## 10. Testing Strategy

### Unit Tests
* **Validation & Normalization Service**:
  * Kiểm tra trim và lowercase email.
  * Kiểm tra kiểm duyệt độ phức tạp mật khẩu mới.
  * Kiểm tra so khớp password và confirmPassword.
* **Rate Limiter Service**:
  * Kiểm tra cho phép gửi dưới 3 lần/5 phút.
  * Kiểm tra chặn lần thứ 4, tạo block key 60 phút và ném ra lỗi HTTP 429.
* **Auth Service (OTP Logic)**:
  * Kiểm tra sinh ngẫu nhiên OTP và băm trước khi lưu.
  * Kiểm tra đếm sai và tự hủy OTP sau 5 lần nhập sai.
  * Kiểm tra DB transaction cập nhật password hash, `password_updated_at` và `must_change_password`.
  * Kiểm tra non-blocking audit logs và logging khi lỗi SMTP xảy ra.

### Integration Tests
* **Database & Cache Integration**:
  * Kiểm tra tìm kiếm email hoạt động chính xác trong PostgreSQL loại bỏ soft deleted.
  * Kiểm tra Redis lưu cache đúng thời hạn TTL và tự động hết hiệu lực sau 10 phút.
  * Kiểm tra cơ chế thu hồi token: Tích hợp `JwtAuthGuard` kiểm tra JWT có `iat` cũ hơn `password_updated_at` của người dùng vừa đổi và từ chối truy cập.

### E2E / API Tests
* Đầy đủ các kịch bản tương ứng với **Acceptance Criteria**:
  * `POST /api/v1/auth/password-reset/request` (Happy Path, Email restricts, Spam blocker).
  * `POST /api/v1/auth/password-reset/confirm` (Happy Path, Invalid OTP, Sai mật khẩu chuẩn, Nhập sai quá 5 lần).

---

## 11. Implementation Phases

### Phase 0 - Outline & Research (Consolidation)
- Xác nhận các Redis client và SMTP configurations hiện có trong NestJS project để kế thừa.
- Thiết kế lớp Mail Service Adapter để tích hợp gửi mail.

### Phase 1 - Foundations & Cache Design
- Định nghĩa các DTO và Validation decorators (độ phức tạp mật khẩu, định dạng OTP).
- Hiện thực hóa Redis Cache manager dành riêng cho OTP và Rate Limit chống spam.
- Thiết lập email template bằng tiếng Việt cho nội dung gửi mã OTP.

### Phase 2 - Request OTP API (`/request`)
- Implement endpoint `POST /api/v1/auth/password-reset/request`.
- Thực thi strict rate-limiting kiểm soát spam.
- Thực thi tra cứu PostgreSQL loại bỏ các tài khoản resigned/deleted/inactive với thông báo lỗi E1 chung.
- Sinh mã OTP, băm và lưu Redis, kích hoạt email SMTP.
- Ghi nhận audit log yêu cầu OTP.

### Phase 3 - Confirm OTP & Reset API (`/confirm`)
- Implement endpoint `POST /api/v1/auth/password-reset/confirm`.
- Kiểm tra OTP trên Redis (sai quá 5 lần hủy key).
- Cập nhật an toàn mật khẩu đã hash mới cùng `password_updated_at` và `must_change_password = false` của người dùng.
- Xóa sạch cache session OTP trong Redis.
- Tích hợp kiểm duyệt JWT Revocation (`iat < password_updated_at`) trong `JwtAuthGuard` chung của hệ thống.
- Ghi nhận audit log thành công cùng IP/User-Agent.

### Phase 4 - Verification
- Hoàn thiện 100% độ bao phủ Unit tests, Integration tests, và E2E API tests.
- Kiểm tra linting và chuẩn hóa code.

---

## 12. Risks & Mitigations

* **Risk 1**: Nguy cơ rò rỉ mã OTP lưu trữ plain text trong cache Redis nếu server Redis bị tấn công.
  * **Mitigation**: Thực hiện băm (hash) OTP bằng thuật toán một chiều an toàn trước khi lưu vào Redis.
* **Risk 2**: Brute-force mã OTP 6 chữ số do thời gian TTL 10 phút khá dài.
  * **Mitigation**: Đặt giới hạn cứng tối đa 5 lần thử sai cho mỗi OTP session. Lần thứ 5 sai sẽ tự hủy hoàn toàn phiên xác thực.
* **Risk 3**: Spam gửi email liên tục gây nghẽn mail server hoặc tăng chi phí SMTP.
  * **Mitigation**: Thực thi Rate Limiter chặn cứng ngay từ tầng API Request ở mức 3 lần/5 phút trước khi truy vấn PostgreSQL.
* **Risk 4**: Lộ thông tin tài khoản nội bộ (Account Enumeration) qua API thông báo email tồn tại/không tồn tại.
  * **Mitigation**: Đồng bộ hóa toàn bộ các trường hợp lỗi liên quan đến tài khoản thành thông báo chung E1, trả cùng một mã lỗi và HTTP status.

---

## 13. Acceptance Criteria Traceability

| Acceptance Criteria từ spec.md | Plan Coverage | Các thành phần hiện thực hóa |
| :--- | :--- | :--- |
| **AC-001**: Yêu cầu OTP thành công | Mục 5, 7, 10, 11 | API Request, Redis TTL 10 phút, SMTP Dispatch, Audit logs |
| **AC-002**: Xác thực OTP & đổi mật khẩu thành công | Mục 5, 6, 7, 10, 11 | API Confirm, DB update, Token Revocation (`password_updated_at`), Hủy Redis OTP, Audit logs |
| **AC-003**: Email restrictions (E1) | Mục 2, 5, 7, 9, 11 | DB query filters, Thông báo lỗi bảo mật chung |
| **AC-004**: Sai OTP / Hết hạn (E2) | Mục 5, 7, 9, 11 | Redis TTL check, Sai quá 5 lần tự hủy OTP |
| **AC-005**: Mật khẩu mới không đạt chuẩn (E3) | Mục 5, 8, 11 | DTO Password complexity validation |
| **AC-006**: Rate Limit Spam protection (E4) | Mục 3, 5, 7, 8, 11 | Redis Rate Limiter counter & block key (3 lần/5 phút -> block 60 phút) |
