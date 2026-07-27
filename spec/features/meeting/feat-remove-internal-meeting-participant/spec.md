| Ngày cập nhật | Tóm tắt thay đổi | Các dòng thay đổi |
| :--- | :--- | :--- |
| 2026-06-11 | Áp dụng CR-001→CR-004: chốt recurring instance-only, no .ics, Admin không gỡ Host/Organizer, thêm agenda owner validation | Toàn bộ file |
| 2026-07-26 | Đính chính hiện trạng (BE-06): code controller từng khai route thiếu prefix `meetings/` (chạy nhầm ở root path), đã sửa lại `meetings.controller.ts` ngày 2026-07-26 cho khớp đúng path `DELETE /api/v1/meetings/{meetingId}/participants/{participantUserId}` đã đặc tả ở mục 6.1 của spec này. Spec không thay đổi nội dung, chỉ code được sửa. | Ghi chú, không đổi nội dung đặc tả |


# Feature Specification: Gỡ bỏ thành viên nội bộ khỏi cuộc họp

- **Feature ID**: UC-MM-08
- **Feature Name**: Remove Internal Meeting Participant
- **Module / Domain**: Meeting Management (meetings)
- **Created Date**: 2026-06-11
- **Status**: Draft
- **Source Documents**:
  - UC-MM-08 Gỡ bỏ thành viên nội bộ khỏi cuộc họp (AGENTS.md)
  - Database v3.2 Compact

---

## 1. Feature Overview

### 1.1 Bối cảnh

Trong quy trình quản lý vòng đời cuộc họp, danh sách người tham gia có thể thay đổi sau khi meeting được tạo. Host/Organizer cần khả năng loại bỏ một nhân sự nội bộ khỏi danh sách tham dự dự kiến khi phát hiện mời nhầm người, thay đổi nhân sự, hoặc cần thu hẹp phạm vi bảo mật của cuộc họp. Thao tác này chỉ có hiệu lực ở giai đoạn pre-meeting (meeting đang ở trạng thái `scheduled`).

Tính năng này thuộc module **Meeting Management** và tác động trực tiếp lên bảng `meeting_participants`, đồng thời kích hoạt luồng notification/audit đồng bộ.

### 1.2 Mục tiêu

Mục tiêu của tính năng này là cho phép Host/Organizer/Admin gỡ bỏ một nhân sự nội bộ khỏi danh sách tham dự của cuộc họp trước khi sự kiện bắt đầu, nhằm đảm bảo danh sách khách mời chính xác và đồng bộ với hệ thống điểm danh.

### 1.3 Giá trị mang lại

- Host/Organizer chủ động điều chỉnh danh sách tham dự mà không cần hủy meeting.
- Nhân sự bị gỡ không còn bị yêu cầu điểm danh cho cuộc họp đó.
- Lịch cá nhân của người bị gỡ được giải phóng.
- Hệ thống tự động ghi nhận thay đổi qua audit log và meeting event.
- Async notification đảm bảo người bị gỡ được thông báo kịp thời.

### 1.4 Giả định

- Thao tác remove là hard delete row khỏi `meeting_participants` vì bảng hiện tại không có cột `deleted_at`.
- Lịch sử thay đổi được lưu qua `meeting_events` và `audit_logs`.
- "My Schedule" của user được tính từ `meeting_participants`; khi row bị xóa, meeting tự động biến mất khỏi lịch cá nhân.
- Email notification xử lý async qua `notifications` và `background_jobs`.
- Chỉ áp dụng cho internal participant (bảng `meeting_participants`), không áp dụng cho external participant (bảng `meeting_external_participants`).
- Feature chỉ áp dụng cho một meeting instance cụ thể, không cascade sang toàn bộ recurring series.
- Không tạo file `.ics` cancellation như một phần của feature này. External calendar sync là out of scope.

---

## 2. Actors & Permissions

### 2.1 Danh sách actor

| Actor | Vai trò | Quyền trong tính năng |
|---|---|---|
| Internal Employee (Host) | Chủ trì cuộc họp | Được phép gỡ participant khỏi meeting mình chủ trì |
| Organizer | Người tạo cuộc họp | Được phép gỡ participant khỏi meeting mình tạo |
| System Admin | Quản trị hệ thống | Được phép gỡ internal participant thông thường nếu có permission. Không được gỡ Host/Organizer. |
| Internal Participant | Thành viên tham dự | Không được phép gỡ người khác hoặc tự gỡ |

### 2.2 Permission rule

- Permission đề xuất: `meeting.participant.remove`
- Organizer được remove participant của meeting mình tạo (kiểm tra `meetings.organizer_id`).
- Host được remove participant của meeting mình chủ trì (kiểm tra `meetings.host_id`).
- Admin/System Admin được remove internal participant thông thường nếu có permission `meeting.participant.remove`, ngoại trừ Host/Organizer.
- Participant thường không được remove người khác kể cả khi có user_id trong participant list.

### 2.3 Actor Constraints

- Phải được xác thực (authenticated).
- Phải có quyền `meeting.participant.remove` hoặc là Organizer/Host của meeting đó.
- Chỉ thao tác được trên meeting có status là `scheduled`.

