# Feature Specification: Logout Phiên Hiện Tại

- **Feature ID**: AUTH-002
- **Feature Name**: Đăng xuất khỏi hệ thống
- **Module / Domain**: auth
- **Created Date**: 2026-05-27
- **Status**: Draft
- **Source Documents**:
  - `CLAUDE.md`
  - `spec/features/auth/feat-login/plan.md`
  - `API_Contract_Agent_Reference.md`
  - `database_v3_1_balanced_intelligent_meeting_system_v3_1_balanced_49_tables.md`
  - `spec/features/account/feat-create-account/spec.md`
  - `UC-AUTH-02 - Đăng xuất khỏi hệ thống`

---

## 1. Context & Goal

### 1.1 Bối cảnh

Tính năng này thuộc module `auth` trong vòng đời xác thực của hệ thống Intelligent Meeting Lifecycle Management System. Sau khi người dùng đã đăng nhập và đang truy cập các khu vực nội bộ, hệ thống cần cho phép người dùng chủ động kết thúc phiên làm việc hiện tại để bảo vệ thông tin cá nhân, dữ liệu tổ chức và giảm rủi ro truy cập trái phép trên thiết bị đang dùng.

Use case `UC-AUTH-02` tập trung vào thao tác đăng xuất khỏi phiên hiện tại. Theo API contract, hệ thống đã có endpoint `POST /api/v1/auth/logout` cho actor đã xác thực (`auth:user`). Theo database baseline, hệ thống có bảng `user_sessions` để theo dõi session/refresh token và bảng `audit_logs` để lưu nhật ký kiểm toán cho các thao tác bảo mật.

### 1.2 Mục tiêu

Mục tiêu của tính năng này là cho phép `User` đã đăng nhập đăng xuất an toàn khỏi phiên làm việc hiện tại nhằm chấm dứt quyền truy cập của phiên đó, đảm bảo các request tiếp theo không thể tiếp tục dùng session vừa đăng xuất để truy cập tài nguyên được bảo vệ.

### 1.3 Giá trị mang lại

- Giúp người dùng kết thúc phiên làm việc hiện tại một cách rõ ràng và an toàn.
- Giảm rủi ro lộ dữ liệu nội bộ khi người dùng rời thiết bị hoặc kết thúc ca làm việc.
- Giữ tính nhất quán giữa trạng thái xác thực ở backend và trạng thái đăng nhập cục bộ ở frontend.
- Hỗ trợ truy vết bảo mật qua `audit_logs` nếu hệ thống yêu cầu ghi log cho thao tác logout.

### 1.4 Giả định

- Người dùng đã đăng nhập hợp lệ trước khi thao tác logout.
- Endpoint logout áp dụng cho phiên hiện tại, không phải chức năng logout tất cả thiết bị.
- Frontend có cơ chế lưu trạng thái xác thực cục bộ, nhưng spec backend này chỉ mô tả dữ liệu API và không mở rộng sang hành vi triển khai UI cụ thể.
- Backend sử dụng `Authorization Bearer access token` hiện tại để xác định đúng phiên cần thu hồi.
- Access token hiện tại bắt buộc phải chứa claim `sid` với giá trị bằng `user_sessions.id` để ánh xạ tới phiên hiện tại.
- Các protected resources của hệ thống đều kiểm tra xác thực ở những request sau logout.

### 1.5 Cần làm rõ

- API contract gốc đang mô tả input logout là `Authorization` kèm body tùy chọn `{refreshToken?}` hoặc `{sessionId?}`; spec này đã chốt theo clarify là chỉ dùng `Authorization Bearer access token` và không yêu cầu body, nên cần đồng bộ lại với API contract chính thức nếu contract đang là nguồn chuẩn bên ngoài spec.

---

## 2. Actor & Roles

### 2.1 Danh sách actor

| Actor | Vai trò trong tính năng | Quyền / Trách nhiệm chính |
|---|---|---|
| User | Actor chính khởi tạo thao tác logout | Gửi yêu cầu logout từ phiên đã đăng nhập và dừng sử dụng phiên hiện tại sau khi logout thành công |
| Backend Auth Service | Thành phần xử lý xác thực và thu hồi session hiện tại | Xác thực request, xác định session hiện tại, revoke/invalidate session, trả response đúng contract |
| Frontend Client | Thành phần giao diện kích hoạt logout và dọn trạng thái cục bộ | Gọi API logout, xóa auth state cục bộ theo cơ chế hiện có, điều hướng về màn hình đăng nhập, hiển thị thông báo |

