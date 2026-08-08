# Feature Specification: UC-MM-02 — Cập nhật thời gian họp

- **Feature ID**: MEETING-TIME-UPDATE-001
- **Feature Name**: update-meeting-time
- **Module / Domain**: meetings
- **Created Date**: 2026-06-09
- **Status**: Draft
- **Source Documents**:
  - User request specification (2026-06-09)
  - AGENTS.md (Backend Agent Guide v1.1)
  - Database v3.2 Compact baseline

## CHANGELOG & REVISION HISTORY
| Ngày cập nhật | Tóm tắt thay đổi | Các dòng thay đổi |
| :--- | :--- | :--- |
| 2026-06-08 | Cập nhật quyết định clarify cho feature (recurring, capacity, suggested rooms, notification, enum, duration) | Các mục Out of Scope, Business Rules, Data Model, Notifications, Error Handling, EARS |
| 2026-08-08 | [Xử lý xung đột phòng/giờ họp — Nhóm A] Room conflict check chỉ tính booking `approved`/`active` là chặn; booking `pending` của meeting/request khác KHÔNG còn chặn (không tự động khiến phòng đang chọn biến mất khỏi danh sách gợi ý chỉ vì có request pending khác trùng giờ). Xem `KE_HOACH_XU_LY_XUNG_DOT_PHONG_GIO_HOP_2026-08-08.md` ở root repo. | Mục 18.1 (CONF-001, CONF-004) |
| 2026-08-08 | [Xử lý xung đột phòng/giờ họp — Nhóm B] Room conflict overlap logic (CONF-002) đổi từ `existing.start_at < new.end_at AND existing.end_at > new.start_at` sang có buffer: cần khoảng cách tối thiểu `bufferMinutes` phút (mặc định 15, `system_configs.room_booking_buffer_minutes`) giữa 2 booking `approved`/`active` liền kề cùng phòng — back-to-back không còn hợp lệ. | Mục 18.1 (CONF-002, CONF-002b mới) |

---

## 1. Feature Overview

Tính năng cho phép người dùng có quyền quản lý cuộc họp thay đổi ngày họp, giờ bắt đầu hoặc giờ kết thúc của một cuộc họp đã được lên lịch từ trước. Khi thay đổi thời gian, hệ thống phải kiểm tra hợp lệ thời gian mới, kiểm tra quyền thao tác, kiểm tra trạng thái cuộc họp, kiểm tra phòng họp hiện tại có còn khả dụng trong khung giờ mới không, cập nhật booking phòng tương ứng, giải phóng khung giờ cũ, giữ khung giờ mới và tạo thông báo cập nhật lịch họp cho toàn bộ người tham gia.

Tính năng này thuộc module **meetings** và nằm trong nhóm use case quản lý vòng đời cuộc họp sau khi đã scheduled. Feature phục vụ giai đoạn **trước cuộc họp** (pre-meeting) của meeting lifecycle, khi lịch họp cần điều chỉnh do thay đổi kế hoạch công việc của người chủ trì hoặc các bên liên quan.

---

## 2. Use Case Metadata

| Field | Value |
|---|---|
| Use Case ID | UC-MM-02 |
| Use Case Name | Cập nhật thời gian họp |
| Domain | Meeting Management |
| Actor Primary | Internal Employee, Manager |
| Trigger | Kế hoạch làm việc thay đổi (người chủ trì bận đột xuất, đối tác đến muộn, v.v.) |
| Priority | High |
| Complexity | Medium |
| Estimated Effort | 3-5 story points |

---

## 3. Actors and Permissions

### 3.1 Danh sách Actor

| Actor | Vai trò trong tính năng | Quyền / Trách nhiệm chính |
|---|---|---|
| Creator / Organizer | Người tạo cuộc họp | Có quyền thay đổi thời gian cuộc họp của mình |
| Host | Người chủ trì cuộc họp | Có quyền thay đổi thời gian cuộc họp được giao làm host |
| Admin | Quản trị viên hệ thống | Có quyền can thiệp lịch, override permission |
| Participant | Người tham gia cuộc họp | Không có quyền thay đổi thời gian |

### 3.2 Permission Matrix

| Permission | Creator/Organizer | Host | Admin | Participant |
|---|---|---|---|---|
| `meeting.time.update` | ✅ (trên meeting của mình) | ✅ (trên meeting được giao) | ❌ | ❌ |
| `meeting.time.update.any` | ❌ | ❌ | ✅ | ❌ |

### 3.3 Permission Rules

- Creator/Organizer hoặc Host của meeting được phép sử dụng permission `meeting.time.update` để cập nhật thời gian cho meeting mà họ sở hữu hoặc được giao làm host.
- Admin sở hữu permission `meeting.time.update.any` được phép cập nhật thời gian cho bất kỳ meeting nào trong phạm vi được phép.
- Participant thường không có quyền thay đổi thời gian cuộc họp dưới bất kỳ hình thức nào.

### 3.4 Actor Constraints

- Người dùng phải đăng nhập (authenticated) trước khi sử dụng tính năng.
- Người dùng phải có permission phù hợp để thực hiện thao tác cập nhật.
- Người dùng chỉ được cập nhật thời gian cho meeting đang ở trạng thái `scheduled`.

---

## 4. Scope

### 4.1 Trong phạm vi

- Cho phép Creator/Organizer, Host, Admin cập nhật `start_time`, `end_time` của meeting đã scheduled.
- Cho phép đổi `room_id` khi phòng hiện tại không khả dụng trong khung giờ mới.
- Kiểm tra quyền thao tác trước khi xử lý.
- Kiểm tra trạng thái meeting phải là `scheduled`.
- Kiểm tra thời gian mới hợp lệ (startTime < endTime, không trong quá khứ).
- Kiểm tra phòng hiện tại/phòng mới có khả dụng trong khung giờ mới.
- Kiểm tra participant conflict và trả về soft warning nếu có.
- Cập nhật `meetings` và `room_bookings` trong cùng transaction.
- Tạo `meeting_events`, `audit_logs` cho mọi thao tác thành công.
- Tạo `notifications` và `background_jobs` để gửi thông báo cho participants.
- Hỗ trợ override participant conflict khi người dùng xác nhận.
- Hỗ trợ đổi phòng do room conflict (alternative flow A1).

### 4.2 Ngoài phạm vi

Xem mục 5. Out of Scope.

---

## 5. Out of Scope

Các nội dung sau **không thuộc phạm vi** của feature này:

- Tạo meeting mới.
- Duyệt/từ chối meeting request thủ công.
- Hủy meeting.
- Gia hạn (extend) meeting đang diễn ra.
- Chỉnh sửa title, description, agenda, participants, recording config.
- Tạo recurrence rule mới.
- Cập nhật toàn bộ chuỗi cuộc họp định kỳ.
- Cập nhật this-and-following occurrences.
- Tính toán lại recurrence rule.
- Re-generate booking cho nhiều occurrence.
- Implement gửi email provider thật; chỉ đặc tả tạo notification/job queue.
- Thêm bảng database mới.

### 5.1 Không triển khai trong feature này

- Không implement API endpoint mới ngoài `PATCH /api/v1/meetings/{meetingId}/time`.
- Không xử lý automatic no-show release khi đổi thời gian.
- Không xử lý recording auto-start/stop khi đổi thời gian.
- Không tạo bảng database mới.
- Không tạo bảng `schedule_conflicts` (conflict tính động).
- Không dùng bảng `notification_recipients` (lưu JSON trong notifications).
- Không thay đổi schema các bảng hiện có.

### 5.2 Có thể xem xét ở feature khác

- Chỉnh sửa toàn bộ chuỗi meeting định kỳ (recurring meeting series edit).
- Approval flow thủ công cho update time request.
- Tích hợp email provider thật để gửi notification.
- Tự động gợi ý phòng thay thế khi room conflict.

---

## 6. Preconditions

| ID | Điều kiện | Mô tả |
|---|---|---|
| PRE1 | Authenticated | Người dùng đã đăng nhập và có JWT token hợp lệ |
| PRE2 | Authorized | Người dùng là Creator/Organizer hoặc Host của cuộc họp, hoặc Admin có `meeting.time.update.any` |
| PRE3 | Meeting status | Cuộc họp mục tiêu đang ở trạng thái `scheduled` |
| PRE4 | Meeting not started | Cuộc họp chưa bắt đầu, chưa kết thúc, chưa bị hủy |
| PRE5 | Meeting exists | Meeting tồn tại và chưa bị soft delete |