---

## 3. User Stories

- **US-01**: Với vai trò là Host/Organizer, tôi muốn gỡ một nhân sự nội bộ khỏi danh sách tham dự để đảm bảo danh sách khách mời chính xác trước khi cuộc họp diễn ra.
- **US-02**: Với vai trò là System Admin, tôi muốn có thể gỡ internal participant thông thường khỏi bất kỳ meeting nào nếu có lý do chính đáng.
- **US-03**: Với vai trò là người bị gỡ khỏi cuộc họp, tôi muốn nhận được thông báo để giải phóng lịch cá nhân và không còn bị nhắc đến cuộc họp này nữa.

---

## 4. Functional Requirements

> Viết theo chuẩn EARS. Keyword EARS giữ bằng tiếng Anh, nội dung nghiệp vụ viết bằng tiếng Việt.

### 4.1 Authentication & Authorization

**FR-001**: THE system SHALL yêu cầu xác thực người dùng trước khi cho phép thực hiện thao tác gỡ participant khỏi meeting.

**FR-002**: IF người dùng chưa được xác thực (không có JWT token hợp lệ), THEN THE system SHALL từ chối yêu cầu và trả về lỗi 401 Unauthorized.

**FR-003**: THE system SHALL kiểm tra quyền `meeting.participant.remove` HOẶC quyền sở hữu (Organizer/Host) trước khi cho phép thực hiện thao tác gỡ participant.

**FR-004**: IF người dùng đã xác thực nhưng không có quyền `meeting.participant.remove` và không phải Organizer/Host của meeting đó, THEN THE system SHALL từ chối yêu cầu và trả về lỗi 403 Forbidden.

**FR-005**: IF the target participant is the meeting Host or Organizer, THE system SHALL reject the request with `409 CANNOT_REMOVE_HOST_OR_ORGANIZER` regardless of the requester's role (including Admin).

**FR-006**: IF người dùng là Participant thường và cố gắng gỡ người khác, THEN THE system SHALL từ chối yêu cầu và trả về lỗi 403 Forbidden.

### 4.2 Validation

**FR-007**: IF giá trị `meetingId` trong path không đúng định dạng UUID, THEN THE system SHALL từ chối yêu cầu và trả về lỗi 400 Bad Request.

**FR-008**: IF giá trị `participantUserId` trong path không đúng định dạng UUID, THEN THE system SHALL từ chối yêu cầu và trả về lỗi 400 Bad Request.

**FR-009**: IF meeting với `meetingId` không tồn tại trong hệ thống, THEN THE system SHALL từ chối yêu cầu và trả về lỗi 404 Not Found.

**FR-010**: IF participant với `participantUserId` không tồn tại trong danh sách `meeting_participants` của meeting đó, THEN THE system SHALL từ chối yêu cầu và trả về lỗi 404 Not Found với mã lỗi `PARTICIPANT_NOT_IN_MEETING`.

### 4.3 State Validation

**FR-011**: WHILE meeting đang ở trạng thái `scheduled`, THE system SHALL cho phép thực hiện thao tác gỡ participant.

**FR-012**: IF meeting không ở trạng thái `scheduled` (ví dụ: `in_progress`, `completed`, `cancelled`), THEN THE system SHALL từ chối yêu cầu và trả về lỗi 409 Conflict với mã lỗi `MEETING_NOT_REMOVABLE`.

### 4.4 Business Logic

**FR-013**: WHEN tất cả điều kiện validate hợp lệ, THE system SHALL xóa record participant khỏi bảng `meeting_participants` (hard delete).

**FR-014**: WHEN participant đã bị xóa khỏi `meeting_participants`, THE system SHALL ghi một record vào bảng `meeting_events` với event_type là `participant_removed` và metadata chứa `removedUserId`, `removedByUserId`, `reason` (nếu có).

**FR-015**: WHEN participant đã bị xóa khỏi `meeting_participants`, THE system SHALL ghi một record vào bảng `audit_logs` với action là `remove_participant`, actor là user thực hiện, target là meeting, và chi tiết là participant bị gỡ.

**FR-016**: WHEN participant đã bị xóa khỏi `meeting_participants`, THE system SHALL tạo một record trong bảng `notifications` cho user bị gỡ với notification_type là `meeting_participant_removed`, chứa thông tin meeting và nội dung thông báo.

**FR-017**: WHEN notification được tạo thành công, THE system SHALL enqueue một background job vào bảng `background_jobs` để gửi email thông báo đến user bị gỡ.

**FR-018**: WHERE người dùng gửi kèm lý do (optional `reason` trong request body), THE system SHALL lưu lý do đó vào metadata của `meeting_events` và `audit_logs`.

**FR-019**: IF the meeting belongs to a recurring series, THE system SHALL apply the participant removal only to the specified meeting instance identified by `meetingId`.

**FR-020**: IF the request attempts to remove a participant from an entire recurring series, THE system SHALL reject the request with `422 RECURRING_SERIES_SCOPE_NOT_SUPPORTED`.