### 2.2 Role & Permission Rules

- Chỉ người dùng đã xác thực mới được gọi endpoint logout theo permission `auth:user` trong API contract.
- Logout chỉ áp dụng cho phiên hiện tại của thiết bị/trình duyệt đang gửi request.
- Logout không được revoke toàn bộ session của cùng user trên các thiết bị hoặc trình duyệt khác.
- Frontend chịu trách nhiệm dọn trạng thái xác thực cục bộ sau khi backend trả kết quả thành công.

### 2.3 Actor Constraints

- Người dùng phải đang ở trạng thái đăng nhập hợp lệ trước khi khởi tạo thao tác logout.
- Request logout phải gửi kèm `Authorization Bearer access token` hợp lệ.
- Access token dùng cho logout bắt buộc phải chứa claim `sid` với giá trị bằng `user_sessions.id` của phiên hiện tại.

---

## 3. Functional Requirements

> Tất cả Functional Requirements được viết theo phong cách EARS và tập trung vào hành vi nghiệp vụ cần có cho `UC-AUTH-02`.

### 3.1 Core Requirements

```text
FR-001: Hệ thống phải cung cấp chức năng cho người dùng đã đăng nhập đăng xuất khỏi phiên làm việc hiện tại.
FR-002: Khi người dùng chọn chức năng "Đăng xuất", hệ thống phải gửi request logout tới endpoint được quy định trong API contract.
FR-003: Khi backend nhận request logout, hệ thống phải xác thực request dựa trên `Authorization Bearer access token` hiện tại.
FR-004: Khi request logout hợp lệ, hệ thống phải lấy claim `sid` từ access token để xác định đúng bản ghi `user_sessions.id` của phiên hiện tại.
FR-005: Khi xác định được session hiện tại, hệ thống phải thu hồi hoặc vô hiệu hóa đúng session đó mà không tác động đến các session hợp lệ khác của cùng user.
FR-006: Khi logout thành công, hệ thống phải cập nhật `user_sessions` của phiên hiện tại thành trạng thái không còn hiệu lực bằng cách đặt `is_active = false`, ghi `revoked_at = now()`, và ghi `revoke_reason = USER_LOGOUT` nếu field này tồn tại trong schema.
FR-007: Khi logout thành công, hệ thống phải trả response thành công theo API contract và không được trả về password hash, token bí mật mới, refresh token mới, hoặc dữ liệu nhạy cảm không cần thiết.
FR-008: Nếu request logout được gửi lặp lại cho session đã bị revoke trước đó, hệ thống phải vẫn trả response thành công theo nguyên tắc idempotent logout.
FR-009: Sau khi logout thành công, hệ thống phải từ chối mọi protected API tiếp theo dùng lại session hoặc token cũ với status `401`.
FR-010: Nếu request logout không có thông tin xác thực hợp lệ, hệ thống phải từ chối yêu cầu theo status code lỗi xác thực đã được định nghĩa trong API contract.
FR-011: Nếu session hiện tại đã bị thu hồi trước đó, hệ thống phải vẫn trả response thành công và không được thu hồi các session khác của cùng user.
```

### 3.2 Workflow Requirements

```text
FR-012: Khi người dùng mở menu tài khoản hoặc khu vực quản lý tài khoản, hệ thống phải cho phép người dùng chọn hành động "Đăng xuất".
FR-013: Khi người dùng xác nhận logout hoặc hoàn tất thao tác chọn logout, hệ thống phải bắt đầu quy trình đăng xuất cho phiên hiện tại.
FR-014: Khi backend hoàn tất revoke hoặc invalidate session hiện tại, hệ thống phải chặn các request tiếp theo dùng lại session hoặc token cũ để truy cập protected resources bằng cách trả `401`.
FR-015: Nếu người dùng hủy thao tác logout trước khi request được gửi đi, hệ thống phải đóng menu hoặc hộp thoại liên quan và không gửi request logout tới backend.
FR-016: Nếu hệ thống có frontend tích hợp, frontend phải tự xóa các dữ liệu auth state tạm thời, tự điều hướng người dùng về màn hình đăng nhập, và tự hiển thị thông báo `Đăng xuất thành công`; backend chỉ chịu trách nhiệm trả dữ liệu API logout.
```

### 3.3 Authorization Requirements

