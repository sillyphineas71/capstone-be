# 📝 CHANGELOG & REVISION HISTORY
| Ngày cập nhật | Tóm tắt thay đổi | Các dòng thay đổi |
| :--- | :--- | :--- |
| 2026-05-27 | Tích hợp kết quả làm rõ (Clarifications) từ ý kiến của người dùng vào đặc tả chi tiết | Nhật ký làm rõ, các yêu cầu FR, Error, NFR liên quan |
| 2026-05-27 | Cập nhật định dạng câu EARS sang dạng song ngữ (Từ khóa tiếng Anh + Nội dung tiếng Việt) | Phần 3 (FRs), Phần 4 (NFRs), Phần 6 (Errors), Phần 8 (OOS) |
| 2026-05-27 | Khởi tạo tài liệu đặc tả tính năng Password Reset OTP (feat-password-reset-otp) | Toàn bộ tài liệu |

# Feature Specification: feat-password-reset-otp

- **Feature ID**: AUTH-OTP-003
- **Feature Name**: Tạo yêu cầu đặt lại mật khẩu bằng OTP (Password Reset with OTP)
- **Module / Domain**: auth (Xác thực & Ủy quyền)
- **Created Date**: 2026-05-27
- **Status**: Draft
- **Source Documents**:
  - UC-AUTH-03 Tạo yêu cầu đặt lại mật khẩu bằng OTP
  - [AGENTS.md](file:///c:/Users/Admin/Desktop/Capstone/capstone-be/AGENTS.md) (Quy tắc chung cho Backend & Database v3.2 Compact)
  - [database_v3_2_compact_39_tables.md](file:///c:/Users/Admin/Desktop/Capstone/capstone-be/database_v3_2_compact_39_tables.md)

---

## 1. Context & Goal

### 1.1 Bối cảnh
Tính năng này thuộc module `auth`. Khi người dùng quên mật khẩu đăng nhập hệ thống, họ cần có cơ chế an toàn và tiện lợi để tự khôi phục quyền truy cập vào tài khoản của mình. 
Thay vì sử dụng liên kết đặt lại mật khẩu (password reset link) dễ bị đánh cắp hoặc tấn công trung gian, hệ thống sử dụng mã OTP gồm 6 chữ số được gửi trực tiếp đến địa chỉ email đã đăng ký của người dùng để xác thực danh tính.

### 1.2 Mục tiêu
Mục tiêu của tính năng này là cho phép **Người dùng (User)** thực hiện **Đặt lại mật khẩu** thông qua **Mã xác thực OTP gửi qua Email** nhằm khôi phục quyền đăng nhập vào hệ thống mà không cần liên hệ quản trị viên (Admin).

### 1.3 Giá trị mang lại
- **Cho người dùng**: Khôi phục quyền truy cập tài khoản nhanh chóng, tự phục vụ (self-service) mọi lúc mọi nơi.
- **Cho quản trị viên**: Giảm thiểu công việc hỗ trợ kỹ thuật liên quan đến việc đặt lại mật khẩu thủ công.
- **Cho an toàn hệ thống**: Mã OTP 6 chữ số ngẫu nhiên có thời gian hiệu lực cực ngắn (10 phút) và tự hủy sau khi sử dụng thành công, giúp ngăn ngừa rủi ro bảo mật.
- **Cho bảo mật**: Ràng buộc spam gửi OTP liên tục giúp tránh việc lạm dụng hệ thống gửi mail.

### 1.4 Giả định
- Hệ thống Email của tổ chức hoạt động ổn định và có thể gửi email có chứa mã OTP trong vòng 10-30 giây.
- Người dùng có quyền truy cập vào hộp thư của địa chỉ email đã đăng ký trong hệ thống.
- Cấu hình Redis/Cache TTL được bật và hoạt động ổn định trên môi trường Backend để quản lý session OTP tạm thời.

### 1.5 Nhật ký Làm rõ (Clarifications)

#### Session 2026-05-27
- **Q1.1 (JWT Revocation)**: Sau khi reset password thành công, hệ thống bắt buộc invalidate toàn bộ access token cũ của user. Vì hệ thống dùng stateless JWT và không còn `user_sessions`, sử dụng user-level invalidation marker (như check `iat < password_updated_at` trong Auth Guard).
- **Q1.2 (must_change_password)**: Nếu user đang có `must_change_password = true`, sau khi reset password bằng OTP thành công thì cập nhật thành `must_change_password = false`.
- **Q3.1 (Spam limits)**: Cho phép tối đa 3 lần request/resend OTP trong 5 phút. Lần thứ 4 trong cùng cửa sổ 5 phút sẽ bị block và trả về lỗi HTTP 429. Block password reset của email đó trong 60 phút.
- **Q4.1 (Audit logs metadata)**: Bắt buộc lưu IP và User-Agent (nếu lấy được) trong `metadata_json` của `audit_logs`. Tuyệt đối không lưu plain OTP, plain password hoặc dữ liệu nhạy cảm không cần thiết.
- **Q5.1 (Soft Delete & Account Enumeration)**: Tài khoản bị xóa mềm, nghỉ việc (resigned), bị khóa (locked), vô hiệu hóa (inactive/disabled) đều trả cùng một mã lỗi HTTP 400 và thông báo lỗi E1: "Email không tồn tại hoặc tài khoản đã bị khóa. Vui lòng kiểm tra lại." để tránh lộ thông tin nội bộ.
- **Q5.2 (OTP Wrong attempts)**: Giới hạn tối đa 5 lần nhập sai OTP cho mỗi OTP session. Lần thứ 5 sẽ hủy OTP trong Redis và yêu cầu lấy mã mới.
- **Q7.1 (Multi-language)**: Không hỗ trợ đa ngôn ngữ trong v1. Email OTP mặc định dùng tiếng Việt.

---

## 2. Actor & Roles

### 2.1 Danh sách actor

| Actor | Vai trò trong tính năng | Quyền / Trách nhiệm chính |
|---|---|---|
| **User (Người dùng)** | Chủ thể thực hiện yêu cầu | Nhập email, nhận mã OTP, nhập OTP và mật khẩu mới để đặt lại. |
| **Hệ thống Email** | Actor phụ trợ (Secondary Actor) | Nhận yêu cầu gửi email từ backend và chuyển tiếp email chứa mã OTP đến hộp thư của User. |

### 2.2 Role & Permission Rules
- Bất kỳ người dùng nào sở hữu một tài khoản email đã hoạt động trong hệ thống đều có thể thực hiện chức năng này mà không cần đăng nhập trước (nằm ngoài phạm vi RBAC của tài khoản đã đăng nhập).

### 2.3 Actor Constraints
- Người dùng phải truy cập từ màn hình Đăng nhập của hệ thống web (chưa xác thực).
- Địa chỉ email nhập vào phải thuộc một tài khoản đang ở trạng thái hoạt động (`active`) trong hệ thống (không bị khóa hay vô hiệu hóa).

---

## 3. Functional Requirements

### 3.1 Core Requirements
- `FR-AUTH-OTP-001`: THE system SHALL [lưu trữ thông tin xác thực OTP trong bộ nhớ tạm thời (Redis/Cache TTL) với thời gian hết hạn là 10 phút] (BR1).
- `FR-AUTH-OTP-002`: THE system SHALL [áp dụng các quy chuẩn bảo mật mật khẩu (tối thiểu 8 ký tự, bao gồm ít nhất một chữ hoa, một chữ thường, một ký tự đặc biệt, và một chữ số) cho bất kỳ dữ liệu mật khẩu mới nào được nhập vào] (BR2).
- `FR-AUTH-OTP-003`: THE system SHALL [vô hiệu hóa và xóa bỏ mã OTP khỏi bộ nhớ tạm thời ngay lập tức sau khi mã được dùng để đặt lại mật khẩu thành công] (BR3).
- `FR-AUTH-OTP-004`: THE system SHALL NOT [tạo hoặc sử dụng bất kỳ bảng cơ sở dữ liệu vật lý lâu dài nào cho các yêu cầu đặt lại mật khẩu, mà phải lưu toàn bộ dữ liệu OTP tạm thời trong bộ nhớ cache tại thời điểm chạy (runtime)].

### 3.2 Event-driven Requirements
- `FR-AUTH-OTP-005`: WHEN [người dùng gửi yêu cầu đặt lại mật khẩu bằng email], THE system SHALL [kiểm tra sự tồn tại của email và đảm bảo trạng thái tài khoản của người dùng `users.account_status` đang hoạt động `active`] (E1).
- `FR-AUTH-OTP-006`: WHEN [địa chỉ email hoạt động hợp lệ được xác thực], THE system SHALL [sinh ngẫu nhiên một mã OTP gồm 6 chữ số, lưu trữ mã này trong bộ nhớ tạm thời với thời gian TTL là 10 phút, và kích hoạt tiến trình gửi email thông qua Hệ thống Email].
- `FR-AUTH-OTP-007`: WHEN [tiến trình gửi email chứa mã OTP được bắt đầu], THE system SHALL [chuyển hướng người dùng sang màn hình "Xác thực & Đặt lại mật khẩu" và bắt đầu đếm ngược thời gian hiệu lực 10 phút].
- `FR-AUTH-OTP-008`: WHEN [người dùng yêu cầu gửi lại mã (Resend OTP)], THE system SHALL [vô hiệu hóa mã OTP hiện tại của email đó, khởi tạo một mã OTP 6 chữ số mới, kích hoạt tiến trình gửi email mới, và đặt lại đồng hồ đếm ngược về 10 phút] (A1).
- `FR-AUTH-OTP-009`: WHEN [người dùng nhập chính xác mã OTP kèm mật khẩu mới hợp lệ], THE system SHALL [cập nhật trường `password_hash` trong bảng `users`, cập nhật trường `password_updated_at` thành thời gian hiện tại, đặt trường `must_change_password` thành `false`, thu hồi (invalidate) toàn bộ JWT Access Token cũ của người dùng này thông qua cơ chế kiểm tra `iat < password_updated_at` trong Auth Guard, và tự động chuyển hướng người dùng về màn hình Đăng nhập với thông báo thành công].

### 3.3 State-driven Requirements
- `FR-AUTH-OTP-010`: WHILE [mã OTP còn trong khoảng thời gian hiệu lực 10 phút và chưa được sử dụng], THE system SHALL [chấp nhận các yêu cầu xác thực OTP từ phía người dùng].
- `FR-AUTH-OTP-011`: WHILE [tài khoản email bị khóa tạm thời do gửi yêu cầu quá giới hạn (Spam protection)], THE system SHALL [từ chối mọi yêu cầu đặt lại mật khẩu mới cho email đó].

### 3.4 Optional Feature Requirements
- `FR-AUTH-OTP-012`: WHERE [các cấu hình dịch vụ email tùy chỉnh tồn tại], THE system SHALL [sử dụng template email mặc định bằng tiếng Việt (không hỗ trợ đa ngôn ngữ ở v1) và thông tin máy chủ SMTP đã được định nghĩa để định dạng và gửi email chứa mã OTP một cách an toàn].

### 3.5 Unwanted Behavior Requirements
- `FR-AUTH-OTP-013`: IF [địa chỉ email được gửi lên không tồn tại trong hệ thống, tài khoản bị xóa mềm (`deleted_at IS NOT NULL`), trạng thái nghỉ việc (`resigned`), bị khóa (`locked`), hoặc vô hiệu hóa (`inactive/disabled`)], THEN THE system SHALL [từ chối yêu cầu và trả về cùng một mã lỗi HTTP 400 kèm thông báo cảnh báo: "Email không tồn tại hoặc tài khoản đã bị khóa. Vui lòng kiểm tra lại" (E1) để tránh việc dò quét tài khoản nội bộ].
- `FR-AUTH-OTP-014`: IF [người dùng nhập sai mã OTP hoặc phiên xác thực OTP đã hết hạn], THEN THE system SHALL [từ chối yêu cầu, tăng số lần thử sai trong bộ nhớ tạm. Nếu số lần nhập sai đạt tối đa 5 lần cho phiên OTP hiện tại, lập tức hủy mã OTP này trong Redis và trả về lỗi: "Mã xác nhận không hợp lệ hoặc đã hết hạn" (E2)].
- `FR-AUTH-OTP-015`: IF [mật khẩu mới không đáp ứng quy chuẩn bảo mật hoặc không trùng khớp với trường mật khẩu xác nhận], THEN THE system SHALL [từ chối yêu cầu và trả về lỗi kiểm tra mật khẩu tương ứng] (E3).
- `FR-AUTH-OTP-016`: IF [người dùng gửi yêu cầu hoặc gửi lại mã OTP lần thứ 4 trong vòng 5 phút (vượt quá giới hạn tối đa 3 lần)], THEN THE system SHALL [tạm thời khóa chức năng khôi phục mật khẩu đối với email này trong vòng 60 phút, trả về lỗi HTTP 429 và thông báo: "Bạn đã thao tác quá nhiều lần. Vui lòng thử lại sau 60 phút" (E4)].
- `FR-AUTH-OTP-017`: IF [việc gửi email thất bại do lỗi kết nối SMTP của Hệ thống Email], THEN THE system SHALL [ghi log chi tiết sự kiện lỗi và trả về mã lỗi được kiểm soát cho người dùng mà không làm thay đổi trạng thái của cơ sở dữ liệu].

### 3.6 Workflow Requirements
- `FR-AUTH-OTP-018`: WHEN [quy trình khôi phục mật khẩu bắt đầu], THE system SHALL [khởi tạo bộ đếm theo dõi giới hạn rate-limiting (spam protection) trong bộ nhớ tạm thời].
- `FR-AUTH-OTP-019`: WHEN [quá trình đặt lại mật khẩu hoàn tất thành công], THE system SHALL [ghi nhận một bản ghi audit log để lưu vết sự kiện khôi phục mật khẩu thành công (bao gồm ID người dùng, nhãn thời gian và IP/ngữ cảnh)].

### 3.7 Authorization Requirements
- `FR-AUTH-OTP-020`: WHEN [thực thi callback đặt lại mật khẩu], THE system SHALL [kiểm tra và xác thực rằng hành động này được thực hiện qua một phiên xác thực OTP hợp lệ, ngăn chặn việc cập nhật mật khẩu trực tiếp mà không thông qua xác thực].

### 3.8 Data & State Requirements
- `FR-AUTH-OTP-021`: WHEN [mật khẩu được đặt lại thành công], THE system SHALL [cập nhật trường `password_hash` của người dùng thành mật khẩu đã được hash và cập nhật trường `password_updated_at` trong cơ sở dữ liệu].

### 3.9 Notification / Audit Requirements
- `FR-AUTH-OTP-022`: WHEN [mật khẩu được thay đổi thành công], THE system SHALL [ghi lại một bản ghi audit log chứa tên đăng nhập của tác nhân, hành động 'PASSWORD_RESET_SUCCESS', nhãn thời gian, địa chỉ IP và thông tin thiết bị User-Agent (nếu lấy được) trong metadata_json (tuyệt đối không lưu plain OTP hay plain password)].

### 3.13 Traceability

| Requirement ID | EARS Pattern | Nguồn / Use Case liên quan | Ghi chú |
|---|---|---|---|
| FR-AUTH-OTP-001 | Ubiquitous | BR1 | Lưu OTP trong Redis với TTL 10 phút. |
| FR-AUTH-OTP-002 | Ubiquitous | BR2 | Chuẩn mật khẩu tối thiểu 8 ký tự, đủ loại ký tự. |
| FR-AUTH-OTP-003 | Ubiquitous | BR3 | Vô hiệu hóa OTP sau khi đổi thành công. |
| FR-AUTH-OTP-004 | Ubiquitous | DB v3.2 Compact | Không dùng bảng cơ sở dữ liệu vật lý. |
| FR-AUTH-OTP-005 | Event-driven | Flow 4, E1 | Kiểm tra sự tồn tại và trạng thái email. |
| FR-AUTH-OTP-006 | Event-driven | Flow 5 | Tạo mã 6 số và gửi email. |
| FR-AUTH-OTP-007 | Event-driven | Flow 6 | Đổi màn hình, đếm ngược thời gian. |
| FR-AUTH-OTP-008 | Event-driven | A1 | Gửi lại OTP mới, hủy OTP cũ. |
| FR-AUTH-OTP-009 | Event-driven | Flow 9 | Cập nhật DB và redirect về Login. |
| FR-AUTH-OTP-010 | State-driven | BR1 | Chỉ xác thực OTP trong thời gian hiệu lực. |
| FR-AUTH-OTP-011 | State-driven | E4 | Khóa yêu cầu trong 60 phút nếu spam. |
| FR-AUTH-OTP-013 | Unwanted Behavior | E1 | Xử lý lỗi Email không tồn tại/bị khóa. |
| FR-AUTH-OTP-014 | Unwanted Behavior | E2 | Xử lý lỗi OTP không khớp/hết hạn. |
| FR-AUTH-OTP-015 | Unwanted Behavior | E3 | Xử lý lỗi mật khẩu không đạt chuẩn. |
| FR-AUTH-OTP-016 | Unwanted Behavior | E4 | Rate limit chặn spam gửi OTP. |
| FR-AUTH-OTP-017 | Unwanted Behavior | System Failure | Xử lý lỗi gửi Email SMTP thất bại. |

---

## 4. Non-functional Requirements

### 4.1 Performance
- `NFR-AUTH-OTP-001`: THE system SHALL [khởi tạo mã OTP và đưa email gửi mã vào hàng đợi giao nhận trong vòng tối đa 1 giây kể từ khi nhận được yêu cầu hợp lệ].
- `NFR-AUTH-OTP-002`: THE system SHALL [xác thực OTP và thực thi giao dịch đặt lại mật khẩu trong thời gian dưới 500 mili giây dưới điều kiện tải thông thường].

### 4.2 Security
- `NFR-AUTH-OTP-003`: THE system SHALL [thực hiện hash mã OTP trước khi lưu trữ vào bộ nhớ tạm để phòng tránh rủi ro khai thác thông tin từ bộ nhớ].
- `NFR-AUTH-OTP-004`: THE system SHALL NOT [trả về mã OTP đã được tạo trong bất kỳ nội dung phản hồi API (response body) nào].
- `NFR-AUTH-OTP-005`: THE system SHALL [sử dụng bộ sinh số ngẫu nhiên có độ an toàn mã hóa cao (secure cryptographically strong random number generator) để tạo ra mã OTP 6 chữ số].
- `NFR-AUTH-OTP-006`: THE system SHALL [bắt buộc mật khẩu mới được băm bằng bcrypt/argon2 với các hệ số xử lý tiêu chuẩn trước khi lưu trữ vào cơ sở dữ liệu].

### 4.3 Reliability & Consistency
- `NFR-AUTH-OTP-007`: THE system SHALL [thực hiện việc cập nhật mật khẩu và vô hiệu hóa mã OTP như là một giao dịch nguyên tử (atomic operation) hoặc tuần tự với cam kết xóa tuyệt đối để ngăn chặn việc tái sử dụng OTP].
- `NFR-AUTH-OTP-008`: THE system SHALL [duy trì trạng thái người dùng nhất quán trong cơ sở dữ liệu, tự động khôi phục (rollback) mọi thay đổi nếu giao dịch cơ sở dữ liệu gặp lỗi trong quá trình đặt lại].

### 4.4 Usability
- `NFR-AUTH-OTP-009`: THE system SHALL [trả về các thông báo lỗi chuẩn hóa và có thể bản địa hóa cho ứng dụng phía client đối với bất kỳ lỗi kiểm tra hoặc lỗi vi phạm quy tắc nghiệp vụ nào].

### 4.5 Observability
- `NFR-AUTH-OTP-010`: THE system SHALL [ghi nhận audit log đối với các sự kiện bảo mật quan trọng bao gồm: yêu cầu đặt lại mật khẩu, đặt lại mật khẩu hoàn tất, vượt quá giới hạn rate limit và các lượt thử xác thực thất bại].

---

## 5. Data Model

### 5.1 Entity liên quan

| Entity / Table | Vai trò trong tính năng | Ghi chú |
|---|---|---|
| `users` | Lưu thông tin tài khoản đích. | Cập nhật `password_hash`, `password_updated_at`, và đọc `account_status`, `must_change_password`. |
| `audit_logs` | Ghi nhận nhật ký bảo mật của hệ thống. | Tạo mới bản ghi audit log khi yêu cầu OTP hoặc đặt lại thành công. |

### 5.2 Dữ liệu đầu vào

#### API 1: Yêu cầu gửi OTP (`POST /api/v1/auth/password-reset/request`)
| Field | Type dự kiến | Bắt buộc | Mô tả | Validation |
|---|---:|---:|---|---|
| `email` | `string` | Có | Email đăng ký của tài khoản cần khôi phục. | Định dạng email hợp lệ, không rỗng, tối đa 255 ký tự. |

#### API 2: Đặt lại mật khẩu (`POST /api/v1/auth/password-reset/confirm`)
| Field | Type dự kiến | Bắt buộc | Mô tả | Validation |
|---|---:|---:|---|---|
| `email` | `string` | Có | Email đăng ký của tài khoản cần khôi phục. | Định dạng email hợp lệ. |
| `otp` | `string` | Có | Mã OTP gồm 6 chữ số nhận qua email. | Chuỗi gồm đúng 6 chữ số `^\d{6}$`. |
| `newPassword` | `string` | Có | Mật khẩu mới cần thiết lập. | Tối thiểu 8 ký tự, chứa chữ hoa, chữ thường, số, ký tự đặc biệt. |
| `confirmPassword` | `string` | Có | Mật khẩu xác nhận. | Phải trùng khớp hoàn toàn với `newPassword`. |

### 5.3 Dữ liệu đầu ra

#### Response API 1 (Yêu cầu gửi OTP thành công)
```json
{
  "success": true,
  "message": "Mã xác thực đã được gửi tới email của bạn. Vui lòng kiểm tra hộp thư."
}
```

#### Response API 2 (Đặt lại mật khẩu thành công)
```json
{
  "success": true,
  "message": "Đổi mật khẩu thành công. Vui lòng đăng nhập lại bằng mật khẩu mới."
}
```

### 5.4 State / Status Model
Trạng thái lưu trữ OTP tạm thời trong Redis/Cache:

| State Key | Trạng thái | Điều kiện chuyển | Mô tả |
|---|---|---|---|
| `otp:password_reset:{email}` | **Active** (Còn hiệu lực) | Được tạo sau khi gửi email thành công. | Chứa OTP hash, số lần thử sai, thời gian hết hạn (TTL 10 phút). |
| `otp:password_reset:{email}` | **Expired** (Hết hiệu lực) | Hết 10 phút hoặc bị hủy khi yêu cầu gửi lại. | Dữ liệu tự động bị xóa khỏi Cache bởi cơ chế TTL. |
| `otp:password_reset:{email}` | **Deleted** (Đã xóa) | Xóa ngay khi đặt lại mật khẩu thành công. | OTP bị xóa hoàn toàn, không thể tái sử dụng. |

Trạng thái Rate Limit ngăn Spam gửi OTP:

| State Key | Trạng thái | Điều kiện chuyển | Mô tả |
|---|---|---|---|
| `otp_limit:password_reset:{email}` | **Tracking** (Theo dõi) | Tăng dần sau mỗi lần gửi OTP thành công. | Chứa số lần yêu cầu gửi mã của email trong vòng 5 phút. |
| `otp_blocked:password_reset:{email}` | **Blocked** (Đang khóa) | Kích hoạt khi số lần yêu cầu > 3 lần. | Tự động chặn mọi yêu cầu gửi OTP mới từ email này trong 60 phút. |

---

## 6. Error Handling

### 6.1 Validation Errors
- `ERR-AUTH-OTP-001`: IF [trường dữ liệu `email` bị thiếu hoặc không hợp lệ], THEN THE system SHALL [từ chối yêu cầu với lỗi HTTP `400 Bad Request` và trả về thông tin kiểm tra chi tiết].
- `ERR-AUTH-OTP-002`: IF [trường dữ liệu `otp` không chứa chính xác 6 chữ số], THEN THE system SHALL [từ chối yêu cầu với lỗi HTTP `400 Bad Request`].
- `ERR-AUTH-OTP-003`: IF [trường mật khẩu mới `newPassword` hoặc mật khẩu xác nhận `confirmPassword` không đáp ứng quy chuẩn bảo mật], THEN THE system SHALL [từ chối yêu cầu với lỗi HTTP `400 Bad Request`].

### 6.2 Authentication / Authorization Errors
- Bất kỳ ai cũng có thể truy cập hai API này mà không cần Bearer token (API Public). Tuy nhiên, nếu có token được gửi kèm, hệ thống có thể từ chối hoặc bỏ qua để đảm bảo tính cô lập của luồng khôi phục.

### 6.3 Business Rule Errors
- `ERR-AUTH-OTP-004`: IF [người dùng cố gắng đặt lại mật khẩu bằng mã OTP đã hết hạn, nhập sai quá 5 lần hoặc đã bị xóa], THEN THE system SHALL [trả về lỗi HTTP `400 Bad Request` cùng thông báo: "Mã xác nhận không hợp lệ hoặc đã hết hạn"].
- `ERR-AUTH-OTP-005`: IF [người dùng nhập sai mã OTP], THEN THE system SHALL [tăng số lần thử sai trong cache. Nếu số lần nhập sai vượt quá 5 lần, ngay lập tức vô hiệu hóa và xóa phiên xác thực OTP đó trong Redis và trả về lỗi HTTP `400 Bad Request`].

### 6.4 Conflict Errors
- `ERR-AUTH-OTP-006`: IF [mật khẩu mới giống hệt mật khẩu hiện tại của người dùng], THEN THE system SHALL [chấp nhận việc đặt lại mật khẩu mà không chặn lại].

### 6.5 Integration / Device / External Service Errors
- `ERR-AUTH-OTP-007`: IF [Hệ thống Email hoặc máy chủ SMTP gặp lỗi không phản hồi], THEN THE system SHALL [ghi lại sự kiện lỗi này trong nhật ký hệ thống ở mức `error` và trả về lỗi HTTP `500 Internal Server Error` cùng thông báo rằng email không thể gửi đi].

---

## 7. Acceptance Criteria

### 7.1 Happy Path
- **AC-001: Yêu cầu mã OTP khôi phục mật khẩu thành công**
  - **Given**: Người dùng ở màn hình Đăng nhập của hệ thống web và nhập email hợp lệ `employee@company.com` đã được đăng ký và đang hoạt động.
  - **When**: Người dùng nhấn vào "Quên mật khẩu?" và chọn "Gửi mã xác nhận".
  - **Then**: 
    1. Hệ thống kiểm tra hợp lệ, tạo mã OTP 6 chữ số ngẫu nhiên.
    2. Hệ thống lưu mã OTP (được hash) vào Redis Cache với TTL 10 phút.
    3. Hệ thống gửi email chứa mã OTP đến `employee@company.com`.
    4. Hệ thống trả về response thành công, giao diện chuyển sang màn hình nhập OTP & mật khẩu mới, bắt đầu đếm ngược.
    5. Hệ thống ghi một bản ghi vào `audit_logs` với sự kiện `PASSWORD_RESET_OTP_REQUESTED`.

- **AC-002: Xác thực OTP và Đặt lại mật khẩu thành công**
  - **Given**: Người dùng đang ở màn hình nhập OTP, đã nhận được OTP hợp lệ qua email.
  - **When**: Người dùng nhập đúng mã OTP, nhập mật khẩu mới đạt chuẩn bảo mật, khớp mật khẩu xác nhận và nhấn "Xác nhận".
  - **Then**:
    1. Hệ thống xác thực mã OTP khớp và còn hiệu lực.
    2. Hệ thống hash mật khẩu mới, cập nhật vào trường `password_hash` và cập nhật `password_updated_at = now()`, `must_change_password = false` của user trong cơ sở dữ liệu.
    3. Hệ thống xóa bỏ mã OTP khỏi Redis Cache ngay lập tức.
    4. Hệ thống trả về response thành công và tự động redirect người dùng về trang Đăng nhập.
    5. Hệ thống ghi nhận sự kiện `PASSWORD_RESET_SUCCESS` vào `audit_logs`.

### 7.2 Validation & Exception Cases
- **AC-003: Email không tồn tại hoặc bị khóa**
  - **Given**: Người dùng nhập email không tồn tại trong hệ thống (ví dụ: `unknown@company.com`) hoặc email của một tài khoản có `account_status = 'locked'` hoặc `'inactive'`.
  - **When**: Người dùng nhấn "Gửi mã xác nhận".
  - **Then**: Hệ thống chặn yêu cầu, trả về HTTP 400 và hiển thị thông báo lỗi: "Email không tồn tại hoặc tài khoản đã bị khóa. Vui lòng kiểm tra lại". Không có email nào được gửi và không tạo phiên OTP trong Redis.

- **AC-004: Mã OTP không chính xác hoặc hết hạn**
  - **Given**: Người dùng đang ở màn hình nhập OTP.
  - **When**: Người dùng nhập sai mã OTP hoặc nhập mã OTP đã quá thời hạn 10 phút hiệu lực và nhấn "Xác nhận".
  - **Then**: Hệ thống từ chối yêu cầu, trả về lỗi HTTP 400 và hiển thị thông báo lỗi: "Mã xác nhận không hợp lệ hoặc đã hết hạn".

- **AC-005: Mật khẩu mới không đạt chuẩn bảo mật**
  - **Given**: Người dùng nhập OTP đúng nhưng mật khẩu mới chỉ có 6 ký tự hoặc không chứa chữ hoa/ký tự đặc biệt.
  - **When**: Người dùng nhấn "Xác nhận".
  - **Then**: Hệ thống trả về lỗi validation HTTP 400, bôi đỏ các trường tương ứng và hiển thị thông báo yêu cầu người dùng điều chỉnh lại mật khẩu cho đúng quy chuẩn bảo mật.

- **AC-006: Gửi yêu cầu quá nhiều lần (Spam Protection)**
  - **Given**: Người dùng đã nhấn gửi mã OTP thành công 3 lần trong vòng 5 phút.
  - **When**: Người dùng tiếp tục nhấn nút "Gửi mã xác nhận" hoặc "Gửi lại mã" lần thứ 4.
  - **Then**: Hệ thống tạm khóa tính năng khôi phục của email này trong vòng 60 phút, trả về lỗi HTTP 429 và thông báo: "Bạn đã thao tác quá nhiều lần. Vui lòng thử lại sau 60 phút".

---

## 8. Out of Scope

Các nội dung sau **không thuộc phạm vi** của tính năng này:
- Không tích hợp gửi mã OTP qua tin nhắn SMS hoặc ứng dụng OTT (Zalo, Telegram, v.v.). Chỉ hỗ trợ gửi qua kênh Email.
- Không triển khai giao diện hoặc API đổi mật khẩu khi người dùng đã đăng nhập thành công (đó là tính năng "Đổi mật khẩu" thuộc module Account Management).
- Không tự động đăng nhập người dùng sau khi khôi phục mật khẩu thành công. Người dùng bắt buộc phải quay lại màn hình Đăng nhập và tự điền mật khẩu mới để đăng nhập.
- Không hỗ trợ Vector database, AI Document, hay các phương thức xác thực sinh trắc học khuôn mặt trong luồng quên mật khẩu này.
- `OOS-001`: THE system SHALL NOT [tạo mới bất kỳ bảng cơ sở dữ liệu vật lý nào (như `password_reset_requests`) do chúng đã được lược bỏ trong thiết kế Database v3.2 Compact].
- `OOS-002`: THE system SHALL NOT [cho phép tái sử dụng mã OTP trong bất kỳ trường hợp nào].