**FR-021**: WHEN a participant is removed successfully, THE system SHALL NOT generate or attach an `.ics` cancellation file as part of this feature.

**FR-022**: IF the target participant owns one or more agenda items in `meeting_agendas`, THE system SHALL reject the request with `409 PARTICIPANT_OWNS_AGENDA_ITEMS`.

**FR-023**: WHEN the system rejects removal because the participant owns agenda items, THE system SHALL include the blocking agenda item identifiers in the error details where available.

### 4.5 Transaction & Consistency

**FR-024**: WHEN thực hiện thao tác gỡ participant, THE system SHALL đảm bảo tính toàn vẹn bằng cách thực hiện tất cả các bước (remove participant, tạo meeting_event, tạo audit_log, tạo notification, enqueue background_job) trong cùng một transaction.

**FR-025**: IF bất kỳ bước nào trong transaction thất bại (ví dụ: tạo notification thất bại), THEN THE system SHALL rollback toàn bộ transaction và trả về lỗi 500 Internal Server Error, đảm bảo không xảy ra trạng thái đã remove participant nhưng chưa tạo notification.

### 4.6 Idempotency & Concurrency

**FR-026**: IF yêu cầu gỡ participant đã được thực hiện trước đó (participant không còn tồn tại trong `meeting_participants`), THEN THE system SHALL trả về lỗi 404 Not Found với mã lỗi `PARTICIPANT_NOT_IN_MEETING` (idempotent-safe, không throw exception không cần thiết).

**FR-027**: WHEN hai yêu cầu gỡ cùng một participant được gửi đồng thời, THE system SHALL xử lý tuần tự và chỉ yêu cầu đầu tiên thành công, yêu cầu thứ hai nhận lỗi 404 Not Found.

### 4.7 Attendance / Presence Impact

**FR-028**: WHEN participant bị gỡ khỏi meeting đang ở trạng thái `scheduled`, THE system SHALL không cần cập nhật `attendance_records` hoặc `presence_snapshots` vì meeting chưa bắt đầu; attendance chỉ tính trên danh sách participant hiện tại khi meeting diễn ra.

### 4.8 Response Contract

**FR-029**: WHEN thao tác gỡ participant thành công, THE system SHALL trả về HTTP 200 với response body chứa `meetingId`, `removedParticipantUserId`, `removed` = true, `removedAt` (ISO-8601), `notificationQueued` = true, `notificationId`, `backgroundJobId`.

**FR-030**: THE system SHALL trả về response theo format chuẩn của dự án: `{ success: true, message: "...", data: { ... } }`.

### 4.9 Traceability

| Requirement ID | EARS Pattern | Use Case liên quan | Ghi chú |
|---|---|---|---|
| FR-001 | Ubiquitous | UC-MM-08 | Luôn cần auth |
| FR-002 | Unwanted Behavior | UC-MM-08 | Auth failure |
| FR-003 | Ubiquitous | UC-MM-08 | Authorization check |
| FR-004 | Unwanted Behavior | UC-MM-08 | Permission denied |
| FR-005 | Unwanted Behavior | UC-MM-08 | Cannot remove Host/Organizer |
| FR-006 | Unwanted Behavior | UC-MM-08 | Participant cannot remove others |
| FR-007 | Unwanted Behavior | UC-MM-08 | Invalid meetingId UUID |
| FR-008 | Unwanted Behavior | UC-MM-08 | Invalid participantUserId UUID |
| FR-009 | Unwanted Behavior | UC-MM-08 | Meeting not found |
| FR-010 | Unwanted Behavior | UC-MM-08 | Participant not in meeting |
| FR-011 | State-driven | UC-MM-08 | Allowed state |
| FR-012 | Unwanted Behavior | UC-MM-08 | Wrong state |
| FR-013 | Event-driven | UC-MM-08 | Hard delete participant |
| FR-014 | Event-driven | UC-MM-08 | Meeting event record |
| FR-015 | Event-driven | UC-MM-08 | Audit log record |
| FR-016 | Event-driven | UC-MM-08 | Notification creation |
| FR-017 | Event-driven | UC-MM-08 | Background job enqueue |
| FR-018 | Optional Feature | UC-MM-08 | Optional reason |
| FR-019 | Event-driven | UC-MM-08 | Recurring instance-only |
| FR-020 | Unwanted Behavior | UC-MM-08 | Recurring series-wide rejected |
| FR-021 | Unwanted Behavior | UC-MM-08 | No .ics generation |
| FR-022 | Unwanted Behavior | UC-MM-08 | Agenda owner validation |
| FR-023 | Event-driven | UC-MM-08 | Agenda owner error details |
| FR-024 | Ubiquitous | UC-MM-08 | Transactional guarantee |
| FR-025 | Unwanted Behavior | UC-MM-08 | Rollback on failure |
| FR-026 | Unwanted Behavior | UC-MM-08 | Idempotent remove |
| FR-027 | Unwanted Behavior | UC-MM-08 | Concurrent remove |
| FR-028 | Ubiquitous | UC-MM-08 | Attendance impact note |
| FR-029 | Event-driven | UC-MM-08 | Success response |
| FR-030 | Ubiquitous | UC-MM-08 | Response format |
## 5. Non-Functional Requirements

