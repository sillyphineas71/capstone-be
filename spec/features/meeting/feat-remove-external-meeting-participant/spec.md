| Ngày cập nhật | Tóm tắt thay đổi | Các dòng thay đổi |
| :--- | :--- | :--- |
| 2026-06-25 | Khởi tạo spec cho tính năng gỡ bỏ khách mời bên ngoài (external participant) khỏi cuộc họp | Toàn bộ file |

# Feature Specification: Gỡ bỏ khách mời bên ngoài khỏi cuộc họp

- **Feature ID**: MEET-REMOVE-EXTERNAL-PARTICIPANT-001
- **Feature Name**: Remove External Meeting Participant
- **Module / Domain**: Meeting Management (meetings)
- **Created Date**: 2026-06-25
- **Status**: Draft
- **Source Documents**:
  - Không có Use Case chính thức tương ứng trong `UseCase_List_SMRMPTS.xlsx` (đã rà soát: chỉ có UC-23 "Thêm thành viên nội bộ thủ công" và UC-25 "Gỡ bỏ thành viên nội bộ"; không có UC riêng cho việc gỡ external participant).
  - Đây là tính năng mở rộng theo **yêu cầu trực tiếp của team/người dùng ngày 2026-06-25**, dựa trên gap được phát hiện khi review module `meetings` hiện tại.
  - Tham chiếu thiết kế tương đương: `spec/features/meeting/feat-remove-internal-meeting-participant` (UC-MM-08) — dùng làm baseline cho luồng quyền, transaction, idempotency.
  - Companion feature: `spec/features/meeting/feat-add-external-meeting-participant`.
  - Database v3.2 Compact (39 Tables) — bảng `meeting_external_participants`.

---

## 1. Feature Overview

### 1.1 Bối cảnh

Sau khi tính năng "Thêm khách mời bên ngoài vào cuộc họp đã tạo" (`feat-add-external-meeting-participant`) cho phép bổ sung khách mời bên ngoài sau khi meeting đã tồn tại, hệ thống cũng cần một thao tác đối xứng để **gỡ bỏ** một khách mời bên ngoài đã được thêm nhầm, không còn cần tham dự, hoặc do thay đổi kế hoạch họp.

Hiện tại, khách mời bên ngoài chỉ có thể bị loại khỏi danh sách bằng cách hủy toàn bộ cuộc họp — không có cách nào gỡ riêng một khách mời mà vẫn giữ nguyên cuộc họp và các participant khác.

Tính năng này thuộc module **Meeting Management**, tác động lên bảng `meeting_external_participants`, và là tính năng song hành (companion feature) với `feat-add-external-meeting-participant`.

### 1.2 Mục tiêu

Mục tiêu của tính năng này là cho phép Organizer, Host, hoặc actor có quyền quản lý phù hợp gỡ bỏ một khách mời bên ngoài khỏi danh sách tham dự của một cuộc họp đang ở trạng thái `scheduled`, nhằm đảm bảo danh sách khách mời chính xác trước khi cuộc họp diễn ra.

### 1.3 Giá trị mang lại

- Organizer/Host chủ động điều chỉnh danh sách khách mời bên ngoài mà không cần hủy meeting.
- Khách mời bị gỡ không còn được tính vào sức chứa phòng hoặc danh sách mời khi tính `getAttendeeCount`.
- Hệ thống tự động ghi nhận thay đổi qua `meeting_events` và `audit_logs`.
- Khách mời bị gỡ (nếu có email) được thông báo qua email, tránh trường hợp khách mời vẫn nghĩ mình còn tham dự.

### 1.4 Giả định

- Thao tác remove là **hard delete** row khỏi `meeting_external_participants`, vì bảng hiện tại không có cột `deleted_at` (giống quyết định đã áp dụng cho `feat-remove-internal-meeting-participant`).
- Khách mời bên ngoài **không thể** là Host hoặc Organizer của meeting, vì `meetings.organizer_id`/`meetings.host_id` chỉ tham chiếu `users.id`. Do đó, KHÔNG cần logic "bảo vệ Host/Organizer" như ở luồng gỡ internal participant.
- Khách mời bên ngoài **không thể** là owner của bất kỳ agenda item nào, vì `meeting_agendas.owner_id` chỉ tham chiếu `users.id`. Do đó, KHÔNG cần kiểm tra "agenda owner" như ở luồng gỡ internal participant.
- Cột `email` trên `meeting_external_participants` có thể là `null` (theo schema hiện tại); nếu vậy, bước gửi email thông báo được bỏ qua một cách an toàn, không làm fail thao tác gỡ.
- Email notification xử lý async qua `notifications` và `background_jobs`, enqueue sau khi transaction chính commit (best-effort), mirror pattern thực tế của `removeParticipant` (internal) trong code hiện tại.
- Permission code mới `meeting.participant.remove.external` cần được seed; việc tạo seed cụ thể thuộc phạm vi `/speckit.plan`.
- Giá trị enum mới `external_participant_removed` cho `meeting_events.event_type` là giá trị ứng dụng mới trên cột `varchar(60)`, không cần migration.