```text
FR-017: Nếu người dùng chưa đăng nhập, hệ thống phải không cho phép sử dụng chức năng logout như một thao tác hợp lệ cho phiên nội bộ đang hoạt động.
FR-018: Khi xử lý logout, backend phải kiểm tra quyền truy cập của request theo cơ chế `auth:user` đã được định nghĩa trong API contract.
FR-019: Nếu request logout không vượt qua bước xác thực hoặc phân quyền, hệ thống phải không thay đổi dữ liệu session.
```

### 3.4 Data & State Requirements

```text
FR-020: Khi logout được xử lý thành công, hệ thống phải ghi nhận thời điểm session hiện tại bị thu hồi bằng `revoked_at` và đặt `is_active = false` trong `user_sessions`.
FR-021: Khi logout được xử lý thành công, hệ thống phải duy trì tính nhất quán để session vừa logout không còn được xem là session hoạt động của người dùng.
FR-022: Nếu request logout chỉ nhắm tới phiên hiện tại, hệ thống phải không sửa đổi trạng thái của các session khác thuộc cùng `user_id`.
FR-023: Hệ thống phải dùng claim `sid` trong access token hiện tại để chỉ revoke session khớp với request và ngữ cảnh xác thực hiện tại.
```

### 3.5 Notification / Audit Requirements

```text
FR-024: Khi người dùng logout thành công, hệ thống phải luôn cố gắng ghi audit log cho hành động logout.
FR-025: Khi ghi audit log cho logout, hệ thống phải lưu tối thiểu actor, action, thời gian thực hiện và context request theo các cột hiện có của `audit_logs`.
FR-026: Nếu ghi audit log thất bại sau khi session đã được revoke thành công, hệ thống phải không làm logout thất bại.
```

### 3.6 Integration Requirements

```text
FR-027: Hệ thống phải kiểm tra và cập nhật bản ghi `user_sessions` liên quan trước khi xác nhận logout thành công.
FR-028: Nếu thao tác thu hồi session không hoàn tất do lỗi hệ thống, hệ thống phải trả lỗi phù hợp và không được báo logout thành công sai thực tế.
FR-029: Nếu hệ thống có lớp bảo vệ protected resources dùng session hoặc token, hệ thống phải từ chối các request tiếp theo dùng thông tin xác thực cũ sau khi logout thành công.
```

### 3.7 Traceability

| Requirement ID | Nguồn / Use Case liên quan | Ghi chú |
|---|---|---|
| FR-001 đến FR-029 | `UC-AUTH-02 - Đăng xuất khỏi hệ thống` | Luồng chính, luồng thay thế, business rules và phạm vi logout |
| FR-003, FR-010, FR-018 | `API_Contract_Agent_Reference.md` | Endpoint `POST /api/v1/auth/logout`, permission `auth:user`, status `200/401/404` |
| FR-006, FR-020, FR-023, FR-026 | `database_v3_1_balanced_intelligent_meeting_system_v3_1_balanced_49_tables.md` | Bảng `user_sessions` với `refresh_token_hash`, `expires_at`, `revoked_at`, `is_active` |
| FR-024, FR-025 | `CLAUDE.md`, `API_Contract_Agent_Reference.md`, database baseline | Tài liệu nguồn yêu cầu audit cho API ghi dữ liệu/thao tác bảo mật và có bảng `audit_logs` |

---

## 4. Non-functional Requirements

### 4.1 Performance

```text
NFR-001: Hệ thống phải phản hồi thao tác logout thành công hoặc thất bại trong vòng 3 giây trong điều kiện tải thông thường.
NFR-002: Hệ thống phải xử lý logout theo cách không tạo ảnh hưởng dây chuyền đến các session khác của cùng user.
```

### 4.2 Security

```text
NFR-003: Hệ thống phải yêu cầu xác thực hợp lệ trước khi cho phép thực hiện logout cho phiên hiện tại.
NFR-004: Hệ thống phải không trả về dữ liệu nhạy cảm không cần thiết trong response logout.
NFR-005: Hệ thống phải bảo đảm token hoặc session cũ không tiếp tục truy cập được protected resources sau khi logout thành công và phải trả `401` cho các request đó.
```

### 4.3 Reliability & Consistency

```text
NFR-006: Hệ thống phải đảm bảo session hiện tại không bị đánh dấu logout thành công nếu thao tác revoke hoặc invalidate session chưa hoàn tất.
NFR-007: Hệ thống phải đảm bảo logout của một thiết bị không làm thay đổi trạng thái session hợp lệ trên thiết bị khác của cùng tài khoản.
NFR-008: Hệ thống phải xử lý an toàn các request logout lặp lại hoặc session đã revoke theo nguyên tắc idempotent và vẫn trả success cho cùng phiên đã revoke.
```