### 5.1 Security

**NFR-001**: THE system SHALL enforce authentication cho mọi request đến endpoint này.

**NFR-002**: THE system SHALL enforce authorization dựa trên permission `meeting.participant.remove` hoặc quyền sở hữu (Organizer/Host).

**NFR-003**: THE system SHALL NOT trả về thông tin nhạy cảm (token, password hash, internal error stack) trong response.

### 5.2 Consistency

**NFR-004**: THE system SHALL đảm bảo tính nhất quán giữa các bảng `meeting_participants`, `meeting_events`, `audit_logs`, `notifications`, `background_jobs` trong cùng một business transaction.

### 5.3 Auditability

**NFR-005**: THE system SHALL ghi audit log cho mọi thao tác gỡ participant dù thành công hay thất bại (nếu thất bại ở bước phi business như validation/auth thì không bắt buộc).

**NFR-006**: THE system SHALL lưu đầy đủ thông tin trong audit log: `actor_id`, `action`, `target_type`, `target_id`, `details`, `ip_address` (nếu có), `timestamp`.

### 5.4 Idempotency & Concurrency

**NFR-007**: THE system SHALL xử lý an toàn khi nhận nhiều yêu cầu gỡ cùng một participant đồng thời: chỉ một request thành công, các request còn lại nhận lỗi 404.

### 5.5 Async Notification Reliability

**NFR-008**: THE system SHALL tạo notification record trong cùng transaction với thao tác remove để đảm bảo notification không bị mất nếu remove thành công.

**NFR-009**: IF background job gửi email thất bại sau khi transaction thành công, THE system SHALL ghi nhận lỗi và cho phép retry job, không rollback thao tác remove.

### 5.6 Performance

**NFR-010**: THE system SHALL hoàn thành thao tác gỡ participant (bao gồm tạo meeting_event, audit_log, notification, background_job) trong vòng 2 giây dưới tải bình thường.

**NFR-011**: THE system SHALL xử lý tối thiểu 50 request gỡ participant đồng thời mà không làm ảnh hưởng đến các thao tác meeting khác.

---

## 6. API Contract đề xuất

### 6.1 Endpoint

```
DELETE /api/v1/meetings/{meetingId}/participants/{participantUserId}
```

### 6.2 Headers

| Header | Value | Bắt buộc |
|---|---|---:|
| Authorization | Bearer \<JWT token\> | Có |
| Content-Type | application/json | Không (nếu có body) |

### 6.3 Path Parameters

| Parameter | Type | Bắt buộc | Mô tả |
|---|---:|---:|---|
| meetingId | UUID | Có | ID của cuộc họp |
| participantUserId | UUID | Có | ID của user là participant cần gỡ |

### 6.4 Optional Body

```json
{
  "reason": "Lý do gỡ thành viên (không bắt buộc)"
}
```

### 6.5 Success Response (200 OK)

```json
{
  "success": true,
  "message": "Đã gỡ bỏ thành viên khỏi cuộc họp thành công",
  "data": {
    "meetingId": "uuid",
    "removedParticipantUserId": "uuid",
    "removed": true,
    "removedAt": "2026-06-11T10:00:00.000Z",
    "notificationQueued": true,
    "notificationId": "uuid",
    "backgroundJobId": "uuid"
  }
}
```

### 6.6 Error Responses

| Status | Mã lỗi | Điều kiện |
|---|---:|---|
| 400 | INVALID_UUID | `meetingId` hoặc `participantUserId` không đúng định dạng UUID |
| 401 | UNAUTHENTICATED | Thiếu hoặc token hết hạn |
| 403 | FORBIDDEN | Không có quyền `meeting.participant.remove` và không phải Organizer/Host |
| 404 | MEETING_NOT_FOUND | Meeting không tồn tại |
| 404 | PARTICIPANT_NOT_IN_MEETING | Participant không có trong meeting |
| 409 | MEETING_NOT_REMOVABLE | Meeting không ở trạng thái `scheduled` |
| 409 | CANNOT_REMOVE_HOST_OR_ORGANIZER | Cố gắng gỡ Host hoặc Organizer (bao gồm cả Admin) |
| 409 | PARTICIPANT_OWNS_AGENDA_ITEMS | Participant đang là owner của agenda items |
| 422 | RECURRING_SERIES_SCOPE_NOT_SUPPORTED | Cố gắng gỡ participant khỏi toàn bộ recurring series |
| 422 | INVALID_BUSINESS_STATE | Trạng thái nghiệp vụ không hợp lệ |
| 500 | INTERNAL_ERROR | Lỗi server không xác định |

---

## 7. Data Model Impact

### 7.1 Entity liên quan

| Entity / Table | Vai trò | Thao tác |
|---|---|---|
| `meeting_participants` | Lưu danh sách participant nội bộ | DELETE row của target participant |
| `meetings` | Đọc trạng thái, organizer_id, host_id | READ ONLY |
| `meeting_events` | Ghi lại sự kiện participant_removed | INSERT |
| `audit_logs` | Ghi lại hành động audit | INSERT |
| `notifications` | Tạo thông báo cho người bị gỡ | INSERT |
| `background_jobs` | Enqueue job gửi email | INSERT |
| `meeting_agendas` | Kiểm tra quyền sở hữu agenda (owner_id) | READ ONLY (validate) |

