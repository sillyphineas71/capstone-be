# Feature Specification: Login

- **Feature ID**: AUTH-001
- **Feature Name**: Đăng nhập hệ thống
- **Module / Domain**: auth
- **Created Date**: 2026-05-26
- **Status**: Draft
- **Source Documents**:
  - `CLAUDE.md`
  - `spec/features/account/feat-create-account/spec.md`
  - `API_Contract_Agent_Reference.md`
  - `database_v3_1_balanced_intelligent_meeting_system_v3_1_balanced_49_tables.md`
  - `.specify/templates/spec-template.md`

---

## 1. Context & Goal

### 1.1 Bối cảnh

Tính năng Login thuộc module `auth` và là điểm vào chính để người dùng nội bộ truy cập Intelligent Meeting Lifecycle Management System. Đây là bước xác thực bắt buộc trước khi người dùng sử dụng các chức năng quản lý tài khoản, cuộc họp, phòng họp, điểm danh, ghi âm, biên bản và các nghiệp vụ quản trị khác.

Theo API contract hiện tại, use case `UC-AUTH-01` cung cấp endpoint `POST /api/v1/auth/login` cho phép người dùng đăng nhập bằng thông tin xác thực và nhận access token, refresh token cùng thông tin user cơ bản. Tính năng này cần bảo đảm xác thực đúng tài khoản, kiểm soát trạng thái tài khoản, tạo session phù hợp với baseline database, và không làm rò rỉ dữ liệu nhạy cảm.

### 1.2 Mục tiêu

Mục tiêu của tính năng này là cho phép người dùng nội bộ đăng nhập vào hệ thống bằng thông tin xác thực hợp lệ nhằm truy cập các chức năng được phân quyền, đồng thời bảo đảm an toàn xác thực, kiểm soát trạng thái tài khoản, và hỗ trợ quản lý phiên đăng nhập.

### 1.3 Giá trị mang lại

- Cho người dùng: truy cập hệ thống nhanh và nhất quán bằng tài khoản đã được cấp.
- Cho quản trị hệ thống: kiểm soát được tài khoản không hợp lệ, tài khoản bị khóa hoặc ngừng hoạt động.
- Cho bảo mật và vận hành: có access token, refresh token và session để quản lý truy cập và revoke khi cần.
- Cho audit và điều tra sự cố: có thể ghi nhận sự kiện đăng nhập và thông tin trace cần thiết.

### 1.4 Giả định

- API contract hiện tại là nguồn chuẩn cho request/response của `POST /api/v1/auth/login`.
- Hệ thống sử dụng JWT Bearer access token và có refresh token trong response login theo API contract.
- Bảng `user_sessions` trong database baseline là nơi bắt buộc để tạo session đăng nhập trước khi trả login success.
- Quyền và permission trả về trong response được suy ra từ `roles`, `permissions`, `user_roles` và `role_permissions`.
- Trạng thái tài khoản trong phạm vi login hiện tại chỉ gồm `active`, `inactive`, `locked`; trạng thái khác bị xem là không được phép đăng nhập.
- Cấu hình thời hạn session khi có `rememberDevice` được lấy từ `system_configs`.

### 1.5 Cần làm rõ

- Không có điểm cần làm rõ mở liên quan đến nghiệp vụ login hiện tại.

---

## 2. Actor & Roles

### 2.1 Danh sách actor

| Actor | Vai trò trong tính năng | Quyền / Trách nhiệm chính |
|---|---|---|
| Người dùng nội bộ | Actor chính thực hiện đăng nhập | Cung cấp email và password hợp lệ để truy cập hệ thống |
| Hệ thống xác thực | Xử lý xác thực, rate limit, tạo session, tạo token | Kiểm tra input, tài khoản, password, trạng thái tài khoản, và trả response đúng contract |
| Quản trị hệ thống | Actor gián tiếp qua cấu hình và trạng thái account | Quản lý account status, role, permission, revoke session và cấu hình auth liên quan |

### 2.2 Role & Permission Rules