### 4.4 Auditability

```text
NFR-009: Hệ thống phải hỗ trợ truy vết thao tác logout qua `audit_logs` nếu chính sách audit áp dụng cho endpoint này.
```

---

## 5. User Story / Use Case

### 5.1 User Story

Là một `User` đã đăng nhập, tôi muốn đăng xuất khỏi phiên làm việc hiện tại để chấm dứt quyền truy cập trên thiết bị đang dùng và bảo vệ thông tin cá nhân cũng như dữ liệu của tổ chức.

### 5.2 Use Case Summary

- **Use Case ID**: `UC-AUTH-02`
- **Use Case Name**: `Đăng xuất khỏi hệ thống`
- **Primary Actor**: `User`
- **Priority**: `High`
- **Frequency of Use**: `Thường xuyên`

### 5.3 Trigger

Người dùng chủ động muốn kết thúc phiên làm việc hiện tại trên phần mềm để bảo mật thông tin cá nhân và dữ liệu của tổ chức.

### 5.4 Preconditions

- Người dùng đang trong trạng thái đăng nhập hợp lệ.
- Người dùng đang truy cập vào giao diện làm việc của hệ thống.
- Request logout được gửi kèm `Authorization Bearer access token` hợp lệ.

### 5.5 Postconditions

- Phiên làm việc hiện tại của người dùng bị chấm dứt và bị revoke trong `user_sessions`.
- Người dùng không còn quyền truy cập vào các trang nội bộ bằng phiên đăng nhập vừa đăng xuất.
- Các request tiếp theo từ thiết bị hoặc trình duyệt đó nếu không có thông tin xác thực mới phải bị chặn.
- Backend trả dữ liệu API logout thành công; việc xóa auth state, điều hướng về màn hình đăng nhập và hiển thị thông báo `Đăng xuất thành công` thuộc trách nhiệm của frontend tích hợp.

### 5.6 Main Flow

1. Người dùng mở menu tài khoản hoặc khu vực quản lý tài khoản trên giao diện hệ thống.
2. Hệ thống hiển thị tùy chọn `Đăng xuất`.
3. Người dùng chọn `Đăng xuất`.
4. Client gửi request logout tới backend với `Authorization Bearer access token` hiện tại và không cần body.
5. Backend xác thực access token logout hiện tại.
6. Backend lấy `sid` hoặc `session_id` từ access token để xác định `user_sessions.id` của phiên hiện tại.
7. Backend revoke session hiện tại bằng cách cập nhật `is_active = false`, `revoked_at = now()`, và `revoke_reason = USER_LOGOUT` nếu field này tồn tại trong schema.
8. Backend luôn cố gắng ghi nhận hành động logout vào `audit_logs`; lỗi audit không làm fail logout.
9. Backend trả response logout thành công theo API contract.
10. Các protected API tiếp theo dùng lại session hoặc token cũ phải trả `401`.

### 5.7 Alternative Flows

- **AF-01: Hủy bỏ thao tác logout**
  - Tại bước 2 hoặc trước khi request được gửi, người dùng đóng menu hoặc hủy xác nhận logout nếu giao diện có hộp thoại xác nhận.
  - Hệ thống đóng thành phần giao diện liên quan.
  - Không có request logout nào được gửi tới backend.

- **AF-02: Access token còn hợp lệ nhưng session đã bị revoke trước đó**
  - Backend kiểm tra request và bản ghi session hiện tại.
  - Nếu session không còn active hoặc đã bị revoke, hệ thống vẫn trả response logout thành công theo nguyên tắc idempotent.

- **AF-03: Logout lặp lại nhiều lần cho cùng một phiên**
  - Nếu frontend hoặc người dùng gửi nhiều request logout liên tiếp cho cùng session, hệ thống phải xử lý an toàn.
  - Các request lặp lại cho cùng session đã revoke vẫn trả thành công và không tác động đến session khác.

---

## 6. Business Rules

