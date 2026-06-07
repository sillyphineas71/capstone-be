# Feature Specification: Xem chi tiết hồ sơ tài khoản

- **Feature ID**: UC-AM-10 (tương ứng UC-15 trong API Contract)
- **Feature Name**: Xem chi tiết hồ sơ tài khoản
- **Module / Domain**: accounts
- **Created Date**: 2026-06-08
- **Status**: Draft
- **Source Documents**:
  - Use Case: UC-AM-10 Xem chi tiết hồ sơ tài khoản
  - API Contract v1.0 — UC-15
  - Database v3.2 Compact (39 tables)
  - AGENTS.md

---

## 1. Context & Goal

### 1.1 Bối cảnh

Tính năng này thuộc module **accounts** — phân hệ quản lý tài khoản nhân sự. Trong quá trình vận hành tổ chức, cấp quản lý (Business Admin, System Admin) thường xuyên cần tra cứu thông tin chi tiết của một nhân sự cụ thể để phục vụ các mục đích như: xem xét vai trò, kiểm tra trạng thái tài khoản, xác minh thông tin cá nhân, hoặc làm cơ sở cho các tác vụ quản lý khác như cập nhật thông tin, khóa tài khoản, điều chỉnh vai trò.

Hiện tại, danh sách tài khoản chỉ hiển thị thông tin cơ bản. Khi cần xem đầy đủ hồ sơ, người dùng cần một màn hình chuyên biệt hiển thị tập trung toàn bộ thông tin nhân sự ở chế độ chỉ đọc.

### 1.2 Mục tiêu

Mục tiêu của tính năng này là cho phép **Business Admin** và **System Admin** tra cứu toàn bộ thông tin hồ sơ của một tài khoản nhân sự cụ thể trên hệ thống ở chế độ chỉ đọc, nhằm hỗ trợ công tác quản lý nhân sự và ra quyết định.

### 1.3 Giá trị mang lại

- Giúp quản trị viên tra cứu nhanh thông tin nhân sự mà không cần truy vấn nhiều màn hình khác nhau.
- Cung cấp góc nhìn tổng thể và chi tiết về hồ sơ nhân viên (thông tin cá nhân, cấu trúc tổ chức, thông tin hệ thống).
- Tăng hiệu quả quản lý nhân sự nhờ hiển thị tập trung, rõ ràng.
- Làm cơ sở cho các tác vụ quản lý tiếp theo như cập nhật thông tin, khóa tài khoản, thay đổi vai trò.

### 1.4 Giả định

- Thông tin hồ sơ nhân sự đã được tạo và lưu trữ trong hệ thống thông qua quy trình tạo tài khoản (UC-06, UC-05).
- Quản trị viên đã có tài khoản hợp lệ và được phân quyền phù hợp.
- Mỗi nhân sự có một tài khoản duy nhất trong hệ thống.

### 1.5 Cần làm rõ

Tất cả các ambiguity đã được giải quyết trong phiên clarify ngày 2026-06-08:
- Department scope của Business Admin xác định từ `users.department_id` + child departments.
- `directManager` trả null nếu `direct_manager_id` null.
- `employmentStatus` enum: active, probation, resigned, transferred.
- `avatarUrl` lấy từ `users.avatar_url`, trả null nếu không có.
- Self-view bypass department scope nhưng vẫn cần permission.
- Các requirement UI thuần frontend đã được loại bỏ khỏi backend spec.

---

## 2. Actor & Roles

### 2.1 Danh sách actor

| Actor | Vai trò trong tính năng | Quyền / Trách nhiệm chính |
|---|---|---|
| Business Admin | Quản trị viên nghiệp vụ, có nhu cầu tra cứu hồ sơ nhân sự phục vụ quản lý | Xem chi tiết hồ sơ của tất cả nhân sự trong phạm vi quản lý |
| System Admin | Quản trị viên hệ thống, quản lý toàn bộ tài khoản và cấu hình | Xem chi tiết hồ sơ của mọi tài khoản trên hệ thống |

### 2.2 Role & Permission Rules

