# 📝 CHANGELOG & REVISION HISTORY
| Ngày cập nhật | Tóm tắt thay đổi | Các dòng thay đổi |
| :--- | :--- | :--- |
| 2026-06-25 | Khởi tạo đặc tả tính năng Xem hồ sơ công khai tài khoản (Public Profile API) | Toàn bộ tài liệu |

# Feature Specification: Xem hồ sơ công khai tài khoản (Public Profile)

- **Feature ID**: ACCT-PUBLIC-PROFILE-001
- **Feature Name**: Xem hồ sơ công khai tài khoản (Public Profile API)
- **Module / Domain**: accounts
- **Created Date**: 2026-06-25
- **Status**: Draft
- **Source Documents**:
  - Yêu cầu nghiệp vụ trực tiếp từ người dùng (2026-06-25): "Tạo API public profile mới"
  - `spec/features/account/feat-view-detail-account/spec.md` (UC-AM-10 — endpoint chi tiết hồ sơ hiện có, dùng để đối chiếu phạm vi dữ liệu nhạy cảm cần loại trừ)
  - `spec/features/account/feat-admin-avatar-review-workflow/spec.md` (quy tắc `users.avatar_url` chỉ được cập nhật khi avatar đã được duyệt)
  - CLAUDE.md / AGENTS.md (Database v3.2 Compact, API response convention)
  - `src/modules/accounts/entities/user.entity.ts`, `src/modules/accounts/entities/department.entity.ts`
  - `src/modules/accounts/controllers/users.controller.ts` (controller `@Controller('users')` hiện có, nơi bổ sung endpoint mới)

---

## 1. Context & Goal

### 1.1 Bối cảnh

Tính năng này thuộc module **accounts**. Hệ thống hiện đã có endpoint `GET /api/v1/users/{userId}` (UC-AM-10) để **System Admin/Business Admin** xem chi tiết đầy đủ hồ sơ một tài khoản, bao gồm cả các trường quản trị nhạy cảm như `accountStatus`, `employmentStatus`, `mustChangePassword`, `lastLoginAt`, `roles`. Endpoint này yêu cầu permission `account.user.read.detail` và bị giới hạn theo department scope đối với Business Admin.

Trong thực tế vận hành, nhiều màn hình nghiệp vụ khác (ví dụ: danh sách người tham dự cuộc họp, hiển thị thông tin người tạo/người liên quan trong một bản ghi, tra cứu nhanh đồng nghiệp) chỉ cần hiển thị một vài thông tin định danh cơ bản của một user khác (tên, email, mã nhân viên, phòng ban, ảnh đại diện) — không cần và không nên có quyền xem dữ liệu quản trị nhạy cảm của người đó. Hiện tại các màn hình này không có endpoint phù hợp: nếu dùng `GET /users/{userId}` thì bắt buộc phải có permission quản trị, vừa sai mục đích sử dụng vừa có rủi ro lộ thông tin nhạy cảm nếu permission đó được nới rộng cho nhiều role chỉ để phục vụ mục đích hiển thị thông tin cơ bản.

Tính năng này bổ sung một endpoint mới, gọn nhẹ và an toàn theo thiết kế ("safe by default"): bất kỳ user đã đăng nhập đều có thể xem hồ sơ công khai rút gọn của một user khác, mà không cần permission quản trị.

### 1.2 Mục tiêu

Mục tiêu của tính năng này là cho phép **bất kỳ user đã đăng nhập (authenticated user)** xem một tập thông tin công khai, an toàn, tối thiểu của một tài khoản khác trong hệ thống, nhằm **phục vụ các nhu cầu hiển thị thông tin cơ bản trong nghiệp vụ (ví dụ: thông tin người tham dự cuộc họp) mà không làm lộ các thông tin quản trị nhạy cảm**.

### 1.3 Giá trị mang lại

- Cho người dùng thông thường: tra cứu nhanh thông tin cơ bản (tên, phòng ban, ảnh đại diện) của đồng nghiệp mà không cần quyền quản trị.
- Cho hệ thống/bảo mật: tách bạch rõ giữa dữ liệu công khai an toàn và dữ liệu quản trị nhạy cảm (trạng thái tài khoản, vai trò chi tiết, thời gian đăng nhập cuối, trạng thái bắt buộc đổi mật khẩu...), giảm rủi ro lộ thông tin khi mở rộng tính năng hiển thị thông tin người dùng ra nhiều màn hình khác nhau.
- Cho frontend: có một contract ổn định, nhẹ, không phụ thuộc permission quản trị để hiển thị thông tin người dùng ở các màn hình nghiệp vụ thông thường.