- Login là endpoint `public` theo API contract, không yêu cầu access token trước khi gọi.
- Sau khi đăng nhập thành công, hệ thống phải trả về danh sách `roles[]` và `permissions[]` của user nếu contract yêu cầu.
- Phân quyền sử dụng các chức năng sau đăng nhập không thuộc phạm vi của feature này; feature này chỉ chịu trách nhiệm xác thực và cấp thông tin phân quyền ban đầu trong response.

### 2.3 Actor Constraints

- Người dùng phải có tài khoản tồn tại trong bảng `users`.
- Người dùng phải cung cấp email hợp lệ và password raw input hợp lệ.
- Tài khoản phải ở trạng thái cho phép đăng nhập theo policy hiện hành.
- Yêu cầu đăng nhập phải vượt qua strict validation và rate limit trước khi xác thực account.
- Việc tạo `user_sessions` phải hoàn tất trước khi response success được trả về.

---

## 3. Functional Requirements

### 3.1 Core Requirements

```text
FR-001: Hệ thống phải cung cấp chức năng đăng nhập hệ thống qua endpoint `POST /api/v1/auth/login` theo use case UC-AUTH-01.
FR-002: Khi người dùng gửi yêu cầu đăng nhập, hệ thống phải strict validate request body trước mọi bước xác thực khác.
FR-003: Nếu request body chứa field ngoài `email` và `password`, hệ thống phải từ chối yêu cầu với `400 VALIDATION_ERROR`.
FR-004: Nếu request body thiếu `email` hoặc `password`, hệ thống phải từ chối yêu cầu với `400 VALIDATION_ERROR`.
FR-005: Khi nhận giá trị `email`, hệ thống phải trim, lowercase và kiểm tra đúng email format trước khi tra cứu tài khoản.
FR-006: Khi nhận giá trị `password`, hệ thống phải kiểm tra sự hiện diện của password nhưng phải giữ nguyên raw input, không trim trước khi xác thực.
FR-007: Trước khi tra cứu tài khoản, hệ thống phải kiểm tra rate limit theo IP và email.
FR-008: Nếu vượt rate limit, hệ thống phải từ chối yêu cầu với `429 AUTH_TOO_MANY_ATTEMPTS`.
FR-009: Khi dữ liệu đầu vào hợp lệ và chưa vượt rate limit, hệ thống phải tìm tài khoản tương ứng với email đã được chuẩn hóa.
FR-010: Nếu không tìm thấy tài khoản tương ứng, hệ thống phải từ chối đăng nhập với `401 AUTH_INVALID_CREDENTIALS`.
FR-011: Khi tài khoản tồn tại, hệ thống phải kiểm tra password raw input với `users.password_hash` trước khi cho phép đăng nhập.
FR-012: Nếu password không chính xác, hệ thống phải từ chối đăng nhập với `401 AUTH_INVALID_CREDENTIALS`.
FR-013: Khi password chính xác, hệ thống phải kiểm tra `users.account_status` trước khi tạo session hoặc token.
FR-014: Nếu tài khoản ở trạng thái `inactive`, hệ thống phải từ chối đăng nhập với `403 AUTH_ACCOUNT_INACTIVE`.
FR-015: Nếu tài khoản ở trạng thái `locked`, hệ thống phải từ chối đăng nhập với `423 AUTH_ACCOUNT_LOCKED`.
FR-016: Nếu tài khoản có trạng thái khác ngoài `active`, `inactive`, `locked`, hệ thống phải từ chối đăng nhập với `403 AUTH_ACCOUNT_STATUS_NOT_ALLOWED`.
FR-017: Khi tài khoản hợp lệ và ở trạng thái `active`, hệ thống phải tạo mới bản ghi `user_sessions` trước khi tạo access token và refresh token.
FR-018: Nếu không thể tạo `user_sessions`, hệ thống phải fail login và trả `500 AUTH_SESSION_CREATE_FAILED`.
FR-019: Khi session được tạo thành công, hệ thống phải tạo access token và refresh token gắn với session vừa tạo.
FR-020: Nếu hệ thống không thể tạo token sau khi session đã được tạo, hệ thống phải trả về lỗi xử lý đăng nhập và không trả response success.
```

### 3.2 Workflow Requirements

