# Feature Specification: Duyệt hoặc từ chối yêu cầu cuộc họp

- **Feature ID**: MEETING-REQUEST-REVIEW-001
- **Feature Name**: Duyệt hoặc từ chối yêu cầu cuộc họp
- **Module / Domain**: meetings / scheduling
- **Created Date**: 2026-06-08
- **Status**: Draft
- **Source Documents**:
  - Database v3.2 Compact (39 tables)
  - API_CONTRACT_v1.0 / API_Contract_Agent_Reference_v3_2_Compact
  - AGENTS.md / CLAUDE.md backend guide
  - spec.md của MEETING-CREATE-MANUAL-001

---

## CHANGELOG & REVISION HISTORY
| Ngày cập nhật | Tóm tắt thay đổi | Các dòng thay đổi |
| :--- | :--- | :--- |
| 2026-06-08 | Cập nhật spec sau khi clarify: xử lý room conflict không reject, cấm self-approval, validation, pessimistic lock | Toàn bộ các mục liên quan FR, AC, Model, Errors |

## 1. Context & Goal

### 1.1 Bối cảnh

Feature này là bước tiếp theo sau feature `MEETING-CREATE-MANUAL-001 - Tạo cuộc họp mới thủ công`. Trong hệ thống hiện tại, người dùng không tạo cuộc họp chính thức ngay lập tức. Feature tạo meeting trước đó chỉ tạo một yêu cầu cuộc họp chờ duyệt.

Sau khi user tạo yêu cầu thành công, trạng thái dữ liệu là:

```
meetings.status = pending_approval
room_bookings.status = pending
meeting_requests.approval_status = pending
meeting_requests.request_type = create_meeting
```

Feature mới này có nhiệm vụ xử lý bước phê duyệt hoặc từ chối yêu cầu cuộc họp đang pending. Người có quyền (Manager/Approver) sẽ xem xét yêu cầu và đưa ra quyết định.

Feature này thuộc module `meetings` và `scheduling`. Nó liên quan trực tiếp đến approval flow trong meeting lifecycle — giai đoạn "trước cuộc họp" (pre-meeting).

### 1.2 Mục tiêu

Mục tiêu của tính năng này là cho phép Manager / Approver phê duyệt hoặc từ chối yêu cầu cuộc họp đang pending, đảm bảo chuyển trạng thái nhất quán giữa các bảng liên quan (meetings, meeting_requests, room_bookings) và thông báo kết quả đến các bên liên quan.

### 1.3 Giá trị mang lại

- Cho phép tổ chức kiểm soát việc đặt phòng và tổ chức cuộc họp qua quy trình phê duyệt.
- Ngăn chặn double booking nhờ re-check conflict phòng trước khi approve.
- Đảm bảo dữ liệu nhất quán giữa các bảng trong cùng một transaction.
- Ghi nhận đầy đủ audit trail cho quyết định phê duyệt/từ chối.
- Thông báo kết quả cho người tạo và người tham gia qua notification records.

### 1.4 Giả định

- Meeting request đã được tạo bởi feature MEETING-CREATE-MANUAL-001 với trạng thái `pending`.
- Approver được xác định bằng permission `meeting_request.approve` hoặc `meeting_request.reject`.
- Room conflict là hard block — nếu phát hiện conflict thì không approve.
- Participant conflict là warning only — không block approve.
- Hệ thống chỉ tạo notification records, không gửi SMTP trực tiếp.
- `approval_status` dùng giá trị `approved`; `applied_at` ghi thời điểm apply thành công.

### 1.5 Cần làm rõ

- Audit log failure có bắt buộc rollback toàn bộ operation không? Mặc định hiện tại: audit log failure trong transaction sẽ rollback toàn bộ. Nếu project policy cho phép audit log failure không rollback, cần cập nhật sau.

---

## 2. Actor & Roles

### 2.1 Danh sách actor

| Actor | Vai trò trong tính năng | Quyền / Trách nhiệm chính |
|---|---|---|
| Manager / Approver | Xem và xử lý (approve/reject) meeting request | Cần permission `meeting_request.approve` hoặc `meeting_request.reject` |
| Creator / Host | Người tạo meeting request; nhận thông báo kết quả | Không có quyền approve/reject request của chính mình |
| Participants | Người tham gia cuộc họp; nhận meeting_invite khi được approve | Không có quyền xử lý request |
| System | Thực thi business rules, transaction, notification, audit | Đảm bảo consistency và ghi nhận sự kiện |