### 1.4 Giả định

- User thực hiện request đã đăng nhập thành công và có JWT access token hợp lệ.
- Tính năng `feat-admin-avatar-review-workflow` là nguồn duy nhất cập nhật `users.avatar_url`; trường này chỉ được set khi System Administrator đã duyệt (approve) một avatar submission. Trước khi được duyệt, `users.avatar_url` là `null`.
- Mỗi user có tối đa một `department` tại một thời điểm, tham chiếu qua `users.department_id`.
- Tính năng này không thay thế và không thay đổi endpoint chi tiết hồ sơ hiện có `GET /api/v1/users/{userId}` (UC-AM-10).

### 1.5 Cần làm rõ

Không còn điểm cần làm rõ. Phạm vi dữ liệu trả về, cơ chế xác thực, và danh sách trường bị loại trừ đã được xác định rõ trong yêu cầu nghiệp vụ nguồn.

---

## 2. Actor & Roles

### 2.1 Danh sách actor

| Actor | Vai trò trong tính năng | Quyền / Trách nhiệm chính |
|---|---|---|
| Authenticated User | Bất kỳ user đã đăng nhập hợp lệ, không phân biệt role (`INTERNAL_USER`, `MANAGER`, `BUSINESS_ADMIN`, `SYSTEM_ADMIN`...) | Gửi yêu cầu xem hồ sơ công khai của một `userId` bất kỳ |
| Target User | User là đối tượng được tra cứu hồ sơ công khai | Dữ liệu công khai an toàn của user này được trả về trong response |

### 2.2 Role & Permission Rules

- THE system SHALL không yêu cầu bất kỳ permission hoặc role cụ thể nào ngoài việc đã đăng nhập hợp lệ (`JwtAuthGuard`).
- Không áp dụng `PermissionsGuard`, `RolesGuard`, hoặc bất kỳ department scope nào cho endpoint này — đây là quyết định thiết kế có chủ đích, không phải thiếu sót.
- Mọi authenticated user, bất kể role, đều có quyền truy cập như nhau đối với endpoint này.

### 2.3 Actor Constraints

- Actor phải có JWT access token hợp lệ (chưa hết hạn, chưa bị revoke).
- Không yêu cầu actor và target user cùng department, cùng team, hoặc có quan hệ quản lý.
- Actor có thể xem hồ sơ công khai của chính mình (self-view) theo cùng quy tắc như xem hồ sơ của user khác.

---

## 3. Functional Requirements

> Tất cả Functional Requirements được viết theo EARS.

### 3.1 Core Requirements

```text
FR-001: THE system SHALL cung cấp endpoint GET /api/v1/users/{userId}/public-profile để trả về hồ sơ công khai rút gọn của một tài khoản.
FR-002: THE system SHALL chỉ trả về các trường sau trong response: id, fullName, email, employeeCode, department (id, departmentName), avatarUrl.
FR-003: THE system SHALL KHÔNG bao gồm trong response các trường quản trị nhạy cảm, bao gồm nhưng không giới hạn: accountStatus, employmentStatus, mustChangePassword, lastLoginAt, failedLoginCount, lockedUntil, passwordUpdatedAt, roles, directManager, positionTitle, phoneNumber, hasFaceProfile, createdAt, updatedAt.
```

### 3.2 Event-driven Requirements

```text
FR-004: WHEN authenticated user gửi yêu cầu GET đến endpoint với userId hợp lệ và tồn tại, THE system SHALL truy vấn thông tin từ bảng users và departments rồi trả về response thành công với đầy đủ các trường công khai.
FR-005: WHEN authenticated user gửi yêu cầu xem hồ sơ công khai, THE system SHALL KHÔNG thực hiện bất kỳ hành vi tạo, cập nhật hay xóa dữ liệu nào đối với bảng users hoặc departments.
```

### 3.3 State-driven Requirements

```text
FR-006: WHILE user đã đăng nhập với JWT hợp lệ, THE system SHALL cho phép user đó truy cập endpoint public-profile của bất kỳ userId nào đang active trong hệ thống, không phân biệt role hoặc department của actor.
```

