# Feature Specification: Lấy danh sách yêu cầu cuộc họp đang chờ duyệt

- **Feature ID**: MEETING-PENDING-REQUESTS-001
- **Feature Name**: Lấy danh sách yêu cầu cuộc họp đang chờ duyệt
- **Module / Domain**: meetings / scheduling
- **Created Date**: 2026-06-23
- **Status**: Draft
- **Source Documents**:
  - Database v3.2 Compact (39 tables)
  - API_CONTRACT_v1.0_with_system_roles.md
  - AGENTS.md / CLAUDE.md backend guide
  - spec.md của MEETING-REQUEST-REVIEW-001 (feat-review-meeting-request)
  - .specify/templates/spec-template.md

---

## CHANGELOG & REVISION HISTORY
| Ngày cập nhật | Tóm tắt thay đổi | Các dòng thay đổi |
| :--- | :--- | :--- |
| 2026-06-23 | Tạo mới spec cho feature feat-pending-meeting-requests | Toàn bộ file |
| 2026-06-23 | Cập nhật tasks.md/data-model.md/research.md — sửa role-check pattern, thêm FromToConstraint, bổ sung UserEntity.departmentId | tasks.md T006-T007, data-model.md UserEntity, research.md Permission check |
| 2026-06-23 | Sửa lỗi encoding UTF-8 cho tasks.md và thêm verify 403 detail vào T011/T013 | tasks.md toàn bộ, T011, T013 |

---

## 1. Context & Goal

### 1.1 Bối cảnh

Feature này cung cấp API cho Admin / Business Admin / System Admin / Manager / Approver xem danh sách các yêu cầu cuộc họp (meeting requests) trong hệ thống.

Trong quy trình phê duyệt cuộc họp, người có quyền (approver/manager) cần một giao diện tập trung để xem các yêu cầu đang chờ xử lý. Feature này là bước đọc dữ liệu đầu tiên trong approval flow, cung cấp dữ liệu đầu vào cho feature feat-review-meeting-request (approve/reject).

Bản chất dữ liệu là bảng meeting_requests, không phải trực tiếp là meetings. Một meeting request có thể thuộc các loại: create_meeting, update_time, update_room, cancel_meeting, extend_meeting, book_room.

Feature này thuộc module meetings và scheduling, giai đoạn trước cuộc họp (pre-meeting).

### 1.2 Mục tiêu

Mục tiêu của tính năng này là cho phép Admin / Manager / Approver xem và tra cứu danh sách các yêu cầu cuộc họp đang chờ xử lý, với các bộ lọc linh hoạt và phân trang, nhằm hỗ trợ quy trình phê duyệt cuộc họp.

### 1.3 Giá trị mang lại

- Giúp Admin/Manager/Approver có cái nhìn tổng quan về các yêu cầu đang chờ xử lý.
- Hỗ trợ lọc và tìm kiếm linh hoạt theo trạng thái, loại request, phòng, người yêu cầu.
- Phân trang và sort giảm tải cho UI và dễ dàng tích hợp vào danh sách quản trị.
- Giới hạn dữ liệu theo phạm vi role, đảm bảo an toàn thông tin.
- Trả relation summary (requestedBy, targetRoom, meeting) giảm số lượng API call từ client.

### 1.4 Giả định

- Meeting request đã được tạo bởi các feature khác (ví dụ feat-create-meeting-manual, feat-update-meeting-time...).
- Permission meeting_request.read đã được seed trong bảng permissions.
- Approver/Manager scope trong v1: Manager/Approver thấy request của user có requestedBy.directManagerId = currentUser.id, hoặc user thuộc department có departments.manager_user_id = currentUser.id.
- API tuân thủ convention /api/v1, response chuẩn success/data/meta/error.
- Pagination dùng page, limit, sortBy, sortOrder theo convention chung.
- Chỉ hỗ trợ sort theo allowlist để tránh SQL injection.
- Không ghi audit log cho hành động đọc dữ liệu trừ khi project policy yêu cầu.

### 1.5 Cần làm rõ (đã giải quyết)