---

## 7. Postconditions

| ID | Kết quả | Mô tả |
|---|---|---|
| POST1 | Meetings updated | `meetings.start_time` và `meetings.end_time` được cập nhật thành khung thời gian mới |
| POST2 | Booking updated | Booking phòng hiện tại trong `room_bookings` được cập nhật `reserved_start_time`, `reserved_end_time` |
| POST3 | Old slot freed | Khung giờ cũ của phòng được giải phóng |
| POST4 | New slot locked | Khung giờ mới của phòng được giữ/chốt nếu không có room conflict |
| POST5 | Event created | Hệ thống tạo `meeting_events` với `event_type = 'meeting_time_updated'` |
| POST6 | Audit logged | Hệ thống ghi `audit_logs` cho thao tác cập nhật |
| POST7 | Notification queued | Hệ thống tạo notification/background job để gửi thông báo cho participants |
| POST8 | Data preserved | Các thông tin khác của meeting (title, description, agenda, recording config, participants) không bị reset hoặc mất dữ liệu |

---

## 8. Main Success Scenario

1. Người dùng mở danh sách cuộc họp hoặc lịch cá nhân.
2. Người dùng chọn cuộc họp cần đổi thời gian.
3. Người dùng chọn chức năng "Chỉnh sửa cuộc họp".
4. Hệ thống hiển thị thông tin hiện tại của cuộc họp.
5. Người dùng thay đổi ngày họp, giờ bắt đầu hoặc giờ kết thúc.
6. Người dùng nhấn "Lưu thay đổi" hoặc "Cập nhật".
7. Hệ thống kiểm tra quyền thao tác.
8. Hệ thống kiểm tra trạng thái meeting phải là `scheduled`.
9. Hệ thống kiểm tra thời gian mới hợp lệ:

   - startTime < endTime
   - startTime không nằm trong quá khứ
   - endTime không nằm trong quá khứ
   - duration hợp lệ theo rule hệ thống nếu có
10. Hệ thống kiểm tra phòng hiện tại có khả dụng trong khung giờ mới không.
11. Hệ thống kiểm tra participant conflict.
12. Nếu participant conflict chỉ là soft warning, hệ thống trả warning cho client để người dùng xác nhận tiếp tục.
13. Nếu không có blocking conflict, hệ thống cập nhật `meetings`.
14. Hệ thống cập nhật `room_bookings` tương ứng.
15. Hệ thống tạo `meeting_events`.
16. Hệ thống tạo `audit_logs`.
17. Hệ thống tạo notification/background job để gửi email/in-app notification cho participants.
18. Hệ thống trả kết quả thành công.

---

## 9. Alternative Flows

### 9.1 A1 — Đổi phòng do room conflict

Tại bước kiểm tra phòng, nếu phòng hiện tại không khả dụng trong khung giờ mới:

1. Hệ thống trả lỗi hoặc cảnh báo blocking conflict: "Phòng họp hiện tại không khả dụng trong khung giờ mới."
2. Response cần có thông tin conflict và danh sách suggestedRooms nếu service hỗ trợ.
3. Người dùng có thể chọn phòng khác đang trống.
4. Khi user gửi lại request với `newRoomId`, hệ thống kiểm tra phòng mới.
5. Nếu phòng mới khả dụng, hệ thống cập nhật đồng thời:
   - `meetings.start_time`
   - `meetings.end_time`
   - `meetings.room_id`
   - `room_bookings.room_id`
   - `room_bookings.reserved_start_time`
   - `room_bookings.reserved_end_time`
6. Hệ thống tạo event/audit/notification như normal flow.

---

## 10. Exception Flows

### 10.1 E1 — Thời gian trong quá khứ

Nếu startTime hoặc endTime mới nằm trong quá khứ:

- Không cập nhật meeting.
- Không cập nhật room booking.
- Trả lỗi validation.
- Error code: `MEETING_TIME_IN_PAST`.
- HTTP status: `422 Unprocessable Entity`.
- Message: "Không thể dời lịch họp về thời điểm trong quá khứ."

### 10.2 E2 — Meeting đã bắt đầu, đã kết thúc hoặc đã bị hủy

Nếu meeting không còn ở trạng thái `scheduled`, ví dụ: `in_progress`, `completed`, `cancelled`:

- Không cho cập nhật thời gian dự kiến.
- Error code: `MEETING_STATUS_NOT_EDITABLE`.
- HTTP status: `409 Conflict`.
- Message: "Không thể thay đổi thời gian dự kiến cho cuộc họp đang diễn ra, đã kết thúc hoặc đã bị hủy. Vui lòng sử dụng chức năng Gia hạn nếu cần thêm thời gian."

### 10.3 E3 — Participant conflict soft warning

Nếu khung giờ mới trùng với lịch của một hoặc nhiều participant:

- Hệ thống không tự động block nếu conflict chỉ ở mức warning.
- Hệ thống trả response warning để client hiển thị: "Khung giờ mới trùng lịch với [Tên khách mời]. Bạn có muốn tiếp tục lưu?"
- Client có thể gửi lại request với `overrideParticipantConflict: true`.
- Nếu `overrideParticipantConflict: true`, hệ thống được phép tiếp tục lưu nếu không có room conflict hoặc policy block.

### 10.4 E4 — Không có quyền cập nhật

Nếu user không phải Creator/Organizer, Host hoặc Admin có quyền:

- Không cho cập nhật.
- Error code: `MEETING_TIME_UPDATE_FORBIDDEN`.
- HTTP status: `403 Forbidden`.
- Message: "Bạn không có quyền thay đổi thời gian cuộc họp này."

### 10.5 E5 — Room conflict blocking

Nếu phòng hiện tại hoặc phòng mới bị trùng booking trong khung giờ mới:

- Không cập nhật meeting.
- Không cập nhật booking.
- Error code: `ROOM_TIME_CONFLICT`.
- HTTP status: `409 Conflict`.
- Response nên chứa:
  - conflictedRoomId
  - requestedStartTime
  - requestedEndTime
  - conflicts[]
  - suggestedRooms[] nếu có
  - blocking: true

---

## 11. Functional Requirements

> Tất cả Functional Requirements viết theo EARS.
> Keyword EARS giữ bằng tiếng Anh. Nội dung nghiệp vụ viết bằng tiếng Việt.

### 11.1 Core Requirements (Ubiquitous)

```text
FR-001: THE system SHALL yêu cầu JWT Bearer token hợp lệ cho mọi request gửi đến endpoint cập nhật thời gian họp.
FR-002: THE system SHALL kiểm tra permission của người dùng trước khi thực hiện bất kỳ thay đổi nào lên dữ liệu.
FR-003: THE system SHALL đảm bảo mọi cập nhật `meetings` và `room_bookings` nằm trong cùng một database transaction.
FR-004: THE system SHALL bảo toàn toàn bộ dữ liệu không liên quan đến thời gian (title, description, agenda, participants, recording config) khi cập nhật thời gian họp.
FR-005: THE system SHALL tạo `meeting_events` với `event_type = 'meeting_time_updated'` cho mọi thao tác cập nhật thời gian thành công.
FR-006: THE system SHALL ghi `audit_logs` cho mọi thao tác cập nhật thời gian thành công.
```

### 11.2 Event-driven Requirements

