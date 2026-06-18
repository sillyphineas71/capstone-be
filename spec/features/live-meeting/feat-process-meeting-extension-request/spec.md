# Feature Specification: Phê duyệt hoặc từ chối yêu cầu gia hạn phiên họp

- **Feature ID**: UC-IMM-03
- **Feature Name**: Phê duyệt hoặc từ chối yêu cầu gia hạn phiên họp
- **Module / Domain**: live-meeting
- **Created Date**: 2026-06-16
- **Status**: Draft
- **Source Documents**:
  - Database v3.2 Compact (39 tables)
  - AGENTS.md - Backend Agent Guide v1.1
  - API_CONTRACT_v1.0_with_system_roles.md (UC-95, UC-96, UC-97)
  - SPEC_ALIGNMENT_WITH_DB_V3_2_COMPACT.md
  - Spec/Plan/Tasks của UC-IMM-02 (feat-request-meeting-extension)
  - Use Case nhập từ user: UC-IMM-03

## 📝 CHANGELOG & REVISION HISTORY
| Ngày cập nhật | Tóm tắt thay đổi | Các dòng thay đổi |
| :--- | :--- | :--- |
| 2026-06-16 | Tạo spec lần đầu cho UC-IMM-03 Phê duyệt/từ chối yêu cầu gia hạn phiên họp | Toàn bộ file |
| 2026-06-16 | Cập nhật logic theo clarify: lock meeting & room_bookings, phân quyền override, conflict pending | Section 2, 3, 4, 6, 7, 8 |

---

## EARS Requirements

Functional Requirements trong spec này viết theo EARS.
Keyword EARS giữ nguyên bằng tiếng Anh.

| Keyword | Vai trò |
|---|---|
| THE system SHALL | Yêu cầu luôn đúng, không phụ thuộc event/state/option/error |
| WHEN | Trigger/event xảy ra tại một thời điểm |
| WHILE | Hành vi đúng trong suốt một trạng thái |
| WHERE | Yêu cầu chỉ áp dụng khi feature/capability/config tồn tại |
| IF ... THEN | Xử lý lỗi, ngoại lệ, điều kiện không mong muốn |

---

## 1. Context & Goal

### 1.1 Bối cảnh

Tính năng UC-IMM-03 thuộc nhóm In-Meeting Management, module live-meeting. Đây là feature xử lý quyết định cho các yêu cầu gia hạn phiên họp đang ở trạng thái chờ xử lý (pending).

Feature này nằm ngay sau UC-IMM-02 (Yêu cầu gia hạn phiên họp). UC-IMM-02 tạo ra `meeting_requests` với `request_type = extend_meeting`. Nếu không có room conflict, UC-IMM-02 tự động approve và apply extension. Nếu có room conflict, UC-IMM-02 tạo pending request và gửi thông báo cho Manager/Approver.

UC-IMM-03 xử lý nửa còn lại: Manager/Approver phê duyệt hoặc từ chối pending extension request. Feature này cũng kiểm tra lại room conflict tại thời điểm quyết định (re-validation) vì lịch phòng có thể đã thay đổi kể từ khi request được tạo.

### 1.2 Mục tiêu

Mục tiêu của tính năng này là cho phép Manager/Approver đưa ra quyết định cuối cùng (approve/reject) cho extension request đang pending, đảm bảo:
- Nếu approve: cập nhật `meetings.end_time`, `room_bookings.reserved_end_time`, `room_booking_usages.reserved_end_time` giống UC-IMM-02 auto-apply path.
- Nếu reject: giữ nguyên end time cũ, lưu rejection reason.
- Mọi quyết định đều có transaction, audit, event, notification đầy đủ.
- Idempotent: cùng một request chỉ được xử lý một lần.

### 1.3 Giá trị mang lại

- **Cho Host**: Nhận được quyết định rõ ràng về yêu cầu gia hạn (approve/reject) kèm lý do nếu bị từ chối.
- **Cho Manager/Approver**: Có endpoint chính thức để đưa ra quyết định, kiểm tra lại conflict tại thời điểm duyệt.
- **Cho vận hành phòng họp**: Tránh overlap booking vì conflict được kiểm tra lại khi approve.
- **Cho audit/báo cáo**: Mọi quyết định approve/reject đều được ghi nhận đầy đủ trong `meeting_events` và `audit_logs`.

### 1.4 Giả định

- Chỉ các pending extension request (`meeting_requests.request_type = extend_meeting`, `approval_status = pending`) mới được xử lý.
- Meeting vẫn đang `in_progress` tại thời điểm approve (re-validation).
- Extension policy (`meeting.extension.policy`) đã được load và validate ở UC-IMM-02, không cần validate lại extension minutes.
- Người quyết định đã được xác thực và có permission `meeting.session.extension.decide`.
- Business Admin chỉ có quyền giám sát/audit, không tự động override pending request trừ khi API contract hiện tại có endpoint riêng.