### 2.2 Role & Permission Rules

- User có permission `meeting_request.approve` được phép approve request.
- User có permission `meeting_request.reject` được phép reject request.
- User không có quyền tương ứng thì bị từ chối 403.
- Permission format: `meeting_request.approve`, `meeting_request.reject`.
- Không dùng permission cũ kiểu `meeting:approve`.

### 2.3 Actor Constraints

- Phải đăng nhập (authenticated) trước khi thực hiện approve/reject.
- Phải có permission tương ứng với hành động.
- Request chỉ được approve/reject nếu `meeting_requests.approval_status = pending`.
- **ĐẶC BIỆT**: Không được phép tự duyệt (self-approval). Nếu người đang thao tác approve/reject chính là người tạo request (`requested_by`) hoặc là organizer của meeting, hệ thống phải từ chối (403 Forbidden).

---

## 3. Functional Requirements

> Tất cả Functional Requirements viết theo EARS.
> Keyword EARS giữ bằng tiếng Anh. Nội dung nghiệp vụ viết bằng tiếng Việt.

### 3.1 Core Requirements (Ubiquitous)

```
FR-001: THE system SHALL yêu cầu người dùng đăng nhập trước khi thực hiện bất kỳ hành động approve hoặc reject nào.
FR-002: THE system SHALL yêu cầu người dùng có permission `meeting_request.approve` để thực hiện approve, và permission `meeting_request.reject` để thực hiện reject.
FR-003: THE system SHALL chỉ cho phép approve hoặc reject meeting request khi `meeting_requests.approval_status` đang ở trạng thái `pending`.
FR-004: THE system SHALL ghi nhận `decision_by` và `decision_at` trên `meeting_requests` khi approver thực hiện approve hoặc reject.
FR-004b: THE system SHALL từ chối thao tác approve/reject (trả về 403 Forbidden) nếu người dùng đang thao tác chính là người tạo request (creator) hoặc organizer của meeting.
FR-004c: THE system SHALL chỉ hỗ trợ xử lý yêu cầu với `meeting_requests.request_type = create_meeting`. Nếu là loại khác, trả về 422 Unprocessable Entity.
```

### 3.2 Event-driven Requirements (Approve flow)

```
FR-005: WHEN approver gửi yêu cầu approve meeting request hợp lệ, THE system SHALL kiểm tra room conflict lần cuối trước khi thay đổi trạng thái.
FR-006: WHEN approver approve meeting request và không có room conflict, THE system SHALL chuyển:
  - `meeting_requests.approval_status` sang `approved`
  - `meetings.status` sang `scheduled`
  - `room_bookings.status` sang `approved`
FR-007: WHEN approver approve meeting request thành công, THE system SHALL tạo notification `meeting_invite` cho internal participants và external participants (nếu có email).
FR-008: WHEN approver approve meeting request thành công, THE system SHALL tạo notification `meeting_request_approved` cho creator và host.
FR-009: WHEN approver approve meeting request thành công, THE system SHALL tạo `meeting_events` với `event_type = meeting_request_approved`.
FR-010: WHEN approver approve meeting request thành công, THE system SHALL ghi audit_log với `action_type = approve` và `entity_type = meeting_request`.
```

### 3.3 Event-driven Requirements (Reject flow)

```
FR-011: WHEN approver gửi yêu cầu reject meeting request hợp lệ, THE system SHALL chuyển:
  - `meeting_requests.approval_status` sang `rejected`
  - `meetings.status` sang `cancelled`
  - `room_bookings.status` sang `cancelled`
FR-012: WHEN approver reject meeting request, THE system SHALL lưu `rejection_reason` vào `meeting_requests.rejection_reason`, `meetings.cancellation_reason`, và `room_bookings.cancellation_reason`.
FR-013: WHEN approver reject meeting request thành công, THE system SHALL tạo notification `meeting_request_rejected` cho creator (và host nếu host khác creator).
FR-014: WHEN approver reject meeting request, THE system SHALL NOT tạo notification `meeting_invite` cho participants.
FR-015: WHEN approver reject meeting request thành công, THE system SHALL tạo `meeting_events` với `event_type = meeting_request_rejected`.
FR-016: WHEN approver reject meeting request thành công, THE system SHALL ghi audit_log với `action_type = reject` và `entity_type = meeting_request`.
```