```text
FR-021: Khi `user_sessions` được tạo thành công, hệ thống phải gắn session đó với đúng `user_id`, thời điểm đăng nhập và thời điểm hết hạn phù hợp.
FR-022: Nếu hệ thống có cấu hình thời hạn session theo `rememberDevice`, hệ thống phải lấy cấu hình đó từ `system_configs`.
FR-023: Khi đăng nhập thành công, hệ thống phải cập nhật `users.last_login_at`.
FR-024: Nếu cập nhật `users.last_login_at` thất bại, hệ thống phải không fail login và phải chỉ ghi log lỗi nội bộ.
FR-025: Khi đăng nhập thành công, hệ thống phải ghi audit log cho sự kiện login success.
FR-026: Nếu ghi audit log login success thất bại, hệ thống phải không fail login và phải chỉ ghi log lỗi nội bộ.
FR-027: Khi đăng nhập thành công, hệ thống phải trả về dữ liệu success theo format chuẩn của dự án, bao gồm token, thời hạn hiệu lực và thông tin user cơ bản theo API contract.
FR-028: Khi trả về thông tin user, hệ thống phải bao gồm `id`, `email`, `fullName`, `avatarUrl`, `departmentId`, `roles[]` và `permissions[]` theo API contract hiện hành.
```

### 3.3 Authorization Requirements

```text
FR-029: Vì endpoint login là `public`, hệ thống phải không yêu cầu access token trước khi xử lý yêu cầu đăng nhập.
FR-030: Khi người dùng đăng nhập thành công, hệ thống phải chỉ trả về các role và permission đang còn hiệu lực của user.
FR-031: Nếu user không có role hoặc permission hiệu lực, hệ thống phải vẫn trả response success theo dữ liệu thực tế của account và không tự suy diễn quyền ngoài dữ liệu thực tế.
```

### 3.4 Data & State Requirements

```text
FR-032: Khi tải dữ liệu account để đăng nhập, hệ thống phải lấy thông tin từ `users` và dữ liệu phân quyền liên quan từ `user_roles`, `roles`, `role_permissions` và `permissions` nếu cần cho response.
FR-033: Trong khi xử lý đăng nhập, hệ thống phải không trả về `password_hash`, `refresh_token_hash` hoặc dữ liệu nhạy cảm tương đương trong response.
FR-034: Nếu tài khoản có trạng thái `active`, hệ thống phải cho phép tiếp tục quy trình đăng nhập khi các điều kiện xác thực khác đều hợp lệ.
FR-035: Nếu tài khoản có trạng thái `locked`, hệ thống phải trả `423 AUTH_ACCOUNT_LOCKED`.
FR-036: Nếu tài khoản có trạng thái `inactive`, hệ thống phải trả `403 AUTH_ACCOUNT_INACTIVE`.
FR-037: Nếu tài khoản có trạng thái không được hỗ trợ, hệ thống phải trả `403 AUTH_ACCOUNT_STATUS_NOT_ALLOWED`.
```

### 3.5 Notification / Audit Requirements

```text
FR-038: Khi người dùng đăng nhập thành công, hệ thống phải ghi audit log với actor, action type, thời gian và thông tin trace phù hợp với `audit_logs`.
FR-039: Nếu đăng nhập thất bại do lỗi hệ thống hoặc lỗi token/session, hệ thống phải ghi log vận hành phù hợp để phục vụ điều tra sự cố mà không làm lộ secret hoặc raw credential.
FR-040: Nếu `last_login_at` update hoặc audit log ghi thất bại sau khi login success đã sẵn sàng, hệ thống phải chỉ ghi log nội bộ và không rollback kết quả đăng nhập thành công.
```

### 3.6 Integration Requirements

```text
FR-041: Nếu tính năng login phụ thuộc vào dữ liệu role và permission, hệ thống phải chỉ sử dụng các bảng baseline hiện có để tổng hợp dữ liệu phân quyền.
FR-042: Nếu tính năng login phụ thuộc vào cấu hình thời hạn session, hệ thống phải đọc cấu hình đó từ `system_configs` thay vì tự tạo nguồn dữ liệu mới.
FR-043: Nếu việc tạo session thất bại, hệ thống phải không tiếp tục bước tạo token và không trả response success.
```

### 3.7 Traceability