- Business Admin và System Admin được phép sử dụng tính năng này.
- Cả hai actor đều cần permission `account.user.read.detail` để truy cập endpoint.
- **System Admin**: được phép xem chi tiết mọi user chưa bị soft-delete, không giới hạn phạm vi.
- **Business Admin**: chỉ được xem user thuộc department scope của chính mình.
- Department scope của Business Admin được xác định từ `users.department_id` của chính Business Admin.
- Nếu hệ thống hỗ trợ cây phòng ban (qua `departments.parent_department_id`), scope bao gồm department của Business Admin và toàn bộ active child departments.
- `departments.manager_user_id` không được dùng làm nguồn xác định department scope mặc định trong use case này.

### 2.3 Actor Constraints

- Phải đăng nhập thành công vào hệ thống (JWT access token hợp lệ).
- Phải có permission `account.user.read.detail`.
- User ID target phải tồn tại trong hệ thống và chưa bị soft-delete.
- Khi target user chính là authenticated user (self-view), system bypass department scope check nhưng vẫn yêu cầu permission `account.user.read.detail`.

---

## 3. Functional Requirements

> Tất cả Functional Requirements được viết theo EARS.

### 3.1 Core Requirements

```text
FR-001: THE system SHALL hiển thị thông tin hồ sơ nhân sự ở chế độ chỉ đọc (read-only), không cho phép thay đổi dữ liệu trong luồng nghiệp vụ này.

FR-002: THE system SHALL trả về đầy đủ các trường thông tin của hồ sơ nhân sự bao gồm: id, employeeCode, email, fullName, phoneNumber, avatarUrl, positionTitle, department (id, departmentName), directManager (id, fullName), accountStatus, employmentStatus, mustChangePassword, lastLoginAt, roles (id, roleCode, roleName), hasFaceProfile, createdAt.

FR-003: THE system SHALL cho phép authenticated user xem chi tiết hồ sơ của chính mình (self-view) mà không bị department scope check chặn, nhưng vẫn phải có permission `account.user.read.detail`.
```

### 3.2 Event-driven Requirements

```text
FR-004: WHEN quản trị viên gửi yêu cầu xem chi tiết hồ sơ với userId hợp lệ, THE system SHALL tổng hợp thông tin từ các bảng liên quan (users, departments, user_roles, roles, face_profiles) và trả về response thành công.

FR-005: WHEN quản trị viên gửi yêu cầu xem chi tiết hồ sơ, THE system SHALL NOT thực hiện bất kỳ hành vi tạo, cập nhật hay xóa bỏ dữ liệu nào đối với bảng users, departments, user_roles, roles hay face_profiles.
```

### 3.3 State-driven Requirements

```text
FR-006: WHILE authenticated user has permission `account.user.read.detail`, WHEN the requested target userId exists and is accessible within the actor's scope, THE system SHALL trả về dữ liệu hồ sơ ở chế độ read-only và không thực hiện thay đổi dữ liệu.
```

### 3.4 Authorization Requirements

```text
FR-007: IF the user is not authenticated, THEN THE system SHALL reject the request and return an authentication error.

FR-008: IF the user does not have permission `account.user.read.detail`, THEN THE system SHALL reject the request without returning any user data.

FR-009: IF the authenticated user is a Business Admin, THEN THE system SHALL resolve department scope from the Business Admin's own `users.department_id`, including all active child departments via `departments.parent_department_id`, and only allow access to target users whose `users.department_id` falls within that scope.

FR-010: IF the authenticated user is a Business Admin and the target user's department_id is outside the resolved department scope (and is not a self-view request), THEN THE system SHALL reject the request with a 403 FORBIDDEN error without returning any user data.
```

### 3.5 Unwanted Behavior Requirements

```text
FR-011: IF userId không tồn tại trong hệ thống, THEN THE system SHALL trả về lỗi không tìm thấy tài khoản và không thực hiện thay đổi dữ liệu.

FR-012: IF tài khoản target đã bị xóa (soft-delete), THEN THE system SHALL trả về lỗi không tìm thấy tài khoản và không tiết lộ thông tin nhạy cảm.

FR-013: IF có lỗi hệ thống xảy ra trong quá trình tổng hợp dữ liệu, THEN THE system SHALL trả về lỗi server và ghi nhận sự kiện vào audit log.
```

### 3.6 Requirement Traceability