### 3.4 State-driven Requirements

```
FR-017: WHILE `meeting_requests.approval_status` đang ở trạng thái `pending`, THE system SHALL cho phép thực hiện approve hoặc reject.
FR-018: WHILE `meetings.status` đang ở trạng thái `pending_approval`, THE system SHALL cho phép chuyển sang `scheduled` (khi approve) hoặc `cancelled` (khi reject).
FR-019: WHILE `room_bookings.status` đang ở trạng thái `pending`, THE system SHALL cho phép chuyển sang `approved` (khi approve) hoặc `cancelled` (khi reject).
```

### 3.5 Unwanted Behavior Requirements (Invalid State)

```
FR-020: IF `meeting_requests.approval_status` không còn là `pending`, THEN THE system SHALL từ chối thao tác approve/reject và trả về lỗi 409.
FR-021: IF `meetings.status` không phải `pending_approval`, THEN THE system SHALL từ chối thao tác approve/reject và trả về lỗi 409.
FR-022: IF `room_bookings.status` không phải `pending`, THEN THE system SHALL từ chối thao tác approve/reject và trả về lỗi 409.
```

### 3.6 Unwanted Behavior Requirements (Room Conflict)

```
FR-023: IF phát hiện room booking conflict (booking khác có status `pending`, `approved`, hoặc `active` overlap với thời gian của request hiện tại), THEN THE system SHALL không approve, giữ `approval_status = pending`, cập nhật `conflict_check_status = blocked` và `conflict_checked_at`, và trả về lỗi 409 Conflict.
FR-024: IF phát hiện room booking conflict khi approve, THE system SHALL ghi nhận conflict vào `meeting_requests.conflict_summary_json`.
FR-025: IF phát hiện participant conflict khi approve, THE system SHALL cho phép approve (không block), và có thể ghi participant conflict vào `conflict_summary_json` hoặc audit metadata.
```

### 3.7 Data & State Requirements

```
FR-026: WHEN approve thành công, THE system SHALL ghi `applied_at` trên `meeting_requests`, `approved_by` và `approved_at` trên `room_bookings`.
FR-027: WHEN reject thành công, THE system SHALL ghi `decision_at` và `rejection_reason` trên `meeting_requests`, và `cancellation_reason` trên `meetings` và `room_bookings`. Không ghi `applied_at`.
FR-028: WHEN approve hoặc reject thành công, THE system SHALL ghi `decision_by` trên `meeting_requests`.
FR-028b: WHEN approve, THE system SHALL lưu `decisionNote` (nếu có) vào `audit_logs.metadata_json.decision_note` và có thể thêm vào `meeting_requests.notes`.
```

### 3.8 Transaction & Consistency Requirements

```
FR-029: WHEN approve hoặc reject meeting request, THE system SHALL thực hiện tất cả các thay đổi trong một synchronous DB transaction duy nhất.
FR-030: WHEN bắt đầu xử lý trong transaction, THE system SHALL sử dụng Pessimistic Locking (`SELECT FOR UPDATE`) trên bản ghi `meeting_requests` để tránh race condition (double approval).
FR-031: IF bất kỳ persistence operation nào trong transaction thất bại (bao gồm cả ghi `audit_logs`), THEN THE system SHALL rollback toàn bộ transaction và trả về lỗi 500.
```

### 3.9 Conflict Re-check Requirements

```
FR-032: WHEN approve meeting request, THE system SHALL kiểm tra room booking overlap với các booking khác (status IN ('pending','approved','active')), loại trừ booking hiện tại của request này.
FR-033: IF có booking khác overlap, THEN THE system SHALL không approve và trả về 409 Conflict.
FR-034: IF không có booking khác overlap, THEN THE system SHALL cho phép approve và tiến hành cập nhật trạng thái.
```

### 3.10 Notification / Audit Requirements

```
FR-035: WHEN approve thành công, THE system SHALL tạo notification records với `notification_type = meeting_invite`, `channel` bao gồm cả `email` và `in_app`, `delivery_status = queued`.
FR-036: WHEN reject thành công, THE system SHALL tạo notification records với `notification_type = meeting_request_rejected`, `delivery_status = queued`.
FR-037: WHEN approve hoặc reject thành công, THE system SHALL ghi audit_log với `user_id`, `action_type`, `entity_type`, `entity_id`, `new_value_json` và `metadata_json`.
```