```text
FR-007: WHEN người dùng gửi request PATCH đến endpoint `/api/v1/meetings/{meetingId}/time`, THE system SHALL kiểm tra quyền thao tác trước khi xử lý business logic.
FR-008: WHEN request cập nhật thời gian hợp lệ và không có blocking conflict, THE system SHALL cập nhật `meetings.start_time` và `meetings.end_time` thành giá trị mới.
FR-009: WHEN cập nhật `meetings` thành công, THE system SHALL cập nhật `room_bookings.reserved_start_time` và `room_bookings.reserved_end_time` tương ứng.
FR-010: WHEN request có chứa `newRoomId`, THE system SHALL kiểm tra phòng mới tồn tại, active và khả dụng trong khung giờ mới.
FR-011: WHEN cập nhật thời gian thành công và có thay đổi phòng, THE system SHALL cập nhật cả `meetings.room_id` và `room_bookings.room_id`.
FR-012: WHEN cập nhật thời gian thành công, THE system SHALL tạo notification với `notification_type = 'meeting_time_updated'` cho toàn bộ participants.
FR-013: WHEN notification được tạo, THE system SHALL tạo background job với `job_type = 'send_email'` nếu notification channel yêu cầu email.
FR-014: WHEN người dùng gửi request với `overrideParticipantConflict: true` và không có blocking conflict, THE system SHALL cho phép cập nhật tiếp tục.
FR-REC-001: WHEN the target meeting belongs to a recurring series, THE system SHALL update only the selected meeting instance identified by meetingId.
FR-REC-002: THE system SHALL NOT update meeting_recurrence_rules or other occurrences in the same series as part of UC-MM-02.
FR-REQ-001: WHEN the meeting time update is applied immediately without manual approval, THE system SHALL store the related meeting_requests record with approval_mode = 'auto' and approval_status = 'applied'.
```

### 11.3 State-driven Requirements

```text
FR-015: WHILE meeting đang ở trạng thái `scheduled`, THE system SHALL cho phép Creator/Organizer, Host và Admin cập nhật thời gian họp.
FR-016: WHILE meeting đang ở trạng thái `in_progress`, `completed` hoặc `cancelled`, THE system SHALL từ chối mọi request cập nhật thời gian.
FR-017: WHILE một request cập nhật thời gian đang được xử lý trong transaction, THE system SHALL kiểm tra room conflict lại ngay trước khi commit để tránh race condition.
```

### 11.4 Optional Feature Requirements

```text
FR-018: WHERE người dùng không gửi `newRoomId`, THE system SHALL giữ nguyên `room_id` hiện tại và kiểm tra khả dụng của phòng đó trong khung giờ mới.
FR-019: WHERE người dùng gửi `changeReason`, THE system SHALL lưu reason đó vào `audit_logs.metadata_json` và `meeting_events.new_value_json`.
```

### 11.5 Unwanted Behavior Requirements

```text
FR-020: IF meeting không tồn tại hoặc đã bị soft delete, THEN THE system SHALL trả về lỗi với error code `MEETING_NOT_FOUND` và HTTP status 404.
FR-021: IF người dùng không có quyền cập nhật thời gian cho meeting này, THEN THE system SHALL từ chối request với error code `MEETING_TIME_UPDATE_FORBIDDEN` và HTTP status 403.
FR-022: IF meeting không ở trạng thái `scheduled`, THEN THE system SHALL từ chối request với error code `MEETING_STATUS_NOT_EDITABLE` và HTTP status 409.
FR-023: IF `startTime` >= `endTime`, THEN THE system SHALL từ chối request với error code `INVALID_TIME_RANGE` và HTTP status 422.
FR-024: IF `startTime` hoặc `endTime` nằm trong quá khứ, THEN THE system SHALL từ chối request với error code `MEETING_TIME_IN_PAST` và HTTP status 422.
FR-025: IF phòng hiện tại hoặc phòng mới không khả dụng trong khung giờ mới, THEN THE system SHALL từ chối request với error code `ROOM_TIME_CONFLICT` và HTTP status 409.
FR-026: IF `newRoomId` được gửi nhưng phòng không tồn tại, THEN THE system SHALL từ chối request với error code `ROOM_NOT_FOUND` và HTTP status 404.
FR-027: IF `newRoomId` được gửi nhưng phòng đang inactive/maintenance, THEN THE system SHALL từ chối request với error code `ROOM_NOT_AVAILABLE` và HTTP status 409.
FR-028: IF participant conflict được phát hiện và `overrideParticipantConflict` là false hoặc không được gửi, THEN THE system SHALL trả response với error code `PARTICIPANT_TIME_CONFLICT_WARNING`, blocking: false và requiresConfirmation: true.
FR-029: IF không tìm thấy active booking record nào cho meeting trong `room_bookings`, THEN THE system SHALL vẫn cho phép cập nhật thời gian meeting và tạo booking mới, đồng thời ghi cảnh báo vào audit log.
FR-030: IF có race condition (request khác đã cập nhật cùng phòng/khoảng thời gian), THEN THE system SHALL rollback transaction và trả error code `ROOM_TIME_CONFLICT`.
FR-CAP-001: IF newRoomId is provided and the new room capacity is lower than the required attendee count, THEN THE system SHALL reject the update request with error code ROOM_CAPACITY_INSUFFICIENT and HTTP status 409.
FR-DUR-001: IF the requested meeting duration is shorter than 15 minutes or longer than 8 hours, THEN THE system SHALL reject the update request with error code MEETING_DURATION_OUT_OF_RANGE and HTTP status 422.
```

### 11.6 Authorization Requirements

```text
FR-031: IF request không có JWT token hoặc token không hợp lệ, THEN THE system SHALL trả về HTTP status 401 Unauthorized.
FR-032: IF người dùng đã authenticated nhưng không có permission `meeting.time.update` hoặc `meeting.time.update.any`, THEN THE system SHALL trả về HTTP status 403 Forbidden.
FR-033: WHEN người dùng sở hữu permission `meeting.time.update`, THE system SHALL chỉ cho phép cập nhật meeting mà họ là Creator/Organizer hoặc Host.
FR-034: WHEN người dùng sở hữu permission `meeting.time.update.any`, THE system SHALL cho phép cập nhật bất kỳ meeting nào.
```

### 11.7 Transaction & Consistency Requirements

```text
FR-035: WHEN cập nhật thời gian họp, THE system SHALL cập nhật `meetings` và `room_bookings` trong cùng một database transaction.
FR-036: IF bất kỳ bước nào trong transaction thất bại, THEN THE system SHALL rollback toàn bộ transaction và không thay đổi dữ liệu.
FR-037: THE system SHALL kiểm tra room conflict lại ngay trước khi commit transaction.
FR-038: IF room conflict phát sinh tại thời điểm commit, THEN THE system SHALL rollback transaction và trả error code `ROOM_TIME_CONFLICT`.
FR-039: WHEN cập nhật thành công, THE system SHALL tạo `meeting_events` và `audit_logs` trong cùng transaction nếu có thể.
```

### 11.8 Notification & Background Job Requirements

```text
FR-040: WHEN cập nhật thời gian thành công, THE system SHALL tạo notification record trong bảng `notifications` với `notification_type = 'meeting_time_updated'`.
FR-041: WHEN tạo notification, THE system SHALL ghi danh sách `recipient_user_ids_json` và `recipient_emails_json` từ danh sách participants của meeting.
FR-042: WHEN notification cần gửi email, THE system SHALL tạo background job với `job_type = 'send_email'` và `status = 'queued'`.
FR-043: IF tạo notification hoặc background job thất bại, THEN THE system SHALL không rollback việc cập nhật meeting, nhưng phải ghi lỗi vào audit log và đánh dấu `notificationStatus = 'failed'` trong response.
FR-044: THE system SHALL hỗ trợ retry cho background job gửi email thông qua cơ chế retry mặc định.
```

### 11.9 Traceability