### 1.5 Cần làm rõ

- *(Không có điểm nào cần làm rõ. UC-IMM-03 dựa trên contract UC-96/UC-97 đã có, DB v3.2 Compact, và spec UC-IMM-02 đã ổn định.)*

---

## 2. Actor & Roles

### 2.1 Danh sách actor

| Actor | Vai trò trong tính năng | Quyền / Trách nhiệm chính |
|---|---|---|
| Manager | Người đưa ra quyết định approve/reject extension request đang pending | Permissions: `meeting.session.extension.decide` |
| Business Admin | Giám sát, audit, override request của phòng ban khác trong trường hợp đặc biệt | Permissions: `meeting.session.extension.override` (Proposed) |
| System (Internal Actor) | Actor thực thi quyết định approve/reject, ghi event/audit/notification | Internal service |

### 2.2 Role & Permission Rules

- Manager được phép approve/reject extension request nếu họ là approver hợp lệ được chỉ định trong `meeting_requests.rule_snapshot_json.approverIds` (từ UC-IMM-02) VÀ có permission `meeting.session.extension.decide`.
- Business Admin/System Admin muốn xử lý request bất kỳ (override) BẮT BUỘC phải có explicit permission `meeting.session.extension.override` (Proposed / cần đồng bộ API contract). Không dùng logic hard-code role name.
- Người quyết định không được là Host của meeting (không self-approve), trừ khi Host đang giữ role Manager của phòng ban.
- Endpoint yêu cầu JWT auth + permission guard (hỗ trợ cả 2 permission trên).

### 2.3 Actor Constraints

- Phải đăng nhập và có JWT token hợp lệ.
- Người quyết định phải thỏa mãn MỘT TRONG HAI điều kiện:
  1. Có permission `meeting.session.extension.decide` VÀ ID nằm trong `rule_snapshot_json.approverIds` của request (quyết định thông thường).
  2. Có permission `meeting.session.extension.override` (quyết định override).
- Request phải tồn tại, thuộc meeting đang `in_progress`, và có `approval_status = pending`.

---

## 3. Functional Requirements

### 3.1 Core / Ubiquitous Requirements

```text
FR-001: THE system SHALL cho phép Manager/Approver gửi quyết định approve hoặc reject cho một extension request đang ở trạng thái pending.
FR-002: THE system SHALL kiểm tra request tồn tại, thuộc meeting hợp lệ, và có `approval_status = pending` trước khi xử lý quyết định.
FR-003: THE system SHALL đảm bảo idempotency: một request đã được xử lý (approval_status = applied hoặc rejected) không thể bị xử lý lại.
```

### 3.2 Event-driven Requirements

```text
FR-004: WHEN Manager/Approver gửi quyết định approve cho extension request pending, THE system SHALL kiểm tra lại room conflict trong khoảng `[oldEndTime, requestedNewEndTime)` trước khi apply.
FR-005: WHEN quyết định approve được xác nhận và không có conflict, THE system SHALL thực hiện toàn bộ cập nhật sau trong một transaction:
  - UPDATE `meeting_requests.approval_status = applied`, `decision_by`, `decision_at`, `notes`
  - UPDATE `meetings.end_time`, `updated_by`, `updated_at`
  - UPDATE `room_bookings.reserved_end_time` (status = active hoặc approved)
  - UPDATE `room_booking_usages.reserved_end_time` (usage_status = in_use hoặc not_started)
  - INSERT `meeting_events` (event_type = extension_approved)
  - INSERT `audit_logs` (action_type = extend_meeting)
FR-006: WHEN quyết định approve được apply thành công, THE system SHALL gửi notification realtime cho Host thông báo extension đã được phê duyệt.
FR-007: WHEN Manager/Approver gửi quyết định reject cho extension request pending, THE system SHALL thực hiện trong một transaction:
  - UPDATE `meeting_requests.approval_status = rejected`, `rejection_reason`, `decision_by`, `decision_at`, `notes`
  - INSERT `meeting_events` (event_type = extension_rejected)
  - INSERT `audit_logs` (action_type = extend_meeting)
  - KHÔNG thay đổi `meetings.end_time`, `room_bookings.reserved_end_time`, `room_booking_usages`
FR-008: WHEN quyết định reject được apply thành công, THE system SHALL gửi notification cho Host thông báo extension request đã bị từ chối kèm lý do.
```

### 3.3 State-driven / Re-validation Requirements