### 7.2 Dữ liệu đầu vào

| Field | Type | Bắt buộc | Mô tả |
|---|---:|---:|---|
| meetingId | UUID | Có | ID cuộc họp (path param) |
| participantUserId | UUID | Có | ID user cần gỡ (path param) |
| reason | string (nullable) | Không | Lý do gỡ (optional body) |

### 7.3 Dữ liệu đầu ra

| Field | Type | Mô tả |
|---|---:|---|
| meetingId | UUID | ID cuộc họp |
| removedParticipantUserId | UUID | ID participant đã bị gỡ |
| removed | boolean | Luôn là true khi thành công |
| removedAt | ISO-8601 | Thời điểm gỡ |
| notificationQueued | boolean | Luôn là true khi thành công |
| notificationId | UUID | ID của notification đã tạo |
| backgroundJobId | UUID | ID của background job đã enqueue |

### 7.4 Data Constraints

- `meeting_participants` không có `deleted_at`, vì vậy thao tác remove là hard delete.
- Không thêm bảng mới.
- Không sửa schema hiện tại.
- `meeting_events.event_type` được dùng là `participant_removed`.
- `notifications.notification_type` được dùng là `meeting_participant_removed`.

### 7.5 Data Lifecycle

- `meeting_participants`: row bị xóa ngay khi thao tác thành công.
- `meeting_events`: được insert với event_type `participant_removed` để trace lịch sử.
- `audit_logs`: được insert để phục vụ kiểm tra sau này.
- `notifications` + `background_jobs`: được insert để gửi email async.

---

## 8. Business Rules

**BR-01 (Ownership)**: Chỉ Organizer, Host (của meeting đó) hoặc Admin có permission `meeting.participant.remove` mới được gỡ participant (internal participant thông thường). Admin không được gỡ Host/Organizer. Participant thường không có quyền gỡ lẫn nhau hoặc tự gỡ.

**BR-02 (Pre-meeting only)**: Feature chỉ áp dụng cho meeting ở trạng thái `scheduled`. Meeting đã `in_progress`, `completed`, hoặc `cancelled` sẽ bị từ chối.

**BR-03 (Host/Organizer protection)**: Không được gỡ Host hoặc Organizer bằng feature này, kể cả Admin. Nếu cần thay đổi Host, phải dùng feature "Transfer Host" riêng. Nếu cần hủy meeting, dùng feature "Cancel Meeting".

**BR-04 (Internal only)**: Chỉ áp dụng cho internal participants trong bảng `meeting_participants`, không áp dụng cho external participants trong `meeting_external_participants`.

**BR-05 (Transactional integrity)**: Remove participant, tạo meeting_event, tạo audit_log, tạo notification, và enqueue background_job phải nằm trong cùng một database transaction.

**BR-06 (Notification async)**: Thao tác remove participant thành công không phụ thuộc vào việc email đã được gửi xong, nhưng notification record và background_job phải được tạo đồng bộ trong transaction.

**BR-07 (Audit best-effort)**: Nếu audit_log thất bại, không làm fail business transaction. Tuy nhiên, nếu project constitution yêu cầu audit bắt buộc thì follow constitution.

**BR-08 (Attendance reset)**: Khi participant bị gỡ ở giai đoạn `scheduled`, mọi yêu cầu điểm danh và giám sát hiện diện của người đó cho cuộc họp này không còn được áp dụng.

**BR-09 (Recurring instance scope)**: Feature chỉ áp dụng cho một meeting instance cụ thể được xác định bởi `meetingId`. Không cascade remove sang toàn bộ recurring series. Series-wide participant removal là out of scope.

**BR-10 (Agenda owner validation)**: Không được gỡ participant nếu họ đang là `owner_id` của bất kỳ record nào trong `meeting_agendas` thuộc meeting đó. Backend trả về 409 `PARTICIPANT_OWNS_AGENDA_ITEMS`. Không tự động set null, xóa, hoặc chuyển owner agenda.

**BR-11 (No .ics cancellation)**: Feature này không tạo hoặc đính kèm file `.ics` với method=CANCEL. External calendar sync (Google Calendar, Outlook) là out of scope.

---

## 9. Acceptance Criteria

> Format Given / When / Then.

### 9.1 Happy Path

**AC-01 - Remove thành công**:
Given Host/Organizer/Admin đã đăng nhập và có quyền,
And meeting đang ở trạng thái `scheduled`,
And target participant đang tồn tại trong `meeting_participants`,
When Host gửi request DELETE `/api/v1/meetings/{meetingId}/participants/{participantUserId}`,
Then hệ thống trả về HTTP 200,
And record participant bị xóa khỏi `meeting_participants`,
And `meeting_events` có record `participant_removed`,
And `audit_logs` có record thao tác,
And `notifications` có record cho user bị gỡ,
And `background_jobs` có record email job.

