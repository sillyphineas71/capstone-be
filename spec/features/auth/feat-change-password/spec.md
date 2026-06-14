# 📝 CHANGELOG & REVISION HISTORY
| Ngày cập nhật | Tóm tắt thay đổi | Các dòng thay đổi |
| :--- | :--- | :--- |
| 2026-05-27 | Tích hợp toàn bộ 8 câu trả lời Clarification (Q-BL-01..Q-SB-01) vào spec: JWT passive invalidation, E5 dual-layer, must_change_password guard, bcrypt maxLength 72, rate-limit v1, DB row-level lock, AC positive JWT, email OOS xác nhận | Mục 1.4, 1.5, 1.6 (mới), 2.3, 3.1, 3.2, 3.3, 3.4, 3.5, 3.8, 3.9, 3.13, 4.1, 5.2, 6.1, 6.3, 7.5, 7.6 (mới), 7.8, 8.1, 8.3 |
| 2026-05-27 | Khởi tạo tài liệu đặc tả tính năng Thay đổi mật khẩu (feat-change-password) từ UC-AUTH-04 | Toàn bộ tài liệu |

# Feature Specification: feat-change-password

- **Feature ID**: AUTH-CHPWD-004
- **Feature Name**: Thay đổi mật khẩu đăng nhập (Change Password)
- **Module / Domain**: auth (Xác thực & Ủy quyền)
- **Created Date**: 2026-05-27
- **Status**: Draft — Clarified
- **Source Documents**:
  - UC-AUTH-04 Thay đổi mật khẩu đăng nhập
  - [AGENTS.md](file:///d:/FPT/Capstone/capstone-be/AGENTS.md) (Quy tắc chung cho Backend & Database v3.2 Compact)
  - Database v3.2 Compact (39 bảng)

---

## 1. Context & Goal

### 1.1 Bối cảnh

Tính năng này thuộc module `auth`. Người dùng đang trong phiên đăng nhập hợp lệ có nhu cầu thay đổi mật khẩu cá nhân nhằm chủ động nâng cao bảo mật hoặc tuân thủ chính sách đổi mật khẩu định kỳ của tổ chức.

Khác với luồng **Quên mật khẩu (UC-AUTH-03)** dành cho người dùng chưa xác thực, tính năng này yêu cầu người dùng **phải đang đăng nhập** và **phải xác minh chính xác mật khẩu hiện tại** trước khi cập nhật sang mật khẩu mới. Đây là cơ chế đảm bảo chính chủ đang thực hiện thao tác, ngăn chặn kẻ tấn công lợi dụng phiên đăng nhập bị bỏ quên để đổi mật khẩu mà không cần biết mật khẩu gốc.

Tính năng này phục vụ phần **quản lý tài khoản cá nhân** trong meeting lifecycle, không liên quan đến phòng họp, thiết bị hay recording.

### 1.2 Mục tiêu

Mục tiêu của tính năng này là cho phép **Người dùng đã đăng nhập (Authenticated User)** thực hiện **Thay đổi mật khẩu đăng nhập** bằng cách xác minh mật khẩu hiện tại và nhập mật khẩu mới, nhằm **chủ động bảo vệ tài khoản cá nhân và tuân thủ chính sách bảo mật của tổ chức**.

### 1.3 Giá trị mang lại

- **Cho người dùng**: Chủ động nâng cao bảo mật tài khoản cá nhân bất kỳ lúc nào mà không cần liên hệ Admin.
- **Cho quản trị viên / tổ chức**: Đảm bảo người dùng tuân thủ chính sách đổi mật khẩu định kỳ, giảm thiểu rủi ro lộ lọt thông tin.
- **Cho an toàn hệ thống**: Cơ chế xác minh mật khẩu cũ ngăn chặn kẻ tấn công lợi dụng phiên đăng nhập đang mở để chiếm tài khoản.
- **Cho audit / vận hành**: Mọi sự kiện thay đổi mật khẩu được ghi nhận vào `audit_logs` để truy vết khi cần thiết.

### 1.4 Giả định

- Người dùng đã đăng nhập thành công và đang giữ JWT Access Token hợp lệ.
- Hệ thống dùng cơ chế Stateless JWT Blacklist (qua Redis Cache) thay vì bảng `user_sessions` (đã bị lược bỏ trong Database v3.2 Compact).
- **JWT Invalidation là passive**: Request `PATCH /api/v1/auth/change-password` được phép hoàn tất nếu token hợp lệ lúc bắt đầu. Sau khi đổi thành công, hệ thống cập nhật `users.password_updated_at`. Auth Guard sẽ reject mọi JWT có `iat < password_updated_at` với HTTP 401 ở **các request tiếp theo** — không có active revoke trong cùng response.
- Chính sách mật khẩu mặc định: tối thiểu 8 ký tự, tối đa 72 ký tự (giới hạn bcrypt), bao gồm chữ hoa, chữ thường, số và ký tự đặc biệt (theo BR1 trong Use Case nguồn).
- Bcrypt được sử dụng làm thuật toán hash. Do đó tất cả trường password có `maxLength = 72` ký tự.
- `must_change_password = true` được Admin/system set khi tài khoản mới tạo hoặc dùng mật khẩu tạm thời. Khi cờ này là `true`, người dùng chỉ được phép gọi `/auth/me`, `/auth/change-password`, `/auth/logout` — các API nghiệp vụ khác bị chặn bởi guard cho đến khi đổi mật khẩu thành công.
- Rate limit được triển khai trong v1: tối đa 5 lần nhập sai `currentPassword` trong 15 phút/user. Lần thứ 6 → HTTP 429 + block 15 phút.
- Race condition được xử lý bằng DB transaction + row-level lock (SELECT ... FOR UPDATE trên `users`) — không dùng last-write-wins.

### 1.5 Phạm vi làm rõ đã giải quyết

Các điểm từng mơ hồ đã được làm rõ qua phiên Clarification 2026-05-27. Xem chi tiết tại mục **1.6 Nhật ký Làm rõ**.

### 1.6 Nhật ký Làm rõ (Clarifications)

#### Session 2026-05-27

- **Q-BL-01 (JWT Invalidation)**: Token hiện tại (dùng để gọi API đổi mật khẩu) được phép hoàn tất nếu hợp lệ lúc bắt đầu. Passive invalidation: Auth Guard reject `iat < password_updated_at` ở các request tiếp theo. Không active revoke trong cùng response.
- **Q-BL-02 (E5 dual-layer check)**: Kiểm tra "mật khẩu mới trùng mật khẩu cũ" ở cả client (plain text `newPassword === currentPassword` để hỗ trợ UX) và bắt buộc ở server (`bcrypt.compare(newPassword, user.password_hash)`). Client-side không thay thế server-side.
- **Q-BL-03 (must_change_password guard)**: Cờ do Admin/system set cho tài khoản mới tạo / mật khẩu tạm. Khi `must_change_password = true`, chỉ cho phép `/auth/me`, `/auth/change-password`, `/auth/logout`; các API nghiệp vụ khác bị block. Set `false` sau khi đổi mật khẩu thành công.
- **Q-VR-01 (maxLength bcrypt)**: Giới hạn tối đa 72 ký tự cho tất cả trường password (giới hạn bcrypt). `currentPassword`: required + maxLength 72, không kiểm tra complexity. `newPassword`: required, min 8, max 72, có chữ hoa, chữ thường, số, ký tự đặc biệt.
- **Q-EH-01 (Rate limit v1)**: Triển khai trong v1. Tối đa 5 lần sai `currentPassword` trong 15 phút/user → lần thứ 6 trả HTTP 429 + block 15 phút. Redis keys: `change_password:failed:{userId}` và `change_password:block:{userId}`.
- **Q-EH-02 (Race condition)**: DB transaction + row-level lock (SELECT ... FOR UPDATE) trên `users`. Trong transaction: lock row → kiểm tra `account_status` → verify `currentPassword` → validate `newPassword` → update → commit. Nếu account bị lock/disabled/deleted trước khi update → request bị từ chối.
- **Q-AC-01 (Positive JWT AC)**: Có, cần thêm AC positive: JWT được issued SAU `password_updated_at` (sau khi login lại bằng mật khẩu mới) phải được Auth Guard chấp nhận và gọi protected API thành công.
- **Q-SB-01 (Email notification)**: Không gửi email thông báo đổi mật khẩu trong v1. Chỉ ghi `audit_logs`. Email notification là out of scope, xác nhận rõ ràng.

---

## 2. Actor & Roles

### 2.1 Danh sách actor

| Actor | Vai trò trong tính năng | Quyền / Trách nhiệm chính |
|---|---|---|
| **User (Người dùng đã đăng nhập)** | Chủ thể thực hiện thay đổi mật khẩu | Nhập mật khẩu hiện tại, mật khẩu mới và xác nhận mật khẩu mới. |
| **Admin / System** | Kích hoạt cờ `must_change_password` | Set `must_change_password = true` cho tài khoản mới hoặc mật khẩu tạm thời. |
| **Hệ thống xác thực (Auth Guard)** | Actor nội bộ kiểm tra định danh | Xác minh JWT, enforce `must_change_password` guard, kiểm tra mật khẩu hiện tại, passive invalidate JWT cũ sau khi đổi thành công. |
| **Redis Cache** | Lưu rate-limit counter và block flag | Theo dõi số lần sai `currentPassword` và trạng thái block per-user. |

### 2.2 Role & Permission Rules

- Bất kỳ người dùng nào đang giữ JWT Access Token hợp lệ đều có thể thực hiện tính năng này, bất kể role cụ thể (`admin`, `manager`, `employee`, v.v.).
- Người dùng chỉ có thể thay đổi mật khẩu của **chính mình** — không có quyền thay đổi mật khẩu của người khác qua API này.
- Admin đổi mật khẩu cho người dùng khác (nếu có) là luồng nghiệp vụ riêng biệt, **không thuộc phạm vi** tính năng này.

### 2.3 Actor Constraints

- Người dùng phải đang đăng nhập thành công (có JWT Access Token hợp lệ).
- Người dùng phải đã truy cập vào giao diện "Cài đặt tài khoản" / "Thay đổi mật khẩu".
- Tài khoản không bị khóa (`account_status` không phải `locked` hoặc `inactive`) trong quá trình thực hiện — được kiểm tra trong DB transaction với row-level lock.
- Nếu `must_change_password = true`, endpoint `/auth/change-password` vẫn **được phép truy cập**. Đây là một trong số ít endpoint không bị block bởi `must_change_password` guard.
- Nếu người dùng đang bị block bởi rate-limit (`change_password:block:{userId}` tồn tại trong Redis), yêu cầu đổi mật khẩu bị từ chối ngay lập tức với HTTP 429.

---

## 3. Functional Requirements

> Tất cả Functional Requirements phải viết theo EARS.
> Keyword EARS giữ nguyên tiếng Anh, nội dung nghiệp vụ viết bằng tiếng Việt.

### 3.1 Core Requirements

- `FR-CHPWD-001`: THE system SHALL yêu cầu người dùng xác minh mật khẩu hiện tại trước khi cho phép cập nhật mật khẩu mới, để đảm bảo chính chủ đang thực hiện thao tác.
- `FR-CHPWD-002`: THE system SHALL áp dụng chính sách mật khẩu bắt buộc cho `newPassword`: tối thiểu 8 ký tự, tối đa 72 ký tự, bao gồm chữ hoa, chữ thường, số và ký tự đặc biệt (BR1). `currentPassword` chỉ cần: required + tối đa 72 ký tự, không kiểm tra complexity.
- `FR-CHPWD-003`: THE system SHALL lưu trữ mật khẩu mới dưới dạng đã được hash (bcrypt) trong trường `password_hash` của bảng `users` — tuyệt đối không lưu plain text.
- `FR-CHPWD-004`: THE system SHALL cập nhật trường `password_updated_at` trong bảng `users` thành thời gian hiện tại ngay khi mật khẩu được thay đổi thành công, để kích hoạt cơ chế passive JWT invalidation.

### 3.2 Event-driven Requirements

- `FR-CHPWD-005`: WHEN người dùng gửi yêu cầu thay đổi mật khẩu với đầy đủ ba trường (`currentPassword`, `newPassword`, `confirmPassword`), THE system SHALL thực hiện kiểm tra tính hợp lệ cơ bản của dữ liệu đầu vào (required fields, maxLength 72, policy `newPassword`) trước khi xử lý nghiệp vụ.
- `FR-CHPWD-006`: WHEN dữ liệu đầu vào hợp lệ và người dùng chưa bị block rate-limit, THE system SHALL mở DB transaction với row-level lock (SELECT ... FOR UPDATE) trên row `users` của người dùng, kiểm tra lại `account_status`, rồi đối chiếu `currentPassword` với `password_hash` hiện tại bằng `bcrypt.compare`.
- `FR-CHPWD-007`: WHEN xác minh mật khẩu hiện tại thành công và mật khẩu mới hợp lệ, THE system SHALL hash mật khẩu mới bằng bcrypt, cập nhật `password_hash`, `password_updated_at`, và `must_change_password = false` trong cùng một DB transaction, rồi commit và trả về phản hồi thành công.
- `FR-CHPWD-008`: WHEN thay đổi mật khẩu hoàn tất thành công, THE system SHALL trả về HTTP 200. Các request tiếp theo sử dụng JWT cũ (có `iat < password_updated_at`) sẽ bị Auth Guard từ chối với HTTP 401 — đây là passive invalidation, không có active revoke trong cùng response.
- `FR-CHPWD-009`: WHEN thay đổi mật khẩu hoàn tất thành công, THE system SHALL ghi nhận một bản ghi audit log chứa ID người dùng, hành động `PASSWORD_CHANGE_SUCCESS`, timestamp, địa chỉ IP và User-Agent (nếu lấy được) trong `metadata_json` — tuyệt đối không lưu plain password hay plain hash trong log.
- `FR-CHPWD-028`: WHEN người dùng nhập sai `currentPassword`, THE system SHALL tăng counter `change_password:failed:{userId}` trong Redis (TTL 15 phút). Nếu counter đạt 5, THE system SHALL set key `change_password:block:{userId}` với TTL 15 phút.

### 3.3 State-driven Requirements

- `FR-CHPWD-010`: WHILE người dùng đang trong phiên đăng nhập hợp lệ (JWT còn hiệu lực), THE system SHALL cho phép truy cập vào tính năng thay đổi mật khẩu.
- `FR-CHPWD-011`: WHILE tài khoản người dùng đang ở trạng thái `locked` hoặc `inactive` (phát hiện trong DB transaction), THE system SHALL từ chối yêu cầu thay đổi mật khẩu, rollback transaction và trả về lỗi HTTP 403.
- `FR-CHPWD-026`: WHILE `users.must_change_password = true`, THE system SHALL chặn toàn bộ request đến các API nghiệp vụ (ngoại trừ `/auth/me`, `/auth/change-password`, `/auth/logout`) và trả về lỗi HTTP 403 kèm thông báo yêu cầu đổi mật khẩu trước.
- `FR-CHPWD-029`: WHILE `change_password:block:{userId}` tồn tại trong Redis, THE system SHALL từ chối mọi yêu cầu đổi mật khẩu của user đó và trả về HTTP 429, không thực hiện bất kỳ xác minh hay DB query nào.

### 3.4 Optional Feature Requirements

- `FR-CHPWD-012`: WHERE cờ `must_change_password` của người dùng trong bảng `users` đang là `true`, THE system SHALL cập nhật cờ này thành `false` trong cùng DB transaction khi mật khẩu được thay đổi thành công, giải phóng người dùng khỏi guard chặn nghiệp vụ.

### 3.5 Unwanted Behavior Requirements

- `FR-CHPWD-013`: IF một hoặc nhiều trường trong ba trường bắt buộc (`currentPassword`, `newPassword`, `confirmPassword`) bị bỏ trống hoặc thiếu trong request, THEN THE system SHALL từ chối yêu cầu và trả về lỗi validation tương ứng cho từng trường thiếu (E1).
- `FR-CHPWD-014`: IF `currentPassword` do người dùng nhập không khớp với `password_hash` hiện tại trong cơ sở dữ liệu (xác minh bằng `bcrypt.compare`), THEN THE system SHALL từ chối yêu cầu, tăng failed counter trong Redis, và trả về lỗi: "Mật khẩu hiện tại không chính xác. Vui lòng kiểm tra lại" — không cập nhật bất kỳ dữ liệu nào (E2).
- `FR-CHPWD-015`: IF `newPassword` không đáp ứng chính sách bảo mật (dưới 8 ký tự, vượt quá 72 ký tự, thiếu chữ hoa, chữ thường, số hoặc ký tự đặc biệt), THEN THE system SHALL từ chối yêu cầu và trả về thông báo lỗi kèm hướng dẫn về quy tắc đặt mật khẩu an toàn (E3).
- `FR-CHPWD-016`: IF `newPassword` và `confirmPassword` không giống nhau, THEN THE system SHALL từ chối yêu cầu và trả về lỗi: "Mật khẩu xác nhận không trùng khớp" (E4).
- `FR-CHPWD-017`: IF `newPassword` giống hệt với mật khẩu hiện tại — kiểm tra ở server bằng `bcrypt.compare(newPassword, user.password_hash)` (client có thể check plain text trước để hỗ trợ UX nhưng không thay thế server-side) — THEN THE system SHALL từ chối yêu cầu và trả về lỗi: "Mật khẩu mới không được trùng với mật khẩu hiện tại" (E5).
- `FR-CHPWD-018`: IF người dùng không có JWT hợp lệ hoặc JWT đã hết hạn, THEN THE system SHALL từ chối truy cập tính năng và trả về lỗi xác thực HTTP 401.
- `FR-CHPWD-027`: IF người dùng gửi yêu cầu đổi mật khẩu khi `change_password:block:{userId}` tồn tại trong Redis (đã vượt quá 5 lần sai trong 15 phút), THEN THE system SHALL từ chối ngay lập tức với HTTP 429 và thông báo: "Bạn đã nhập sai mật khẩu quá nhiều lần. Vui lòng thử lại sau 15 phút."

### 3.6 Workflow Requirements

- `FR-CHPWD-019`: WHEN người dùng truy cập tính năng Thay đổi mật khẩu, THE system SHALL hiển thị biểu mẫu với ba trường nhập liệu: "Mật khẩu hiện tại", "Mật khẩu mới", và "Xác nhận mật khẩu mới".
- `FR-CHPWD-020`: WHEN người dùng nhấn nút "Cập nhật", THE system SHALL thực hiện tuần tự: (1) kiểm tra rate-limit block, (2) kiểm tra validation đầu vào (required + maxLength + policy), (3) mở DB transaction với row-level lock, (4) kiểm tra lại `account_status`, (5) xác minh `currentPassword` bằng bcrypt, (6) kiểm tra `newPassword` không trùng `currentPassword` bằng bcrypt, (7) kiểm tra `newPassword === confirmPassword`, (8) cập nhật `password_hash`, `password_updated_at`, `must_change_password`, (9) commit transaction, (10) ghi `audit_logs`.

### 3.7 Authorization Requirements

- `FR-CHPWD-021`: IF người dùng không được xác thực (không có JWT hoặc JWT hết hạn/không hợp lệ), THEN THE system SHALL từ chối truy cập và trả về lỗi HTTP 401.
- `FR-CHPWD-022`: WHEN người dùng thực hiện thay đổi mật khẩu, THE system SHALL đảm bảo rằng thay đổi chỉ được áp dụng cho tài khoản của chính người dùng đang thực hiện yêu cầu (lấy `user_id` từ JWT, không lấy từ body request).

### 3.8 Data & State Requirements

- `FR-CHPWD-023`: WHEN mật khẩu được thay đổi thành công, THE system SHALL cập nhật đồng thời `password_hash`, `password_updated_at`, và `must_change_password` trong cùng một DB transaction với row-level lock, đảm bảo tính nhất quán ngay cả khi có concurrent request.
- `FR-CHPWD-024`: IF giao dịch cơ sở dữ liệu thất bại trong quá trình cập nhật mật khẩu, THEN THE system SHALL rollback toàn bộ thay đổi và giữ nguyên dữ liệu mật khẩu cũ, trả về lỗi HTTP 500.

### 3.9 Notification / Audit Requirements

- `FR-CHPWD-025`: WHEN mật khẩu được thay đổi thành công, THE system SHALL tạo một bản ghi trong bảng `audit_logs` với các thông tin: `user_id` của người thực hiện, action `PASSWORD_CHANGE_SUCCESS`, `created_at` (timestamp hiện tại), địa chỉ IP, và User-Agent nếu có trong `metadata_json`. Không lưu plain password hay hash.
- `FR-CHPWD-030`: WHEN người dùng bị block vì rate-limit (lần sai thứ 5), THE system SHALL ghi một bản ghi `audit_logs` với action `PASSWORD_CHANGE_RATE_LIMITED` để truy vết sự kiện bất thường.

### 3.13 Traceability

| Requirement ID | EARS Pattern | Nguồn / Use Case liên quan | Ghi chú |
|---|---|---|---|
| FR-CHPWD-001 | Ubiquitous | UC-AUTH-04 Normal Flow bước 5 | Xác minh mật khẩu hiện tại là bắt buộc. |
| FR-CHPWD-002 | Ubiquitous | UC-AUTH-04 BR1 + Q-VR-01 | Chính sách mật khẩu: min 8, max 72, complexity. |
| FR-CHPWD-003 | Ubiquitous | AGENTS.md - Database Rule | Không lưu plain text password. |
| FR-CHPWD-004 | Ubiquitous | Q-BL-01 | Cập nhật password_updated_at cho passive JWT invalidation. |
| FR-CHPWD-005 | Event-driven | UC-AUTH-04 Normal Flow bước 4 | Kiểm tra validation cơ bản + maxLength. |
| FR-CHPWD-006 | Event-driven | Q-EH-02 | Mở DB transaction + row-level lock trước khi verify. |
| FR-CHPWD-007 | Event-driven | UC-AUTH-04 Normal Flow bước 6-7 + Q-BL-03 | Cập nhật password + must_change_password trong transaction. |
| FR-CHPWD-008 | Event-driven | Q-BL-01 | Passive JWT invalidation qua password_updated_at. |
| FR-CHPWD-009 | Event-driven | AGENTS.md - Audit rule | Ghi audit log sau thay đổi thành công. |
| FR-CHPWD-010 | State-driven | UC-AUTH-04 Preconditions | Chỉ user đăng nhập mới dùng được. |
| FR-CHPWD-011 | State-driven | Q-EH-02 | Tài khoản locked/inactive bị từ chối trong transaction. |
| FR-CHPWD-012 | Optional Feature | Q-BL-03 | Xóa cờ must_change_password khi đổi thành công. |
| FR-CHPWD-013 | Unwanted Behavior | UC-AUTH-04 E1 | Trường bỏ trống. |
| FR-CHPWD-014 | Unwanted Behavior | UC-AUTH-04 E2 + Q-EH-01 | Mật khẩu cũ sai + tăng rate-limit counter. |
| FR-CHPWD-015 | Unwanted Behavior | UC-AUTH-04 E3 + Q-VR-01 | Mật khẩu mới không đạt chuẩn / vượt maxLength. |
| FR-CHPWD-016 | Unwanted Behavior | UC-AUTH-04 E4 | Xác nhận mật khẩu không khớp. |
| FR-CHPWD-017 | Unwanted Behavior | UC-AUTH-04 E5 + Q-BL-02 | Mật khẩu mới trùng cũ — server bắt buộc bcrypt check. |
| FR-CHPWD-018 | Unwanted Behavior | JWT validation | Từ chối nếu không có JWT hợp lệ. |
| FR-CHPWD-026 | State-driven | Q-BL-03 | must_change_password guard chặn API nghiệp vụ. |
| FR-CHPWD-027 | Unwanted Behavior | Q-EH-01 | Rate limit: block 15 phút khi sai quá 5 lần. |
| FR-CHPWD-028 | Event-driven | Q-EH-01 | Tăng Redis counter khi nhập sai currentPassword. |
| FR-CHPWD-029 | State-driven | Q-EH-01 | Từ chối ngay khi đang trong block period. |
| FR-CHPWD-030 | Event-driven | Q-EH-01 | Ghi audit log khi bị rate-limited. |

---

## 4. Non-functional Requirements

### 4.1 Performance

- `NFR-CHPWD-001`: THE system SHALL xử lý và trả về kết quả thay đổi mật khẩu trong vòng tối đa 2 giây kể từ khi nhận được yêu cầu hợp lệ, dưới điều kiện tải thông thường.
- `NFR-CHPWD-002`: THE system SHALL kiểm tra Redis block flag trước khi thực hiện bất kỳ DB query hay bcrypt operation nào, để tối thiểu hóa tài nguyên xử lý khi user đang bị block.

### 4.2 Security

- `NFR-CHPWD-003`: THE system SHALL bắt buộc hash mật khẩu mới bằng bcrypt với hệ số xử lý tiêu chuẩn trước khi lưu vào cơ sở dữ liệu.
- `NFR-CHPWD-004`: THE system SHALL NOT trả về `password_hash` hoặc bất kỳ thông tin mật khẩu nào trong API response.
- `NFR-CHPWD-005`: THE system SHALL NOT ghi plain password hay plain hash vào bất kỳ log nào của hệ thống.
- `NFR-CHPWD-006`: THE system SHALL lấy `user_id` từ JWT token (không từ request body) để xác định người dùng thực hiện thay đổi, nhằm ngăn chặn tấn công giả mạo.
- `NFR-CHPWD-007`: THE system SHALL enforce passive JWT invalidation: Auth Guard phải kiểm tra `jwt.iat < user.password_updated_at` cho mọi protected request sau khi mật khẩu được thay đổi.
- `NFR-CHPWD-016`: THE system SHALL giới hạn tất cả trường password (currentPassword, newPassword, confirmPassword) ở tối đa 72 ký tự để tránh bcrypt long-password DoS attack.

### 4.3 Reliability & Consistency

- `NFR-CHPWD-008`: THE system SHALL thực hiện cập nhật `password_hash`, `password_updated_at`, và `must_change_password` như một giao dịch nguyên tử (atomic transaction) với row-level lock để tránh race condition và trạng thái dữ liệu không nhất quán.
- `NFR-CHPWD-009`: IF giao dịch cơ sở dữ liệu thất bại, THEN THE system SHALL rollback hoàn toàn và không thay đổi dữ liệu mật khẩu người dùng.

### 4.4 Usability

- `NFR-CHPWD-010`: THE system SHALL trả về thông báo lỗi rõ ràng và có thể hiển thị cho từng trường hợp lỗi validation và lỗi nghiệp vụ.
- `NFR-CHPWD-011`: THE system SHALL sử dụng tên trường và định dạng response nhất quán với convention API của dự án (`success`, `message`, `data`, `error`).

### 4.5 Observability

- `NFR-CHPWD-012`: THE system SHALL ghi nhận audit log cho sự kiện thay đổi mật khẩu thành công (`PASSWORD_CHANGE_SUCCESS`) và sự kiện rate-limit bị kích hoạt (`PASSWORD_CHANGE_RATE_LIMITED`).
- `NFR-CHPWD-013`: THE system SHALL ghi log ở mức `warn` hoặc `error` cho các lần xác minh mật khẩu thất bại hoặc các trường hợp ngoại lệ không mong muốn.

### 4.6 Maintainability

- `NFR-CHPWD-014`: THE system SHALL tách biệt logic xác minh mật khẩu, logic rate-limiting, logic cập nhật mật khẩu và logic ghi audit log thành các phương thức/service riêng biệt trong module `auth`.
- `NFR-CHPWD-015`: THE system SHALL cung cấp test case cho: đổi mật khẩu thành công, xác minh mật khẩu cũ sai, validation lỗi (required + maxLength + policy), mật khẩu mới không đạt chuẩn, mật khẩu mới trùng cũ, rate-limit bị block, must_change_password guard, JWT passive invalidation.

---

## 5. Data Model

> Tính năng này không yêu cầu thêm bảng mới. Chỉ tương tác với các bảng có sẵn trong Database v3.2 Compact. Redis được dùng cho rate-limit counters (ephemeral, không persist).

### 5.1 Entity liên quan

| Entity / Table | Vai trò trong tính năng | Ghi chú |
|---|---|---|
| `users` | Bảng chính lưu thông tin tài khoản người dùng. | Đọc `password_hash` (bcrypt compare), `account_status`, `must_change_password`. Cập nhật `password_hash`, `password_updated_at`, `must_change_password`. Row-level lock khi update. |
| `audit_logs` | Lưu nhật ký các sự kiện bảo mật quan trọng. | Tạo bản ghi mới khi thay đổi mật khẩu thành công (`PASSWORD_CHANGE_SUCCESS`) hoặc bị rate-limit (`PASSWORD_CHANGE_RATE_LIMITED`). |
| **Redis Cache** | Lưu rate-limit state (ephemeral). | Key `change_password:failed:{userId}` (TTL 15 phút) — counter số lần sai. Key `change_password:block:{userId}` (TTL 15 phút) — flag block. Không persist vào PostgreSQL. |

### 5.2 Dữ liệu đầu vào

**API: Thay đổi mật khẩu** (`PATCH /api/v1/auth/change-password`)

| Field | Type dự kiến | Bắt buộc | Mô tả | Validation |
|---|---:|---:|---|---|
| `currentPassword` | `string` | Có | Mật khẩu hiện tại của người dùng để xác minh danh tính. | Required. MinLength: 1. **MaxLength: 72 ký tự** (giới hạn bcrypt). Không kiểm tra complexity. |
| `newPassword` | `string` | Có | Mật khẩu mới người dùng muốn đặt. | Required. **MinLength: 8. MaxLength: 72 ký tự**. Phải có ít nhất 1 chữ hoa, 1 chữ thường, 1 chữ số, 1 ký tự đặc biệt. Không trùng với `currentPassword` (server-side bcrypt check bắt buộc). |
| `confirmPassword` | `string` | Có | Mật khẩu xác nhận lại để tránh nhập sai. | Required. **MaxLength: 72 ký tự**. Phải trùng khớp hoàn toàn với `newPassword`. |

> **Lưu ý bảo mật**: `user_id` được lấy từ JWT payload, **không được nhận từ request body** để tránh giả mạo.
>
> **Lý do maxLength 72**: bcrypt chỉ xử lý tối đa 72 byte đầu tiên của input. Chuỗi dài hơn có cùng 72 ký tự đầu sẽ tạo ra hash giống nhau (security vulnerability) và có thể gây DoS do bcrypt cost. Giới hạn này phải được enforce ở cả backend validation và DTO.

### 5.3 Dữ liệu đầu ra

**Response thành công (HTTP 200)**:

```json
{
  "success": true,
  "message": "Thay đổi mật khẩu thành công. Vui lòng đăng nhập lại bằng mật khẩu mới."
}
```

**Response lỗi — mật khẩu cũ sai (HTTP 400)**:

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

**Response lỗi — rate-limited (HTTP 429)**:

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

**Response lỗi — must_change_password guard (HTTP 403)**:

```json
{
  "success": false,
  "message": "Tài khoản của bạn yêu cầu đổi mật khẩu trước khi tiếp tục. Vui lòng đổi mật khẩu tại /auth/change-password.",
  "error": {
    "code": "MUST_CHANGE_PASSWORD",
    "details": {}
  },
  "timestamp": "2026-05-27T10:00:00.000Z",
  "path": "/api/v1/meetings"
}
```

### 5.4 State / Status Model

**Thay đổi trạng thái trong bảng `users`:**

| Thao tác | Trước | Sau |
|---|---|---|
| Thay đổi mật khẩu thành công | `password_hash` = hash cũ, `password_updated_at` = timestamp cũ | `password_hash` = hash mới, `password_updated_at` = NOW() |
| must_change_password (nếu = true) | `must_change_password = true` | `must_change_password = false` |

**Rate-limit state trong Redis:**

| Redis Key | Trạng thái | TTL | Điều kiện tạo | Điều kiện xóa |
|---|---|---|---|---|
| `change_password:failed:{userId}` | Counter (integer) | 15 phút (reset mỗi lần tăng) | Tăng mỗi khi nhập sai `currentPassword` | Hết TTL tự động |
| `change_password:block:{userId}` | Flag (exists/not exists) | 15 phút | Counter đạt 5 | Hết TTL tự động |

**must_change_password guard state:**

| Trạng thái | Endpoints được phép | Endpoints bị block |
|---|---|---|
| `must_change_password = false` | Tất cả | Không có |
| `must_change_password = true` | `/auth/me`, `/auth/change-password`, `/auth/logout` | Tất cả API nghiệp vụ khác (meetings, rooms, v.v.) |

### 5.5 Data Constraints

- `password_hash` phải luôn được lưu dưới dạng bcrypt hash, không bao giờ plain text.
- `password_updated_at` phải được cập nhật đồng thời với `password_hash` trong cùng transaction với row-level lock.
- `user_id` phải được trích xuất từ JWT, không được lấy từ request body.
- Tất cả trường password có `maxLength = 72` ký tự (giới hạn bcrypt).
- Mật khẩu mới phải khác với mật khẩu hiện tại (kiểm tra bằng `bcrypt.compare` ở server, không thể bỏ qua qua client-side workaround).
- Rate-limit counters lưu trong Redis, không persist vào PostgreSQL.

### 5.6 Data Lifecycle

- **Khi nào dữ liệu được tạo**: Không tạo bản ghi mới trong `users` — chỉ cập nhật.
- **Khi nào dữ liệu được cập nhật**: Khi người dùng thay đổi mật khẩu thành công (`password_hash`, `password_updated_at`, `must_change_password`).
- **Khi nào dữ liệu được xóa/hủy**: Không áp dụng — mật khẩu cũ bị ghi đè bởi hash mới.
- **Redis rate-limit**: tự hết hạn sau 15 phút (TTL), không cần cleanup thủ công.
- **Khi nào dữ liệu được dùng cho audit**: Bản ghi `audit_logs` được tạo ngay khi thay đổi thành công hoặc khi rate-limit bị kích hoạt, có thể dùng cho báo cáo bảo mật.

---

## 6. Error Handling

> Error requirements dùng `IF ... THEN THE system SHALL ...` theo EARS Unwanted Behavior Pattern.

### 6.1 Validation Errors

- `ERR-CHPWD-001`: IF trường `currentPassword` bị thiếu, rỗng, hoặc vượt quá 72 ký tự, THEN THE system SHALL từ chối yêu cầu với lỗi HTTP `400 Bad Request` và trả về thông báo validation cho trường đó (E1 + Q-VR-01).
- `ERR-CHPWD-002`: IF trường `newPassword` bị thiếu, rỗng, dưới 8 ký tự, hoặc vượt quá 72 ký tự, THEN THE system SHALL từ chối yêu cầu với lỗi HTTP `400 Bad Request` và trả về thông báo validation cho trường đó (E1 + Q-VR-01).
- `ERR-CHPWD-003`: IF trường `confirmPassword` bị thiếu, rỗng, hoặc vượt quá 72 ký tự, THEN THE system SHALL từ chối yêu cầu với lỗi HTTP `400 Bad Request` và trả về thông báo validation cho trường đó (E1 + Q-VR-01).
- `ERR-CHPWD-004`: IF `newPassword` không đạt chuẩn chính sách bảo mật (thiếu chữ hoa, chữ thường, số hoặc ký tự đặc biệt), THEN THE system SHALL từ chối yêu cầu với lỗi HTTP `400 Bad Request` kèm thông báo hướng dẫn quy tắc mật khẩu (E3).
- `ERR-CHPWD-005`: IF `newPassword` và `confirmPassword` không trùng khớp, THEN THE system SHALL từ chối yêu cầu với lỗi HTTP `400 Bad Request` và thông báo: "Mật khẩu xác nhận không trùng khớp" (E4).

### 6.2 Authentication / Authorization Errors

- `ERR-CHPWD-006`: IF người dùng không gửi JWT hoặc JWT không hợp lệ/đã hết hạn, THEN THE system SHALL trả về lỗi HTTP `401 Unauthorized`.
- `ERR-CHPWD-007`: IF tài khoản người dùng đang ở trạng thái `locked` hoặc `inactive` (phát hiện trong DB transaction), THEN THE system SHALL rollback transaction, từ chối yêu cầu và trả về lỗi HTTP `403 Forbidden`.
- `ERR-CHPWD-013`: IF người dùng gọi API nghiệp vụ trong khi `must_change_password = true`, THEN THE system SHALL từ chối request với HTTP `403 Forbidden` và mã lỗi `MUST_CHANGE_PASSWORD`, hướng dẫn user truy cập `/auth/change-password` trước.

### 6.3 Business Rule Errors

- `ERR-CHPWD-008`: IF `currentPassword` do người dùng nhập không khớp với `password_hash` hiện tại trong cơ sở dữ liệu, THEN THE system SHALL từ chối yêu cầu với lỗi HTTP `400 Bad Request`, tăng Redis counter `change_password:failed:{userId}`, và trả về thông báo: "Mật khẩu hiện tại không chính xác. Vui lòng kiểm tra lại" (E2). Không cập nhật bất kỳ dữ liệu nào.
- `ERR-CHPWD-009`: IF `newPassword` giống hệt với mật khẩu hiện tại (xác minh bằng `bcrypt.compare` ở server), THEN THE system SHALL từ chối yêu cầu với lỗi HTTP `422 Unprocessable Entity` và thông báo: "Mật khẩu mới không được trùng với mật khẩu hiện tại" (E5).
- `ERR-CHPWD-011`: IF người dùng gửi yêu cầu đổi mật khẩu khi đang bị block rate-limit (`change_password:block:{userId}` tồn tại), THEN THE system SHALL từ chối ngay lập tức với HTTP `429 Too Many Requests`, mã lỗi `CHANGE_PASSWORD_RATE_LIMITED`, và thông tin `retryAfterMinutes: 15`.

### 6.4 Conflict Errors

- `ERR-CHPWD-010`: IF giao dịch cơ sở dữ liệu thất bại trong quá trình cập nhật mật khẩu (kể cả do lock timeout hoặc deadlock), THEN THE system SHALL rollback toàn bộ thay đổi và trả về lỗi HTTP `500 Internal Server Error`.

### 6.5 Error Response Expectations

| Field | Mô tả |
|---|---|
| `success` | `false` trong mọi trường hợp lỗi |
| `message` | Thông báo lỗi có thể hiển thị cho người dùng |
| `error.code` | Mã lỗi nội bộ (`CURRENT_PASSWORD_INCORRECT`, `PASSWORD_POLICY_VIOLATION`, `CONFIRM_PASSWORD_MISMATCH`, `SAME_AS_CURRENT_PASSWORD`, `CHANGE_PASSWORD_RATE_LIMITED`, `MUST_CHANGE_PASSWORD`) |
| `error.details` | Chi tiết lỗi validation theo từng trường nếu có; `retryAfterMinutes` nếu rate-limited |
| `timestamp` | Thời điểm xảy ra lỗi (ISO 8601) |
| `path` | API path của request |

---

## 7. Acceptance Criteria

> Acceptance Criteria dùng format Given / When / Then.

### 7.1 Happy Path

- **AC-001: Thay đổi mật khẩu thành công**
  - **Given**: Người dùng đang đăng nhập hợp lệ (JWT còn hiệu lực), tài khoản đang `active`, truy cập vào tính năng Thay đổi mật khẩu, chưa bị block rate-limit.
  - **When**: Người dùng nhập đúng mật khẩu hiện tại (`OldPass@123`), nhập mật khẩu mới đạt chuẩn (`NewPass@456`), nhập lại mật khẩu xác nhận trùng khớp (`NewPass@456`), và nhấn "Cập nhật".
  - **Then**:
    1. Hệ thống kiểm tra Redis — không có block flag.
    2. Hệ thống validate đầu vào — hợp lệ.
    3. Hệ thống mở DB transaction, lock row `users`.
    4. Hệ thống kiểm tra `account_status = active`.
    5. Hệ thống xác minh `OldPass@123` khớp với `password_hash` bằng bcrypt.
    6. Hệ thống xác minh `NewPass@456` khác `OldPass@123` bằng bcrypt.
    7. Hệ thống hash `NewPass@456`, cập nhật `password_hash`, `password_updated_at = NOW()`, `must_change_password = false`, commit transaction.
    8. Hệ thống ghi bản ghi `PASSWORD_CHANGE_SUCCESS` vào `audit_logs`.
    9. Hệ thống trả về HTTP 200 với thông báo thành công.
    10. Các request tiếp theo dùng JWT cũ bị Auth Guard reject HTTP 401 (passive invalidation).

- **AC-002: Thay đổi mật khẩu khi có cờ `must_change_password = true`**
  - **Given**: Người dùng đang đăng nhập và tài khoản có `must_change_password = true`.
  - **When**: Người dùng thực hiện thay đổi mật khẩu thành công theo AC-001.
  - **Then**: Trường `must_change_password` trong bảng `users` được cập nhật thành `false`. Người dùng có thể truy cập các API nghiệp vụ bình thường (sau khi đăng nhập lại với token mới).

### 7.2 Validation Cases

- **AC-003: Trường bắt buộc bị bỏ trống**
  - **Given**: Người dùng đang đăng nhập hợp lệ.
  - **When**: Người dùng gửi yêu cầu thiếu trường `confirmPassword` (để trống).
  - **Then**: Hệ thống trả về lỗi HTTP 400, bôi đỏ trường thiếu, và hiển thị cảnh báo yêu cầu nhập đầy đủ thông tin. Không có dữ liệu nào bị thay đổi. Không tăng rate-limit counter.

- **AC-004: Mật khẩu mới không đạt chuẩn**
  - **Given**: Người dùng nhập mật khẩu hiện tại đúng và nhập mật khẩu mới là `simple` (chỉ 6 ký tự thường).
  - **When**: Người dùng nhấn "Cập nhật".
  - **Then**: Hệ thống trả về lỗi HTTP 400 kèm thông báo hướng dẫn quy tắc mật khẩu. Không thay đổi mật khẩu.

- **AC-004b: Mật khẩu vượt maxLength 72 ký tự**
  - **Given**: Người dùng nhập `newPassword` dài 80 ký tự.
  - **When**: Người dùng nhấn "Cập nhật".
  - **Then**: Hệ thống trả về lỗi HTTP 400 với thông báo maxLength. Không thực hiện bất kỳ bcrypt operation nào.

- **AC-005: Mật khẩu xác nhận không trùng khớp**
  - **Given**: Người dùng nhập mật khẩu mới `NewPass@456` và nhập xác nhận `NewPass@789`.
  - **When**: Người dùng nhấn "Cập nhật".
  - **Then**: Hệ thống trả về lỗi HTTP 400 với thông báo: "Mật khẩu xác nhận không trùng khớp". Không thay đổi mật khẩu.

### 7.3 Authorization Cases

- **AC-006: Người dùng chưa đăng nhập**
  - **Given**: Người dùng không có JWT hợp lệ (chưa đăng nhập hoặc token đã hết hạn).
  - **When**: Người dùng gửi request đến API thay đổi mật khẩu.
  - **Then**: Hệ thống trả về lỗi HTTP 401 Unauthorized. Không xử lý yêu cầu.

- **AC-006b: must_change_password guard chặn API nghiệp vụ**
  - **Given**: Người dùng đang đăng nhập với `must_change_password = true`.
  - **When**: Người dùng gọi `GET /api/v1/meetings`.
  - **Then**: Hệ thống trả về HTTP 403 với mã lỗi `MUST_CHANGE_PASSWORD`, thông báo yêu cầu đổi mật khẩu tại `/auth/change-password` trước.

### 7.4 Business Rule Cases

- **AC-007: Mật khẩu hiện tại nhập sai**
  - **Given**: Người dùng đang đăng nhập hợp lệ, chưa bị block rate-limit.
  - **When**: Người dùng nhập sai mật khẩu hiện tại (`WrongPass@123`) trong khi mật khẩu thực là `OldPass@123`.
  - **Then**: Hệ thống trả về lỗi HTTP 400 với thông báo: "Mật khẩu hiện tại không chính xác. Vui lòng kiểm tra lại". Redis counter `change_password:failed:{userId}` tăng lên 1. Không có dữ liệu nào bị thay đổi.

- **AC-008: Mật khẩu mới trùng với mật khẩu hiện tại**
  - **Given**: Người dùng đang đăng nhập hợp lệ với mật khẩu hiện tại là `OldPass@123`.
  - **When**: Người dùng nhập `OldPass@123` vào cả trường mật khẩu hiện tại, mật khẩu mới và xác nhận.
  - **Then**: Hệ thống trả về lỗi HTTP 422 với thông báo: "Mật khẩu mới không được trùng với mật khẩu hiện tại". Không thay đổi mật khẩu.

### 7.5 State Transition & JWT Cases

- **AC-009: JWT cũ bị invalidate sau khi đổi mật khẩu (passive)**
  - **Given**: Người dùng đã thay đổi mật khẩu thành công (AC-001) và `password_updated_at` đã được cập nhật.
  - **When**: Người dùng (hoặc kẻ tấn công) thử gửi request với JWT cũ (issued trước `password_updated_at`).
  - **Then**: Auth Guard phát hiện `jwt.iat < user.password_updated_at`, từ chối request và trả về lỗi HTTP 401.

- **AC-011: JWT mới sau khi đăng nhập lại hoạt động bình thường**
  - **Given**: Người dùng đã đổi mật khẩu thành công. JWT cũ đã bị passive invalidate.
  - **When**: Người dùng đăng nhập lại bằng mật khẩu mới, nhận JWT mới (có `iat > password_updated_at`), rồi gọi một protected API (`GET /api/v1/meetings`).
  - **Then**: Auth Guard chấp nhận JWT mới (vì `jwt.iat >= user.password_updated_at`). API trả về HTTP 200 thành công.

### 7.6 Rate-limit Cases

- **AC-012: Rate-limit block sau 5 lần sai**
  - **Given**: Người dùng đang đăng nhập hợp lệ và đã nhập sai `currentPassword` 5 lần trong 15 phút (counter = 5).
  - **When**: Người dùng nhập sai lần thứ 6.
  - **Then**: Hệ thống set key `change_password:block:{userId}` với TTL 15 phút. Trả về HTTP 429 với thông báo: "Bạn đã nhập sai mật khẩu quá nhiều lần. Vui lòng thử lại sau 15 phút." Ghi bản ghi `PASSWORD_CHANGE_RATE_LIMITED` vào `audit_logs`.

- **AC-013: Yêu cầu bị reject ngay trong thời gian block**
  - **Given**: Key `change_password:block:{userId}` đang tồn tại trong Redis (user đang bị block).
  - **When**: Người dùng gửi bất kỳ request đổi mật khẩu nào (dù nhập đúng hay sai).
  - **Then**: Hệ thống reject ngay với HTTP 429, không thực hiện bất kỳ DB query hay bcrypt operation nào.

### 7.7 Audit Cases

- **AC-010: Audit log được ghi khi đổi mật khẩu thành công**
  - **Given**: Người dùng đã thay đổi mật khẩu thành công.
  - **When**: Admin kiểm tra bảng `audit_logs`.
  - **Then**: Tồn tại một bản ghi mới với action `PASSWORD_CHANGE_SUCCESS`, `user_id` của người thực hiện, timestamp chính xác, và metadata chứa IP/User-Agent. Không có plain password hay hash trong log.

### 7.8 Acceptance Criteria Traceability

| AC ID | Requirement ID liên quan | Kịch bản test chính |
|---|---|---|
| AC-001 | FR-CHPWD-005, 006, 007, 008, 009, 023 | Đổi mật khẩu thành công end-to-end với DB transaction |
| AC-002 | FR-CHPWD-012 | Cờ must_change_password được reset về false |
| AC-003 | FR-CHPWD-013, ERR-CHPWD-001/002/003 | Validation bắt buộc nhập đủ 3 trường |
| AC-004 | FR-CHPWD-015, ERR-CHPWD-004 | Mật khẩu mới không đạt chuẩn complexity |
| AC-004b | FR-CHPWD-015, ERR-CHPWD-002, NFR-CHPWD-016 | maxLength 72 được enforce |
| AC-005 | FR-CHPWD-016, ERR-CHPWD-005 | Mật khẩu xác nhận không khớp |
| AC-006 | FR-CHPWD-021, ERR-CHPWD-006 | Không có JWT hợp lệ |
| AC-006b | FR-CHPWD-026, ERR-CHPWD-013 | must_change_password guard chặn API nghiệp vụ |
| AC-007 | FR-CHPWD-014, FR-CHPWD-028, ERR-CHPWD-008 | Mật khẩu hiện tại nhập sai + tăng Redis counter |
| AC-008 | FR-CHPWD-017, ERR-CHPWD-009 | Mật khẩu mới trùng cũ — server bcrypt check |
| AC-009 | FR-CHPWD-008, NFR-CHPWD-007 | Passive JWT invalidation: token cũ bị reject |
| AC-011 | FR-CHPWD-008, NFR-CHPWD-007 | Token mới (sau login lại) được chấp nhận |
| AC-010 | FR-CHPWD-009, FR-CHPWD-025 | Audit log PASSWORD_CHANGE_SUCCESS đầy đủ |
| AC-012 | FR-CHPWD-027, FR-CHPWD-028, FR-CHPWD-030 | Rate-limit block sau 5 lần sai |
| AC-013 | FR-CHPWD-029 | Reject ngay trong block period, không tốn tài nguyên |

---

## 8. Out of Scope

Các nội dung sau **không thuộc phạm vi** của tính năng này:

- Không triển khai luồng **Quên mật khẩu / Reset mật khẩu bằng OTP** (đã có ở UC-AUTH-03 / feat-password-reset-otp).
- Không triển khai tính năng **Admin đổi mật khẩu hộ cho người dùng khác** — đó là luồng Admin riêng biệt.
- **Không gửi email thông báo đổi mật khẩu trong v1** (xác nhận rõ — Q-SB-01). UC-AUTH-04 v1 chỉ ghi `audit_logs`. Email notification sau đổi mật khẩu (kể cả thông báo đơn giản) là out of scope.
- Không triển khai giao diện hiển thị "Lịch sử đổi mật khẩu" hay "Độ mạnh mật khẩu real-time".
- Không có active push logout toàn bộ thiết bị — chỉ có passive invalidation qua `iat < password_updated_at` khi request tiếp theo gửi đến.
- Không triển khai hàng đợi task bất đồng bộ (async job) cho tính năng này.
- Không hỗ trợ đa ngôn ngữ (multi-language) trong v1.

### 8.1 Không triển khai trong feature này

- Không thêm bảng database mới (không cần, đã có `users` và `audit_logs`).
- Không tạo session xác thực trung gian (khác với OTP reset flow).
- Không có flow duyệt/approval cho việc thay đổi mật khẩu.
- Không gửi email notification sau khi đổi mật khẩu thành công.
- Không triển khai active token revocation (chỉ passive qua `password_updated_at`).

### 8.2 Có thể xem xét ở feature khác

- **Gửi email thông báo** khi phát hiện mật khẩu được thay đổi (bất kể IP bình thường hay lạ).
- **Hiển thị lịch sử thay đổi mật khẩu** trong trang cài đặt tài khoản.
- **Chính sách đổi mật khẩu định kỳ bắt buộc** có thể cấu hình qua `system_policies`.
- **Active token revocation** bằng Redis blacklist JWT ID (jti) nếu cần logout tức thì.

### 8.3 Out-of-scope EARS Guardrails

- `OOS-001`: THE system SHALL NOT tạo bảng database mới cho tính năng này — chỉ sử dụng `users` và `audit_logs` từ Database v3.2 Compact.
- `OOS-002`: THE system SHALL NOT gửi bất kỳ email thông báo nào sau khi đổi mật khẩu thành công trong phạm vi UC-AUTH-04 v1.
- `OOS-003`: THE system SHALL NOT triển khai API cho phép Admin thay đổi mật khẩu của người dùng khác trong phạm vi feature này.
- `OOS-004`: THE system SHALL NOT tích hợp vector database, AI, hay embedding pipeline vào tính năng này.
- `OOS-005`: THE system SHALL NOT triển khai active JWT revocation (Redis blacklist theo jti) trong phạm vi feature này — chỉ dùng passive invalidation qua `password_updated_at`.

---

## Checklist tự kiểm tra trước khi hoàn tất spec

- [x] Spec đã có đủ 8 thành phần chính.
- [x] Functional Requirements đã viết theo EARS.
- [x] Requirement sử dụng keyword EARS bằng tiếng Anh: `THE system SHALL`, `WHEN`, `WHILE`, `WHERE`, `IF`, `THEN`.
- [x] Đã có đủ 5 EARS basic patterns: Ubiquitous, Event-driven, State-driven, Optional Feature, Unwanted Behavior.
- [x] Đã cân nhắc Complex / Combined EARS Requirements — không cần trong feature này do flow đủ đơn giản.
- [x] Mỗi requirement có mã ID rõ ràng (`FR-CHPWD-XXX`, `ERR-CHPWD-XXX`, `NFR-CHPWD-XXX`).
- [x] Requirement có thể kiểm thử được.
- [x] Không mô tả quá sâu implementation.
- [x] Không tự ý thêm feature ngoài tài liệu nguồn.
- [x] Không tự ý thêm database table/field mới nếu chưa có căn cứ.
- [x] Error handling đã bao gồm validation, authentication, authorization, business rule, conflict, rate-limit.
- [x] Error requirements đã ưu tiên format `IF ... THEN THE system SHALL ...`.
- [x] Acceptance Criteria dùng Given / When / Then.
- [x] Traceability đã liên kết AC với FR/ERR/NFR liên quan.
- [x] Out of Scope đủ rõ để tránh agent tự mở rộng.
- [x] Tất cả 8 câu hỏi Clarification đã được encode vào spec.