### 3.11 Requirement Notes

- Các notification sau khi approve/reject chỉ tạo records trong bảng `notifications`. Delivery thực tế (SMTP, push) không thuộc phạm vi feature này.
- `audit_logs` là persistence bắt buộc trong transaction. Nếu audit_log thất bại, toàn bộ transaction rollback.

### 3.12 Traceability

| Requirement ID | EARS Pattern | Nguồn / Use Case liên quan | Ghi chú |
|---|---|---|---|
| FR-001 | Ubiquitous | Authentication | User phải login |
| FR-002 | Ubiquitous | Permission check | meeting_request.approve / meeting_request.reject |
| FR-003 | Ubiquitous | State validation | Chỉ xử lý request pending |
| FR-005 | Event-driven | Approve flow | Re-check conflict trước khi approve |
| FR-006 | Event-driven | Approve flow | State transition approve |
| FR-011 | Event-driven | Reject flow | State transition reject |
| FR-020 | Unwanted Behavior | Invalid state | Request không còn pending |
| FR-023 | Unwanted Behavior | Room conflict | 409 Conflict |
| FR-029 | Ubiquitous | Transaction | Atomic approve |
| FR-030 | Ubiquitous | Transaction | Atomic reject |
| FR-032 | Event-driven | Conflict re-check | Overlap checking |

---

## 4. Non-functional Requirements

### 4.1 Performance

```
NFR-001: THE system SHALL hoàn thành approve/reject operation và trả response trong vòng 3 giây dưới tải bình thường.
NFR-002: THE system SHALL hỗ trợ ít nhất 10 yêu cầu approve/reject đồng thời mà không làm ảnh hưởng đến consistency.
```

### 4.2 Security

```
NFR-003: THE system SHALL yêu cầu authentication trước khi cho phép truy cập API approve/reject.
NFR-004: THE system SHALL kiểm tra authorization (permission) cho mỗi operation approve hoặc reject.
NFR-004b: THE system SHALL chủ động kiểm tra ở service layer để chặn hành vi self-approval.
NFR-005: THE system SHALL NOT tiết lộ thông tin nhạy cảm (password, token) trong response.
NFR-006: THE system SHALL ghi nhận `decision_by` để truy vết ai đã thực hiện quyết định.
```

### 4.3 Reliability & Consistency

```
NFR-007: THE system SHALL đảm bảo approve/reject là atomic — hoặc tất cả thay đổi thành công, hoặc không có thay đổi nào.
NFR-008: THE system SHALL giữ trạng thái nhất quán giữa meeting_requests, meetings, room_bookings sau mỗi operation.
NFR-009: THE system SHALL đảm bảo idempotency — request đã được xử lý (approved/rejected) thì không thể xử lý lại.
NFR-010: IF một persistence operation thất bại trong transaction, THEN THE system SHALL rollback toàn bộ transaction.
```

### 4.4 Usability

```
NFR-011: THE system SHALL trả về error message rõ ràng, có thể hiểu được bởi client.
NFR-012: THE system SHALL sử dụng response format thống nhất theo project convention (success/data/meta hoặc success/error).
```

### 4.5 Observability

```
NFR-013: THE system SHALL ghi audit_log cho mỗi hành động approve và reject.
NFR-014: THE system SHALL log lỗi quan trọng (DB failure, transaction rollback) để hỗ trợ troubleshooting.
NFR-015: THE system SHALL tạo meeting_events để ghi nhận sự kiện approve/reject trong vòng đời cuộc họp.
```

### 4.6 Maintainability

```
NFR-016: THE system SHALL giữ business logic approve/reject trong module meetings/scheduling, không trộn lẫn với module khác.
NFR-017: THE system SHALL cung cấp test cases cho success flow, validation failure, authorization failure, và business rule failure.
```

---

## 5. Data Model

### 5.1 Entity liên quan