```text
FR-009: WHILE meeting đang ở trạng thái `in_progress`, THE system SHALL cho phép xử lý approve cho extension request.
FR-010: WHILE extension request đang ở trạng thái `pending`, THE system SHALL đảm bảo request không bị xử lý bởi hai người cùng lúc (concurrency lock).
FR-011: WHILE kiểm tra room conflict cho quyết định approve, THE system SHALL coi booking có status `pending`, `approved`, `active` của meeting khác là blocking conflict (Bảo toàn lịch phòng quan trọng hơn UX gia hạn, không cho phép auto-override booking đang pending của người khác).
FR-012: WHILE kiểm tra room conflict cho quyết định approve, THE system SHALL exclude chính booking của meeting hiện tại khỏi conflict check.
FR-013: WHILE quyết định approve đang được xử lý, IF có room conflict phát sinh (re-validation thất bại), THEN THE system SHALL chuyển request từ `pending` sang `rejected` với lý do conflict, ghi `conflict_summary_json` và `rejection_reason`.
```

### 3.4 Re-validation Conflict (Reject) Requirements

```text
FR-014: IF re-validation phát hiện room conflict, THEN THE system SHALL:
  - UPDATE `meeting_requests.approval_status = rejected`, `rejection_reason` = "Phòng đã có lịch đặt trong khoảng thời gian gia hạn"
  - UPDATE `meeting_requests.conflict_summary_json` với danh sách conflict chi tiết
  - INSERT `meeting_events` (event_type = extension_rejected)
  - INSERT `audit_logs` (action_type = extend_meeting)
  - KHÔNG thay đổi `meetings.end_time`, `room_bookings`, `room_booking_usages`
FR-015: IF re-validation phát hiện room conflict, THEN THE system SHALL thông báo cho Host rằng request đã bị từ chối do phòng đã có lịch.
```

### 3.5 Unwanted Behavior / Error Requirements

```text
FR-016: IF request không tồn tại hoặc `approval_status != pending`, THEN THE system SHALL từ chối yêu cầu với lỗi phù hợp.
FR-017: IF người quyết định không thỏa mãn đồng thời (có `meeting.session.extension.decide` VÀ thuộc approver list) HOẶC không có explicit permission `meeting.session.extension.override`, THEN THE system SHALL từ chối yêu cầu với lỗi 403.
FR-018: IF người quyết định gọi thao tác override NHƯNG thiếu explicit permission `meeting.session.extension.override`, THEN THE system SHALL từ chối yêu cầu với lỗi 403 (Không nhận diện Admin qua role name).
FR-019: IF meeting không còn ở trạng thái `in_progress`, THEN THE system SHALL từ chối approve (reject request) vì meeting đã kết thúc hoặc bị hủy.
FR-020: IF request đã được xử lý (`approval_status = applied` hoặc `rejected`), THEN THE system SHALL từ chối yêu cầu và không thay đổi dữ liệu (idempotency).
FR-021: IF decision không phải `approved` hoặc `rejected`, THEN THE system SHALL từ chối yêu cầu với lỗi validation.
FR-022: IF một phần của transaction thất bại (ví dụ ghi audit, event, notification), THEN THE system SHALL rollback toàn bộ transaction.
```

### 3.6 Notification Requirements

```text
FR-023: WHEN quyết định approve được apply thành công, THE system SHALL tạo notification cho Host:
  - `notification_type = meeting_extension_approved`
  - `channel = in_app`
  - `priority = high`
  - Payload chứa thông tin extension mới (newEndTime, extensionMinutes)
FR-024: WHEN quyết định reject được apply thành công, THE system SHALL tạo notification cho Host:
  - `notification_type = meeting_extension_rejected`
  - `channel = in_app`
  - `priority = high`
  - Payload chứa rejection reason
FR-025: IF notification delivery thất bại (approve hoặc reject), THEN THE system SHALL giữ nguyên kết quả business transaction và ghi log lỗi delivery.
```

### 3.7 Authorization / Access Control Requirements

```text
FR-026: IF the user is not authenticated, THEN THE system SHALL reject access to the decide endpoint.
FR-027: IF the user does not have permission `meeting.session.extension.decide` VÀ cũng không có `meeting.session.extension.override`, THEN THE system SHALL reject the request without modifying data.
FR-028: WHEN the user performs a decide action, THE system SHALL verify that the user is either in the request's approver list (normal decision) or possesses the explicit override permission (override decision).
```

### 3.8 Data / State Requirements

```text
FR-029: WHEN request được approve thành công, THE system SHALL set `meeting_requests.approval_status = applied`, `decision_by = currentUserId`, `decision_at = now()`.
FR-030: WHEN request bị reject (do Manager quyết định hoặc do re-validation conflict), THE system SHALL set `meeting_requests.approval_status = rejected`, `rejection_reason` tương ứng, `decision_by`, `decision_at`.
FR-031: IF request có `approval_status = applied` hoặc `rejected`, THEN THE system SHALL NOT cho phép bất kỳ thay đổi nào lên request đó.
```