### 3.4 Optional Feature Requirements

```text
FR-007: WHERE target user đã có avatar được System Administrator duyệt (theo feat-admin-avatar-review-workflow) và users.avatar_url khác null, THE system SHALL trả về avatarUrl chứa giá trị URL đó.
```

### 3.5 Authorization Requirements

```text
FR-008: IF user chưa đăng nhập (JWT thiếu/không hợp lệ/hết hạn), THEN THE system SHALL từ chối yêu cầu và trả về lỗi xác thực, không trả về bất kỳ dữ liệu nào.
FR-009: THE system SHALL KHÔNG kiểm tra permission hoặc role của actor khi xử lý yêu cầu này, ngoài việc xác thực JWT.
```

### 3.6 Unwanted Behavior Requirements

```text
FR-010: IF userId không phải là UUID hợp lệ, THEN THE system SHALL từ chối yêu cầu và trả về lỗi validation.
FR-011: IF userId không tồn tại trong hệ thống, THEN THE system SHALL trả về lỗi không tìm thấy tài khoản.
FR-012: IF target user đã bị soft-delete (deleted_at khác null), THEN THE system SHALL trả về lỗi không tìm thấy tài khoản, không tiết lộ thông tin tài khoản đã bị xóa.
```

### 3.7 Data Requirements

```text
FR-013: WHEN target user có department_id là null, THE system SHALL trả về department = null trong response, không bỏ qua (omit) field này.
FR-014: WHEN target user có avatar_url là null (chưa có avatar được duyệt), THE system SHALL trả về avatarUrl = null trong response, không bỏ qua field này.
FR-015: WHEN target user có employeeCode là null, THE system SHALL trả về employeeCode = null trong response, không bỏ qua field này.
```

### 3.8 Requirement Traceability

| Requirement ID | EARS Pattern | Nguồn / Use Case liên quan | Ghi chú |
|---|---|---|---|
| FR-001 | Ubiquitous | Yêu cầu nghiệp vụ nguồn | Endpoint mới |
| FR-002 | Ubiquitous | Yêu cầu nghiệp vụ nguồn | Whitelist field trả về |
| FR-003 | Ubiquitous | Yêu cầu nghiệp vụ nguồn | Loại trừ field nhạy cảm |
| FR-004 | Event-driven | Yêu cầu nghiệp vụ nguồn | Xử lý request thành công |
| FR-005 | Event-driven | Yêu cầu nghiệp vụ nguồn | No data mutation |
| FR-006 | State-driven | Yêu cầu nghiệp vụ nguồn | Không phân biệt role/department |
| FR-007 | Optional Feature | feat-admin-avatar-review-workflow | avatarUrl chỉ có khi đã được duyệt |
| FR-008 | Unwanted Behavior | AGENTS.md §9 | Auth |
| FR-009 | Ubiquitous | Yêu cầu nghiệp vụ nguồn | Chỉ cần đăng nhập, không cần permission |
| FR-010 | Unwanted Behavior | Quy ước UUID validation hiện có | Invalid UUID |
| FR-011 | Unwanted Behavior | UC-AM-10 (đối chiếu) | User not found |
| FR-012 | Unwanted Behavior | UC-AM-10 (đối chiếu) | Soft-deleted user |
| FR-013 | Data | UC-AM-10 (đối chiếu) | department null |
| FR-014 | Data | feat-admin-avatar-review-workflow | avatarUrl null |
| FR-015 | Data | Database v3.2 Compact (`users.employee_code` nullable) | employeeCode null |

---

## 4. Non-functional Requirements

### 4.1 Performance

```text
NFR-001: THE system SHALL trả về kết quả của endpoint public-profile trong vòng dưới 1 giây dưới tải bình thường.
```

### 4.2 Security

```text
NFR-002: THE system SHALL enforce authentication (JWT hợp lệ) trước khi cho phép truy cập endpoint public-profile.
NFR-003: THE system SHALL KHÔNG expose các trường password_hash, reset/refresh token, accountStatus, employmentStatus, mustChangePassword, lastLoginAt, failedLoginCount, lockedUntil, roles, hoặc bất kỳ thông tin quản trị nội bộ khác trong response của endpoint này.
NFR-004: THE system SHALL áp dụng đúng whitelist field tại Mục 3.1 (FR-002) cho mọi response thành công, không trả thêm field ngoài whitelist dù entity users có field đó.
```