| Entity / Table | Vai trò trong tính năng | Ghi chú |
|---|---|---|
| meeting_requests | Lưu thông tin yêu cầu approve/reject, approval_status, decision info | Bảng chính được cập nhật |
| meetings | Cuộc họp liên quan đến request; status chuyển từ pending_approval sang scheduled/cancelled | Cập nhật status |
| room_bookings | Booking phòng liên quan; status chuyển từ pending sang approved/cancelled | Cập nhật status |
| meeting_participants | Danh sách participant để tạo meeting_invite notification | Đọc (read-only) |
| meeting_external_participants | Danh sách external participant để tạo meeting_invite notification | Đọc (read-only) |
| meeting_events | Ghi sự kiện approve/reject | Tạo mới |
| notifications | Lưu notification records cho participants và creator/host | Tạo mới |
| audit_logs | Ghi audit trail cho hành động approve/reject | Tạo mới |
| users | Xác thực và ghi nhận approver thông tin | Đọc (read-only) |
| rooms | Kiểm tra room conflict khi approve (start_time, end_time) | Đọc (read-only) |

### 5.2 Dữ liệu đầu vào

#### Approve endpoint: POST /api/v1/meeting-requests/{requestId}/approve

| Field | Type dự kiến | Bắt buộc | Mô tả | Validation |
|---|---|---|---|---|
| requestId (path) | uuid | Có | ID của meeting request | UUID valid |
| decisionNote (body) | string | Không | Ghi chú quyết định của approver | Optional, trim whitespace. Tối đa 500 ký tự |

#### Reject endpoint: POST /api/v1/meeting-requests/{requestId}/reject

| Field | Type dự kiến | Bắt buộc | Mô tả | Validation |
|---|---|---|---|---|
| requestId (path) | uuid | Có | ID của meeting request | UUID valid |
| rejectionReason (body) | string | Có | Lý do từ chối | Required, trim whitespace, không rỗng sau trim. Tối đa 1000 ký tự |

### 5.3 Dữ liệu đầu ra

#### Approve response

| Field | Type dự kiến | Mô tả |
|---|---|---|
| requestId | uuid | ID của meeting request |
| approvalStatus | string | `approved` |
| meetingId | uuid | ID của meeting được approve |
| bookingId | uuid | ID của room booking được approve |
| appliedAt | ISO 8601 | Thời điểm apply thành công |

#### Reject response

| Field | Type dự kiến | Mô tả |
|---|---|---|
| requestId | uuid | ID của meeting request |
| approvalStatus | string | `rejected` |
| decisionAt | ISO 8601 | Thời điểm reject |

### 5.4 State / Status Model

| Entity | Status trước | Status sau (Approve) | Status sau (Reject) | Điều kiện chuyển |
|---|---|---|---|---|
| meeting_requests | pending | approved | rejected | approval_status = pending |
| meetings | pending_approval | scheduled | cancelled | meetings.status = pending_approval |
| room_bookings | pending | approved | cancelled | room_bookings.status = pending |

### 5.5 Data Constraints

- `meeting_requests.meeting_id` phải reference đến meetings.id hợp lệ.
- `room_bookings.meeting_id` phải reference đến meetings.id hợp lệ.
- Một meeting request chỉ có thể được approve hoặc reject một lần (không thể xử lý lại).
- `meeting_requests.approval_status` chỉ chấp nhận các giá trị: `pending`, `approved`, `rejected`, `cancelled`.
- `meetings.status` chỉ chấp nhận các giá trị phù hợp với state machine.

### 5.6 Data Lifecycle

- **Tạo**: Meeting request được tạo bởi feature MEETING-CREATE-MANUAL-001 với approval_status = pending.
- **Cập nhật**: Feature này cập nhật approval_status và các decision fields khi approve/reject.
- **Terminal states**: approved, rejected là terminal states — không thể chuyển tiếp.
- **Audit**: Mỗi lần cập nhật đều được ghi vào audit_logs.

### 5.7 Cần làm rõ

(Không có — tất cả các bảng đã được xác định rõ trong Database v3.2 Compact.)

---

## 6. Error Handling

### 6.1 Validation Errors

```
ERR-001: IF `requestId` path parameter không đúng định dạng UUID, THEN THE system SHALL trả về 400 Bad Request.
ERR-002: IF `rejectionReason` bị thiếu hoặc rỗng sau khi trim khi reject, THEN THE system SHALL trả về 400 Bad Request.
ERR-003: IF `decisionNote` vượt quá 500 ký tự, hoặc `rejectionReason` vượt quá 1000 ký tự, THEN THE system SHALL trả về 400 Bad Request.
ERR-003b: IF `meeting_requests.request_type` không phải là `create_meeting`, THEN THE system SHALL trả về 422 Unprocessable Entity với code `UNSUPPORTED_REQUEST_TYPE`.
```