**AC-02 - Participant không còn trong danh sách**:
Given AC-01 đã thành công,
When gọi API GET participants của meeting đó,
Then target participant không còn xuất hiện trong danh sách.

**AC-03 - My Schedule của người bị gỡ**:
Given participant bị gỡ thành công (AC-01),
When người bị gỡ xem "My Schedule",
Then meeting đó không còn hiển thị trong lịch cá nhân.

### 9.2 Authorization Cases

**AC-04 - Organizer/Host không thể bị gỡ**:
Given Host/Organizer là target participant,
When Host khác (hoặc Admin) gửi request gỡ,
Then hệ thống trả về HTTP 409,
And participant không bị xóa khỏi `meeting_participants`.

**AC-05 - Participant thường không có quyền**:
Given user A là participant thường (không phải Host/Organizer/Admin),
When user A gửi request gỡ participant B khỏi meeting,
Then hệ thống trả về HTTP 403,
And không có thay đổi dữ liệu nào xảy ra.

### 9.3 State Validation Cases

**AC-06 - Meeting in_progress/completed bị chặn**:
Given meeting đang ở trạng thái `in_progress` hoặc `completed`,
When Host/Organizer gửi request gỡ participant,
Then hệ thống trả về HTTP 409 với mã lỗi `MEETING_NOT_REMOVABLE`,
And participant không bị xóa khỏi `meeting_participants`.

### 9.4 Validation Cases

**AC-07 - Participant không thuộc meeting**:
Given target participant không tồn tại trong `meeting_participants`,
When Host/Organizer gửi request gỡ,
Then hệ thống trả về HTTP 404 với mã lỗi `PARTICIPANT_NOT_IN_MEETING`.

**AC-08 - Invalid UUID**:
Given meetingId hoặc participantUserId không đúng định dạng UUID,
When gửi request DELETE,
Then hệ thống trả về HTTP 400 Bad Request.

### 9.5 Audit / Notification Cases

**AC-09 - Notification queued**:
Given participant bị gỡ thành công (AC-01),
When kiểm tra database,
Then `notifications` có record với `notification_type` = `meeting_participant_removed`,
And `background_jobs` có record email job tương ứng.

**AC-10 - Audit log created**:
Given participant bị gỡ thành công (AC-01),
When kiểm tra `audit_logs`,
Then có record với action = `remove_participant`, actor = user thực hiện, target = meetingId.

### 9.6 Concurrency / Edge Cases

**AC-11 - Duplicate remove**:
Given participant đã bị gỡ thành công trước đó,
When cùng user đó gửi request gỡ lại lần nữa,
Then hệ thống trả về HTTP 404 với mã lỗi `PARTICIPANT_NOT_IN_MEETING`.

**AC-12 - Email job fail không rollback remove**:
Given participant đã bị gỡ thành công (transaction commit),
When background job gửi email thất bại sau đó,
Then participant vẫn không còn trong `meeting_participants`,
And `meeting_events` và `audit_logs` vẫn còn record.

### 9.7 Recurring Meeting Scope

**AC-REC-001 - Remove from one occurrence only**:
Given a meeting is one occurrence of a recurring series,
When an authorized Host removes an internal participant from that occurrence,
Then the participant is removed only from that occurrence,
And the participant remains in other occurrences of the series.

**AC-REC-002 - Series-wide removal rejected**:
Given a request attempts to remove a participant from an entire recurring series,
When the API is called for series-wide removal,
Then the system returns `422 RECURRING_SERIES_SCOPE_NOT_SUPPORTED`.

### 9.8 No .ics Cancellation

**AC-ICS-001 - No .ics file generated**:
Given a participant is removed successfully,
When the notification job is queued,
Then the system sends a text email/in-app notification,
And does not require generating an `.ics` cancel attachment.

### 9.9 Admin Cannot Remove Host/Organizer

**AC-PERM-ADMIN-001 - Admin cannot remove Host/Organizer**:
Given the requester is Admin with `meeting.participant.remove`,
And the target participant is Host or Organizer,
When the requester attempts to remove the target,
Then the system returns `409 CANNOT_REMOVE_HOST_OR_ORGANIZER`.

### 9.10 Agenda Owner Validation

**AC-AGENDA-001 - Participant owns agenda items**:
Given the target participant owns one or more agenda items,
When an authorized requester attempts to remove that participant,
Then the system returns `409 PARTICIPANT_OWNS_AGENDA_ITEMS`,
And no participant row is removed,
And no notification/job is created.

### 9.11 Traceability