| Requirement ID | EARS Pattern | Nguồn / Use Case liên quan | Ghi chú |
|---|---|---|---|
| FR-001 | Ubiquitous | UC-MM-02 | Authentication |
| FR-002 | Ubiquitous | UC-MM-02 | Authorization check |
| FR-003 | Ubiquitous | UC-MM-02 | Transaction consistency |
| FR-004 | Ubiquitous | UC-MM-02 | Data preservation |
| FR-005 | Ubiquitous | UC-MM-02 | Event logging |
| FR-006 | Ubiquitous | UC-MM-02 | Audit logging |
| FR-007 | Event-driven | UC-MM-02 | Pre-processing authorization |
| FR-008 | Event-driven | UC-MM-02 | Update meeting times |
| FR-009 | Event-driven | UC-MM-02 | Update booking |
| FR-010 | Event-driven | A1 | Room change check |
| FR-011 | Event-driven | A1 | Room change update |
| FR-012 | Event-driven | UC-MM-02 | Notification creation |
| FR-013 | Event-driven | UC-MM-02 | Background job |
| FR-014 | Event-driven | E3 | Override participant conflict |
| FR-015 | State-driven | UC-MM-02 | Allowed state |
| FR-016 | State-driven | E2 | Disallowed states |
| FR-017 | State-driven | UC-MM-02 | Race condition prevention |
| FR-018 | Optional Feature | UC-MM-02 | Default room behavior |
| FR-019 | Optional Feature | UC-MM-02 | Change reason |
| FR-020 | Unwanted Behavior | Edge Case 1,2 | Meeting not found |
| FR-021 | Unwanted Behavior | E4 | No permission |
| FR-022 | Unwanted Behavior | E2 | Wrong status |
| FR-023 | Unwanted Behavior | Edge Case 8 | Invalid time range |
| FR-024 | Unwanted Behavior | E1 | Past time |
| FR-025 | Unwanted Behavior | E5 | Room conflict |
| FR-026 | Unwanted Behavior | Edge Case 12 | Room not found |
| FR-027 | Unwanted Behavior | Edge Case 13 | Room inactive |
| FR-028 | Unwanted Behavior | E3 | Participant conflict warning |
| FR-029 | Unwanted Behavior | Edge Case 17 | Missing booking record |
| FR-030 | Unwanted Behavior | Edge Case 18,19 | Race condition |
| FR-031 | Authorization | UC-MM-02 | Unauthenticated |
| FR-032 | Authorization | E4 | No permission |
| FR-033 | Authorization | UC-MM-02 | Scoped permission |
| FR-034 | Authorization | UC-MM-02 | Admin override |
| FR-035 | Transaction | UC-MM-02 | Transaction boundary |
| FR-036 | Transaction | UC-MM-02 | Rollback on failure |
| FR-037 | Transaction | UC-MM-02 | Re-check before commit |
| FR-038 | Transaction | Edge Case 19 | Race condition rollback |
| FR-039 | Transaction | UC-MM-02 | Event+audit in transaction |
| FR-040 | Notification | UC-MM-02 | Create notification |
| FR-041 | Notification | UC-MM-02 | Recipient JSON fields |
| FR-042 | Notification | UC-MM-02 | Background job |
| FR-043 | Notification | Edge Case 20 | Graceful degradation |
| FR-044 | Notification | UC-MM-02 | Retry strategy |

---

## 12. Business Rules

| ID | Rule | Mức độ |
|---|---|---|
| BR-01 | Participant thường tuyệt đối không có quyền thay đổi thời gian cuộc họp. | Bắt buộc |
| BR-02 | Chỉ Creator/Organizer, Host hoặc Admin có permission phù hợp mới được đổi thời gian. | Bắt buộc |
| BR-03 | Chỉ cho đổi thời gian khi meeting đang ở trạng thái `scheduled`. | Bắt buộc |
| BR-04 | Không cho đổi thời gian meeting ở trạng thái `in_progress`, `completed`, `cancelled`. | Bắt buộc |
| BR-05 | `endTime` phải lớn hơn `startTime`. | Bắt buộc |
| BR-06 | Không được dời meeting về quá khứ. | Bắt buộc |
| BR-07 | Khi cập nhật thời gian, không được reset hoặc làm mất các thông tin khác như title, agenda, participants, recording config. | Bắt buộc |
| BR-08 | Room conflict là blocking conflict. | Bắt buộc |
| BR-09 | Participant conflict là soft warning, có thể override nếu người dùng xác nhận. | Bắt buộc |
| BR-10 | Nếu đổi phòng do conflict, hệ thống phải cập nhật đồng bộ cả meeting và room booking trong cùng transaction. | Bắt buộc |
| BR-11 | Nếu cập nhật meeting thành công nhưng tạo notification job thất bại, cần ghi nhận lỗi phù hợp. Cập nhật meeting thành công, notification failure được log/audit và có khả năng retry. | Bắt buộc |
| BR-12 | Mọi thao tác cập nhật thành công phải ghi `meeting_events` và `audit_logs`. | Bắt buộc |
| BR-13 | UC-MM-02 SHALL update only the selected meeting instance. The system SHALL NOT update other meetings in the same recurring series. | Bắt buộc |
| BR-14 | Khi user gửi `newRoomId`, hệ thống bắt buộc kiểm tra capacity. Required = `expected_attendee_count` hoặc đếm từ participants. Capacity conflict là blocking error. | Bắt buộc |
| BR-15 | Minimum duration: 15 phút, Maximum duration: 8 giờ. | Bắt buộc |

---

## 13. Validation Rules

| Field | Rule | Error Code | HTTP Status |
|---|---|---|---|
| `meetingId` | Phải là UUID hợp lệ | `INVALID_UUID` | 400 |
| `meetingId` | Meeting phải tồn tại và chưa bị soft delete | `MEETING_NOT_FOUND` | 404 |
| `startTime` | Phải là ISO-8601 hợp lệ (có timezone) | `INVALID_DATE_FORMAT` | 422 |
| `endTime` | Phải là ISO-8601 hợp lệ (có timezone) | `INVALID_DATE_FORMAT` | 422 |
| `startTime` | Phải < `endTime` | `INVALID_TIME_RANGE` | 422 |
| `startTime` | Không được trong quá khứ | `MEETING_TIME_IN_PAST` | 422 |
| `endTime` | Không được trong quá khứ | `MEETING_TIME_IN_PAST` | 422 |
| `endTime` | Duration (endTime - startTime) phải từ 15 phút đến 8 giờ | `MEETING_DURATION_OUT_OF_RANGE` | 422 |
| `newRoomId` | Nếu có, phải là UUID hợp lệ | `INVALID_UUID` | 400 |
| `newRoomId` | Nếu có, phòng phải tồn tại | `ROOM_NOT_FOUND` | 404 |
| `newRoomId` | Nếu có, phòng phải active | `ROOM_NOT_AVAILABLE` | 409 |
| `newRoomId` | Nếu có, capacity của phòng phải >= required attendee count | `ROOM_CAPACITY_INSUFFICIENT` | 409 |
| `overrideParticipantConflict` | Nếu có, phải là boolean | `INVALID_BOOLEAN` | 400 |
| `changeReason` | Optional, string, max 500 ký tự | `FIELD_TOO_LONG` | 422 |

---

## 14. API Contract

### 14.1 Endpoint

| Thuộc tính | Giá trị |
|---|---|
| Method | `PATCH` |
| Endpoint | `/api/v1/meetings/{meetingId}/time` |
| Auth | JWT Bearer required |
| Content-Type | `application/json` |

### 14.2 Path Parameters

| Parameter | Type | Bắt buộc | Mô tả |
|---|---|---|---|
| `meetingId` | uuid | Có | ID của cuộc họp cần cập nhật thời gian |

### 14.3 Request Body

```json
{
  "startTime": "2026-07-01T09:00:00+07:00",
  "endTime": "2026-07-01T10:30:00+07:00",
  "newRoomId": "550e8400-e29b-41d4-a716-446655440000",
  "overrideParticipantConflict": false,
  "changeReason": "Host bận đột xuất"
}
```

### 14.4 Request Body Fields

| Field | Type | Bắt buộc | Mô tả | Validation |
|---|---|---|---|---|
| `startTime` | string (ISO-8601) | Có | Thời gian bắt đầu mới | Phải có timezone, không trong quá khứ |
| `endTime` | string (ISO-8601) | Có | Thời gian kết thúc mới | Phải có timezone, phải > startTime |
| `newRoomId` | uuid | Không | ID phòng mới nếu muốn đổi phòng | Nếu có, phòng phải tồn tại và active |
| `overrideParticipantConflict` | boolean | Không | Cho phép bỏ qua participant conflict warning | Default: false |
| `changeReason` | string | Không | Lý do thay đổi thời gian | Max 500 ký tự |

### 14.5 Success Response (200)

```json
{
  "success": true,
  "data": {
    "meetingId": "550e8400-e29b-41d4-a716-446655440000",
    "oldStartTime": "2026-07-01T08:00:00+07:00",
    "oldEndTime": "2026-07-01T09:00:00+07:00",
    "newStartTime": "2026-07-01T09:00:00+07:00",
    "newEndTime": "2026-07-01T10:30:00+07:00",
    "oldRoomId": "550e8400-e29b-41d4-a716-446655440001",
    "newRoomId": "550e8400-e29b-41d4-a716-446655440002",
    "bookingId": "550e8400-e29b-41d4-a716-446655440003",
    "notificationStatus": "queued",
    "updatedAt": "2026-06-09T10:00:00+07:00"
  },
  "meta": {
    "requestId": "req-001"
  }
}
```