### 1.5 Cần làm rõ

- Có cần lưu lại bản ghi "đã từng là khách mời" (audit trail mềm) ngoài `audit_logs`/`meeting_events` không, hay hard delete + 2 bảng log đó là đủ? (Spec này theo phương án hard delete + log, mirror quyết định đã áp dụng cho internal participant.)

---

## 2. Actors & Permissions

### 2.1 Danh sách actor

| Actor | Vai trò | Quyền trong tính năng |
|---|---|---|
| Organizer | Người tạo cuộc họp | Được phép gỡ khách mời bên ngoài khỏi meeting mình tạo |
| Internal Employee (Host) | Người chủ trì cuộc họp | Được phép gỡ khách mời bên ngoài khỏi meeting mình chủ trì |
| System Admin / Meeting Manager | Có quyền `meeting.participant.remove.external` | Được phép gỡ khách mời bên ngoài khỏi meeting thuộc phạm vi quản lý |
| External Participant | Khách mời bên ngoài (đối tượng bị gỡ) | Không phải actor của API này; không có tài khoản, không thể tự thực hiện hành động |

### 2.2 Permission rule

- Permission đề xuất: `meeting.participant.remove.external` (mới, mirror cách đặt tên của `meeting.participant.add.external`).
- Organizer được gỡ khách mời bên ngoài của meeting mình tạo (kiểm tra `meetings.organizer_id`).
- Host được gỡ khách mời bên ngoài của meeting mình chủ trì (kiểm tra `meetings.host_id`).
- Admin/Meeting Manager được gỡ khách mời bên ngoài nếu có permission `meeting.participant.remove.external`.
- **Không áp dụng** rule "bảo vệ Host/Organizer" hoặc rule giới hạn theo `visibility_level='private'` riêng cho remove — mirror đúng hành vi hiện có của `removeParticipant` (internal), nơi chỉ kiểm tra ownership/permission, không kiểm tra visibility.

### 2.3 Actor Constraints

- Phải được xác thực (JWT hợp lệ).
- Phải có quyền `meeting.participant.remove.external` hoặc là Organizer/Host của meeting đó.
- Chỉ thao tác được trên meeting có status là `scheduled`.

---

## 3. User Stories

- **US-01**: Với vai trò Organizer/Host, tôi muốn gỡ một khách mời bên ngoài khỏi danh sách tham dự khi họ không còn tham gia được, để danh sách khách mời chính xác trước khi họp.
- **US-02**: Với vai trò Meeting Manager có quyền phù hợp, tôi muốn gỡ khách mời bên ngoài khỏi meeting thuộc phạm vi quản lý của mình nếu có lý do chính đáng.
- **US-03**: Với vai trò khách mời bên ngoài, tôi muốn nhận email thông báo khi bị gỡ khỏi cuộc họp (nếu hệ thống có email của tôi), để biết mình không cần tham dự nữa.

---

## 4. Functional Requirements

> Viết theo chuẩn EARS. Keyword EARS giữ bằng tiếng Anh, nội dung nghiệp vụ viết bằng tiếng Việt.

### 4.1 Authentication & Authorization

**FR-001**: THE system SHALL yêu cầu xác thực người dùng trước khi cho phép thực hiện thao tác gỡ khách mời bên ngoài khỏi meeting.

**FR-002**: IF người dùng chưa được xác thực, THEN THE system SHALL từ chối yêu cầu và trả về lỗi 401 Unauthorized.

**FR-003**: THE system SHALL kiểm tra quyền `meeting.participant.remove.external` HOẶC quyền sở hữu (Organizer/Host) trước khi cho phép thực hiện thao tác gỡ khách mời bên ngoài.

**FR-004**: IF người dùng đã xác thực nhưng không có quyền `meeting.participant.remove.external` và không phải Organizer/Host của meeting đó, THEN THE system SHALL từ chối yêu cầu và trả về lỗi 403 Forbidden.

### 4.2 Validation

**FR-005**: IF giá trị `meetingId` trong path không đúng định dạng UUID, THEN THE system SHALL từ chối yêu cầu và trả về lỗi 400 Bad Request.

**FR-006**: IF giá trị `externalParticipantId` trong path không đúng định dạng UUID, THEN THE system SHALL từ chối yêu cầu và trả về lỗi 400 Bad Request.

**FR-007**: IF meeting với `meetingId` không tồn tại trong hệ thống hoặc đã bị soft-delete, THEN THE system SHALL từ chối yêu cầu và trả về lỗi 404 `MEETING_NOT_FOUND`.

**FR-008**: IF `externalParticipantId` không tồn tại trong `meeting_external_participants` của đúng `meetingId` đó, THEN THE system SHALL từ chối yêu cầu và trả về lỗi 404 `EXTERNAL_PARTICIPANT_NOT_IN_MEETING`.

### 4.3 State Validation

**FR-009**: WHILE meeting đang ở trạng thái `scheduled`, THE system SHALL cho phép thực hiện thao tác gỡ khách mời bên ngoài.