- **[ĐÃ GIẢI QUYẾT]** Manager/Approver scope: dùng directManagerId và departments.manager_user_id trong v1. Xem FR-032 và AC-006.
- **[DEFER]** Room-manager-specific scope: defer trong v1 vì DB v3.2 Compact chưa có field room owner / approver routing. Không phát minh bảng hoặc field mới.

---

## 2. Actor & Roles

### 2.1 Danh sách actor

| Actor | Vai trò trong tính năng | Quyền / Trách nhiệm chính |
|---|---|---|
| SYSTEM_ADMIN | Xem toàn bộ meeting requests không giới hạn | Cần permission meeting_request.read |
| BUSINESS_ADMIN | Xem toàn bộ meeting requests không giới hạn | Cần permission meeting_request.read |
| MANAGER | Xem request thuộc phạm vi phòng ban/quản lý | Cần permission meeting_request.read |
| APPROVER / ROOM_MANAGER | Xem request thuộc phạm vi được phân công xử lý | Cần permission meeting_request.read |
| HOST / CREATOR | Xem request do mình tạo (thông qua bộ lọc requestedById) | Cần permission meeting_request.read |

### 2.2 Role & Permission Rules

- User có permission meeting_request.read được phép truy cập API này.
- SYSTEM_ADMIN và BUSINESS_ADMIN được xem toàn bộ request không giới hạn.
- MANAGER, APPROVER được xem request thuộc phạm vi xử lý: request của user có requestedBy.directManagerId = currentUser.id, hoặc user thuộc department có departments.manager_user_id = currentUser.id.
- ROOM_MANAGER scope được defer trong v1 (chưa có field room owner / approver routing).
- Host/creator xem request của mình qua tham số requestedById (không phải mặc định).
- Permission format: meeting_request.read.

### 2.3 Actor Constraints

- Phải đăng nhập (authenticated) trước khi truy cập API.
- Phải có permission meeting_request.read.
- Scope constraint (Manager/Approver) áp dụng sau permission check.
- Nếu không có request nào trong scope, trả 200 với data = [] (không fallback toàn tổ chức).

---

## 3. Functional Requirements

> Tất cả Functional Requirements viết theo EARS.
> Keyword EARS giữ bằng tiếng Anh. Nội dung nghiệp vụ viết bằng tiếng Việt.

### 3.1 Core Requirements (Ubiquitous)

`
FR-001: THE system SHALL yêu cầu người dùng đăng nhập trước khi truy cập API danh sách meeting requests.
FR-002: THE system SHALL yêu cầu người dùng có permission meeting_request.read để truy cập API này.
FR-003: THE system SHALL trả về danh sách meeting requests dựa trên bảng meeting_requests của Database v3.2 Compact.
FR-004: THE system SHALL hỗ trợ phân trang với các tham số page, limit, sortBy, sortOrder theo API convention của dự án.
`

### 3.2 Event-driven Requirements (Query & Response)

`
FR-005: WHEN client gửi request GET /api/v1/meeting-requests, THE system SHALL áp dụng các bộ lọc theo query parameters và trả danh sách phù hợp.
FR-006: WHEN client không truyền approvalStatus, THE system SHALL mặc định chỉ trả các request có approval_status = pending cho TẤT CẢ actor (bao gồm SYSTEM_ADMIN và BUSINESS_ADMIN). Endpoint này là approval queue, không phải approval history.
FR-007: WHEN client truyền approvalStatus, THE system SHALL lọc theo giá trị tương ứng: pending, approved, rejected, applied, cancelled.
FR-008: WHEN client truyền approvalStatus=all, THE system SHALL trả tất cả các request không lọc theo approval_status, nhưng vẪN tuân thủ data scope của người dùng (admin thấy toàn tổ chức, Manager/Approver chỉ thấy trong phạm vi được xử lý).
FR-009: WHEN client truyền requestType, THE system SHALL lọc theo giá trị tương ứng: create_meeting, update_time, update_room, cancel_meeting, extend_meeting, book_room.
FR-010: WHEN client truyền targetRoomId, THE system SHALL lọc request có target_room_id tương ứng.
FR-011: WHEN client truyền requestedById, THE system SHALL lọc request có requested_by tương ứng.
FR-012: WHEN client truyền from và/hoặc to, THE system SHALL lọc request có requested_at nằm trong khoảng thời gian tương ứng.
FR-013: WHEN client truyền q, THE system SHALL tìm kiếm theo request_code, case-insensitive, partial match. Trong v1 không search qua meeting.title, requestedBy.fullName/email, hoặc room.roomName.
`