### 4.3 Reliability & Consistency

```text
NFR-005: THE system SHALL đảm bảo dữ liệu department trả về (id, departmentName) khớp với bản ghi departments hiện hành tại thời điểm truy vấn.
NFR-006: IF không thể truy xuất đầy đủ dữ liệu cần thiết do lỗi hệ thống, THEN THE system SHALL trả về lỗi server thay vì dữ liệu không đầy đủ hoặc sai lệch.
```

### 4.4 Usability

```text
NFR-007: THE system SHALL sử dụng response envelope thống nhất với các endpoint accounts khác trong hệ thống (success, message, data).
```

---

## 5. Data Model

### 5.1 Entity liên quan

| Entity / Table | Vai trò trong tính năng | Ghi chú |
|---|---|---|
| `users` | Nguồn dữ liệu chính: id, full_name, email, employee_code, avatar_url, department_id, deleted_at | Chỉ đọc các field công khai, không đọc password_hash, account_status... |
| `departments` | Cung cấp thông tin phòng ban của target user | Liên kết qua `users.department_id`, chỉ lấy id và department_name |

### 5.2 Dữ liệu đầu vào

| Field | Type dự kiến | Bắt buộc | Mô tả | Validation |
|---|---|---|---|---|
| `userId` | UUID | Có | UUID định danh của tài khoản cần xem hồ sơ công khai (route param) | Phải là UUID hợp lệ; phải tồn tại trong bảng `users` và chưa bị soft-delete |

### 5.3 Dữ liệu đầu ra

| Field | Type dự kiến | Mô tả |
|---|---|---|
| `id` | UUID | Định danh user (`users.id`) |
| `fullName` | string | Họ và tên (`users.full_name`) |
| `email` | string | Email (`users.email`) |
| `employeeCode` | string or null | Mã nhân viên (`users.employee_code`), trả về `null` nếu chưa có |
| `department` | object or null | Thông tin phòng ban `{ id, departmentName }`; trả về `null` nếu `users.department_id` là null, không omit field |
| `avatarUrl` | string or null | URL ảnh đại diện (`users.avatar_url`); trả về `null` nếu user chưa có avatar được duyệt |

### 5.4 Data Constraints

- `users.id` là UUID, không được null.
- `users.employee_code` là nullable trong baseline hiện tại (Database v3.2 Compact).
- `users.department_id` tham chiếu `departments.id`, có thể là null.
- `users.avatar_url` chỉ được cập nhật bởi luồng approve avatar (`feat-admin-avatar-review-workflow`); endpoint này chỉ đọc, không cập nhật field này.
- Endpoint này KHÔNG đọc và KHÔNG trả về các field: `password_hash`, `account_status`, `employment_status`, `must_change_password`, `password_updated_at`, `failed_login_count`, `last_login_at`, `locked_until`, `position_title`, `phone_number`, `direct_manager_id`, `created_at`, `updated_at`, `deleted_at`.

### 5.5 Data Lifecycle

- Dữ liệu `users`/`departments` được tạo và cập nhật bởi các use case khác (UC-AM-01 tạo tài khoản, UC-AM-07/UC-09 cập nhật tài khoản, quản lý phòng ban).
- Tính năng này CHỈ ĐỌC dữ liệu hiện có, không tạo/cập nhật/xóa bất kỳ bản ghi nào.

---

## 6. Error Handling

### 6.1 Validation Errors

```text
ERR-001: IF userId không phải là UUID hợp lệ, THEN THE system SHALL trả về lỗi 400 với code INVALID_USER_ID.
```

### 6.2 Authentication Errors

```text
ERR-002: IF user chưa đăng nhập (JWT thiếu/không hợp lệ/hết hạn), THEN THE system SHALL trả về lỗi 401 UNAUTHORIZED.
```

### 6.3 Business Rule Errors

```text
ERR-003: IF userId không tồn tại trong hệ thống, THEN THE system SHALL trả về lỗi 404 với code USER_NOT_FOUND.
ERR-004: IF target user đã bị soft-delete, THEN THE system SHALL trả về lỗi 404 với code USER_NOT_FOUND.
```

### 6.4 Error Response Expectations