| Requirement ID | EARS Pattern | Nguồn / Use Case liên quan | Ghi chú |
|---|---|---|---|
| FR-001 | Ubiquitous | UC-AM-10, POST-1, POST-2 | Chế độ chỉ đọc |
| FR-002 | Ubiquitous | UC-15 API Contract | Response field mapping |
| FR-003 | Ubiquitous | UC-AM-10 | Self-view bypass department scope |
| FR-004 | Event-driven | UC-AM-10, Normal Flow step 3 | Xử lý request |
| FR-005 | Ubiquitous | UC-AM-10, POST-2 | No data mutation |
| FR-006 | State+Event-driven | UC-AM-10, POST-1 | Read-only verification |
| FR-007 | Unwanted Behavior | AGENTS.md §9 | Auth |
| FR-008 | Unwanted Behavior | UC-AM-10, PRE-1 | Permission check |
| FR-009 | Unwanted Behavior | AGENTS.md §9 | Business Admin scope resolution |
| FR-010 | Unwanted Behavior | AGENTS.md §9 | Business Admin out-of-scope |
| FR-011 | Unwanted Behavior | UC-AM-10 | User not found |
| FR-012 | Unwanted Behavior | AGENTS.md §5 | Soft-deleted user |
| FR-013 | Unwanted Behavior | AGENTS.md §17 | System error |

### 3.7 Requirement Notes

- Các response field phải tuân thủ đúng API Contract UC-15.
- Permission `account.user.read.detail` phải được kiểm tra trước khi trả dữ liệu.
- Department scope check chỉ áp dụng cho Business Admin, không áp dụng cho System Admin.
- Self-view bypass department scope check nhưng KHÔNG bypass permission check.

---

## 4. Non-functional Requirements

### 4.1 Performance

```text
NFR-001: THE system SHALL respond to the detail request within 2 seconds under normal load.
```

### 4.2 Security

```text
NFR-002: THE system SHALL NOT expose sensitive information such as password hashes, reset tokens, or internal identifiers in the API response.

NFR-003: THE system SHALL enforce authentication (JWT) before allowing access to any user detail endpoint.

NFR-004: THE system SHALL enforce authorization (permission `account.user.read.detail`) for every detail access request.
```

### 4.3 Reliability & Consistency

```text
NFR-005: THE system SHALL ensure data consistency when aggregating user information from multiple related tables.

NFR-006: IF the user detail cannot be fully retrieved due to a partial failure, THEN THE system SHALL return an error rather than incomplete or inconsistent data.
```

### 4.4 Observability

```text
NFR-007: THE system SHALL record an audit log entry when a user detail is accessed by a Business Admin or System Admin, containing actor id, target user id, and timestamp.

NFR-008: THE system SHALL log failed access attempts (authentication or authorization failures) for security monitoring purposes.
```

---

## 5. Data Model

### 5.1 Entity liên quan

| Entity / Table | Vai trò trong tính năng | Ghi chú |
|---|---|---|
| `users` | Lưu thông tin cá nhân và tài khoản của nhân sự | Bảng chính, chứa toàn bộ trường thông tin |
| `departments` | Cung cấp thông tin phòng ban của nhân sự | Liên kết qua `users.department_id` |
| `user_roles` | Liên kết giữa user và role | Liên kết qua `users.id` |
| `roles` | Định nghĩa vai trò và quyền | Liên kết qua `user_roles.role_id` |
| `face_profiles` | Kiểm tra user đã đăng ký khuôn mặt hay chưa | Liên kết qua `users.id`, trả về `hasFaceProfile` |

### 5.2 Dữ liệu đầu vào

| Field | Type dự kiến | Bắt buộc | Mô tả | Validation |
|---|---|---|---|---|
| `userId` | UUID | Có | UUID định danh của tài khoản nhân sự cần xem chi tiết | Phải là UUID hợp lệ, phải tồn tại trong bảng `users` |

### 5.3 Dữ liệu đầu ra