| AC ID | Requirement ID | Kịch bản test |
|---|---|---|
| AC-01 | FR-001, FR-003, FR-011, FR-013, FR-014, FR-015, FR-016, FR-017, FR-019, FR-024, FR-029 | Remove thành công |
| AC-02 | FR-013 | Participant không còn trong list |
| AC-03 | FR-013, BR-08 | My Schedule không còn meeting |
| AC-04 | FR-005 | Không gỡ được Host/Organizer |
| AC-05 | FR-004, FR-006 | Participant thường không có quyền |
| AC-06 | FR-012 | State in_progress/completed bị chặn |
| AC-07 | FR-010 | Participant không thuộc meeting |
| AC-08 | FR-007, FR-008 | Invalid UUID |
| AC-09 | FR-016, FR-017 | Notification queued |
| AC-10 | FR-015 | Audit log created |
| AC-11 | FR-021 | Duplicate remove idempotent |
| AC-12 | NFR-009 | Email fail không rollback |
| AC-REC-001 | FR-019, FR-020 | Remove from one occurrence only |
| AC-REC-002 | FR-020 | Series-wide removal rejected |
| AC-ICS-001 | FR-021 | No .ics file generated |
| AC-PERM-ADMIN-001 | FR-005 | Admin cannot remove Host/Organizer |
| AC-AGENDA-001 | FR-022, FR-023 | Participant owns agenda items |

---

## 10. Edge Cases