| Field | Mô tả |
|---|---|
| `success` | `false` |
| `message` | Thông báo lỗi |
| `error.code` | Mã lỗi nội bộ (`INVALID_USER_ID`, `USER_NOT_FOUND`) |
| `timestamp` | Thời điểm xảy ra lỗi |
| `path` | API path |

---

## 7. Acceptance Criteria

### 7.1 Happy Path

```text
AC-001:
Given một authenticated user bất kỳ (không cần permission quản trị) và một target user đang active tồn tại trong hệ thống,
When user đó gửi GET /api/v1/users/{userId}/public-profile với userId hợp lệ của target user,
Then the system trả về HTTP 200 với đúng các trường: id, fullName, email, employeeCode, department, avatarUrl, và KHÔNG chứa bất kỳ trường nào khác.

AC-002 (self-view):
Given authenticated user gửi yêu cầu với userId chính là id của bản thân,
When request được xử lý,
Then the system trả về HTTP 200 với hồ sơ công khai của chính user đó, theo cùng quy tắc như xem user khác.

AC-003 (mọi role đều truy cập được):
Given user đã đăng nhập với role bất kỳ (INTERNAL_USER, MANAGER, BUSINESS_ADMIN, hoặc SYSTEM_ADMIN) và không có permission quản trị account nào,
When user đó gửi GET /api/v1/users/{userId}/public-profile,
Then the system trả về HTTP 200, không trả về lỗi 403.
```

### 7.2 Validation Cases

```text
AC-004:
Given userId không phải là UUID hợp lệ (ví dụ "abc" hoặc rỗng),
When user gửi yêu cầu GET,
Then the system trả về HTTP 400 với code INVALID_USER_ID.
```

### 7.3 Authentication Cases

```text
AC-005:
Given user chưa đăng nhập (không có JWT token),
When user gửi yêu cầu GET đến endpoint,
Then the system trả về HTTP 401 UNAUTHORIZED và không trả về bất kỳ dữ liệu nào.
```

### 7.4 Business Rule Cases

```text
AC-006:
Given userId không tồn tại trong hệ thống,
When user gửi yêu cầu GET,
Then the system trả về HTTP 404 với code USER_NOT_FOUND.

AC-007:
Given target user đã bị soft-delete,
When user gửi yêu cầu GET,
Then the system trả về HTTP 404 với code USER_NOT_FOUND.
```

### 7.5 Data Format Cases

```text
AC-008:
Given target user có department_id = null,
When user xem hồ sơ công khai của target user đó,
Then the system trả về HTTP 200 với department = null (không omit field).

AC-009:
Given target user chưa có avatar được duyệt (users.avatar_url = null),
When user xem hồ sơ công khai của target user đó,
Then the system trả về HTTP 200 với avatarUrl = null.

AC-010:
Given target user đã có avatar được System Administrator duyệt (users.avatar_url khác null),
When user xem hồ sơ công khai của target user đó,
Then the system trả về HTTP 200 với avatarUrl chứa permanent display URL từ users.avatar_url.

AC-011:
Given target user có employee_code = null,
When user xem hồ sơ công khai của target user đó,
Then the system trả về HTTP 200 với employeeCode = null (không omit field).
```

### 7.6 Read-only & Sensitive Data Verification

```text
AC-012:
Given user gửi yêu cầu GET đến endpoint public-profile,
When the system xử lý request,
Then the system không thực hiện bất kỳ hành vi INSERT, UPDATE, hay DELETE nào đối với bảng users hoặc departments.

AC-013:
Given response thành công của endpoint public-profile,
When kiểm tra cấu trúc response,
Then response KHÔNG chứa các trường: accountStatus, employmentStatus, mustChangePassword, lastLoginAt, failedLoginCount, lockedUntil, passwordUpdatedAt, roles, directManager, positionTitle, phoneNumber, hasFaceProfile, createdAt, updatedAt, password_hash.
```

### 7.7 Acceptance Criteria Traceability