### 14.6 Participant Conflict Warning Response (409)

```json
{
  "success": false,
  "error": {
    "code": "PARTICIPANT_TIME_CONFLICT_WARNING",
    "message": "Khung giờ mới trùng lịch với một hoặc nhiều người tham gia. Vui lòng xác nhận nếu vẫn muốn tiếp tục.",
    "details": {
      "blocking": false,
      "requiresConfirmation": true,
      "conflicts": [
        {
          "userId": "550e8400-e29b-41d4-a716-446655440010",
          "fullName": "Nguyen Van A",
          "overlappingMeetings": [
            {
              "meetingId": "550e8400-e29b-41d4-a716-446655440020",
              "title": "Weekly Sync",
              "startTime": "2026-07-01T09:30:00+07:00",
              "endTime": "2026-07-01T10:00:00+07:00"
            }
          ]
        }
      ]
    },
    "requestId": "req-001"
  }
}
```

### 14.7 Room Conflict Response (409)

```json
{
  "success": false,
  "error": {
    "code": "ROOM_TIME_CONFLICT",
    "message": "Phòng họp hiện tại không khả dụng trong khung giờ mới.",
    "details": {
      "blocking": true,
      "conflictedRoomId": "550e8400-e29b-41d4-a716-446655440001",
      "requestedStartTime": "2026-07-01T09:00:00+07:00",
      "requestedEndTime": "2026-07-01T10:30:00+07:00",
      "conflicts": [
        {
          "conflictingBookingId": "550e8400-e29b-41d4-a716-446655440030",
          "conflictingMeetingId": "550e8400-e29b-41d4-a716-446655440040",
          "conflictingStartTime": "2026-07-01T09:00:00+07:00",
          "conflictingEndTime": "2026-07-01T10:00:00+07:00",
          "conflictingTitle": "Sprint Planning"
        }
      ],
      "suggestedRooms": [
        {
          "roomId": "550e8400-e29b-41d4-a716-446655440050",
          "name": "Phòng họp A.02",
          "capacity": 12
        },
        {
          "roomId": "550e8400-e29b-41d4-a716-446655440051",
          "name": "Phòng họp A.03",
          "capacity": 8
        }
      ]
    },
    "requestId": "req-001"
  }
}
```

### 14.8 General Error Response

```json
{
  "success": false,
  "error": {
    "code": "ERROR_CODE",
    "message": "Thông báo lỗi chi tiết",
    "details": {},
    "requestId": "req-001"
  }
}
```

---

## 15. Data Model Mapping

### 15.1 `meetings`

| Thao tác | Field | Giá trị | Ghi chú |
|---|---|---|---|
| Cập nhật | `start_time` | Giá trị mới từ request | |
| Cập nhật | `end_time` | Giá trị mới từ request | |
| Cập nhật | `room_id` | `newRoomId` nếu có | Nếu không đổi phòng, giữ nguyên |
| Cập nhật | `updated_by` | User ID người thực hiện | |
| Cập nhật | `updated_at` | Timestamp hiện tại | |
| Không cập nhật | `title` | Giữ nguyên | |
| Không cập nhật | `description` | Giữ nguyên | |
| Không cập nhật | `meeting_agendas` | Giữ nguyên | |
| Không cập nhật | `recording_configs` | Giữ nguyên | |
| Không cập nhật | `meeting_participants` | Giữ nguyên | |

### 15.2 `room_bookings`

| Thao tác | Field | Giá trị | Ghi chú |
|---|---|---|---|
| Tìm kiếm | | | Active booking theo `meeting_id` |
| Cập nhật | `room_id` | `newRoomId` nếu có | Nếu không đổi phòng, giữ nguyên |
| Cập nhật | `reserved_start_time` | Giá trị mới từ request | |
| Cập nhật | `reserved_end_time` | Giá trị mới từ request | |
| Cập nhật | `booking_type` | `scheduled` hoặc `relocated` | `relocated` nếu đổi phòng |
| Cập nhật | `updated_at` | Timestamp hiện tại | |

### 15.3 `meeting_requests`

| Thao tác | Field | Giá trị | Ghi chú |
|---|---|---|---|
| Tạo | `request_type` | `'update_time'` | |
| Tạo | `approval_mode` | `'auto'` | Không biến thành approval flow thủ công |
| Tạo | `approval_status` | `'applied'` | `applied` dùng cho request update-time tự động duyệt |
| Tạo | `requested_start_time` | `startTime` từ request | |
| Tạo | `requested_end_time` | `endTime` từ request | |
| Tạo | `target_room_id` | `newRoomId` nếu có | |
| Tạo | `conflict_check_status` | `'completed'` | |
| Tạo | `conflict_summary_json` | JSON chứa kết quả conflict check | |
| Tạo | `request_payload_json` | JSON chứa toàn bộ request body | |
| Tạo | `applied_at` | Timestamp hiện tại | |

### 15.4 `meeting_events`

| Field | Giá trị |
|---|---|
| `event_type` | `'meeting_time_updated'` |
| `old_value_json` | `{ "startTime": "...", "endTime": "...", "roomId": "..." }` |
| `new_value_json` | `{ "startTime": "...", "endTime": "...", "roomId": "...", "changeReason": "..." }` |
| `actor_user_id` | User ID người thực hiện |
| `source_type` | `'manual'` |

### 15.5 `notifications`

| Field | Giá trị |
|---|---|
| `notification_type` | `'meeting_time_updated'` |
| `channel` | `'email'` hoặc `'in_app'` |
| `related_entity_type` | `'meeting'` |
| `related_entity_id` | meetingId |
| `recipient_user_ids_json` | JSON array chứa user IDs của participants |
| `recipient_emails_json` | JSON array chứa emails của participants |
| `delivery_status` | `'queued'` |
| `payload_json` | JSON chứa old/new time, room info, changeReason |

### 15.6 `background_jobs`

| Field | Giá trị |
|---|---|
| `job_type` | `'send_email'` |
| `related_entity_type` | `'meeting'` |
| `related_entity_id` | meetingId |
| `status` | `'queued'` |
| `input_json` | JSON chứa notificationId, template variables |

### 15.7 `audit_logs`

| Field | Giá trị |
|---|---|
| `action_type` | `'update'` |
| `entity_type` | `'meeting'` |
| `entity_id` | meetingId |
| `old_value_json` | JSON chứa old startTime, endTime, roomId |
| `new_value_json` | JSON chứa new startTime, endTime, roomId |
| `metadata_json` | JSON chứa reason, requestId, actorUserId |

---

## 16. Notification Requirements

### 16.1 Notification Content

Khi cập nhật thời gian họp thành công, hệ thống tạo notification với nội dung:

**Subject**: "Cập nhật thời gian cuộc họp: {meetingTitle}"

**Nội dung**:
- Meeting title
- Thời gian cũ (hiển thị dạng gạch ngang): `~~08:00 - 09:00, 01/07/2026~~`
- Thời gian mới (hiển thị nổi bật): **09:00 - 10:30, 01/07/2026**
- Phòng cũ nếu có đổi phòng
- Phòng mới nếu có đổi phòng
- Change reason nếu có
- Người cập nhật (tên người thực hiện)
- Link xem chi tiết meeting

### 16.2 Notification Channels

| Channel | Mô tả | Bắt buộc |
|---|---|---|
| In-app | Notification hiển thị trong ứng dụng | Có |
| Email | Gửi email thông báo đến participants | Có (qua background job) |

### 16.3 Recipients

- Toàn bộ participants nội bộ (internal) của meeting.
- External participants nếu có email trong `meeting_external_participants`.
- Creator/Organizer và Host (bao gồm người thực hiện cập nhật).

### 16.4 Notification Requirements (EARS)