### 3.9 Audit / Event Requirements

```text
FR-032: WHEN mọi quyết định approve/reject (bao gồm re-validation reject) được thực thi, THE system SHALL ghi `meeting_events` với event_type tương ứng (`extension_approved` hoặc `extension_rejected`).
FR-033: WHEN mọi quyết định approve/reject được thực thi, THE system SHALL ghi `audit_logs` với `action_type = extend_meeting` (approve) hoặc `extend_meeting_reject` (reject).
FR-034: IF ghi event hoặc audit log thất bại trong transaction, THEN THE system SHALL rollback toàn bộ transaction.
```

### 3.10 Concurrency / Locking Requirements

```text
FR-035: WHEN xử lý quyết định approve/reject, THE system SHALL sử dụng pessimistic lock (SELECT FOR UPDATE) trên các bảng sau trong cùng một transaction: `meeting_requests`, `meetings` (dòng tương ứng của meeting), và `room_bookings` (dòng booking active/approved hiện tại).
FR-036: IF hai request đến cùng lúc cho cùng một extension request, THEN THE system SHALL đảm bảo chỉ một request được xử lý thành công (dùng DB lock + status check).
FR-036b: WHEN các row đã được lock, THE system SHALL kiểm tra lại toàn bộ: request status, meeting status (phải in_progress), current end time, requested end time, và room conflict trước khi apply thay đổi (đề phòng Host kết thúc cuộc họp trong lúc đang duyệt).
```

### 3.11 Complex / Combined Requirements

```text
FR-037: WHILE meeting đang `in_progress`, WHEN Manager/Approver gửi quyết định approve cho extension request pending, THE system SHALL re-check room conflict và nếu không conflict thì apply transaction đầy đủ.
FR-038: WHILE request đang pending, IF room conflict xuất hiện tại thời điểm re-validation (khác với thời điểm request được tạo), THEN THE system SHALL reject request với lý do conflict thay vì approve.
FR-039: WHILE request đang pending, IF meeting không còn `in_progress`, THEN THE system SHALL reject request và không apply extension.
FR-040: WHILE request đã được xử lý (applied hoặc rejected), IF có request xử lý lại, THEN THE system SHALL từ chối và trả về trạng thái hiện tại của request (idempotency).
```

### 3.12 Requirement Notes

- Không tạo enum/trạng thái DB mới cho approve path. Dùng `approval_status = applied` (đã tồn tại từ UC-IMM-02).
- Business label `APPROVED` có thể được map với persisted status `applied` ở tầng response.
- Toàn bộ re-validation conflict check dùng dynamic query từ `room_bookings`, không dùng bảng `schedule_conflicts`.
- Re-validation reject (do conflict phát sinh tại thời điểm approve) cũng ghi `meeting_events` và `audit_logs` như reject thông thường.
- Notification failure: best-effort, không rollback business transaction.

### 3.13 Traceability

| Requirement ID | EARS Pattern | Nguồn / Use Case liên quan | Ghi chú |
|---|---|---|---|
| FR-001 | Ubiquitous | UC-96, UC-IMM-03 | Core quyết định approve/reject |
| FR-002 | Ubiquitous | UC-96 | Validate request pending |
| FR-003 | Ubiquitous | UC-IMM-03 | Idempotency guard |
| FR-004 | Event-driven | UC-96, UC-97 | Re-validation conflict trước approve |
| FR-005 | Event-driven | UC-97 | Approve transaction |
| FR-006 | Event-driven | UC-IMM-03 | Notify Host khi approve |
| FR-007 | Event-driven | UC-96 | Reject transaction, không thay đổi end_time |
| FR-008 | Event-driven | UC-IMM-03 | Notify Host khi reject |
| FR-009 | State-driven | UC-IMM-03 | Meeting phải in_progress |
| FR-010 | State-driven | UC-IMM-03 | Concurrency lock |
| FR-011 | State-driven | UC-IMM-02/03 | Conflict check rules |
| FR-012 | State-driven | UC-IMM-02/03 | Exclude current meeting's booking |
| FR-013 | Complex (State+Event+Unwanted) | UC-IMM-03 | Re-validation fails: auto reject |
| FR-014 | Unwanted Behavior | UC-IMM-03 | Re-validation conflict handling |
| FR-015 | Unwanted Behavior | UC-IMM-03 | Notify Host khi reject vì conflict |
| FR-016 | Unwanted Behavior | UC-96 | Request not found / not pending |
| FR-017 | Authorization | UC-96 | Permission check |
| FR-018 | Authorization | UC-IMM-03 | Approver list check |
| FR-019 | Unwanted Behavior | UC-IMM-03 | Meeting không còn in_progress |
| FR-020 | Unwanted Behavior | UC-IMM-03 | Idempotency |
| FR-021 | Unwanted Behavior | UC-96 | Invalid decision value |
| FR-022 | Unwanted Behavior | UC-IMM-03 | Transaction rollback |
| FR-023 | Event-driven | UC-IMM-03 | Notification approve |
| FR-024 | Event-driven | UC-IMM-03 | Notification reject |
| FR-025 | Unwanted Behavior | UC-IMM-03 | Notification failure not rollback |
| FR-026 | Authorization | API Convention | Auth |
| FR-027 | Authorization | UC-96 | Permission |
| FR-028 | Authorization | UC-IMM-03 | Approver check |
| FR-029 | Data | UC-97 | Status applied |
| FR-030 | Data | UC-96 | Status rejected |
| FR-031 | Data | UC-IMM-03 | Terminal status |
| FR-032 | Event-driven | UC-97 / UC-96 | meeting_events |
| FR-033 | Event-driven | UC-IMM-03 | audit_logs |
| FR-034 | Unwanted Behavior | UC-IMM-03 | Transaction rollback |
| FR-035 | Ubiquitous | UC-IMM-03 | SELECT FOR UPDATE |
| FR-036 | Unwanted Behavior | UC-IMM-03 | Race condition |
| FR-037 | Complex | UC-96, UC-97 | Approve + conflict re-check |
| FR-038 | Complex | UC-IMM-03 | Re-validation reject |
| FR-039 | Complex | UC-IMM-03 | Meeting không còn in_progress |
| FR-040 | Complex | UC-IMM-03 | Idempotency |