| Requirement ID | Nguồn / Use Case liên quan | Ghi chú |
|---|---|---|
| FR-002 | User clarification | Strict validate body |
| FR-005 | User clarification | Trim + lowercase email, validate format |
| FR-006 | User clarification | Không trim password |
| FR-007 | User clarification | Rate limit theo IP/email |
| FR-010 | User clarification | Không thấy user -> `401 AUTH_INVALID_CREDENTIALS` |
| FR-012 | User clarification | Sai password -> `401 AUTH_INVALID_CREDENTIALS` |
| FR-014 | User clarification | `inactive` -> `403 AUTH_ACCOUNT_INACTIVE` |
| FR-015 | User clarification | `locked` -> `423 AUTH_ACCOUNT_LOCKED` |
| FR-016 | User clarification | Status khác -> `403 AUTH_ACCOUNT_STATUS_NOT_ALLOWED` |
| FR-017 | User clarification, Database `user_sessions` | Session được tạo trước token |
| FR-018 | User clarification | Session fail -> `500 AUTH_SESSION_CREATE_FAILED` |
| FR-023 | Database `users`, user clarification | Update `last_login_at` |
| FR-025 | Database `audit_logs`, user clarification | Ghi audit login success |

---

## 4. Non-functional Requirements

### 4.1 Performance

```text
NFR-001: Hệ thống phải phản hồi yêu cầu đăng nhập thành công hoặc thất bại trong vòng 3 giây trong điều kiện tải thông thường.
NFR-002: Hệ thống phải xử lý login theo cách không làm chậm đáng kể trải nghiệm đăng nhập khi cần kiểm tra rate limit, tải role, permission và session data liên quan.
```

### 4.2 Security

```text
NFR-003: Hệ thống phải không cho phép đăng nhập nếu chưa hoàn tất strict validation, kiểm tra rate limit, kiểm tra tài khoản, password và trạng thái tài khoản.
NFR-004: Hệ thống phải không trả về `password_hash`, `refresh_token_hash` hoặc secret token nội bộ trong response login.
NFR-005: Hệ thống phải chỉ lưu refresh token hoặc session token ở dạng hash trong dữ liệu session nếu session persistence được sử dụng.
NFR-006: Hệ thống phải dùng cùng một mã lỗi `AUTH_INVALID_CREDENTIALS` cho cả trường hợp không tìm thấy tài khoản và password sai.
```

### 4.3 Reliability & Consistency

```text
NFR-007: Hệ thống phải đảm bảo rằng response success chỉ được trả về khi `user_sessions`, access token và refresh token đã được tạo nhất quán.
NFR-008: Hệ thống phải fail toàn bộ login nếu không thể tạo `user_sessions`.
NFR-009: Hệ thống phải không fail login chỉ vì không cập nhật được `last_login_at` hoặc không ghi được audit log sau khi các bước xác thực và cấp quyền truy cập đã thành công.
```

### 4.4 Usability

```text
NFR-010: Hệ thống phải trả về lỗi rõ ràng để client phân biệt được validation error, authentication error, account status error, rate limit error, token/session error và system error.
NFR-011: Hệ thống phải giữ response format của login nhất quán với chuẩn `{ success, data, meta }` hoặc `{ success, error }` của dự án.
```

### 4.5 Observability

```text
NFR-012: Hệ thống phải ghi nhận đủ thông tin trace như request id, ip address hoặc user agent nếu các dữ liệu đó có sẵn trong request context.
NFR-013: Hệ thống phải cho phép truy vết sự kiện đăng nhập thành công qua `audit_logs` nếu policy audit của dự án áp dụng cho login.
NFR-014: Hệ thống phải ghi log nội bộ khi cập nhật `last_login_at` hoặc ghi audit log thất bại sau login success.
```

### 4.6 Maintainability

```text
NFR-015: Logic đăng nhập phải tách bạch giữa validation, rate limit, xác thực account, tạo session, tạo token, cập nhật `last_login_at`, ghi audit log và tổng hợp response để dễ kiểm thử và thay đổi policy.
NFR-016: Tính năng phải có test case cho ít nhất các nhóm luồng: thành công, validation fail, rate limit fail, sai password, user không tồn tại, account inactive, account locked, status không được hỗ trợ, lỗi tạo session.
```

---