### 3.3 State-driven Requirements

`
FR-014: WHILE người dùng là SYSTEM_ADMIN hoặc BUSINESS_ADMIN, THE system SHALL cho phép xem toàn bộ request không giới hạn.
FR-015: WHILE người dùng là MANAGER, ROOM_MANAGER, hoặc APPROVER, THE system SHALL giới hạn dữ liệu theo phạm vi xử lý (nếu scope logic đã được triển khai).
`

### 3.4 Sorting Requirements

`
FR-016: WHEN client không truyền sortBy và sortOrder, THE system SHALL mặc định sort theo requested_at DESC.
FR-017: WHEN client truyền sortBy, THE system SHALL kiểm tra giá trị trong allowlist trước khi áp dụng.
FR-018: THE system SHALL chỉ cho phép sort theo các field: requested_at, created_at, approval_status, request_type.
`

### 3.5 Response & Relation Requirements

`
FR-019: WHEN trả danh sách meeting requests, THE system SHALL bao gồm relation summary:
  - requestedBy: id, fullName, email
  - targetRoom: id, roomName (null nếu không có)
  - meeting: id, title (null nếu không có)
  - conflictSummary: raw JSON từ meeting_requests.conflict_summary_json, type Record<string, unknown> | null. Trả nguyên trạng, không mutate. FE dùng conflictCheckStatus cho display logic.
FR-020: WHEN trả danh sách meeting requests, THE system SHALL bao gồm các field chính:
  - id, requestCode, requestType, approvalStatus, requestedAt
  - requestedStartTime, requestedEndTime
  - conflictCheckStatus, conflictSummary
  - decisionBy, decisionAt, rejectionReason
FR-021: WHEN meeting_id là null (ví dụ requestType = create_meeting), THE system SHALL trả meeting = null thay vì làm lỗi response.
FR-022: WHEN target_room_id là null (ví dụ request không gắn phòng), THE system SHALL trả targetRoom = null thay vì làm lỗi response.
FR-023: THE system SHALL load relations bằng TypeORM QueryBuilder hoặc LEFT JOIN, tránh N+1 query.
`

### 3.6 Validation Requirements

`
FR-024: IF page < 1, THEN THE system SHALL trả về lỗi 400 Bad Request.
FR-025: IF limit < 1 hoặc limit > 100, THEN THE system SHALL trả về lỗi 400 Bad Request.
FR-026: IF approvalStatus không nằm trong danh sách hợp lệ, THEN THE system SHALL trả về lỗi 422 Unprocessable Entity.
FR-027: IF requestType không nằm trong danh sách hợp lệ, THEN THE system SHALL trả về lỗi 422 Unprocessable Entity.
FR-028: IF targetRoomId hoặc requestedById không phải UUID hợp lệ, THEN THE system SHALL trả về lỗi 400 Bad Request.
FR-029: IF from > to, THEN THE system SHALL trả về lỗi 400 hoặc 422 Invalid date range.
FR-030: IF sortBy không nằm trong allowlist, THEN THE system SHALL trả về lỗi 400 hoặc 422 Invalid sort field.
`

### 3.7 Authorization Requirements

`
FR-031: IF user không có permission meeting_request.read, THEN THE system SHALL trả về 403 Forbidden.
FR-032: IF user là MANAGER hoặc APPROVER, THE system SHALL giới hạn kết quả theo scope v1:
  - request có requested_by là user có direct_manager_id = currentUser.id, HOẶC
  - request có requested_by thuộc department có manager_user_id = currentUser.id.
  Nếu không có request nào trong scope, trả 200 với data = [] (không fallback toàn tổ chức).
  Room-manager-specific scope được defer trong v1.
`

### 3.8 Performance & Data Requirements