| # | Edge Case | Expected Behavior |
|---|---|---|
| EC-01 | Target user không tồn tại trong hệ thống users | Trả về lỗi 404 `PARTICIPANT_NOT_IN_MEETING` (chỉ check `meeting_participants`, không cần user tồn tại) |
| EC-02 | Meeting không tồn tại | Trả về lỗi 404 `MEETING_NOT_FOUND` |
| EC-03 | Participant đã bị gỡ trước đó | Trả về lỗi 404 `PARTICIPANT_NOT_IN_MEETING` |
| EC-04 | Người thực hiện là target participant (tự gỡ) | Nếu là Host/Organizer: trả về 409. Nếu là participant thường: trả về 403 |
| | EC-05 | Người thực hiện là Host, target là Organizer | Trả về 409 `CANNOT_REMOVE_HOST_OR_ORGANIZER` |` |
| EC-06 | Meeting scheduled nhưng start_time đã qua | Vẫn cho phép remove vì status còn là `scheduled` (không check start_time) |
| EC-07 | Notification enqueue thất bại trong transaction | Rollback toàn bộ transaction, trả về 500, participant không bị remove |
| EC-08 | Audit log thất bại | Nếu audit là best-effort: không rollback, ghi warning log. Nếu audit mandatory: rollback như FR-020 |
| EC-09 | Hai request đồng thời remove cùng participant | Request đầu thành công, request thứ hai nhận 404 `PARTICIPANT_NOT_IN_MEETING` |
| EC-10 | Participant có invitation_status khác nhau (accepted/declined/tentative/pending) | Remove vẫn thành công vì không phụ thuộc vào invitation_status. Mọi status đều có thể bị remove |
| EC-11 | Reason quá dài (>1000 ký tự) | Trả về 400 Bad Request với lỗi validation trường reason |
| EC-12 | Meeting không có trường host_id (null) | Chỉ check organizer_id và permission, không bắt buộc host phải tồn tại |
| EC-13 | Meeting thuộc recurring series, chỉ remove instance | Remove chỉ áp dụng cho occurrence cụ thể, không ảnh hưởng các occurrence khác |
| EC-14 | Request series-wide participant removal | Từ chối với 422 RECURRING_SERIES_SCOPE_NOT_SUPPORTED |
| EC-15 | Target participant là agenda owner | Trả về 409 PARTICIPANT_OWNS_AGENDA_ITEMS kèm danh sách agendaItemIds |
| EC-16 | Admin cố gắng gỡ Host/Organizer | Trả về 409 CANNOT_REMOVE_HOST_OR_ORGANIZER, không ngoại lệ cho Admin |

---

## 11. Out of Scope

Các nội dung sau **không thuộc phạm vi** của feature này:

### 11.1 Không triển khai trong feature này

- **Transfer Host**: Không cho phép chuyển quyền chủ trì. Nếu Host cần thay đổi, đó là feature riêng.
- **Cancel Meeting**: Không hủy meeting khi gỡ participant.
- **Add Internal Participant**: Thêm participant mới là feature riêng, không gộp chung.
- **Remove External Participant**: Chỉ xử lý internal participant (`meeting_participants`), không xử lý external participant (`meeting_external_participants`).
- **Update Meeting Time**: Không thay đổi thời gian meeting.
- **Recalculate Participant Conflict**: Không tính lại lịch bận/xung đột sau khi gỡ participant.
- **Direct IoT/Camera Sync Command**: Không gửi lệnh đồng bộ trực tiếp đến thiết bị IoT/camera. Attendance/presence tự động derive từ participant list.
- **Editing Attendance Records**: Không sửa attendance records sau khi meeting đã bắt đầu.
- **Notification Template Management**: Không cho phép tùy chỉnh nội dung email/notification template.

### 11.2 Out-of-scope EARS Guardrails

**OOS-001**: THE system SHALL NOT thực hiện chức năng Transfer Host như một phần của feature này.

**OOS-002**: THE system SHALL NOT tạo bảng mới hoặc thêm cột mới vào schema database hiện tại.

**OOS-003**: THE system SHALL NOT gửi lệnh điều khiển trực tiếp đến IoT device, IP Camera, hoặc Door Face Attendance Terminal.

**OOS-004**: THE system SHALL NOT xử lý việc gỡ external participant (bảng `meeting_external_participants`) trong feature này.

**OOS-005**: THE system SHALL NOT remove participant from an entire recurring meeting series. Only instance-specific removal is supported.

**OOS-006**: THE system SHALL NOT generate or attach `.ics` cancellation files as part of this feature.

**OOS-007**: THE system SHALL NOT synchronize with external calendar systems (Google Calendar, Outlook) for automatic event removal.

**OOS-008**: THE system SHALL NOT reassign agenda ownership or delete agenda items as a side effect of participant removal.

---

## 12. Assumptions / Clarifications Resolved

### Assumptions

| # | Assumption | Ghi chú |
|---|---|---|
| A-01 | Feature chỉ áp dụng khi meeting status là `scheduled`. | Meeting đã bắt đầu hoặc kết thúc sẽ không cho phép remove. |
| A-02 | Remove participant là hard delete row khỏi `meeting_participants`. | Bảng hiện tại không có `deleted_at`; lịch sử được lưu bằng `meeting_events` và `audit_logs`. |
| A-03 | "My Schedule" của user được tính từ `meeting_participants`. | Khi row bị xóa, meeting tự động biến mất khỏi lịch cá nhân. |
| A-04 | Attendance/absence không cần cập nhật record vì meeting chưa bắt đầu. | Khi điểm danh, hệ thống chỉ tính người còn trong participant list. |
| A-05 | Email notification xử lý async qua `notifications` và `background_jobs`. | Không đồng bộ gửi email trong request lifecycle. |
| A-06 | Nếu tạo notification/job thất bại, rollback toàn bộ transaction. | Tránh trạng thái đã remove participant nhưng không có notification queued. |
| A-07 | Nếu audit log thất bại, không làm fail business transaction (best-effort). | Ghi warning/log kỹ thuật. Nếu constitution yêu cầu audit bắt buộc thì follow. |

### Clarifications Resolved

| # | Vấn đề cần làm rõ | Quyết định |
|---|---|---|
| C-01 | Có cho phép reason optional không? | Có. Optional body `{reason?: string}`, không bắt buộc. |
| C-02 | Có cần kiểm tra invitation_status trước khi remove không? | Không. Remove được phép bất kể invitation_status là accepted/declined/tentative/pending. |
| C-03 | Có cần check start_time đã qua chưa ngoài status không? | Không. Chỉ check `meetings.status`, không check `start_time`. Nếu status vẫn là `scheduled` thì cho phép. |
| C-04 | Người dùng có thể tự gỡ chính mình không? | Không. Nếu là Host hoặc Organizer: trả về 409 CANNOT_REMOVE_HOST_OR_ORGANIZER. |
| C-05 | Feature có áp dụng cho recurring series không? | Chỉ áp dụng cho một meeting instance cụ thể. Series-wide removal là out of scope. |
| C-06 | Feature có tạo file .ics cancellation không? | Không. Feature chỉ remove participant khỏi hệ thống nội bộ, tạo notification và enqueue background_job. External calendar sync là out of scope. |
| C-07 | Admin có được gỡ Host/Organizer không? | Không. Admin cũng không được gỡ Host/Organizer bằng feature này. Nếu cần thay đổi Host, dùng feature Transfer Host. |
| C-08 | Có cần kiểm tra agenda owner trước khi remove không? | Có. Nếu participant đang là owner_id của bất kỳ agenda item nào, hệ thống chặn với 409 PARTICIPANT_OWNS_AGENDA_ITEMS. |

---

## 13. Readiness Checklist

- [x] Spec đã có đầy đủ các phần chính (Feature Overview, Actors, User Stories, Functional Requirements, Non-Functional Requirements, API Contract, Data Model, Business Rules, Acceptance Criteria, Edge Cases, Out of Scope, Assumptions).
- [x] Functional Requirements viết theo EARS với keyword tiếng Anh, nội dung tiếng Việt.
- [x] Đã có đủ 5 EARS basic patterns: Ubiquitous, Event-driven, State-driven, Optional Feature, Unwanted Behavior.
- [x] Mỗi requirement có mã ID rõ ràng.
- [x] Requirement có thể kiểm thử được (testable).
- [x] Không mô tả quá sâu implementation.
- [x] Không tự ý thêm feature ngoài tài liệu nguồn.
- [x] Không tự ý thêm database table/field mới.
- [x] Error handling đã bao gồm validation, authentication, authorization, business rule, conflict.
- [x] Acceptance Criteria dùng Given / When / Then (17 AC).
- [x] Traceability đã liên kết AC với FR liên quan.
- [x] Out of Scope đủ rõ ràng để tránh agent tự mở rộng.
- [x] Đã có phần Assumptions ghi rõ các giả định.
- [x] Đã bao phủ 16 edge case.
- [x] Tối thiểu 20 functional requirements (đã đạt 30 FR).
- [x] API Contract đã đề xuất rõ ràng.
- [x] Permission requirement `meeting.participant.remove` đã được define.
- [x] Sẵn sàng cho bước `/speckit-plan`.