---

## 4. Non-functional Requirements

### 4.1 Performance & Reliability
```text
NFR-001: THE system SHALL hoàn thành xử lý quyết định approve/reject trong vòng 3 giây trong điều kiện tải bình thường.
NFR-002: THE system SHALL đảm bảo toàn bộ cập nhật (request + meeting + booking + usage + event + audit) là atomic trong một database transaction.
NFR-003: THE system SHALL dùng pessimistic lock (SELECT FOR UPDATE) trên `meeting_requests`, `meetings`, và `room_bookings` để tránh race condition và state inconsistency khi xử lý cùng lúc (vd: End meeting và Approve extension đồng thời).
NFR-004: IF transaction thất bại, THEN THE system SHALL rollback toàn bộ và không để lại dữ liệu rác.
```

### 4.2 Security
```text
NFR-005: THE system SHALL yêu cầu JWT authentication trước khi cho phép truy cập endpoint decide.
NFR-006: THE system SHALL enforce check permission `meeting.session.extension.decide` HOẶC `meeting.session.extension.override` cho mọi request xử lý quyết định.
NFR-007: THE system SHALL kiểm tra người quyết định có nằm trong approver list của request không (nếu sử dụng quyền decide thông thường). Quyền override phải được check tường minh (explicit permission).
NFR-008: THE system SHALL NOT expose internal error details trong response lỗi.
```

### 4.3 Observability
```text
NFR-009: THE system SHALL ghi audit log cho mọi quyết định approve/reject với actor, action, timestamp, và liên kết tới request.
NFR-010: THE system SHALL ghi meeting event cho mọi thay đổi trạng thái của extension request.
NFR-011: IF notification delivery thất bại, THEN THE system SHALL ghi log lỗi kèm requestId và error detail.
```

### 4.4 Maintainability
```text
NFR-012: THE system SHALL cung cấp unit test cho service (approve happy path, reject, re-validation conflict, authorization, idempotency, concurrency).
NFR-013: THE system SHALL tách biệt business logic xử lý quyết định trong service layer, không đặt trong controller.
```

---

## 5. Data Model

> Không thêm bảng mới. Tất cả đều dùng bảng có sẵn trong DB v3.2 Compact.

### 5.1 Entity liên quan

| Entity / Table | Vai trò trong tính năng | Ghi chú |
|---|---|---|
| `meeting_requests` | Lưu extension request, được UPDATE status bởi UC-IMM-03 | `request_type = extend_meeting`, `approval_status` chuyển từ `pending` sang `applied` hoặc `rejected` |
| `meetings` | UPDATE `end_time` khi approve | Phải đang `in_progress` |
| `room_bookings` | UPDATE `reserved_end_time` khi approve | Trạng thái `active` hoặc `approved` |
| `room_booking_usages` | UPDATE `reserved_end_time` khi approve | Usage_status `in_use` hoặc `not_started` |
| `meeting_events` | INSERT event `extension_approved` hoặc `extension_rejected` | Ghi timeline |
| `audit_logs` | INSERT audit log cho approve/reject | action_type = `extend_meeting` hoặc `extend_meeting_reject` |
| `notifications` | INSERT notification cho Host | notification_type = `meeting_extension_approved` hoặc `meeting_extension_rejected` |
| `system_configs` | READ extension policy (nếu cần re-validate policy từ UC-IMM-02) | Optional, chỉ đọc nếu logic cần |