```text
NFR-NOTIF-001: WHEN cập nhật thời gian meeting thành công, THE system SHALL tạo notification record cho mỗi participant trong meeting.
NFR-NOTIF-002: THE system SHALL lưu danh sách recipient user IDs và emails dưới dạng JSON trong notification record.
NFR-NOTIF-003: WHEN notification cần gửi email, THE system SHALL tạo background job với `job_type = 'send_email'` và `status = 'queued'`.
NFR-NOTIF-004: IF background job gửi email thất bại, THE system SHALL hỗ trợ retry tối thiểu 3 lần trước khi đánh dấu thất bại.
NFR-NOTIF-005: WHEN the meeting has external participants with email addresses, THE system SHALL include those email addresses in recipient_emails_json for email notification.
NFR-NOTIF-006: WHEN an external participant has no email address, THE system SHALL skip email delivery for that participant and record the skipped recipient in notification payload or delivery result without failing the meeting time update.
NFR-NOTIF-007: THE system SHALL NOT create in-app notification recipients for external participants.
NFR-NOTIF-008: IF the notification background job fails after the maximum retry attempts, THE system SHALL mark the notification delivery_status as failed and store the failure reason.
NFR-NOTIF-009: THE system SHALL NOT rollback a successfully committed meeting time update because of notification delivery failure.
```

---

## 17. Audit and Event Logging Requirements

### 17.1 Event Logging (`meeting_events`)

Mọi thao tác cập nhật thời gian thành công phải tạo event record trong `meeting_events`:

```text
AUD-001: THE system SHALL tạo `meeting_events` với `event_type = 'meeting_time_updated'` cho mọi cập nhật thời gian thành công.
AUD-002: THE system SHALL ghi cả `old_value_json` và `new_value_json` vào meeting event.
AUD-003: THE system SHALL ghi `actor_user_id` là người thực hiện cập nhật.
AUD-004: THE system SHALL đặt `source_type = 'manual'` cho mọi cập nhật do người dùng chủ động thực hiện.
```

### 17.2 Audit Logging (`audit_logs`)

Mọi thao tác cập nhật thời gian thành công phải ghi audit log:

```text
AUD-005: THE system SHALL ghi `audit_logs` với `action_type = 'update'` và `entity_type = 'meeting'` cho mọi cập nhật thời gian thành công.
AUD-006: THE system SHALL ghi `entity_id` là meetingId để truy vết.
AUD-007: THE system SHALL ghi `old_value_json` chứa thông tin thời gian và phòng trước khi cập nhật.
AUD-008: THE system SHALL ghi `new_value_json` chứa thông tin thời gian và phòng sau khi cập nhật.
AUD-009: THE system SHALL ghi `metadata_json` chứa changeReason và requestId nếu có.
```

---

## 18. Conflict Detection Requirements

### 18.1 Room Conflict Detection

Room conflict được tính động từ `room_bookings` và `meetings`. Không dùng bảng `schedule_conflicts`.

```text
CONF-001: THE system SHALL kiểm tra room conflict bằng cách query các booking ở trạng thái `approved` hoặc `active` trong `room_bookings` cho cùng phòng trong khoảng thời gian yêu cầu.
CONF-002: THE system SHALL sử dụng overlap logic có buffer: `existing.start_at < (new.end_at + bufferMinutes) AND existing.end_at > (new.start_at - bufferMinutes)` — tương đương yêu cầu khoảng cách tối thiểu `bufferMinutes` phút giữa endTime của một booking và startTime của booking kế tiếp cùng phòng.
CONF-002b: THE system SHALL đọc `bufferMinutes` từ `system_configs.room_booking_buffer_minutes` (mặc định 15 nếu thiếu/không hợp lệ, sắp xếp `updated_at DESC` khi đọc vì `config_key` không có unique constraint). Buffer chỉ áp dụng khi so sánh với booking `approved`/`active` (xem CONF-004) — không áp dụng cho booking `pending`.
CONF-003: THE system SHALL loại trừ booking của chính meeting hiện tại khỏi kết quả conflict check.
CONF-004: THE system SHALL loại trừ các booking đã cancelled, released, rejected, VÀ các booking `pending` (thuộc meeting/request khác) khỏi conflict check — booking `pending` không tính là đang chiếm phòng (xem `feat-create-meeting-manual` FR-012, `feat-review-meeting-request` FR-032/FR-033 để biết cơ chế Manager quyết định khi nhiều request pending trùng phòng/giờ).
CONF-005: IF room conflict được phát hiện, THEN THE system SHALL đánh dấu `blocking: true` trong response.
CONF-006: WHERE the current room is unavailable in the requested time range, THE system SHOULD return up to five suggested rooms that are available, active, capacity-sufficient, and closest to the original room requirements. Tiêu chí ưu tiên: cùng site_name/area_name, match thiết bị, capacity gần nhất nhưng đủ sức chứa.
```

### 18.2 Participant Conflict Detection

Participant conflict được tính động từ `meetings` và `meeting_participants`.

```text
CONF-007: THE system SHALL kiểm tra participant conflict bằng cách kiểm tra lịch của từng participant trong khoảng thời gian mới.
CONF-008: IF participant có meeting khác trong khoảng thời gian mới, THEN THE system SHALL ghi nhận conflict và đánh dấu `blocking: false`.
CONF-009: THE system SHALL loại trừ meeting hiện tại của participant khỏi kết quả conflict check.
CONF-010: IF `overrideParticipantConflict` được gửi với giá trị `true`, THEN THE system SHALL bỏ qua participant conflict warning.
```

---

## 19. Transaction and Consistency Requirements

### 19.1 Transaction Boundary

```text
TXN-001: THE system SHALL cập nhật `meetings` và `room_bookings` trong cùng một database transaction.
TXN-002: THE system SHALL kiểm tra room conflict lại ngay trước khi commit transaction để tránh race condition.
TXN-003: IF room conflict phát sinh tại thời điểm re-check, THEN THE system SHALL rollback toàn bộ transaction.
TXN-004: THE system SHALL tạo `meeting_events` và `audit_logs` trong cùng transaction với cập nhật meeting nếu có thể.
TXN-005: IF ghi event/audit log trong transaction thất bại, THEN THE system SHALL rollback toàn bộ transaction.
```

### 19.2 Consistency Rules

```text
TXN-006: THE system SHALL đảm bảo `meetings.room_id` và `room_bookings.room_id` luôn đồng nhất sau khi cập nhật.
TXN-007: THE system SHALL đảm bảo `meetings.start_time`/`end_time` khớp với `room_bookings.reserved_start_time`/`reserved_end_time`.
TXN-008: IF notification/job tạo sau transaction thất bại, THEN THE system SHALL không ảnh hưởng đến kết quả cập nhật chính và ghi log lỗi.
```

### 19.3 Race Condition Prevention

```text
TXN-009: THE system SHALL sử dụng database-level locking (ví dụ: pessimistic lock hoặc serializable isolation level) khi kiểm tra và cập nhật room booking để tránh race condition.
TXN-010: IF hai request đồng thời cố gắng cập nhật cùng một meeting, THEN THE system SHALL xử lý tuần tự và request thứ hai nhận được kết quả của lần cập nhật đầu tiên hoặc bị từ chối do conflict.
```

---

## 20. Error Handling

### 20.1 Error Code Reference

| Error Code | HTTP Status | Description |
|---|---|---|
| `MEETING_NOT_FOUND` | 404 | Meeting không tồn tại hoặc đã bị xóa |
| `MEETING_TIME_UPDATE_FORBIDDEN` | 403 | Người dùng không có quyền cập nhật thời gian |
| `MEETING_STATUS_NOT_EDITABLE` | 409 | Meeting không ở trạng thái cho phép cập nhật |
| `MEETING_TIME_IN_PAST` | 422 | Thời gian mới nằm trong quá khứ |
| `INVALID_TIME_RANGE` | 422 | startTime >= endTime |
| `INVALID_DATE_FORMAT` | 422 | Định dạng thời gian không hợp lệ |
| `ROOM_NOT_FOUND` | 404 | Phòng không tồn tại |
| `ROOM_NOT_AVAILABLE` | 409 | Phòng không khả dụng (inactive/maintenance) |
| `ROOM_CAPACITY_INSUFFICIENT` | 409 | Phòng họp được chọn không đủ sức chứa cho số lượng người tham gia |
| `ROOM_TIME_CONFLICT` | 409 | Phòng bị trùng lịch trong khung giờ yêu cầu |
| `PARTICIPANT_TIME_CONFLICT_WARNING` | 409 | Participant conflict (soft warning) |
| `INVALID_UUID` | 400 | UUID không hợp lệ |
| `INVALID_BOOLEAN` | 400 | Giá trị boolean không hợp lệ |
| `MEETING_DURATION_OUT_OF_RANGE` | 422 | Thời lượng cuộc họp phải nằm trong khoảng từ 15 phút đến 8 giờ |
| `FIELD_TOO_LONG` | 422 | Field vượt quá độ dài cho phép |