| Field | Type dự kiến | Mô tả |
|---|---|---|
| `id` | UUID | Định danh user |
| `employeeCode` | string | Mã nhân viên |
| `email` | string | Email đăng nhập |
| `fullName` | string | Họ và tên |
| `phoneNumber` | string | Số điện thoại |
| `avatarUrl` | string or null | URL ảnh đại diện, lấy từ `users.avatar_url`. Trả về `null` nếu `users.avatar_url` là null |
| `positionTitle` | string | Chức danh công việc |
| `department` | object | Thông tin phòng ban { id, departmentName } |
| `directManager` | object or null | Thông tin quản lý trực tiếp { id, fullName }. Trả về `null` nếu `users.direct_manager_id` là null. Không omit field này |
| `accountStatus` | enum | Trạng thái tài khoản: `active`, `inactive`, `locked`, `pending_reset` |
| `employmentStatus` | enum | Trạng thái làm việc: `active`, `probation`, `resigned`, `transferred` |
| `mustChangePassword` | boolean | Yêu cầu đổi mật khẩu |
| `lastLoginAt` | datetime | Lần đăng nhập cuối (ISO-8601) |
| `roles` | array | Danh sách vai trò [{ id, roleCode, roleName }] |
| `hasFaceProfile` | boolean | Đã đăng ký khuôn mặt hay chưa |
| `createdAt` | datetime | Thời điểm tạo tài khoản (ISO-8601) |

### 5.4 Data Constraints

- `users.id` là UUID, không được null.
- `users.email` phải là unique.
- `users.department_id` tham chiếu đến `departments.id`.
- `users.direct_manager_id` tham chiếu đến `users.id`, có thể là null.
- `users.avatar_url` lưu URL trực tiếp, không cần join qua `media_files` trong use case này.
- `user_roles` có unique constraint trên cặp (user_id, role_id).
- Face profile có thể không tồn tại; nếu không có thì `hasFaceProfile = false`.
- `employmentStatus` chỉ nhận các giá trị: `active`, `probation`, `resigned`, `transferred`.
- Department scope của Business Admin được resolve động từ `users.department_id` của admin đó, bao gồm cả child departments qua `departments.parent_department_id`.

### 5.5 Data Lifecycle

- Dữ liệu user được tạo qua UC-06 (Tạo tài khoản thủ công) hoặc UC-05 (Import Excel).
- Dữ liệu user được cập nhật qua UC-09 (Cập nhật thông tin tài khoản).
- Dữ liệu user bị soft-delete qua UC-10 (Xóa tài khoản).
- Tính năng này CHỈ ĐỌC dữ liệu, không tạo/cập nhật/xóa bất kỳ bản ghi nào.

---

## 6. Error Handling

### 6.1 Validation Errors

```text
ERR-001: IF `userId` is not a valid UUID, THEN THE system SHALL reject the request and return a validation error with code `INVALID_USER_ID`.
```

### 6.2 Authentication / Authorization Errors

```text
ERR-002: IF the user is not authenticated (missing/invalid JWT), THEN THE system SHALL return a 401 authentication error.

ERR-003: IF the user does not have permission `account.user.read.detail`, THEN THE system SHALL return a 403 authorization error with code `FORBIDDEN`.
```

### 6.3 Business Rule Errors

```text
ERR-004: IF `userId` does not exist in the system, THEN THE system SHALL return a 404 error with code `USER_NOT_FOUND`.

ERR-005: IF the target user is soft-deleted, THEN THE system SHALL return a 404 error with code `USER_NOT_FOUND`.

ERR-006: IF the authenticated user is a Business Admin and the target user is outside the resolved department scope (and is not a self-view request), THEN THE system SHALL return a 403 error with code `FORBIDDEN`.
```

### 6.4 Error Response Expectations

| Field | Mô tả |
|---|---|
| `statusCode` | HTTP status code |
| `message` | Thông báo lỗi |
| `error` | Loại lỗi ngắn gọn |
| `code` | Mã lỗi nội bộ |
| `timestamp` | Thời điểm xảy ra lỗi |
| `path` | API path |

---

## 7. Acceptance Criteria

### 7.1 Happy Path