### 5.2 Dữ liệu đầu vào (Request Body)

| Field | Type dự kiến | Bắt buộc | Mô tả | Validation |
|---|---:|---:|---|---|
| `decision` | string | Có | `approved` hoặc `rejected` | Chỉ chấp nhận `approved` hoặc `rejected` |
| `reason` | string | Không (mặc định null) | Lý do reject (bắt buộc nếu decision = rejected) | Tối đa 500 ký tự |

### 5.3 Dữ liệu đầu ra (Response Body)

**Approve Response 200:**
| Field | Type dự kiến | Mô tả |
|---|---:|---|
| `requestId` | uuid | ID của extension request |
| `decision` | string | `approved` |
| `status` | string | `applied` (persisted status) |
| `oldEndTime` | datetime | End time cũ trước khi extension |
| `newEndTime` | datetime | End time mới sau khi approve |
| `extensionMinutes` | number | Số phút được gia hạn |
| `decisionAt` | datetime | Thời điểm quyết định |
| `message` | string | Thông báo cho người dùng |

**Reject Response 200:**
| Field | Type dự kiến | Mô tả |
|---|---:|---|
| `requestId` | uuid | ID của extension request |
| `decision` | string | `rejected` |
| `status` | string | `rejected` |
| `rejectionReason` | string | Lý do từ chối (nếu có) |
| `decisionAt` | datetime | Thời điểm quyết định |
| `message` | string | Thông báo cho người dùng |

### 5.4 State / Status Model cho `meeting_requests.approval_status`

| Status | Ý nghĩa | Có thể chuyển sang | Điều kiện chuyển |
|---|---|---|---|
| `pending` | Đang chờ xử lý (tạo bởi UC-IMM-02) | `applied`, `rejected` | Manager quyết định hoặc re-validation fail |
| `applied` | Đã được approve và apply vào meeting/booking | terminal (không chuyển tiếp) | Approve thành công, không conflict |
| `rejected` | Đã bị từ chối bởi Manager hoặc re-validation conflict | terminal (không chuyển tiếp) | Manager reject hoặc re-validation phát hiện conflict |

### 5.5 Data Constraints

- `meeting_requests` với `request_type = extend_meeting` chỉ được xử lý một lần (idempotency).
- Không cho phép approve request đã có `approval_status = applied` hoặc `rejected`.
- `meetings.end_time` chỉ được update khi request được approve và không có room conflict.
- Không thay đổi `meetings.actual_end_time` hoặc `meetings.start_time` trong feature này.

### 5.6 Data Lifecycle

- Request được tạo bởi UC-IMM-02 với `approval_status = pending`.
- Request được cập nhật bởi UC-IMM-03 với `approval_status = applied` hoặc `rejected`.
- Khi `applied`: `meetings.end_time`, `room_bookings.reserved_end_time`, `room_booking_usages.reserved_end_time` được cập nhật.
- Khi `rejected`: chỉ cập nhật `meeting_requests`, không thay đổi meeting/booking/usage.
- Mọi thay đổi được ghi vào `meeting_events` và `audit_logs`.

### 5.7 Data-related EARS Requirements

```text
FR-DATA-001: WHEN request được approve, THE system SHALL set `meeting_requests.approval_status` = `applied`, `decision_by` = currentUserId, `decision_at` = now().
FR-DATA-002: WHEN request được reject, THE system SHALL set `meeting_requests.approval_status` = `rejected`, `rejection_reason` = reason (nếu có), `decision_by`, `decision_at`.
FR-DATA-003: IF request không tồn tại hoặc `approval_status != pending`, THEN THE system SHALL reject the request and return error.
FR-DATA-004: IF approve transaction thành công, meetings.end_time và room_bookings.reserved_end_time phải bằng nhau và bằng requestedNewEndTime.
```

### 5.8 Cần làm rõ

- *(Không có. Toàn bộ các bảng/cột đã có sẵn trong DB v3.2 Compact.)*

---

## 6. Error Handling

### 6.1 Validation Errors

```text
ERR-001: IF `decision` is missing or not `approved`/`rejected`, THEN THE system SHALL reject the request and return error code `VALIDATION_ERROR` (422).
ERR-002: IF `decision = rejected` và `reason` không được cung cấp, THEN THE system SHALL cho phép reject mà không cần reason (reason là optional).
```

### 6.2 Authentication / Authorization Errors