### 20.2 Error Response Format

Tất cả error responses tuân theo format chuẩn:

```json
{
  "success": false,
  "error": {
    "code": "ERROR_CODE",
    "message": "Thông báo lỗi chi tiết (có thể hiển thị cho người dùng)",
    "details": {
      "field": "specific_field",
      "constraints": {}
    },
    "requestId": "uuid"
  }
}
```

### 20.3 Error Handling Requirements (EARS)

```text
ERR-001: IF `meetingId` không phải UUID hợp lệ, THEN THE system SHALL trả về HTTP 400 với error code `INVALID_UUID`.
ERR-002: IF `startTime` hoặc `endTime` không đúng định dạng ISO-8601, THEN THE system SHALL trả về HTTP 422 với error code `INVALID_DATE_FORMAT`.
ERR-003: IF `startTime` >= `endTime`, THEN THE system SHALL trả về HTTP 422 với error code `INVALID_TIME_RANGE`.
ERR-004: IF `startTime` hoặc `endTime` nằm trong quá khứ, THEN THE system SHALL trả về HTTP 422 với error code `MEETING_TIME_IN_PAST`.
ERR-005: IF request không có JWT token, THEN THE system SHALL trả về HTTP 401 Unauthorized.
ERR-006: IF user không có permission, THEN THE system SHALL trả về HTTP 403 với error code `MEETING_TIME_UPDATE_FORBIDDEN`.
ERR-007: IF meeting không ở trạng thái `scheduled`, THEN THE system SHALL trả về HTTP 409 với error code `MEETING_STATUS_NOT_EDITABLE`.
ERR-008: IF room conflict blocking được phát hiện, THEN THE system SHALL trả về HTTP 409 với error code `ROOM_TIME_CONFLICT` và details blocking=true.
ERR-009: IF participant conflict được phát hiện và không có override, THEN THE system SHALL trả về HTTP 409 với error code `PARTICIPANT_TIME_CONFLICT_WARNING` và details blocking=false.
ERR-010: IF `newRoomId` được gửi nhưng phòng không tồn tại, THEN THE system SHALL trả về HTTP 404 với error code `ROOM_NOT_FOUND`.
ERR-011: IF `newRoomId` thuộc phòng inactive/maintenance, THEN THE system SHALL trả về HTTP 409 với error code `ROOM_NOT_AVAILABLE`.
ERR-012: IF có database error hoặc unexpected error, THEN THE system SHALL trả về HTTP 500 và ghi log đầy đủ.
```

---

## 21. Acceptance Criteria

### 21.1 Happy Path

```text
AC-001:
Given người dùng là Creator của meeting đang ở trạng thái `scheduled`,
When người dùng gửi request PATCH với startTime và endTime hợp lệ, không có room conflict, không có participant conflict,
Then hệ thống cập nhật thành công, trả về HTTP 200 với response chứa thông tin thời gian cũ và mới.
```

```text
AC-002:
Given người dùng là Admin có permission `meeting.time.update.any`,
When người dùng gửi request PATCH hợp lệ cho một meeting không phải của mình,
Then hệ thống cho phép cập nhật và trả về HTTP 200.
```

### 21.2 Validation Cases

```text
AC-003:
Given `startTime` >= `endTime`,
When người dùng gửi request,
Then hệ thống từ chối với error code `INVALID_TIME_RANGE` và HTTP 422.
```

```text
AC-004:
Given `startTime` nằm trong quá khứ,
When người dùng gửi request,
Then hệ thống từ chối với error code `MEETING_TIME_IN_PAST` và HTTP 422.
```

```text
AC-005:
Given `meetingId` không phải UUID hợp lệ,
When người dùng gửi request,
Then hệ thống từ chối với error code `INVALID_UUID` và HTTP 400.
```

### 21.3 Authorization Cases

```text
AC-006:
Given người dùng không có JWT token,
When người dùng gửi request,
Then hệ thống trả về HTTP 401 Unauthorized.
```

```text
AC-007:
Given người dùng là participant thường của meeting (không phải Creator, Host, Admin),
When người dùng gửi request PATCH,
Then hệ thống từ chối với error code `MEETING_TIME_UPDATE_FORBIDDEN` và HTTP 403.
```

```text
AC-008:
Given người dùng đã authenticated nhưng không phải Creator/Host/Admin của meeting,
When người dùng gửi request,
Then hệ thống từ chối với error code `MEETING_TIME_UPDATE_FORBIDDEN` và HTTP 403.
```

### 21.4 Business Rule Cases

```text
AC-009:
Given meeting đang ở trạng thái `in_progress`,
When người dùng gửi request PATCH,
Then hệ thống từ chối với error code `MEETING_STATUS_NOT_EDITABLE` và HTTP 409.
```

```text
AC-010:
Given meeting đang ở trạng thái `completed`,
When người dùng gửi request PATCH,
Then hệ thống từ chối với error code `MEETING_STATUS_NOT_EDITABLE` và HTTP 409.
```

```text
AC-011:
Given meeting đang ở trạng thái `cancelled`,
When người dùng gửi request PATCH,
Then hệ thống từ chối với error code `MEETING_STATUS_NOT_EDITABLE` và HTTP 409.
```

### 21.5 Conflict Cases

```text
AC-012:
Given phòng hiện tại đã có booking khác trong khung giờ mới,
When người dùng gửi request PATCH (không có `newRoomId`),
Then hệ thống từ chối với error code `ROOM_TIME_CONFLICT`, `blocking: true`, và HTTP 409.
```

```text
AC-013:
Given phòng hiện tại không khả dụng trong khung giờ mới,
When người dùng gửi request với `newRoomId` hợp lệ và phòng mới khả dụng,
Then hệ thống cập nhật thành công, thay đổi cả room_id, và trả về HTTP 200.
```

```text
AC-014:
Given participant có meeting khác trong khung giờ mới và `overrideParticipantConflict` không được gửi hoặc là false,
When người dùng gửi request,
Then hệ thống trả về HTTP 409 với error code `PARTICIPANT_TIME_CONFLICT_WARNING`, `blocking: false`.
```

```text
AC-015:
Given participant có meeting khác trong khung giờ mới và `overrideParticipantConflict: true`,
When người dùng gửi request và không có room conflict,
Then hệ thống cho phép cập nhật và trả về HTTP 200.
```

### 21.6 Data Integrity Cases

```text
AC-016:
Given cập nhật thời gian thành công,
When kiểm tra dữ liệu,
Then `meetings.start_time` và `meetings.end_time` khớp với giá trị mới, và các field khác (title, description) không thay đổi.
```

```text
AC-017:
Given cập nhật thời gian thành công,
When kiểm tra dữ liệu,
Then `room_bookings.reserved_start_time` và `reserved_end_time` khớp với `meetings.start_time` và `meetings.end_time`.
```

```text
AC-018:
Given cập nhật thời gian thành công,
When kiểm tra audit,
Then `audit_logs` có record với `action_type = 'update'` và `entity_id` tương ứng.
```

```text
AC-019:
Given cập nhật thời gian thành công,
When kiểm tra events,
Then `meeting_events` có record với `event_type = 'meeting_time_updated'` và chứa old/new value JSON.
```

```text
AC-020:
Given cập nhật thời gian thành công,
When kiểm tra notification,
Then `notifications` có record với `notification_type = 'meeting_time_updated'` và `delivery_status = 'queued'`.
```

### 21.7 Acceptance Criteria Traceability