### 6.2 Authentication / Authorization Errors

```
ERR-004: IF user chưa đăng nhập (không có JWT token hợp lệ), THEN THE system SHALL trả về 401 Unauthorized.
ERR-005: IF user không có permission `meeting_request.approve` khi gọi approve, THEN THE system SHALL trả về 403 Forbidden.
ERR-006: IF user không có permission `meeting_request.reject` khi gọi reject, THEN THE system SHALL trả về 403 Forbidden.
ERR-006b: IF user thực hiện duyệt chính request của mình tạo ra hoặc meeting do mình tổ chức, THEN THE system SHALL trả về 403 Forbidden với code `SELF_APPROVAL_NOT_ALLOWED`.
```

### 6.3 Not Found Errors

```
ERR-007: IF `meeting_requests` không tồn tại với requestId được cung cấp, THEN THE system SHALL trả về 404 Not Found.
ERR-008: IF meeting liên quan (meeting_requests.meeting_id) không tồn tại, THEN THE system SHALL trả về 404 Not Found.
ERR-009: IF room booking liên quan không tồn tại, THEN THE system SHALL trả về 404 Not Found.
```

### 6.4 Invalid State Errors

```
ERR-010: IF `meeting_requests.approval_status` không còn là `pending`, THEN THE system SHALL trả về 409 Conflict và không thay đổi dữ liệu.
ERR-011: IF `meetings.status` không phải `pending_approval`, THEN THE system SHALL trả về 409 Conflict.
ERR-012: IF `room_bookings.status` không phải `pending`, THEN THE system SHALL trả về 409 Conflict.
```

### 6.5 Conflict Errors

```
ERR-013: IF approve bị chặn do phát hiện room booking conflict mới, THEN THE system SHALL trả về 409 Conflict với thông tin conflict, không đổi trạng thái chính.
ERR-013b: IF request đã được approve/reject bởi một transaction khác (phát hiện qua Pessimistic Lock), THEN THE system SHALL trả về 409 Conflict với code `REQUEST_ALREADY_PROCESSED`.
```

### 6.6 System Failure Errors

```
ERR-014: IF DB transaction thất bại, THEN THE system SHALL rollback toàn bộ thay đổi và trả về 500 Internal Server Error.
ERR-015: IF audit log persistence thất bại trong transaction, THEN THE system SHALL rollback toàn bộ operation (mặc định hiện tại).
```

### 6.7 Error Response Expectations

Response lỗi nên có tối thiểu:

| Field | Mô tả |
|---|---|
| `statusCode` | HTTP status code |
| `message` | Thông báo lỗi có thể diễn giải |
| `error` | Loại lỗi ngắn gọn |
| `code` | Mã lỗi nội bộ |
| `details` | Chi tiết lỗi validation/business nếu cần |
| `timestamp` | Thời điểm xảy ra lỗi |
| `path` | API path |

---

## 7. Acceptance Criteria

### 7.1 Happy Path

```
AC-001: Approve meeting request thành công
Given một meeting request đang ở trạng thái `pending`, meeting ở `pending_approval`, room booking ở `pending`, và không có room conflict,
When approver có permission `meeting_request.approve` gửi yêu cầu approve,
Then:
  - meeting_requests.approval_status = approved
  - meetings.status = scheduled
  - room_bookings.status = approved
  - meeting_events được tạo với event_type = meeting_request_approved
  - notifications meeting_invite được tạo cho participants
  - notifications meeting_request_approved được tạo cho creator/host
  - audit_logs được ghi với action_type = approve
```

```
AC-002: Reject meeting request thành công
Given một meeting request đang ở trạng thái `pending`, meeting ở `pending_approval`, room booking ở `pending`,
When approver có permission `meeting_request.reject` gửi yêu cầu reject với `rejectionReason` hợp lệ,
Then:
  - meeting_requests.approval_status = rejected
  - meetings.status = cancelled
  - room_bookings.status = cancelled
  - meeting_events được tạo với event_type = meeting_request_rejected
  - notifications meeting_request_rejected được tạo cho creator/host
  - NOT tạo meeting_invite cho participants
  - audit_logs được ghi với action_type = reject
```

### 7.2 Not Found Cases