```text
AC-001:
Given một user hợp lệ tồn tại trong hệ thống,
When System Admin có quyền `account.user.read.detail` gửi yêu cầu GET đến endpoint với userId hợp lệ,
Then the system returns HTTP 200 với đầy đủ các trường thông tin hồ sơ bao gồm: id, employeeCode, email, fullName, phoneNumber, avatarUrl, positionTitle, department, directManager, accountStatus, employmentStatus, mustChangePassword, lastLoginAt, roles, hasFaceProfile, createdAt.
```

```text
AC-002:
Given một user hợp lệ không có face profile,
When quản trị viên xem chi tiết user đó,
Then the system returns `hasFaceProfile: false` trong response.
```

```text
AC-012:
Given System Admin có permission `account.user.read.detail`,
When System Admin requests detail of any existing non-deleted user (regardless of department),
Then the system returns HTTP 200 with full account profile.
```

```text
AC-013:
Given Business Admin có permission `account.user.read.detail` và target user thuộc department scope của Business Admin (bao gồm child departments),
When Business Admin requests detail of that user,
Then the system returns HTTP 200 with full account profile.
```

### 7.2 Validation Cases

```text
AC-003:
Given userId không phải UUID hợp lệ (ví dụ: "abc" hoặc ""),
When quản trị viên gửi yêu cầu GET,
Then the system rejects with HTTP 400 and returns code `INVALID_USER_ID`.
```

### 7.3 Authorization Cases

```text
AC-004:
Given user chưa đăng nhập (không có JWT token),
When user gửi yêu cầu GET đến endpoint,
Then the system returns HTTP 401 authentication error.

AC-005:
Given user đã đăng nhập nhưng không có permission `account.user.read.detail`,
When user gửi yêu cầu GET đến endpoint,
Then the system returns HTTP 403 with code `FORBIDDEN` and không trả về bất kỳ dữ liệu user nào.

AC-006:
Given Business Admin có permission `account.user.read.detail` nhưng target user thuộc department ngoài scope (không phải self-view),
When Business Admin requests detail of that user,
Then the system returns HTTP 403 with code `FORBIDDEN`.
```

```text
AC-014:
Given Business Admin có permission `account.user.read.detail`,
When Business Admin requests detail of their own user profile (self-view, target userId == authenticated userId),
Then the system bypasses department scope check and returns HTTP 200 with full account profile.
```

### 7.4 Business Rule Cases

```text
AC-007:
Given userId không tồn tại trong hệ thống,
When quản trị viên gửi yêu cầu GET,
Then the system returns HTTP 404 with code `USER_NOT_FOUND`.

AC-008:
Given user đã bị soft-delete,
When quản trị viên gửi yêu cầu GET,
Then the system returns HTTP 404 with code `USER_NOT_FOUND`.
```

### 7.5 Data Format Cases

```text
AC-015:
Given target user có `direct_manager_id = null`,
When quản trị viên xem chi tiết user đó,
Then the system returns HTTP 200 with `directManager: null` (không omit field).
```

```text
AC-016:
Given target user có `avatar_url = null`,
When quản trị viên xem chi tiết user đó,
Then the system returns HTTP 200 with `avatarUrl: null`.
```

```text
AC-017:
Given target user có `avatar_url` là URL hợp lệ,
When quản trị viên xem chi tiết user đó,
Then the system returns HTTP 200 với `avatarUrl` chứa giá trị từ `users.avatar_url`.
```

```text
AC-018:
Given target user có `employmentStatus`,
When quản trị viên xem chi tiết user đó,
Then the system returns HTTP 200 với `employmentStatus` chỉ thuộc một trong các giá trị: `active`, `probation`, `resigned`, `transferred`.
```

### 7.6 Read-only Verification

```text
AC-009:
Given quản trị viên gửi yêu cầu GET đến endpoint xem chi tiết hồ sơ,
When the system processes the request,
Then the system không thực hiện bất kỳ hành vi INSERT, UPDATE hay DELETE nào đối với các bảng users, departments, user_roles, roles, face_profiles.

AC-010:
Given quản trị viên thành công xem chi tiết hồ sơ,
When the response is returned,
Then the original dữ liệu users/departments/user_roles/roles/face_profiles không bị thay đổi sau request.
```

### 7.7 Audit Cases

```text
AC-011:
Given quản trị viên có quyền thành công xem chi tiết một hồ sơ,
When the system hoàn tất việc trả dữ liệu,
Then the system records an audit log with actor id, target user id, action type `view_detail`, and timestamp.
```