`
FR-033: THE system SHALL đảm bảo query index-friendly, sử dụng các index có sẵn trên meeting_requests (approval_status, request_type, requested_by, requested_at, target_room_id).
FR-034: THE system SHALL không trả password, token, password_hash, hoặc PII không cần thiết trong response.
FR-035: THE system SHALL không ghi audit_log cho hành động đọc dữ liệu (GET), trừ khi project policy yêu cầu audit cho approval queue.
`

### 3.9 Traceability

| Requirement ID | EARS Pattern | Nguồn / Use Case liên quan | Ghi chú |
|---|---|---|---|
| FR-001 | Ubiquitous | Authentication | Yêu cầu JWT |
| FR-002 | Ubiquitous | Permission check | meeting_request.read |
| FR-003 | Ubiquitous | Database v3.2 Compact | Bảng meeting_requests |
| FR-005 | Event-driven | Query handling | Filter theo query params |
| FR-006 | Event-driven | Default filter | Mặc định trả pending |
| FR-014 | State-driven | Admin scope | SYSTEM_ADMIN / BUSINESS_ADMIN |
| FR-015 | State-driven | Manager scope | Manager/Approver scope |
| FR-024 | Unwanted Behavior | Validation | Page/limit invalid |

---

## 4. Non-functional Requirements

### 4.1 Performance

`
NFR-001: THE system SHALL trả response danh sách meeting requests trong vòng 3 giây dưới tải bình thường (dưới 10.000 request).
NFR-002: THE system SHALL hỗ trợ ít nhất 50 yêu cầu đọc danh sách đồng thời mà không suy giảm hiệu suất nghiêm trọng.
NFR-003: THE system SHALL sử dụng database index trên các field thường được dùng để lọc (approval_status, request_type, requested_by, requested_at) để đảm bảo query performance.
`

### 4.2 Security

`
NFR-004: THE system SHALL yêu cầu authentication trước khi cho phép truy cập API.
NFR-005: THE system SHALL kiểm tra authorization (permission meeting_request.read) cho mỗi request.
NFR-006: THE system SHALL không tiết lộ thông tin nhạy cảm (password, token) trong response.
NFR-007: THE system SHALL validate sortBy theo allowlist để tránh SQL/QueryBuilder injection.
`

### 4.3 Reliability & Consistency

`
NFR-008: THE system SHALL trả dữ liệu nhất quán giữa các request trong cùng phiên làm việc.
NFR-009: THE system SHALL trả pagination meta (page, limit, total, totalPages) chính xác.
`

### 4.4 Usability

`
NFR-010: THE system SHALL trả error message rõ ràng, có thể hiểu được bởi client.
NFR-011: THE system SHALL sử dụng response format thống nhất theo project convention (success/data/meta/error).
`

### 4.5 Maintainability

`
NFR-012: THE system SHALL giữ business logic trong module meetings/scheduling, không trộn lẫn với module khác.
NFR-013: THE system SHALL cung cấp test cases cho success flow, validation failure, authorization failure, và data scope filtering.
`

---

## 5. Data Model

### 5.1 Entity liên quan

| Entity / Table | Vai trò trong tính năng | Ghi chú |
|---|---|---|
| meeting_requests | Bảng chính chứa dữ liệu request | approval_status, request_type, requested_by, target_room_id, meeting_id,... |
| users | Relation summary: requestedBy | LEFT JOIN, chỉ lấy id, full_name, email |
| rooms | Relation summary: targetRoom | LEFT JOIN, chỉ lấy id, room_name |
| meetings | Relation summary: meeting | LEFT JOIN, chỉ lấy id, title |

### 5.2 Query Parameters (đầu vào)