```
AC-003: Approve request không tồn tại
Given một requestId không tồn tại trong hệ thống,
When approver gửi yêu cầu approve,
Then hệ thống trả về 404 Not Found.
```

```
AC-004: Reject request không tồn tại
Given một requestId không tồn tại trong hệ thống,
When approver gửi yêu cầu reject,
Then hệ thống trả về 404 Not Found.
```

### 7.3 Invalid State Cases

```
AC-005: Approve request đã approved trước đó
Given một meeting request đã được approved trước đó (approval_status = approved),
When approver gửi yêu cầu approve lần nữa,
Then hệ thống trả về 409 Conflict và không thay đổi dữ liệu.
```

```
AC-006: Reject request đã approved trước đó
Given một meeting request đã được approved trước đó (approval_status = approved),
When approver gửi yêu cầu reject,
Then hệ thống trả về 409 Conflict và không thay đổi dữ liệu.
```

### 7.4 Conflict Cases

```
AC-007: Approve request bị room conflict mới phát sinh
Given một meeting request đang pending, nhưng có booking khác (status pending/approved/active) đã chiếm phòng trong cùng khoảng thời gian,
When approver gửi yêu cầu approve,
Then hệ thống trả về 409 Conflict, không approve, và ghi nhận conflict vào conflict_summary_json.
```

### 7.5 Authorization Cases

```
AC-008: User không có permission approve
Given user không có permission `meeting_request.approve`,
When user gửi yêu cầu approve,
Then hệ thống trả về 403 Forbidden.
```

```
AC-009: User không có permission reject
Given user không có permission `meeting_request.reject`,
When user gửi yêu cầu reject,
Then hệ thống trả về 403 Forbidden.
```

```
AC-009b: User duyệt request của chính mình
Given user là người tạo request (requested_by) hoặc organizer,
When user có quyền gửi yêu cầu approve/reject,
Then hệ thống chặn lại và trả về 403 Forbidden (SELF_APPROVAL_NOT_ALLOWED).
```

### 7.6 Validation Cases

```
AC-010: Reject thiếu rejectionReason
Given approper gửi yêu cầu reject,
When `rejectionReason` bị thiếu hoặc chỉ gồm khoảng trắng,
Then hệ thống trả về 400 Bad Request.
```

### 7.7 Notification / Audit Cases

```
AC-011: Approve tạo notification meeting_invite cho participants
Given approve meeting request thành công,
Then hệ thống tạo notification records với notification_type = meeting_invite cho internal participants và external participants.
```

```
AC-012: Reject không tạo meeting_invite cho participants
Given reject meeting request thành công,
Then hệ thống không tạo notification meeting_invite cho participants.
```

```
AC-013: Approve ghi audit log
Given approve meeting request thành công,
Then audit_logs có record với action_type = approve, entity_type = meeting_request, entity_id = requestId, user_id = approverId.
```

```
AC-014: Reject ghi audit log
Given reject meeting request thành công,
Then audit_logs có record với action_type = reject, entity_type = meeting_request, entity_id = requestId, user_id = approverId.
```

### 7.8 Transaction Cases

```
AC-015: Transaction rollback khi update meeting thành công nhưng update booking thất bại
Given hệ thống đang xử lý approve,
When update meeting thành công nhưng update booking thất bại (ví dụ DB error),
Then toàn bộ transaction rollback, không có thay đổi nào được persist, và trả về 500.
```

### 7.9 Acceptance Criteria Traceability

| AC ID | Requirement ID liên quan | Kịch bản test chính |
|---|---|---|
| AC-001 | FR-001, FR-005, FR-006, FR-007, FR-008, FR-009, FR-010, FR-026, FR-028, FR-034, FR-035 | Approve success flow |
| AC-002 | FR-001, FR-011, FR-012, FR-013, FR-014, FR-015, FR-016, FR-027, FR-028, FR-036 | Reject success flow |
| AC-003 | ERR-007 | Request not found |
| AC-004 | ERR-007 | Request not found |
| AC-005 | FR-020, FR-021, FR-022, ERR-010 | Already approved |
| AC-006 | FR-020, ERR-010 | Already approved, reject |
| AC-007 | FR-023, FR-024, FR-032, FR-033, ERR-013 | Room conflict |
| AC-008 | FR-002, ERR-005 | No approve permission |
| AC-009 | FR-002, ERR-006 | No reject permission |
| AC-010 | ERR-002 | Missing rejectionReason |
| AC-011 | FR-007, FR-035 | Meeting invite notification |
| AC-012 | FR-014 | No invite on reject |
| AC-013 | FR-010, FR-037 | Audit log approve |
| AC-014 | FR-016, FR-037 | Audit log reject |
| AC-015 | FR-029, FR-031, ERR-014, ERR-015 | Transaction rollback |