### 7.8 Acceptance Criteria Traceability

| AC ID | Requirement ID liên quan | Kịch bản test chính |
|---|---|---|
| AC-001 | FR-001, FR-002, FR-004 | Happy path — System Admin |
| AC-002 | FR-002 | Face profile không tồn tại |
| AC-003 | ERR-001 | Invalid UUID |
| AC-004 | FR-007, ERR-002 | Unauthenticated |
| AC-005 | FR-008, ERR-003 | Không có permission |
| AC-006 | FR-010, ERR-006 | Business Admin ngoài scope |
| AC-007 | FR-011, ERR-004 | User không tồn tại |
| AC-008 | FR-012, ERR-005 | Soft-deleted user |
| AC-009 | FR-001, FR-005, FR-006 | No data mutation (backend) |
| AC-010 | FR-001, FR-005 | Data unchanged after request |
| AC-011 | NFR-007, NFR-008 | Audit log |
| AC-012 | FR-001, FR-002, FR-009 | System Admin — mọi user |
| AC-013 | FR-009 | Business Admin — trong scope |
| AC-014 | FR-003 | Business Admin — self-view |
| AC-015 | FR-002 | directManager null |
| AC-016 | FR-002 | avatarUrl null |
| AC-017 | FR-002 | avatarUrl có giá trị |
| AC-018 | FR-002 | employmentStatus enum |

---

## 8. Out of Scope

### 8.1 Không triển khai trong feature này

- **Chỉnh sửa thông tin tài khoản** (UC-09) — đã có endpoint `PATCH /api/v1/users/{userId}`.
- **Khóa tài khoản người dùng** (UC-12) — đã có endpoint `PATCH /api/v1/users/{userId}/lock`.
- **Cập nhật vai trò và quyền tài khoản** (UC-08) — đã có endpoint `PUT /api/v1/users/{userId}/roles`.
- **Xóa tài khoản người dùng** (UC-10) — đã có endpoint `DELETE /api/v1/users/{userId}`.
- **Cập nhật trạng thái tài khoản** (UC-11) — đã có endpoint `PATCH /api/v1/users/{userId}/status`.
- **Xem lịch sử hoạt động tài khoản** (UC-16) — đã có endpoint `GET /api/v1/users/{userId}/audit-logs`.
- **Đăng ký và liên kết dữ liệu khuôn mặt** (UC-17) — đã có endpoint `POST /api/v1/users/{userId}/face-profile`.
- **Tìm kiếm và lọc danh sách tài khoản** (UC-13, UC-14) — đã có endpoint `GET /api/v1/users`.

### 8.2 Có thể xem xét ở feature khác

- Tính năng điều hướng nhanh (AF1) từ màn hình chi tiết sang các tác vụ như "Chỉnh sửa thông tin", "Khóa tài khoản", "Thay đổi vai trò" sẽ được xử lý ở phía frontend dưới dạng các nút lối tắt gọi đến các endpoint tương ứng.
- Các hành vi UI thuần frontend như "nút Quay lại", "chuyển về màn hình danh sách" không thuộc phạm vi backend spec này.

### 8.3 Out-of-scope EARS Guardrails

```text
OOS-001: THE system SHALL NOT implement any update, delete, or status change logic within this feature.
OOS-002: THE system SHALL NOT create new database tables or fields as part of this feature.
OOS-003: THE system SHALL NOT implement audit log retrieval or face profile registration in this feature.
OOS-004: THE system SHALL NOT implement UI navigation behavior (e.g. "nút Quay lại", "chuyển về màn hình danh sách") as backend logic.
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
- [x] Error handling đã bao gồm validation, authentication, authorization, business rule.
- [x] Error requirements đã ưu tiên format `IF ... THEN THE system SHALL ...`.
- [x] Acceptance Criteria dùng Given / When / Then.
- [x] Traceability đã liên kết AC với FR/ERR/NFR liên quan.
- [x] Out of Scope đủ rõ để tránh agent tự mở rộng.
- [x] Các phần thiếu thông tin đã được đưa vào `Cần làm rõ` (không có, đã đủ thông tin).