- **BR-001**: Ngay sau khi logout thành công, mọi request tiếp theo dùng session hoặc token cũ của thiết bị đó để truy cập protected resources phải bị chặn.
- **BR-002**: Logout của thiết bị hiện tại chỉ chấm dứt phiên làm việc hiện tại, không chấm dứt các phiên đăng nhập hợp lệ khác của cùng tài khoản.
- **BR-003**: Backend không được xóa tài khoản người dùng, không được khóa tài khoản và không được revoke toàn bộ session của user nếu use case này chỉ yêu cầu logout phiên hiện tại.
- **BR-004**: Response logout không được chứa password hash, token bí mật mới, refresh token mới, hoặc dữ liệu nhạy cảm không cần thiết.
- **BR-005**: Frontend chịu trách nhiệm dọn trạng thái đăng nhập cục bộ sau khi backend trả kết quả logout thành công.

---

## 7. API Behavior

### 7.1 Endpoint

- **Method**: `POST`
- **Endpoint**: `/api/v1/auth/logout`
- **Permission**: `auth:user`

### 7.2 Request Behavior

- Request phải có `Authorization: Bearer <access-token>`.
- Request logout không yêu cầu body.
- Access token bắt buộc phải chứa claim `sid` với giá trị bằng `user_sessions.id`.

### 7.3 Success Response

- API contract quy định logout thành công trả `200`.
- Output chính theo contract: `{revoked:true, revokedAt}`.
- Field `revokedAt` phải dùng format ISO 8601 timestamp.
- Response success không được chứa secret mới hoặc dữ liệu nhạy cảm khác.
- Nếu session đã bị revoke trước đó nhưng request vẫn hợp lệ, hệ thống vẫn trả success theo nguyên tắc idempotent logout.

### 7.4 Error Response

- `401`: Khi thiếu thông tin xác thực hoặc thông tin xác thực không hợp lệ theo API contract.
- `401`: Sau logout thành công, mọi protected API dùng lại session hoặc token cũ phải trả `401`.
- `404`: Không dùng cho trường hợp session hiện tại đã bị revoke nếu request logout vẫn hợp lệ theo nguyên tắc idempotent đã chốt.
- `500` hoặc mã lỗi hệ thống cụ thể chưa được contract chốt: dùng cho lỗi nội bộ khi không thể hoàn tất thao tác thu hồi session. Mã lỗi cụ thể cần làm rõ thêm nếu team có chuẩn lỗi riêng cho logout.

### 7.5 API Rules & Open Points

- Logout dùng access token hiện tại và không yêu cầu body.
- Logout chỉ revoke session hiện tại được xác định qua claim `sid` trong access token.
- Claim `sid` trong access token bắt buộc phải có và phải bằng `user_sessions.id`.
- Logout là idempotent; request logout lặp lại cho session đã revoke vẫn trả success.
- Nếu ghi audit log thất bại, logout vẫn thành công nếu revoke session đã hoàn tất.
- Nếu cập nhật `user_sessions` thất bại, logout phải không được báo success sai thực tế.

---

## 8. Data Model

### 8.1 Bảng sử dụng

- `user_sessions`
  - Dùng để xác định và thu hồi session hiện tại.
  - Các cột liên quan theo database baseline gồm: `id`, `user_id`, `refresh_token_hash`, `expires_at`, `revoked_at`, `revoke_reason`, `is_active`, `ip_address`, `user_agent`, `metadata_json`.
  - `id` của bảng này phải được ánh xạ từ claim `sid` trong access token hiện tại.

- `audit_logs`
  - Dùng để ghi nhận hành động logout nếu chính sách audit áp dụng cho endpoint này.
  - Các cột liên quan gồm: `user_id`, `action_type`, `entity_type`, `entity_id`, `ip_address`, `user_agent`, `request_id`, `created_at`, `severity`, `metadata_json`.

- `users`
  - Chỉ được tham chiếu gián tiếp thông qua `user_id` của session để xác định chủ sở hữu phiên hiện tại khi cần.

### 8.2 Data State Expectations

- Session hiện tại sau logout phải không còn được xem là active.
- `revoked_at` phải được ghi nhận khi logout thành công.
- `is_active` phải được cập nhật thành `false` khi logout thành công.
- `revoke_reason` phải ghi `USER_LOGOUT` nếu field này tồn tại trong schema; nếu không có field này thì bỏ qua.

### 8.3 Cần làm rõ

- Không còn điểm nào cần làm rõ thêm; tất cả quyết định đã được chốt sau clarify.

---

## 9. Validation Rules

- Request logout phải có `Authorization Bearer access token` hợp lệ.
- Request logout không yêu cầu body.
- Frontend chỉ được xem logout là thành công khi backend trả response success theo contract.
- Sau logout thành công, frontend phải xóa auth state cục bộ để tránh gửi lại request bằng trạng thái xác thực cũ.

### 9.1 Cần làm rõ