| Parameter | Type dự kiến | Bắt buộc | Mô tả | Validation |
|---|---:|---:|---|---|
| page | integer | Không (mặc định 1) | Số trang | >= 1 |
| limit | integer | Không (mặc định 20) | Số lượng item/trang | 1 <= limit <= 100 |
| approvalStatus | string | Không (mặc định pending) | Trạng thái phê duyệt | pending, approved, rejected, applied, cancelled, all |
| requestType | string | Không | Loại request | create_meeting, update_time, update_room, cancel_meeting, extend_meeting, book_room |
| targetRoomId | uuid | Không | ID phòng mục tiêu | UUID valid |
| requestedById | uuid | Không | ID người tạo request | UUID valid |
| from | ISO 8601 | Không | Thời gian bắt đầu | from <= to |
| to | ISO 8601 | Không | Thời gian kết thúc | from <= to |
| q | string | Không | Từ khóa tìm kiếm | Tìm theo request_code, case-insensitive, partial match. Không search qua relation fields trong v1 |
| sortBy | string | Không (mặc định requested_at) | Field để sort | Allowlist: requested_at, created_at, approval_status, request_type |
| sortOrder | string | Không (mặc định desc) | Thứ tự sort | asc, desc |

### 5.3 Response Data (đầu ra)

Mỗi item trong danh sách:

| Field | Type dự kiến | Mô tả |
|---|---:|---|
| id | uuid | ID của meeting request |
| requestCode | string | Mã yêu cầu |
| requestType | string | Loại request |
| approvalStatus | string | Trạng thái phê duyệt |
| requestedAt | ISO 8601 | Thời điểm tạo request |
| requestedStartTime | ISO 8601 (null) | Thời gian bắt đầu mong muốn |
| requestedEndTime | ISO 8601 (null) | Thời gian kết thúc mong muốn |
| conflictCheckStatus | string | Trạng thái kiểm tra conflict |
| conflictSummary | object | null | Raw JSON từ meeting_requests.conflict_summary_json, Record<string, unknown> | null. Không mutate. FE dùng conflictCheckStatus cho display |
| decisionBy | object (null) | Người quyết định: id, fullName, email |
| decisionAt | ISO 8601 (null) | Thời điểm quyết định |
| rejectionReason | string (null) | Lý do từ chối |
| requestedBy | object | Người tạo request: id, fullName, email |
| targetRoom | object (null) | Phòng mục tiêu: id, roomName |
| meeting | object (null) | Cuộc họp: id, title |

### 5.4 State / Status Model

approval_status:

| Status | Ý nghĩa |
|---|---|
| pending | Đang chờ xử lý |
| approved | Đã được phê duyệt |
| rejected | Bị từ chối |
| applied | Đã được áp dụng vào meeting/booking |
| cancelled | Bị hủy |

### 5.5 Data Constraints

- meeting_requests.request_type chỉ chấp nhận các giá trị: create_meeting, update_time, update_room, cancel_meeting, extend_meeting, book_room.
- meeting_requests.approval_status chỉ chấp nhận các giá trị: pending, approved, rejected, applied, cancelled.
- meeting_requests.meeting_id có thể null (request chưa có meeting).
- meeting_requests.target_room_id có thể null (request không gắn phòng).

### 5.6 Data Lifecycle

- **Tạo**: Meeting request được tạo bởi các feature khác (tạo meeting, cập nhật thời gian, đổi phòng...).
- **Đọc**: Feature này chỉ thực hiện đọc dữ liệu, không thay đổi.
- **Cập nhật**: Trạng thái request được cập nhật bởi feature approve/reject.
- **Terminal states**: approved, rejected, applied, cancelled.

### 5.7 Cần làm rõ

- [ĐÃ GIẢI QUYẾT] Scope filtering cho Manager/Approver: dùng directManagerId và departments.manager_user_id. Xem FR-032 và AC-006.

---

## 6. Error Handling

### 6.1 Validation Errors

`
ERR-001: IF page < 1, THEN THE system SHALL trả về 400 Bad Request.
ERR-002: IF limit < 1 hoặc limit > 100, THEN THE system SHALL trả về 400 Bad Request.
ERR-003: IF approvalStatus không nằm trong danh sách hợp lệ, THEN THE system SHALL trả về 422 Unprocessable Entity.
ERR-004: IF requestType không nằm trong danh sách hợp lệ, THEN THE system SHALL trả về 422 Unprocessable Entity.
ERR-005: IF targetRoomId hoặc requestedById không phải UUID hợp lệ, THEN THE system SHALL trả về 400 Bad Request.
ERR-006: IF from > to, THEN THE system SHALL trả về 400 Invalid date range.
ERR-007: IF sortBy không nằm trong allowlist, THEN THE system SHALL trả về 400 Invalid sort field.
`