**FR-010**: IF meeting không ở trạng thái `scheduled` (ví dụ `in_progress`, `completed`, `cancelled`), THEN THE system SHALL từ chối yêu cầu và trả về lỗi 409 Conflict với mã lỗi `MEETING_NOT_REMOVABLE`.

### 4.4 Applicability Clarifications

**FR-011**: THE system SHALL NOT thực hiện kiểm tra vai trò Host/Organizer cho target khi gỡ khách mời bên ngoài, vì `meeting_external_participants` không có liên kết với `meetings.organizer_id`/`meetings.host_id` (khách mời bên ngoài không thể là Host/Organizer).

**FR-012**: THE system SHALL NOT thực hiện kiểm tra quyền sở hữu agenda (`meeting_agendas.owner_id`) cho khách mời bên ngoài bị gỡ, vì cột này chỉ tham chiếu `users.id` (khách mời bên ngoài không thể sở hữu agenda item).

### 4.5 Business Logic

**FR-013**: WHEN tất cả điều kiện validate hợp lệ, THE system SHALL xóa (hard delete) bản ghi tương ứng khỏi `meeting_external_participants`.

**FR-014**: WHEN khách mời bên ngoài đã bị xóa khỏi `meeting_external_participants`, THE system SHALL ghi một record vào `meeting_events` với `event_type='external_participant_removed'` và `metadata_json` chứa `removedExternalParticipantId`, `removedByUserId`, `reason` (nếu có).

**FR-015**: WHEN khách mời bên ngoài đã bị xóa khỏi `meeting_external_participants`, THE system SHALL ghi một record vào `audit_logs` với action `remove_external_participant`, actor là người thực hiện, target là bản ghi participant đã bị gỡ.

**FR-016**: WHERE người dùng gửi kèm lý do (optional `reason` trong request body), THE system SHALL lưu lý do đó vào `metadata_json` của `meeting_events` và vào `audit_logs`.

### 4.6 Recurring Scope

**FR-017**: IF meeting thuộc một recurring series, THE system SHALL chỉ áp dụng việc gỡ khách mời bên ngoài cho meeting instance cụ thể được xác định bởi `meetingId`.

**FR-018**: IF request chỉ định `scope='series'` (gỡ khỏi toàn bộ recurring series), THEN THE system SHALL từ chối yêu cầu với lỗi 422 `RECURRING_SERIES_SCOPE_NOT_SUPPORTED`.

### 4.7 Transaction & Consistency

**FR-019**: WHEN thực hiện thao tác gỡ khách mời bên ngoài, THE system SHALL đảm bảo các bước (xóa participant, tạo `meeting_event`, tạo `audit_log`) nằm trong cùng một database transaction.

**FR-020**: IF bất kỳ bước nào trong transaction ở FR-019 thất bại, THEN THE system SHALL rollback toàn bộ transaction và trả về lỗi 500 Internal Server Error, đảm bảo không xảy ra trạng thái đã xóa participant nhưng thiếu event/audit log.

### 4.8 Idempotency & Concurrency

**FR-021**: IF yêu cầu gỡ khách mời bên ngoài đã được thực hiện trước đó (bản ghi không còn tồn tại trong `meeting_external_participants`), THEN THE system SHALL trả về lỗi 404 `EXTERNAL_PARTICIPANT_NOT_IN_MEETING` (idempotent-safe).

**FR-022**: WHEN hai yêu cầu gỡ cùng một `externalParticipantId` được gửi đồng thời, THE system SHALL xử lý tuần tự và chỉ yêu cầu đầu tiên thành công; yêu cầu thứ hai nhận lỗi 404 `EXTERNAL_PARTICIPANT_NOT_IN_MEETING`.

### 4.9 Notification

**FR-023**: WHEN khách mời bên ngoài đã bị gỡ thành công VÀ bản ghi có `email` không null, THE system SHALL enqueue một thông báo email (qua `notifications` + `background_jobs`) với `notification_type='meeting_participant_removed'` gửi tới email đó.

**FR-024**: IF bản ghi khách mời bị gỡ có `email` là null, THEN THE system SHALL bỏ qua bước gửi email thông báo và đánh dấu `notificationQueued=false` trong response, mà KHÔNG làm fail thao tác gỡ.

**FR-025**: IF việc enqueue thông báo email ở FR-023 thất bại sau khi transaction chính đã commit thành công, THEN THE system SHALL ghi log lỗi và KHÔNG rollback thao tác gỡ đã thành công.

### 4.10 Response Contract

**FR-026**: WHEN thao tác gỡ khách mời bên ngoài thành công, THE system SHALL trả về HTTP 200 với response body chứa `meetingId`, `removedExternalParticipantId`, `removed=true`, `removedAt` (ISO-8601), `notificationQueued`, và `notificationId`/`backgroundJobId` nếu có.

**FR-027**: THE system SHALL trả về response theo format chuẩn của dự án: `{ success: true, message: "...", data: { ... } }`.

### 4.11 Traceability