- Không còn điểm nào cần làm rõ thêm; claim `sid` đã được chốt là bắt buộc trong access token.

---

## 10. Error Handling

- **Unauthorized error**
  - Xảy ra khi request thiếu token, token không hợp lệ, hoặc request không vượt qua bước xác thực theo contract.
  - Hệ thống phải từ chối request và không thay đổi dữ liệu session.

- **Session not found / session expired / session revoked**
  - Xảy ra khi session hiện tại không còn tồn tại hoặc không còn hiệu lực theo contract.
  - Nếu session đã bị revoke trước đó nhưng request logout hợp lệ, hệ thống vẫn trả success theo nguyên tắc idempotent.

- **Token/session revoke error**
  - Xảy ra khi backend không thể cập nhật hoặc thu hồi session hiện tại trong `user_sessions`.
  - Hệ thống phải fail request thay vì trả success sai thực tế.

- **Audit log error**
  - Xảy ra khi backend không thể ghi `audit_logs` cho thao tác logout.
  - Logout vẫn thành công nếu session đã được revoke thành công.

- **System error**
  - Xảy ra khi có lỗi nội bộ ngoài dự kiến trong quá trình xử lý logout.
  - Hệ thống phải trả lỗi hệ thống phù hợp và không được để trạng thái phản hồi mâu thuẫn với trạng thái session thực tế.

---

## 11. Acceptance Criteria

- [ ] Người dùng đã đăng nhập có thể khởi tạo logout từ menu tài khoản trên giao diện hệ thống.
- [ ] Frontend phải gọi `POST /api/v1/auth/logout` theo API contract khi người dùng chọn logout.
- [ ] Backend phải chỉ cho phép request logout hợp lệ với permission `auth:user`.
- [ ] Logout thành công phải chỉ thu hồi phiên hiện tại, không làm mất hiệu lực các session khác của cùng user.
- [ ] Request logout phải dùng `Authorization Bearer access token` hiện tại và không yêu cầu body.
- [ ] Access token dùng cho logout bắt buộc phải chứa claim `sid` với giá trị bằng `user_sessions.id`.
- [ ] Sau logout thành công, session hiện tại trong `user_sessions` phải có `is_active = false`, có `revoked_at` dạng ISO 8601 timestamp, và có `revoke_reason = USER_LOGOUT` nếu field này tồn tại trong schema.
- [ ] Sau logout thành công, protected APIs dùng lại session hoặc token cũ phải trả `401`.
- [ ] Response success phải trả `200` và chứa dữ liệu success theo API contract hiện có là `{revoked:true, revokedAt}` với `revokedAt` dạng ISO 8601 timestamp.
- [ ] Response logout không được chứa password hash, access token mới, refresh token mới hoặc dữ liệu nhạy cảm không cần thiết.
- [ ] Nếu request logout lặp lại cho cùng session đã revoke, backend vẫn phải trả success theo nguyên tắc idempotent.
- [ ] Nếu audit log thất bại nhưng session revoke thành công, backend vẫn phải trả success.
- [ ] Frontend tích hợp sẽ tự xóa auth state cục bộ, tự điều hướng người dùng về màn hình đăng nhập, và tự hiển thị thông báo `Đăng xuất thành công`; các hành vi này không phải trách nhiệm xử lý của backend API.
- [ ] Nếu người dùng hủy thao tác trước khi request được gửi, hệ thống không được gọi backend logout và người dùng tiếp tục dùng hệ thống bình thường.
- [ ] Nếu request logout thiếu hoặc sai thông tin xác thực, backend phải trả lỗi theo contract và không thay đổi trạng thái session.
- [ ] Nếu session hiện tại đã bị revoke nhưng request logout vẫn hợp lệ, backend phải trả success theo hành vi idempotent đã chốt.
- [ ] Hệ thống phải luôn cố gắng tạo bản ghi `audit_logs` cho thao tác logout với thông tin actor và thời điểm thực hiện; lỗi audit không làm logout fail.

---

## 12. Out of Scope

- Logout tất cả thiết bị hoặc tất cả session của cùng user.
- Thiết kế cơ chế token mới, session mới, hoặc schema database mới.
- Chức năng login, register, forgot password, reset password, SSO, OAuth, face login.
- Cơ chế `rememberDevice` hoặc lưu trạng thái đăng nhập mới ngoài những gì tài liệu nguồn đang có.
- Thay đổi `CLAUDE.md`, API contract, database baseline, hoặc spec template.