## Clarifications

### Session 2026-06-08
- Q: Khi phát hiện Room Conflict lúc approve, có tự động reject request không? → A: Không. Giữ pending, cập nhật `conflict_check_status = blocked`, trả 409. Reject phải là quyết định rõ ràng.
- Q: `applied_at` có ghi khi Reject không? → A: Không, chỉ ghi khi Approve. Reject chỉ ghi `decision_at` và `rejection_reason`.
- Q: Có chặn self-approval không? → A: Có, phải chặn ở service layer nếu user là creator/organizer (trả 403 SELF_APPROVAL_NOT_ALLOWED).
- Q: Validation length cho các note? → A: `decisionNote` max 500 (optional), `rejectionReason` max 1000 (required).
- Q: Có lưu `cancellation_reason` ở `room_bookings` không? → A: Có, lưu ở cả 3 nơi: `meeting_requests`, `meetings`, `room_bookings`.
- Q: Xử lý Race Condition thế nào? → A: Dùng DB Transaction + Pessimistic Lock (`SELECT FOR UPDATE`). Trả 409 `REQUEST_ALREADY_PROCESSED` nếu bị conflict transaction.
- Q: Lưu `decisionNote` ở đâu? → A: Lưu trong `audit_logs.metadata_json.decision_note` và tùy chọn ở `meeting_requests.notes`.
- Q: Tính đồng bộ của API? → A: Approve/reject là synchronous DB transaction. Gửi mail là async sau đó.
- Q: Request type hỗ trợ? → A: Chỉ support `request_type = create_meeting`. Khác thì trả 422.
- Q: Lỗi ghi audit log? → A: Nếu ghi audit log lỗi, rollback toàn bộ transaction và trả 500.

---

## 8. Out of Scope

### 8.1 Không triển khai trong feature này

- Không tạo meeting request mới.
- Không chỉnh sửa nội dung meeting request.
- Không hủy request bởi creator.
- Không start meeting.
- Không in-meeting management.
- Không attendance / presence / camera / IoT.
- Không no-show / auto-release.
- Không recurring meeting.
- Không Google Calendar / Outlook integration.
- Không gửi SMTP trực tiếp.
- Không WebSocket realtime push.
- Không tạo bảng database mới.
- Không dùng bảng đã bị loại bỏ khỏi DB v3.2 Compact (schedule_conflicts, notification_recipients, documents, meeting_action_items, report_exports, system_policies, user_sessions, password_reset_requests, room_seats, equipment_assignments).

### 8.2 Có thể xem xét ở feature khác

- Cancel meeting request by creator — có thể tách thành feature riêng.
- Email delivery thực tế qua SMTP — thuộc feature notification infrastructure.
- WebSocket realtime push cho status changes — thuộc feature realtime infrastructure.
- Tích hợp Google Calendar / Outlook — thuộc feature calendar integration.

### 8.3 Out-of-scope EARS Guardrails

```
OOS-001: THE system SHALL NOT tạo meeting request mới như một phần của feature này.
OOS-002: THE system SHALL NOT gửi email thực tế qua SMTP; chỉ tạo notification records.
OOS-003: THE system SHALL NOT thêm bảng database mới hoặc sử dụng bảng đã bị loại bỏ khỏi DB v3.2 Compact.
OOS-004: THE system SHALL NOT implement WebSocket realtime push trong feature này.
```

---

## Checklist tự kiểm tra trước khi hoàn tất spec

- [x] Functional Requirements đã dùng EARS.
- [x] Có đủ approve và reject flow.
- [x] Có đủ state transition.
- [x] Không còn nhầm create meeting với approve meeting.
- [x] Không chuyển scheduled trước khi approve.
- [x] Không gửi meeting_invite khi reject.
- [x] Không implement SMTP trực tiếp.
- [x] Không thêm bảng mới.
- [x] Không dùng bảng đã bị xóa khỏi DB v3.2 Compact.
- [x] Có AC traceability.
- [x] Có Out of Scope rõ ràng.