| Requirement ID | EARS Pattern | Ghi chú |
|---|---|---|
| FR-001 | Ubiquitous | Luôn cần auth |
| FR-002 | Unwanted Behavior | Auth failure |
| FR-003 | Ubiquitous | Authorization check |
| FR-004 | Unwanted Behavior | Permission denied |
| FR-005 | Unwanted Behavior | Invalid meetingId UUID |
| FR-006 | Unwanted Behavior | Invalid externalParticipantId UUID |
| FR-007 | Unwanted Behavior | Meeting not found |
| FR-008 | Unwanted Behavior | Participant not in meeting |
| FR-009 | State-driven | Allowed state |
| FR-010 | Unwanted Behavior | Wrong state |
| FR-011 | Ubiquitous | No Host/Organizer check needed |
| FR-012 | Ubiquitous | No agenda-owner check needed |
| FR-013 | Event-driven | Hard delete participant |
| FR-014 | Event-driven | Meeting event record |
| FR-015 | Event-driven | Audit log record |
| FR-016 | Optional Feature | Optional reason |
| FR-017 | Event-driven | Recurring instance-only |
| FR-018 | Unwanted Behavior | Recurring series-wide rejected |
| FR-019 | Ubiquitous | Transactional guarantee |
| FR-020 | Unwanted Behavior | Rollback on failure |
| FR-021 | Unwanted Behavior | Idempotent remove |
| FR-022 | Unwanted Behavior | Concurrent remove |
| FR-023 | Event-driven | Email notification |
| FR-024 | Unwanted Behavior | Skip notification when no email |
| FR-025 | Unwanted Behavior | Notification failure isolation |
| FR-026 | Event-driven | Success response |
| FR-027 | Ubiquitous | Response format |

---

## 5. Non-Functional Requirements

### 5.1 Security

**NFR-001**: THE system SHALL enforce authentication cho mọi request đến endpoint này.

**NFR-002**: THE system SHALL enforce authorization dựa trên permission `meeting.participant.remove.external` hoặc quyền sở hữu (Organizer/Host).

**NFR-003**: THE system SHALL NOT trả về thông tin nhạy cảm (token, password hash, internal error stack) trong response.

### 5.2 Consistency

**NFR-004**: THE system SHALL đảm bảo tính nhất quán giữa `meeting_external_participants`, `meeting_events`, `audit_logs` trong cùng một business transaction.

### 5.3 Auditability

**NFR-005**: THE system SHALL ghi audit log cho mọi thao tác gỡ khách mời bên ngoài thành công.

**NFR-006**: THE system SHALL lưu đầy đủ thông tin trong audit log: actor_id, action, target_type, target_id, details, ip_address (nếu có), timestamp.

### 5.4 Idempotency & Concurrency

**NFR-007**: THE system SHALL xử lý an toàn khi nhận nhiều yêu cầu gỡ cùng một khách mời bên ngoài đồng thời: chỉ một request thành công, các request còn lại nhận lỗi 404.

### 5.5 Notification Reliability

**NFR-008**: THE system SHALL enqueue notification email sau khi transaction chính đã commit thành công (best-effort). IF background job gửi email thất bại sau đó, THEN THE system SHALL ghi nhận lỗi và cho phép retry job, không rollback thao tác gỡ.

### 5.6 Performance

**NFR-009**: THE system SHALL hoàn thành thao tác gỡ khách mời bên ngoài (không tính bước notification async) trong vòng dưới 2 giây dưới tải bình thường.

**NFR-010**: THE system SHALL xử lý tối thiểu 30 request gỡ khách mời bên ngoài đồng thời mà không làm ảnh hưởng đến các thao tác meeting khác.

---

## 6. API Contract đề xuất

### 6.1 Endpoint