```text
ERR-003: IF the user is not authenticated, THEN THE system SHALL return error code `UNAUTHORIZED` (401).
ERR-004: IF the user lacks both `meeting.session.extension.decide` and `meeting.session.extension.override`, THEN THE system SHALL return error code `PERMISSION_DENIED` (403).
ERR-005: IF the user uses `meeting.session.extension.decide` but is not in the approver list (and lacks override permission), THEN THE system SHALL return error code `PERMISSION_DENIED` (403).
```

### 6.3 Business Rule Errors

```text
ERR-006: IF request không tồn tại, THEN THE system SHALL return error code `RESOURCE_NOT_FOUND` (404).
ERR-007: IF `approval_status != pending`, THEN THE system SHALL return error code `REQUEST_ALREADY_PROCESSED` (409) kèm trạng thái hiện tại.
ERR-008: IF meeting không còn `in_progress`, THEN THE system SHALL reject request và return error code `MEETING_NOT_ACTIVE` (409).
```

### 6.4 Conflict Errors (Re-validation)

```text
ERR-009: IF re-validation phát hiện room conflict, THEN THE system SHALL reject request (approval_status = rejected), lưu conflict_summary_json, và return error code `ROOM_CONFLICT` (409).
```

### 6.5 Error Code Map

| Error Code | HTTP | Mô tả |
|---:|---|---|
| `VALIDATION_ERROR` | 422 | Decision value không hợp lệ |
| `UNAUTHORIZED` | 401 | Chưa đăng nhập |
| `PERMISSION_DENIED` | 403 | Không đủ quyền / không trong approver list |
| `RESOURCE_NOT_FOUND` | 404 | Request không tồn tại |
| `REQUEST_ALREADY_PROCESSED` | 409 | Request đã được xử lý trước đó |
| `MEETING_NOT_ACTIVE` | 409 | Meeting không còn in_progress |
| `ROOM_CONFLICT` | 409 | Re-validation phát hiện room conflict |
| `INTERNAL_ERROR` | 500 | Lỗi server không xác định |

### 6.6 Error Response Format

```json
{
  "success": false,
  "message": "Request has already been processed",
  "error": {
    "code": "REQUEST_ALREADY_PROCESSED",
    "details": {
      "requestId": "uuid",
      "currentStatus": "applied",
      "processedAt": "2026-06-16T10:00:00+07:00",
      "decisionBy": "uuid"
    }
  },
  "timestamp": "2026-06-16T10:00:00+07:00",
  "path": "/api/v1/live-meetings/{meetingId}/extension-requests/{requestId}/decide"
}
```

---

## 7. Acceptance Criteria

### 7.1 Happy Path

```text
AC-001 (Approve — không conflict):
Given extension request đang pending, meeting đang in_progress, phòng không có booking khác trong khoảng [oldEndTime, requestedNewEndTime),
When Manager gửi quyết định approve,
Then hệ thống cập nhật meeting_requests.approval_status = applied, meetings.end_time, room_bookings.reserved_end_time, room_booking_usages.reserved_end_time, ghi meeting_events, audit_logs, và gửi notification cho Host.
```

### 7.2 Validation & Authorization Cases

```text
AC-002 (Decision không hợp lệ):
Given request đang pending,
When Manager gửi decision = "invalid_value",
Then hệ thống trả về 422 VALIDATION_ERROR.

AC-003 (Permission denied):
Given user không có permission meeting.session.extension.decide,
When user gửi request decide,
Then hệ thống trả về 403 PERMISSION_DENIED.

AC-004 (User không trong approver list và không có explicit override permission):
Given user có permission `meeting.session.extension.decide` nhưng không nằm trong approverIds, VÀ user không có permission `meeting.session.extension.override`,
When user gửi request decide,
Then hệ thống trả về 403 PERMISSION_DENIED.

AC-004b (Admin override thành công):
Given user KHÔNG nằm trong approverIds nhưng có explicit permission `meeting.session.extension.override`,
When user gửi request decide,
Then hệ thống cho phép xử lý quyết định (Approve/Reject).
```

### 7.3 Business Rule Cases

```text
AC-005 (Request không tồn tại):
Given requestId không tồn tại,
When Manager gửi quyết định,
Then hệ thống trả về 404 RESOURCE_NOT_FOUND.

AC-006 (Request đã xử lý — idempotency):
Given request đã có approval_status = applied hoặc rejected,
When Manager gửi quyết định lần nữa,
Then hệ thống trả về 409 REQUEST_ALREADY_PROCESSED và không thay đổi dữ liệu.

AC-007 (Meeting không còn in_progress):
Given meeting đã chuyển sang completed/cancelled,
When Manager gửi quyết định approve,
Then hệ thống reject request và trả về 409 MEETING_NOT_ACTIVE.
```

### 7.4 Conflict Re-validation Cases