### 6.2 Authentication / Authorization Errors

`
ERR-008: IF user chưa đăng nhập (không có JWT token hợp lệ), THEN THE system SHALL trả về 401 Unauthorized.
ERR-009: IF user không có permission meeting_request.read, THEN THE system SHALL trả về 403 Forbidden.
`

### 6.3 System Failure Errors

`
ERR-010: IF database query thất bại hoặc timeout, THEN THE system SHALL trả về 500 Internal Server Error.
ERR-011: IF relation loading (requestedBy/targetRoom/meeting) thất bại, THEN THE system SHALL trả về 500 Internal Server Error.
`

### 6.4 Error Response Expectations

Response lỗi theo API convention:

| Field | Mô tả |
|---|---|
| success | false |
| message | Thông báo lỗi có thể diễn giải |
| error.code | Mã lỗi nội bộ |
| error.details | Chi tiết lỗi validation nếu cần |
| timestamp | Thời điểm xảy ra lỗi |
| path | API path |

---

## 7. Acceptance Criteria

### 7.1 Happy Path

`
AC-001: Admin lấy danh sách pending meeting requests thành công
Given Admin có permission meeting_request.read và trong hệ thống có các request với approval_status = pending,
When Admin gửi GET /api/v1/meeting-requests,
Then hệ thống trả 200 kèm danh sách request có approval_status = pending, phân trang, sort theo requestedAt DESC.
`

`
AC-002: Không truyền approvalStatus thì mặc định chỉ trả pending
Given hệ thống có cả request pending và approved,
When client gửi GET /api/v1/meeting-requests,
Then hệ thống chỉ trả request có approval_status = pending, không trả approved/rejected.
`

`
AC-003: Truyền approvalStatus=approved thì trả request đã approved
Given hệ thống có request approval_status = approved,
When client gửi GET /api/v1/meeting-requests?approvalStatus=approved,
Then hệ thống trả danh sách request có approval_status = approved.
`

`
AC-004: Truyền requestType thì filter đúng loại request
Given hệ thống có request với request_type = create_meeting,
When client gửi GET /api/v1/meeting-requests?requestType=create_meeting,
Then hệ thống chỉ trả request có request_type = create_meeting.
`

### 7.2 Authorization Cases

`
AC-005: User không có permission meeting_request.read bị từ chối
Given user không có permission meeting_request.read,
When user gửi GET /api/v1/meeting-requests,
Then hệ thống trả 403 Forbidden.
`

`
AC-006: Manager/Approver chỉ thấy request trong phạm vi quản lý v1
Given Manager hoặc Approver có permission meeting_request.read,
When họ gọi GET /api/v1/meeting-requests,
Then API chỉ trả request do user có direct_manager_id = currentUser.id tạo, hoặc user thuộc department có manager_user_id = currentUser.id,
And không trả request ngoài tổ chức trừ khi caller là SYSTEM_ADMIN hoặc BUSINESS_ADMIN.
`

### 7.3 Null Relation Cases

`
AC-007: Request có meeting_id = null vẫn trả response hợp lệ
Given một request có meeting_id = null (ví dụ requestType = create_meeting),
When client gửi GET /api/v1/meeting-requests,
Then response trả meeting = null và không bị lỗi.
`

`
AC-008: Request có target_room_id = null vẫn trả response hợp lệ
Given một request có target_room_id = null,
When client gửi GET /api/v1/meeting-requests,
Then response trả targetRoom = null và không bị lỗi.
`

### 7.4 Pagination Cases

`
AC-009: Pagination trả đúng page, limit, total, totalPages
Given hệ thống có tổng cộng 50 request pending,
When client gửi GET /api/v1/meeting-requests?page=1&limit=20,
Then response trả 20 items trên trang 1, meta.total = 50, meta.totalPages = 3.
`

`
AC-010: Sort mặc định là requestedAt DESC
Given hệ thống có nhiều request với requested_at khác nhau,
When client gọi GET /api/v1/meeting-requests,
Then response sort theo requested_at giảm dần.
`