| AC ID | Requirement ID liên quan | Kịch bản test chính |
|---|---|---|
| AC-001 | FR-007, FR-008, FR-009 | Update thành công, không conflict |
| AC-002 | FR-034 | Admin override permission |
| AC-003 | FR-023, ERR-003 | startTime >= endTime |
| AC-004 | FR-024, ERR-004 | startTime trong quá khứ |
| AC-005 | ERR-001 | UUID không hợp lệ |
| AC-006 | FR-031 | Không có token |
| AC-007 | FR-021, ERR-006 | Participant không có quyền |
| AC-008 | FR-032, ERR-006 | User không phải Creator/Host/Admin |
| AC-009 | FR-016, FR-022, ERR-007 | Meeting in_progress |
| AC-010 | FR-016, FR-022, ERR-007 | Meeting completed |
| AC-011 | FR-016, FR-022, ERR-007 | Meeting cancelled |
| AC-012 | FR-025, ERR-008 | Room conflict blocking |
| AC-013 | FR-010, FR-011 | Đổi phòng thành công |
| AC-014 | FR-028, ERR-009 | Participant conflict warning |
| AC-015 | FR-014, FR-028 | Override participant conflict |
| AC-016 | FR-004, FR-008 | Data integrity |
| AC-017 | FR-009, TXN-006, TXN-007 | Booking consistency |
| AC-018 | FR-006, AUD-005 | Audit log created |
| AC-019 | FR-005, AUD-001 | Event log created |
| AC-020 | FR-040, FR-041 | Notification queued |

---

## 22. Edge Cases

| # | Edge Case | Expected Behavior |
|---|---|---|
| 1 | Meeting không tồn tại | Trả về `MEETING_NOT_FOUND` (404) |
| 2 | Meeting bị soft delete | Trả về `MEETING_NOT_FOUND` (404) |
| 3 | User không có quyền | Trả về `MEETING_TIME_UPDATE_FORBIDDEN` (403) |
| 4 | User là participant thường | Trả về `MEETING_TIME_UPDATE_FORBIDDEN` (403) |
| 5 | Meeting đã `in_progress` | Trả về `MEETING_STATUS_NOT_EDITABLE` (409) |
| 6 | Meeting đã `completed` | Trả về `MEETING_STATUS_NOT_EDITABLE` (409) |
| 7 | Meeting đã `cancelled` | Trả về `MEETING_STATUS_NOT_EDITABLE` (409) |
| 8 | `startTime` >= `endTime` | Trả về `INVALID_TIME_RANGE` (422) |
| 9 | `startTime` trong quá khứ | Trả về `MEETING_TIME_IN_PAST` (422) |
| 10 | `endTime` trong quá khứ | Trả về `MEETING_TIME_IN_PAST` (422) |
| 11 | Room hiện tại bị trùng lịch | Trả về `ROOM_TIME_CONFLICT` (409) với blocking=true |
| 12 | `newRoomId` không tồn tại | Trả về `ROOM_NOT_FOUND` (404) |
| 13 | Phòng mới inactive/maintenance | Trả về `ROOM_NOT_AVAILABLE` (409) |
| 14 | Phòng mới không đủ capacity | Trả về `ROOM_CAPACITY_INSUFFICIENT` (409) |
| 15 | Participant conflict, chưa override | Trả về `PARTICIPANT_TIME_CONFLICT_WARNING` (409) với blocking=false |
| 16 | Participant conflict, đã override | Cho phép cập nhật nếu không có blocking conflict |
| 17 | Booking record không tồn tại dù meeting có room_id | Cho phép cập nhật thời gian, tạo booking mới, ghi warning vào audit log |
| 18 | Race condition: hai request cùng cập nhật một meeting | Request thứ hai nhận kết quả đã cập nhật hoặc bị từ chối do conflict |
| 19 | Race condition: meeting khác đặt cùng phòng trong lúc đang update | Re-check trước commit, phát hiện conflict, rollback và trả `ROOM_TIME_CONFLICT` |
| 20 | Notification job tạo thất bại sau khi update meeting | Cập nhật vẫn thành công, ghi log lỗi, `notificationStatus: 'failed'` |
| 21 | Audit log ghi thất bại | Rollback toàn bộ transaction nếu audit trong cùng transaction |
| 22 | Timezone ISO-8601 không hợp lệ | Trả về `INVALID_DATE_FORMAT` (422) |
| 23 | Request chỉ đổi ngày nhưng giữ giờ | Xử lý bình thường, kiểm tra room availability cho ngày mới |
| 24 | Request chỉ đổi giờ bắt đầu/kết thúc trong cùng ngày | Xử lý bình thường, kiểm tra room availability cho khung giờ mới |
| 25 | Request đổi cả thời gian và phòng | Xử lý theo alternative flow A1: kiểm tra phòng mới, cập nhật đồng thời |
| 26 | Duration < 15 phút hoặc > 8 giờ | Trả về `MEETING_DURATION_OUT_OF_RANGE` (422) |

---

## 23. Non-Functional Requirements

### 23.1 Performance

```text
NFR-001: THE system SHALL xử lý request cập nhật thời gian trong vòng 3 giây dưới điều kiện tải bình thường.
NFR-002: THE system SHALL hỗ trợ tối thiểu 50 request cập nhật thời gian đồng thời.
NFR-003: WHEN số lượng request vượt quá ngưỡng hỗ trợ, THE system SHALL trả về rate limiting response theo policy của hệ thống.
```

### 23.2 Security

```text
NFR-004: THE system SHALL yêu cầu authentication trước khi cho phép truy cập endpoint cập nhật thời gian.
NFR-005: THE system SHALL kiểm tra authorization cho mọi request cập nhật thời gian.
NFR-006: THE system SHALL không trả về thông tin nhạy cảm (password, token) trong API response.
NFR-007: IF request chứa credential không hợp lệ hoặc hết hạn, THEN THE system SHALL từ chối request.
```

### 23.3 Reliability & Consistency

```text
NFR-008: THE system SHALL ngăn chặn cập nhật một phần khi transaction thất bại.
NFR-009: THE system SHALL duy trì tính nhất quán giữa `meetings` và `room_bookings` sau khi cập nhật thành công.
NFR-010: IF thao tác ghi dữ liệu thất bại, THEN THE system SHALL rollback toàn bộ transaction.
```

### 23.4 Usability

```text
NFR-011: THE system SHALL trả về error message có ý nghĩa, có thể hiểu được bởi client.
NFR-012: THE system SHALL sử dụng field names và response format nhất quán với API convention của dự án.
```

### 23.5 Observability

```text
NFR-013: THE system SHALL ghi log mọi lỗi xử lý quan trọng cho feature này.
NFR-014: THE system SHALL ghi audit log cho mọi hành động thay đổi dữ liệu quan trọng.
NFR-015: WHEN có lỗi conflict hoặc business rule violation, THE system SHALL ghi đủ thông tin để hỗ trợ debug.
```

### 23.6 Maintainability

```text
NFR-016: THE system SHALL giữ business logic của feature này trong module meetings, không trộn lẫn với module khác.
NFR-017: THE system SHALL cung cấp test cases cho success flow, validation failures, authorization failures, và major business rule failures.
```

---

## 24. Assumptions and Open Questions

### 24.1 Assumptions

- Meeting chỉ có một booking record active trong `room_bookings` tại một thời điểm.
- Timezone trong request được client xác định và gửi kèm trong ISO-8601 string.
- Hệ thống lưu thời gian dưới dạng `timestamptz` trong database.
- Duration validation rule (nếu có) được config trong `system_configs`.
- Capacity check cho phòng mới chỉ áp dụng nếu feature được bật trong `system_configs`.
- Suggested rooms trong response room conflict được tính từ service gợi ý (có thể implement riêng).
- `meeting_requests` được dùng như audit/request snapshot, không phải approval flow.
- Background job retry tối đa 3 lần trước khi đánh dấu thất bại.

### 24.2 Open Questions

*(Tất cả các câu hỏi clarify đã được giải quyết và cập nhật vào spec).*

---

## Checklist tự kiểm tra

- [x] Spec đã có đủ các section theo yêu cầu.
- [x] Functional Requirements đã viết theo EARS.
- [x] Requirement sử dụng keyword EARS bằng tiếng Anh: `THE system SHALL`, `WHEN`, `WHILE`, `WHERE`, `IF`, `THEN`.
- [x] Mỗi requirement có mã ID rõ ràng.
- [x] Requirement có thể kiểm thử được.
- [x] Không mô tả quá sâu implementation.
- [x] Không tự ý thêm feature ngoài tài liệu nguồn.
- [x] Không tự ý thêm database table/field mới.
- [x] Error handling đã bao gồm validation, authentication, authorization, business rule, conflict.
- [x] Error requirements đã ưu tiên format `IF ... THEN THE system SHALL ...`.
- [x] Acceptance Criteria dùng Given / When / Then.
- [x] Traceability đã liên kết AC với FR liên quan.
- [x] Out of Scope đủ rõ để tránh agent tự mở rộng.