```text
AC-008 (Re-validation conflict — auto reject):
Given request đang pending, meeting in_progress, nhưng có booking khác trong [oldEndTime, requestedNewEndTime) tại thời điểm approve,
When Manager gửi quyết định approve,
Then hệ thống tự động reject request (approval_status = rejected), ghi conflict_summary_json, rejection_reason, meeting_events, audit_logs, và trả về 409 ROOM_CONFLICT.
```

### 7.5 Audit / Notification Cases

```text
AC-009 (Audit log cho approve):
Given approve thành công,
When hệ thống hoàn tất transaction,
Then audit_logs có record với action_type = extend_meeting, entity_id = meetingId, actor = currentUserId.

AC-010 (Notification cho Host khi approve):
Given approve thành công,
When transaction hoàn tất,
Then Host nhận notification type = meeting_extension_approved với nội dung end time mới.

AC-011 (Notification cho Host khi reject):
Given reject thành công,
When transaction hoàn tất,
Then Host nhận notification type = meeting_extension_rejected với rejection reason.

AC-012 (Meeting events cho approve/reject):
Given approve hoặc reject thành công,
When transaction hoàn tất,
Then meeting_events có record với event_type = extension_approved hoặc extension_rejected.
```

### 7.6 Concurrency / Idempotency Cases

```text
AC-013 (Race condition — lock tables):
Given request decide đang được xử lý (đã lấy lock trên meeting_requests, meetings, room_bookings),
When Host gửi request End Meeting cùng lúc,
Then giao dịch End Meeting sẽ phải chờ lock. Sau khi approve xong (hoặc ngược lại), giao dịch thứ 2 sẽ re-check trạng thái và nhận diện tình trạng đã thay đổi (vd: approval_status đã đổi hoặc meeting không còn in_progress), từ đó phản hồi lỗi hợp lý (409) mà không gây sai lệch data.

AC-014 (Transaction rollback):
Given một phần của transaction thất bại (ví dụ insert event lỗi),
When hệ thống xử lý,
Then toàn bộ thay đổi (request, meeting, booking, usage) được rollback.
```

### 7.7 Acceptance Criteria Traceability

| AC ID | Requirement ID liên quan | Kịch bản test chính |
|---|---|---|
| AC-001 | FR-001, FR-004, FR-005, FR-006, FR-023, FR-029, FR-032, FR-033 | Approve happy path |
| AC-002 | FR-021, ERR-001 | Decision invalid value |
| AC-003 | FR-017, ERR-004, FR-027 | Permission denied |
| AC-004 | FR-018, ERR-005, FR-028 | User not in approver list |
| AC-005 | FR-016, ERR-006 | Request not found |
| AC-006 | FR-003, FR-020, FR-031, ERR-007 | Idempotency |
| AC-007 | FR-019, ERR-008 | Meeting not in_progress |
| AC-008 | FR-013, FR-014, FR-015, ERR-009 | Re-validation conflict |
| AC-009 | FR-033 | Audit log |
| AC-010 | FR-006, FR-023 | Notification approve |
| AC-011 | FR-008, FR-024 | Notification reject |
| AC-012 | FR-032 | Meeting events |
| AC-013 | FR-035, FR-036 | Race condition |
| AC-014 | FR-022, FR-034 | Transaction rollback |

---

## 8. Out of Scope

Các nội dung sau **không thuộc phạm vi** của UC-IMM-03:

- Tạo mới extension request (thuộc UC-IMM-02).
- Auto-approve extension request (thuộc UC-IMM-02 conflict-free path).
- Tìm kiếm Manager/Approver cho pending request (thuộc UC-IMM-02).
- Gửi thông báo cho Manager về pending request (thuộc UC-IMM-02).
- Tự động reject pending request hết hạn (background job — thuộc feature khác).
- Dời/hủy meeting sau để giải phóng phòng (override booking).
- Bất kỳ policy nào cho phép meeting đang diễn ra tự động override/chiếm phòng của một pending booking khác (việc này phải được xử lý qua tính năng manual override/admin riêng).
- Tạo overlap booking.
- Thêm bảng/cột mới vào database.
- Cập nhật `meetings.start_time` hoặc `actual_end_time`.
- Xử lý email notification (disabled mặc định v1).
- Endpoint để Business Admin override pending request (chưa có trong API contract).

### 8.1 Out-of-scope EARS Guardrails

```text
OOS-001: THE system SHALL NOT tạo mới extension request trong UC-IMM-03.
OOS-002: THE system SHALL NOT tự động approve extension request nếu không có quyết định từ Manager.
OOS-003: THE system SHALL NOT tạo hoặc gửi notification cho Manager về pending request (đã xử lý ở UC-IMM-02).
OOS-004: THE system SHALL NOT tạo database tables hoặc columns mới cho feature này.
OOS-005: THE system SHALL NOT thay đổi `meetings.start_time` hoặc `meetings.actual_end_time`.
```