## 5. Data Model

### 5.1 Entity liên quan

| Entity / Table | Vai trò trong tính năng | Ghi chú |
|---|---|---|
| `users` | Nguồn dữ liệu tài khoản đăng nhập | Chứa email, username, password_hash, account_status, last_login_at, department_id |
| `user_roles` | Liên kết user với role | Chỉ lấy role còn hiệu lực |
| `roles` | Danh sách vai trò của user | Dùng để trả `roles[]` |
| `role_permissions` | Liên kết role với permission | Dùng để tổng hợp permission hiệu lực |
| `permissions` | Danh sách quyền chi tiết | Dùng để trả `permissions[]` |
| `user_sessions` | Quản lý session/refresh token | Là bước persist bắt buộc trước khi login success được trả về |
| `audit_logs` | Nhật ký kiểm toán | Dùng cho login success; lỗi ghi audit không làm fail login |
| `system_configs` | Cấu hình hệ thống liên quan | Là nguồn cấu hình thời hạn session khi có `rememberDevice` |
| `system_policies` | Policy hệ thống liên quan | Chỉ dùng cho policy mô tả hoặc quản trị nếu về sau cần |

### 5.2 Dữ liệu đầu vào

| Field | Type dự kiến | Bắt buộc | Mô tả | Validation |
|---|---:|---:|---|---|
| `email` | `string` | Có | Định danh đăng nhập | Required, valid email format, trim, lowercase |
| `password` | `string` | Có | Mật khẩu đăng nhập | Required, giữ nguyên raw input, không trim |

### 5.3 Dữ liệu đầu ra

| Field | Type dự kiến | Mô tả |
|---|---:|---|
| `accessToken` | `string` | Token truy cập cho các request cần xác thực |
| `refreshToken` | `string` | Token làm mới phiên theo API contract |
| `expiresIn` | `number` | Thời lượng hiệu lực của access token |
| `user.id` | `uuid` | Định danh user |
| `user.email` | `string` | Email của user |
| `user.fullName` | `string` | Tên hiển thị của user |
| `user.avatarUrl` | `string/null` | Ảnh đại diện nếu có |
| `user.departmentId` | `uuid/null` | Phòng ban của user nếu có |
| `user.roles[]` | `array` | Các role hiệu lực của user |
| `user.permissions[]` | `array` | Các permission hiệu lực của user |

### 5.4 State / Status Model

| Status | Ý nghĩa | Có thể chuyển sang | Điều kiện chuyển |
|---|---|---|---|
| `active` | Tài khoản được phép đăng nhập | Phiên đăng nhập hợp lệ | Password đúng, session được tạo, token được tạo |
| `inactive` | Tài khoản không được phép đăng nhập | Không chuyển trong phạm vi feature này | Trả `403 AUTH_ACCOUNT_INACTIVE` |
| `locked` | Tài khoản bị khóa tạm thời hoặc theo chính sách | Không chuyển trong phạm vi feature này | Trả `423 AUTH_ACCOUNT_LOCKED` |
| `other_status` | Trạng thái không nằm trong danh sách chính thức | Không chuyển trong phạm vi feature này | Trả `403 AUTH_ACCOUNT_STATUS_NOT_ALLOWED` |

### 5.5 Data Constraints

- Chỉ chấp nhận đúng hai field input là `email` và `password`.
- Nếu có `rememberDevice` hoặc bất kỳ field lạ nào trong body, request phải bị từ chối với `400 VALIDATION_ERROR`.
- Không trả về `users.password_hash` hoặc `user_sessions.refresh_token_hash` trong response.
- Session phải gắn đúng `user_id` và có thời hạn hết hạn rõ ràng nếu được tạo.
- Role và permission trong response chỉ được lấy từ mapping đang còn hiệu lực.
- Không tự thêm trạng thái tài khoản mới ngoài các trạng thái đã được xác nhận từ database/API contract và clarification hiện tại.

### 5.6 Data Lifecycle

- Dữ liệu đăng nhập được tạo ở mức session khi login success path đi qua bước tạo `user_sessions`.
- Dữ liệu token được tạo sau khi session được persist thành công.
- Dữ liệu `last_login_at` của user được cập nhật sau khi token và session đã sẵn sàng; lỗi cập nhật không làm fail login.
- Dữ liệu audit login success được ghi sau khi login thành công; lỗi ghi audit không làm fail login.