### 7.5 Validation Cases

`
AC-011: Invalid enum trả lỗi validation chuẩn
Given client gửi request với approvalStatus không hợp lệ,
When client gửi GET /api/v1/meeting-requests?approvalStatus=invalid,
Then hệ thống trả 422 Unprocessable Entity.
`

`
AC-012: limit vượt max bị reject
Given client gửi request với limit > 100,
When client gửi GET /api/v1/meeting-requests?limit=200,
Then hệ thống trả 400 Bad Request.
`

### 7.6 Acceptance Criteria Traceability

| AC ID | Requirement ID liên quan | Kịch bản test chính |
|---|---|---|
| AC-001 | FR-001, FR-002, FR-005, FR-006, FR-016 | Admin xem pending requests |
| AC-002 | FR-006 | Default filter pending |
| AC-003 | FR-007 | Filter by approvalStatus |
| AC-004 | FR-009 | Filter by requestType |
| AC-005 | FR-002, FR-031, ERR-009 | No permission |
| AC-006 | FR-015, FR-032 | Scope filtering v1: directManagerId + department manager_user_id |
| AC-007 | FR-021 | Null meeting |
| AC-008 | FR-022 | Null room |
| AC-009 | FR-004 | Pagination |
| AC-010 | FR-016 | Default sort |
| AC-011 | FR-026, ERR-003 | Invalid enum |
| AC-012 | FR-025, ERR-002 | Limit vượt max |

---

## 8. Out of Scope

### 8.1 Không triển khai trong feature này

- Không approve meeting request.
- Không reject meeting request.
- Không tạo meeting mới.
- Không cập nhật meeting/booking.
- Không gửi notification.
- Không tạo migration database.
- Không thêm bảng/cột mới.
- Không ghi audit log cho hành động đọc.
- Không xem chi tiết một request đơn lẻ (single request detail).
- Không export danh sách request ra file.
- Không summary/thống kê số lượng request.

### 8.2 Có thể xem xét ở feature khác

- Chi tiết một meeting request (GET /api/v1/meeting-requests/:id) — có thể tách thành feature riêng.
- Export danh sách request ra Excel/CSV — thuộc feature report/export.
- Thống kê số lượng request theo trạng thái — thuộc feature analytics/dashboard.
- WebSocket realtime push khi có request mới — thuộc feature realtime infrastructure.

### 8.3 Out-of-scope EARS Guardrails

`
OOS-001: THE system SHALL NOT approve, reject, hoặc thay đổi trạng thái của meeting request trong feature này.
OOS-002: THE system SHALL NOT tạo, cập nhật, hoặc xóa bất kỳ bản ghi nào trong quá trình xử lý request.
OOS-003: THE system SHALL NOT thêm bảng database mới hoặc sử dụng bảng đã bị loại bỏ khỏi DB v3.2 Compact.
OOS-004: THE system SHALL NOT gửi email, notification, hoặc WebSocket event trong feature này.
OOS-005: THE system SHALL NOT tạo migration hoặc thay đổi schema database.
OOS-006: THE system SHALL NOT implement single request detail endpoint (GET /api/v1/meeting-requests/:id) trong feature này.
`

---

## Checklist tự kiểm tra trước khi hoàn tất spec

- [x] Functional Requirements đã dùng EARS.
- [x] Có đủ 5 EARS patterns: Ubiquitous, Event-driven, State-driven, Unwanted Behavior, Authorization.
- [x] Mỗi requirement có mã ID rõ ràng.
- [x] Có đủ validation, authorization, response relation requirements.
- [x] Đã xử lý null relation cho meeting và targetRoom.
- [x] Có pagination, sorting, filtering requirements.
- [x] Không tự ý thêm bảng mới.
- [x] Không dùng bảng đã bị xóa khỏi DB v3.2 Compact.
- [x] Không triển khai out-of-scope nội dung.
- [x] Có AC traceability.
- [x] Có Out of Scope rõ ràng.
- [x] Có Cần làm rõ mục về Manager/Approver scope.