| AC ID | Requirement ID liên quan | Kịch bản test chính |
|---|---|---|
| AC-001 | FR-001, FR-002, FR-004 | Happy path |
| AC-002 | FR-006 | Self-view |
| AC-003 | FR-006, FR-009 | Mọi role đều truy cập được |
| AC-004 | ERR-001 | Invalid UUID |
| AC-005 | FR-008, ERR-002 | Unauthenticated |
| AC-006 | FR-011, ERR-003 | User không tồn tại |
| AC-007 | FR-012, ERR-004 | Soft-deleted user |
| AC-008 | FR-013 | department null |
| AC-009 | FR-014 | avatarUrl null |
| AC-010 | FR-007, FR-014 | avatarUrl có giá trị |
| AC-011 | FR-015 | employeeCode null |
| AC-012 | FR-005 | No data mutation |
| AC-013 | FR-003, NFR-003, NFR-004 | Không lộ field nhạy cảm |

---

## 8. Out of Scope

### 8.1 Không triển khai trong feature này

- Không thay đổi hoặc thay thế endpoint chi tiết hồ sơ hiện có `GET /api/v1/users/{userId}` (UC-AM-10) — endpoint đó vẫn yêu cầu permission `account.user.read.detail` và giữ nguyên hành vi.
- Không thêm permission hoặc role check nào cho endpoint public-profile ngoài `JwtAuthGuard` — đây là quyết định thiết kế có chủ đích.
- Không trả về roles, accountStatus, employmentStatus, mustChangePassword, lastLoginAt, phoneNumber, positionTitle, directManager, hasFaceProfile, createdAt, updatedAt trong response.
- Không bao gồm department scope hoặc bất kỳ giới hạn truy cập theo phòng ban/tổ chức nào.
- Không bao gồm chỉnh sửa, cập nhật, hoặc xóa thông tin tài khoản.
- Không tạo bảng hoặc cột mới trong database.
- Không bao gồm audit logging cho hành động xem public-profile (dữ liệu trả về không nhạy cảm; khác với UC-AM-10 vốn ghi audit cho hành vi xem dữ liệu quản trị đầy đủ).
- Không bao gồm danh sách/tìm kiếm nhiều public profile cùng lúc (đã có `GET /users` cho danh sách rút gọn).

### 8.2 Có thể xem xét ở feature khác

- Cache hoặc tối ưu hiệu năng cho endpoint này nếu được gọi với tần suất rất cao (ví dụ danh sách người tham dự cuộc họp nhiều người).
- Mở rộng whitelist field công khai (ví dụ positionTitle) nếu sau này có yêu cầu nghiệp vụ rõ ràng và được xác nhận là an toàn để công khai.

### 8.3 Out-of-scope EARS Guardrails

```text
OOS-001: THE system SHALL NOT implement update, delete, hoặc status change logic trong feature này.
OOS-002: THE system SHALL NOT thêm permission hoặc role check nào ngoài JwtAuthGuard cho endpoint public-profile.
OOS-003: THE system SHALL NOT trả về roles, accountStatus, employmentStatus, mustChangePassword, lastLoginAt, hoặc bất kỳ field quản trị nhạy cảm nào khác trong response của endpoint này.
OOS-004: THE system SHALL NOT tạo bảng hoặc cột mới trong database cho feature này.
OOS-005: THE system SHALL NOT thay đổi hành vi hoặc contract của endpoint GET /api/v1/users/{userId} (UC-AM-10).
```

---

## Checklist tự kiểm tra trước khi hoàn tất spec

- [x] Spec đã có đủ 8 thành phần chính.
- [x] Functional Requirements đã viết theo EARS.
- [x] Requirement sử dụng keyword EARS bằng tiếng Anh: `THE system SHALL`, `WHEN`, `WHILE`, `WHERE`, `IF`, `THEN`.
- [x] Đã có đủ 5 EARS basic patterns: Ubiquitous, Event-driven, State-driven, Optional Feature, Unwanted Behavior.
- [x] Mỗi requirement có mã ID rõ ràng.
- [x] Requirement có thể kiểm thử được.
- [x] Không mô tả quá sâu implementation.
- [x] Không tự ý thêm feature ngoài tài liệu nguồn.
- [x] Không tự ý thêm database table/field mới.
- [x] Error handling đã bao gồm validation, authentication, business rule.
- [x] Error requirements đã ưu tiên format `IF ... THEN THE system SHALL ...`.
- [x] Acceptance Criteria dùng Given / When / Then.
- [x] Traceability đã liên kết AC với FR/ERR/NFR liên quan.
- [x] Out of Scope đủ rõ để tránh agent tự mở rộng.
- [x] Các phần thiếu thông tin đã được đưa vào `Cần làm rõ` (không có, đã đủ thông tin).