### 5.7 Cần làm rõ

- Không có điểm cần làm rõ mở trong data model của feature login hiện tại.

---

## 6. Validation & Error Handling

### 6.1 Validation Rules

- Request body chỉ được chứa `email` và `password`.
- Nếu body chứa `rememberDevice` hoặc field lạ, phải trả `400 VALIDATION_ERROR`.
- `email` là bắt buộc, phải đúng email format, phải được trim và lowercase trước khi tra cứu.
- `password` là bắt buộc và không được trim trước khi verify.

### 6.2 Error Groups

- Validation error:
  - Thiếu `email` hoặc `password`.
  - Sai kiểu dữ liệu đầu vào.
  - Sai email format.
  - Có field không được phép trong body.
- Rate limit error:
  - Vượt giới hạn số lần thử theo IP/email.
- Authentication error:
  - Không tìm thấy tài khoản tương ứng với email.
  - Password không chính xác.
- Account status error:
  - Tài khoản `inactive`.
  - Tài khoản `locked`.
  - Trạng thái khác không được phép đăng nhập.
- Token/session error:
  - Không tạo được `user_sessions`.
  - Không tạo được access token.
  - Không tạo được refresh token khi contract yêu cầu.
- System error:
  - Lỗi truy xuất database.
  - Lỗi tổng hợp role/permission.
  - Lỗi nội bộ khác làm không thể hoàn tất flow đăng nhập.

### 6.3 Error Handling Requirements

```text
FR-044: Nếu request body có field ngoài `email` và `password`, hệ thống phải trả `400 VALIDATION_ERROR`.
FR-045: Nếu `email` thiếu, sai format hoặc `password` thiếu, hệ thống phải trả `400 VALIDATION_ERROR`.
FR-046: Nếu vượt rate limit theo IP/email, hệ thống phải trả `429 AUTH_TOO_MANY_ATTEMPTS`.
FR-047: Nếu xác thực thất bại do tài khoản không tồn tại hoặc password sai, hệ thống phải trả `401 AUTH_INVALID_CREDENTIALS`.
FR-048: Nếu tài khoản `inactive`, hệ thống phải trả `403 AUTH_ACCOUNT_INACTIVE`.
FR-049: Nếu tài khoản `locked`, hệ thống phải trả `423 AUTH_ACCOUNT_LOCKED`.
FR-050: Nếu tài khoản có trạng thái không được phép đăng nhập, hệ thống phải trả `403 AUTH_ACCOUNT_STATUS_NOT_ALLOWED`.
FR-051: Nếu không tạo được `user_sessions`, hệ thống phải trả `500 AUTH_SESSION_CREATE_FAILED`.
FR-052: Nếu gặp lỗi hệ thống ngoài dự kiến khác, hệ thống phải trả system error theo chuẩn error response của dự án.
```

---

## 7. User Scenarios & Testing

### 7.1 Primary User Scenario

1. Người dùng mở màn hình đăng nhập.
2. Người dùng gửi body chỉ gồm `email` và `password`.
3. Hệ thống strict validate body, chuẩn hóa email và giữ nguyên password raw input.
4. Hệ thống kiểm tra rate limit theo IP/email.
5. Hệ thống tìm tài khoản theo email, verify password và kiểm tra `account_status`.
6. Hệ thống tạo `user_sessions`.
7. Hệ thống tạo access token và refresh token gắn với session vừa tạo.
8. Hệ thống cập nhật `users.last_login_at`, ghi audit login success và trả response thành công.

### 7.2 Alternate / Exception Scenarios