```
DELETE /api/v1/meetings/{meetingId}/participants/external/{externalParticipantId}
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
| externalParticipantId | UUID | Có | ID bản ghi `meeting_external_participants` cần gỡ |

### 6.4 Optional Body

```json
{
  "reason": "Khách hàng báo bận, không thể tham dự",
  "scope": "instance"
}
```

| Field | Type | Bắt buộc | Mô tả |
|---|---:|---:|---|
| reason | string (max 1000, nullable) | Không | Lý do gỡ khách mời |
| scope | enum (`instance` \| `series`) | Không, default `instance` | Phạm vi áp dụng cho recurring meeting; chỉ `instance` được hỗ trợ |

### 6.5 Success Response (200 OK)

```json
{
  "success": true,
  "message": "Đã gỡ bỏ khách mời bên ngoài khỏi cuộc họp thành công",
  "data": {
    "meetingId": "uuid",
    "removedExternalParticipantId": "uuid",
    "removed": true,
    "removedAt": "2026-06-25T10:00:00.000Z",
    "notificationQueued": true,
    "notificationId": "uuid",
    "backgroundJobId": "uuid"
  }
}
```

Khi bản ghi không có email (`notificationQueued=false`):

```json
{
  "success": true,
  "message": "Đã gỡ bỏ khách mời bên ngoài khỏi cuộc họp thành công",
  "data": {
    "meetingId": "uuid",
    "removedExternalParticipantId": "uuid",
    "removed": true,
    "removedAt": "2026-06-25T10:00:00.000Z",
    "notificationQueued": false,
    "notificationId": null,
    "backgroundJobId": null
  }
}
```

### 6.6 Error Responses

| Status | Mã lỗi | Điều kiện |
|---|---:|---|
| 400 | INVALID_UUID | `meetingId` hoặc `externalParticipantId` không đúng định dạng UUID |
| 400 | VALIDATION_ERROR | `reason` vượt quá độ dài cho phép |
| 401 | UNAUTHENTICATED | Thiếu hoặc token hết hạn |
| 403 | FORBIDDEN | Không có quyền `meeting.participant.remove.external` và không phải Organizer/Host |
| 404 | MEETING_NOT_FOUND | Meeting không tồn tại |
| 404 | EXTERNAL_PARTICIPANT_NOT_IN_MEETING | Khách mời bên ngoài không có trong meeting đó |
| 409 | MEETING_NOT_REMOVABLE | Meeting không ở trạng thái `scheduled` |
| 422 | RECURRING_SERIES_SCOPE_NOT_SUPPORTED | Cố gắng gỡ khách mời khỏi toàn bộ recurring series |
| 500 | INTERNAL_ERROR | Lỗi server không xác định |

---

## 7. Data Model Impact

### 7.1 Entity liên quan

| Entity / Table | Vai trò | Thao tác |
|---|---|---|
| `meeting_external_participants` | Lưu khách mời bên ngoài | DELETE row của target |
| `meetings` | Đọc trạng thái, `organizer_id`, `host_id` | READ ONLY |
| `meeting_events` | Ghi lại sự kiện `external_participant_removed` | INSERT |
| `audit_logs` | Ghi lại hành động audit | INSERT |
| `notifications` | Tạo thông báo email cho khách mời bị gỡ (nếu có email) | INSERT (conditional) |
| `background_jobs` | Enqueue job gửi email (nếu có email) | INSERT (conditional) |

### 7.2 Dữ liệu đầu vào

| Field | Type | Bắt buộc | Mô tả |
|---|---:|---:|---|
| meetingId | UUID | Có | ID cuộc họp (path param) |
| externalParticipantId | UUID | Có | ID bản ghi khách mời bên ngoài cần gỡ (path param) |
| reason | string (nullable) | Không | Lý do gỡ (optional body) |
| scope | string (nullable) | Không | Phạm vi áp dụng, default `instance` |

### 7.3 Dữ liệu đầu ra

| Field | Type | Mô tả |
|---|---:|---|
| meetingId | UUID | ID cuộc họp |
| removedExternalParticipantId | UUID | ID bản ghi khách mời đã bị gỡ |
| removed | boolean | Luôn là `true` khi thành công |
| removedAt | ISO-8601 | Thời điểm gỡ |
| notificationQueued | boolean | `true` nếu email notification đã được enqueue, `false` nếu bản ghi không có email |
| notificationId | UUID \| null | ID notification đã tạo, `null` nếu không có email |
| backgroundJobId | UUID \| null | ID background job đã enqueue, `null` nếu không có email |

### 7.4 Data Constraints

- `meeting_external_participants` không có cột `deleted_at`; thao tác remove là hard delete.
- Không thêm bảng mới, không sửa schema hiện tại.
- Permission mới `meeting.participant.remove.external` cần seed migration (thuộc phạm vi `/speckit.plan`).
- `meeting_events.event_type` dùng giá trị mới `external_participant_removed` (ứng dụng-level, cột `varchar(60)`, không cần migration).
- `notifications.notification_type` dùng giá trị có sẵn `meeting_participant_removed` (đã tồn tại trong enum `NotificationType`, dùng chung với luồng remove internal participant).

### 7.5 Data Lifecycle

- `meeting_external_participants`: row bị xóa ngay khi thao tác thành công.
- `meeting_events`: insert với `event_type='external_participant_removed'` để trace lịch sử.
- `audit_logs`: insert để phục vụ kiểm tra sau này.
- `notifications` + `background_jobs`: insert có điều kiện (chỉ khi bản ghi có email) sau khi transaction chính commit, để gửi email thông báo bất đồng bộ.

---

## 8. Business Rules

**BR-01 (Ownership)**: Chỉ Organizer, Host (của meeting đó), hoặc actor có permission `meeting.participant.remove.external` mới được gỡ khách mời bên ngoài.

**BR-02 (Pre-meeting only)**: Feature chỉ áp dụng cho meeting ở trạng thái `scheduled`. Meeting đã `in_progress`, `completed`, hoặc `cancelled` sẽ bị từ chối.

**BR-03 (Hard delete)**: Remove là hard delete khỏi `meeting_external_participants`; lịch sử được lưu qua `meeting_events` và `audit_logs`.

**BR-04 (External only)**: Chỉ áp dụng cho khách mời bên ngoài trong `meeting_external_participants`; không áp dụng cho internal participant (`meeting_participants`, đã có feature riêng).

**BR-05 (No Host/Organizer protection needed)**: Không cần logic bảo vệ Host/Organizer như luồng internal, vì khách mời bên ngoài không thể giữ các vai trò đó (FK của `meetings.organizer_id`/`host_id` chỉ tham chiếu `users.id`).

**BR-06 (No agenda-owner check needed)**: Không cần kiểm tra agenda ownership như luồng internal, vì khách mời bên ngoài không thể là `owner_id` của `meeting_agendas` (FK chỉ tham chiếu `users.id`).

**BR-07 (Transactional integrity)**: Xóa participant, tạo `meeting_event`, tạo `audit_log` phải nằm trong cùng một database transaction.

**BR-08 (Notification async, graceful skip)**: Thao tác gỡ thành công không phụ thuộc vào việc email đã được gửi xong. Nếu bản ghi không có email, bỏ qua bước notification một cách an toàn (không lỗi).

**BR-09 (Recurring instance scope)**: Feature chỉ áp dụng cho một meeting instance cụ thể được xác định bởi `meetingId`. Không cascade sang toàn bộ recurring series.

---

## 9. Acceptance Criteria

> Format Given / When / Then.

### 9.1 Happy Path

**AC-01 - Gỡ thành công (có email)**:
Given Organizer/Host/Manager đã đăng nhập và có quyền,
And meeting đang ở trạng thái `scheduled`,
And target external participant tồn tại trong `meeting_external_participants` với email không null,
When actor gửi request DELETE `/api/v1/meetings/{meetingId}/participants/external/{externalParticipantId}`,
Then hệ thống trả về HTTP 200,
And bản ghi bị xóa khỏi `meeting_external_participants`,
And `meeting_events` có record `external_participant_removed`,
And `audit_logs` có record thao tác,
And `notifications` + `background_jobs` có record email job với `notificationQueued=true`.

**AC-02 - Gỡ thành công (không có email)**:
Given target external participant có `email=null`,
When actor gửi request gỡ hợp lệ,
Then hệ thống trả về HTTP 200 với `notificationQueued=false`, `notificationId=null`, `backgroundJobId=null`,
And bản ghi vẫn bị xóa khỏi `meeting_external_participants` và `meeting_events`/`audit_logs` vẫn được ghi.

**AC-03 - Khách mời không còn trong danh sách**:
Given AC-01 đã thành công,
When gọi API xem chi tiết cuộc họp (`GET /me/schedule/:meetingId`),
Then target external participant không còn xuất hiện trong `externalParticipants`.

### 9.2 Authorization Cases

**AC-04 - Không có quyền**:
Given actor không phải Organizer/Host và không có permission `meeting.participant.remove.external`,
When actor gửi request gỡ,
Then hệ thống trả về HTTP 403,
And không có thay đổi dữ liệu nào xảy ra.

### 9.3 State Validation Cases

**AC-05 - Meeting sai trạng thái**:
Given meeting đang ở trạng thái `in_progress`, `completed`, hoặc `cancelled`,
When actor gửi request gỡ,
Then hệ thống trả về HTTP 409 `MEETING_NOT_REMOVABLE`,
And bản ghi không bị xóa.

### 9.4 Validation Cases

**AC-06 - Participant không thuộc meeting**:
Given `externalParticipantId` không tồn tại trong `meeting_external_participants` của `meetingId` đó,
When actor gửi request gỡ,
Then hệ thống trả về HTTP 404 `EXTERNAL_PARTICIPANT_NOT_IN_MEETING`.

**AC-07 - Invalid UUID**:
Given `meetingId` hoặc `externalParticipantId` không đúng định dạng UUID,
When gửi request DELETE,
Then hệ thống trả về HTTP 400 Bad Request.

**AC-08 - Participant thuộc meeting khác**:
Given `externalParticipantId` tồn tại nhưng thuộc một `meetingId` khác,
When actor gửi request gỡ với `meetingId` không khớp,
Then hệ thống trả về HTTP 404 `EXTERNAL_PARTICIPANT_NOT_IN_MEETING` (không tiết lộ sự tồn tại ở meeting khác).

### 9.5 Concurrency / Idempotency Cases

**AC-09 - Gỡ lặp lại**:
Given khách mời đã bị gỡ thành công trước đó,
When gửi lại request gỡ cùng `externalParticipantId`,
Then hệ thống trả về HTTP 404 `EXTERNAL_PARTICIPANT_NOT_IN_MEETING`.

**AC-10 - Hai request đồng thời**:
Given hai request gỡ cùng `externalParticipantId` được gửi gần như đồng thời,
When hệ thống xử lý,
Then chỉ một request thành công (HTTP 200),
And request còn lại nhận HTTP 404 `EXTERNAL_PARTICIPANT_NOT_IN_MEETING`.

### 9.6 Recurring Meeting Scope

**AC-11 - Gỡ khỏi một occurrence**:
Given meeting là một occurrence trong recurring series,
When actor gỡ khách mời bên ngoài khỏi occurrence đó,
Then khách mời chỉ bị gỡ khỏi occurrence đó,
And khách mời vẫn còn trong các occurrence khác của series.

**AC-12 - Series-wide bị từ chối**:
Given request chỉ định `scope='series'`,
When gọi API,
Then hệ thống trả về HTTP 422 `RECURRING_SERIES_SCOPE_NOT_SUPPORTED`.

### 9.7 Traceability

| AC ID | Requirement ID liên quan | Kịch bản test |
|---|---|---|
| AC-01 | FR-001, FR-003, FR-009, FR-013, FR-014, FR-015, FR-019, FR-023, FR-026 | Gỡ thành công, có email |
| AC-02 | FR-024 | Gỡ thành công, không có email |
| AC-03 | FR-013 | Participant không còn trong list |
| AC-04 | FR-004 | Không có quyền |
| AC-05 | FR-010 | Sai trạng thái meeting |
| AC-06 | FR-008 | Participant không thuộc meeting |
| AC-07 | FR-005, FR-006 | Invalid UUID |
| AC-08 | FR-008 | Participant thuộc meeting khác |
| AC-09 | FR-021 | Gỡ lặp lại idempotent |
| AC-10 | FR-022 | Concurrency |
| AC-11 | FR-017 | Remove từ một occurrence |
| AC-12 | FR-018 | Series-wide bị từ chối |

---

## 10. Edge Cases

| # | Edge Case | Expected Behavior |
|---|---|---|
| EC-01 | `externalParticipantId` hợp lệ nhưng thuộc meeting khác | Trả về 404 `EXTERNAL_PARTICIPANT_NOT_IN_MEETING`, không tiết lộ thông tin meeting khác |
| EC-02 | Meeting không tồn tại | Trả về 404 `MEETING_NOT_FOUND` |
| EC-03 | Khách mời đã bị gỡ trước đó | Trả về 404 `EXTERNAL_PARTICIPANT_NOT_IN_MEETING` |
| EC-04 | Meeting `scheduled` nhưng `start_time` đã qua | Vẫn cho phép gỡ vì status còn là `scheduled` (không check `start_time`) |
| EC-05 | Bản ghi khách mời có `email=null` | Gỡ thành công, bỏ qua bước gửi email, `notificationQueued=false` |
| EC-06 | Notification enqueue thất bại sau khi transaction đã commit | Bản ghi vẫn bị xóa, lỗi được log, không rollback |
| EC-07 | Hai request đồng thời gỡ cùng participant | Request đầu thành công, request thứ hai nhận 404 |
| EC-08 | `reason` quá dài (>1000 ký tự) | Trả về 400 Bad Request validation error |
| EC-09 | Meeting thuộc recurring series, chỉ gỡ một instance | Gỡ chỉ áp dụng cho occurrence cụ thể, không ảnh hưởng occurrence khác |
| EC-10 | Request series-wide removal | Từ chối với 422 `RECURRING_SERIES_SCOPE_NOT_SUPPORTED` |
| EC-11 | Actor là Organizer/Host nhưng khách mời được người khác thêm vào (không phải actor) | Vẫn cho phép gỡ; bảng `meeting_external_participants` không có cột `created_by`/`invited_by` nên không có ràng buộc "chỉ người thêm mới được gỡ" |
| EC-12 | `meetingId` hợp lệ nhưng meeting đã bị soft-delete (`deleted_at` không null) | Trả về 404 `MEETING_NOT_FOUND`, coi như không tồn tại |

---

## 11. Out of Scope

Các nội dung sau **không thuộc phạm vi** của feature này:

### 11.1 Không triển khai trong feature này

- **Gỡ thành viên nội bộ** — đã có feature riêng `feat-remove-internal-meeting-participant`.
- **Thêm khách mời bên ngoài** — feature riêng `feat-add-external-meeting-participant`.
- **Cập nhật thông tin khách mời bên ngoài** (sửa tên/email/SĐT) trước khi gỡ.
- **Thay đổi `participant_role`** của bất kỳ participant nào.
- **Gỡ khách mời khỏi toàn bộ recurring series** — chỉ hỗ trợ gỡ theo từng instance cụ thể.
- **Tạo file `.ics` cancellation** đính kèm thông báo gỡ.
- **Đồng bộ với calendar bên ngoài** (Google Calendar, Outlook).
- **Khôi phục (undo) khách mời đã bị gỡ** — vì là hard delete, không có soft delete/restore trong tính năng này.
- **Logic "bảo vệ Host/Organizer"** — không áp dụng vì khách mời bên ngoài không thể giữ các vai trò đó.
- **Kiểm tra agenda ownership** — không áp dụng vì khách mời bên ngoài không thể sở hữu agenda item.

### 11.2 Có thể xem xét ở feature khác

- Feature cho phép khôi phục khách mời bên ngoài vừa bị gỡ trong một khoảng thời gian ngắn (undo window).
- Feature gửi thông báo qua kênh khác (SMS) khi gỡ khách mời bên ngoài không có email.

### 11.3 Out-of-scope EARS Guardrails

**OOS-001**: THE system SHALL NOT thực hiện chức năng cập nhật thông tin khách mời bên ngoài như một phần của feature này.

**OOS-002**: THE system SHALL NOT tạo bảng mới hoặc thêm cột mới vào schema database hiện tại.

**OOS-003**: THE system SHALL NOT xử lý việc gỡ internal participant (`meeting_participants`) trong feature này.

**OOS-004**: THE system SHALL NOT remove khách mời bên ngoài khỏi toàn bộ recurring series; chỉ hỗ trợ gỡ theo instance cụ thể.

**OOS-005**: THE system SHALL NOT generate hoặc đính kèm file `.ics` cancellation như một phần của feature này.

**OOS-006**: THE system SHALL NOT đồng bộ với hệ thống calendar bên ngoài (Google Calendar, Outlook) cho việc gỡ event tự động.

**OOS-007**: THE system SHALL NOT cung cấp cơ chế khôi phục (undo/restore) khách mời bên ngoài đã bị gỡ.

---

## 12. Assumptions / Clarifications Resolved

### Assumptions

| # | Assumption | Ghi chú |
|---|---|---|
| A-01 | Feature chỉ áp dụng khi meeting status là `scheduled`. | Mirror quyết định đã áp dụng cho internal participant removal. |
| A-02 | Remove là hard delete row khỏi `meeting_external_participants`. | Bảng hiện tại không có `deleted_at`; lịch sử lưu qua `meeting_events`/`audit_logs`. |
| A-03 | Không cần logic bảo vệ Host/Organizer. | Khách mời bên ngoài không thể giữ các vai trò đó (FK chỉ tham chiếu `users.id`). |
| A-04 | Không cần kiểm tra agenda ownership. | Khách mời bên ngoài không thể là `owner_id` của `meeting_agendas`. |
| A-05 | Email notification được enqueue sau khi transaction commit (best-effort). | Mirror pattern thực tế đã implement cho `removeParticipant` (internal) trong code hiện tại. |
| A-06 | Nếu bản ghi không có email, bỏ qua bước notification một cách an toàn. | `email` là nullable trong schema hiện tại của `meeting_external_participants`. |
| A-07 | Permission `meeting.participant.remove.external` là permission mới, cần seed migration riêng. | Thuộc phạm vi `/speckit.plan`. |

### Clarifications Resolved

| # | Vấn đề cần làm rõ | Quyết định |
|---|---|---|
| C-01 | Có cho phép `reason` optional không? | Có. Optional body `{reason?: string}`, không bắt buộc. |
| C-02 | Feature có áp dụng cho recurring series không? | Chỉ áp dụng cho một meeting instance cụ thể. Series-wide removal là out of scope. |
| C-03 | Có cần kiểm tra Host/Organizer protection không? | Không cần — khách mời bên ngoài không thể là Host/Organizer. |
| C-04 | Có cần kiểm tra agenda owner không? | Không cần — khách mời bên ngoài không thể sở hữu agenda item. |
| C-05 | Xử lý thế nào nếu khách mời không có email? | Bỏ qua bước gửi email, vẫn gỡ thành công, trả về `notificationQueued=false`. |
| C-06 | Permission code dùng tên gì? | `meeting.participant.remove.external`, mirror naming của `meeting.participant.add.external`. |

---

## 13. Readiness Checklist

- [x] Spec đã có đầy đủ các phần chính (Feature Overview, Actors, User Stories, Functional Requirements, Non-Functional Requirements, API Contract, Data Model, Business Rules, Acceptance Criteria, Edge Cases, Out of Scope, Assumptions).
- [x] Functional Requirements viết theo EARS với keyword tiếng Anh, nội dung tiếng Việt.
- [x] Đã có đủ 5 EARS basic patterns: Ubiquitous, Event-driven, State-driven, Optional Feature, Unwanted Behavior.
- [x] Mỗi requirement có mã ID rõ ràng (27 FR).
- [x] Requirement có thể kiểm thử được (testable).
- [x] Không mô tả quá sâu implementation.
- [x] Không tự ý thêm feature ngoài phạm vi đã nêu (xem mục 11 Out of Scope).
- [x] Không tự ý thêm database table/field mới.
- [x] Error handling đã bao gồm validation, authentication, authorization, business rule, conflict.
- [x] Acceptance Criteria dùng Given / When / Then (12 AC).
- [x] Traceability đã liên kết AC với FR liên quan.
- [x] Out of Scope đủ rõ ràng để tránh agent tự mở rộng.
- [x] Đã có phần Assumptions ghi rõ các giả định, bao gồm việc thiếu UC chính thức trong nguồn tài liệu.
- [x] Đã bao phủ 12 edge case.
- [x] API Contract đã đề xuất rõ ràng kèm error table.
- [x] Permission mới `meeting.participant.remove.external` đã được xác định, cần seed ở `/speckit.plan`.
- [x] Sẵn sàng cho bước `/speckit.plan`.