1. Body có field lạ hoặc có `rememberDevice`: hệ thống trả `400 VALIDATION_ERROR`.
2. Thiếu `email` hoặc `password`, hoặc email sai format: hệ thống trả `400 VALIDATION_ERROR`.
3. Vượt rate limit theo IP/email: hệ thống trả `429 AUTH_TOO_MANY_ATTEMPTS`.
4. Tài khoản không tồn tại: hệ thống trả `401 AUTH_INVALID_CREDENTIALS`.
5. Password sai: hệ thống trả `401 AUTH_INVALID_CREDENTIALS`.
6. Tài khoản `inactive`: hệ thống trả `403 AUTH_ACCOUNT_INACTIVE`.
7. Tài khoản `locked`: hệ thống trả `423 AUTH_ACCOUNT_LOCKED`.
8. Tài khoản có status khác: hệ thống trả `403 AUTH_ACCOUNT_STATUS_NOT_ALLOWED`.
9. Tạo `user_sessions` thất bại: hệ thống trả `500 AUTH_SESSION_CREATE_FAILED`.
10. Cập nhật `last_login_at` hoặc ghi audit log thất bại sau login success path: hệ thống không fail login, chỉ log lỗi nội bộ.

### 7.3 Acceptance Scenarios

- Đăng nhập thành công với tài khoản `active`, password đúng, và nhận đầy đủ `accessToken`, `refreshToken`, `expiresIn`, `user` theo contract hiện hành.
- Request body có field ngoài `email` và `password` bị từ chối với `400 VALIDATION_ERROR`.
- Email sai format bị từ chối với `400 VALIDATION_ERROR`.
- Đăng nhập thất bại khi vượt rate limit với `429 AUTH_TOO_MANY_ATTEMPTS`.
- Đăng nhập thất bại khi tài khoản không tồn tại với `401 AUTH_INVALID_CREDENTIALS`.
- Đăng nhập thất bại khi password không chính xác với `401 AUTH_INVALID_CREDENTIALS`.
- Đăng nhập thất bại khi tài khoản ở trạng thái `inactive` với `403 AUTH_ACCOUNT_INACTIVE`.
- Đăng nhập thất bại khi tài khoản ở trạng thái `locked` với `423 AUTH_ACCOUNT_LOCKED`.
- Đăng nhập thất bại khi tài khoản có trạng thái khác với `403 AUTH_ACCOUNT_STATUS_NOT_ALLOWED`.
- Login success không trả về `password_hash` hoặc dữ liệu nhạy cảm tương đương.
- Login success chỉ xảy ra khi `user_sessions` đã được tạo thành công.
- Nếu cập nhật `last_login_at` hoặc ghi audit thất bại sau login success path, response vẫn là success và lỗi chỉ được ghi nội bộ.

### 7.4 Edge Cases

- User có nhiều role đang hiệu lực cùng lúc.
- User không có department.
- User có role nhưng một phần permission mapping không còn hiệu lực.
- Password có chứa khoảng trắng đầu/cuối và phải được verify theo raw input.
- Session được tạo thành công nhưng cập nhật `last_login_at` thất bại.
- Session được tạo thành công nhưng audit log login success thất bại.

---

## 8. Success Criteria

- Tối thiểu 95% yêu cầu đăng nhập hợp lệ hoàn tất trong vòng 3 giây ở điều kiện tải thông thường.
- 100% response đăng nhập thành công chứa đúng các trường bắt buộc của API contract và không chứa dữ liệu nhạy cảm bị cấm.
- 100% request có field lạ hoặc email/password không hợp lệ bị chặn ở bước strict validation với `400 VALIDATION_ERROR`.
- 100% trường hợp vượt rate limit bị chặn với `429 AUTH_TOO_MANY_ATTEMPTS` trước khi hệ thống xác thực password.
- 100% trường hợp tài khoản không tồn tại hoặc password sai trả cùng mã lỗi `401 AUTH_INVALID_CREDENTIALS`.
- 100% trường hợp tài khoản `inactive`, `locked`, hoặc status không được phép bị chặn trước khi token được cấp.
- 100% đăng nhập thành công chỉ xảy ra sau khi `user_sessions` được tạo thành công.

---

## 9. Out of Scope

- `rememberDevice` request field và hành vi login theo thiết bị trong phạm vi hiện tại, vì strict validation chỉ chấp nhận `email` và `password`.
- Logout.
- Refresh token endpoint.
- Forgot password hoặc password reset bằng OTP.
- Change password sau khi đăng nhập.
- Register, create account, import account.
- SSO, OAuth, face login, social login.
- Cơ chế lockout policy chi tiết theo số lần sai password ngoài kết quả rate limit đã được chốt.
