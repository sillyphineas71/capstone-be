# Feature Specification: Cancel Scheduled Meeting

## 📝 CHANGELOG & REVISION HISTORY
| Ngày cập nhật | Tóm tắt thay đổi | Các dòng thay đổi |
| :--- | :--- | :--- |
| 2026-06-09 | Tạo spec lần đầu cho UC-MM-04 Hủy cuộc họp | Toàn bộ file |
| 2026-06-09 | Clarify: organizer_id/host_id (not created_by), usage not_started logic, event type status_changed + room_released, cancelledAt derived from updated_at, booking cancellation_reason | Mục 2, 3, 5, 7 |

---

- **Feature ID**: MEETING-CANCEL-001
- **Feature Name**: Cancel Scheduled Meeting
- **Use Case**: UC-MM-04 Hủy cuộc họp
- **Module / Domain**: meetings / meeting-management
- **Created Date**: 2026-06-09
- **Status**: Draft
- **Source Documents**:
  - AGENTS.md - Backend Agent Guide v1.1
  - Database v3.2 Compact (39 bảng)

---

## 1. Context & Goal

### 1.1 Bối cảnh

Trong quy trình meeting lifecycle, cuộc họp sau khi được tạo và duyệt sẽ ở trạng thái `scheduled`. Tuy nhiên, nhiều tình huống phát sinh khiến cuộc họp không thể diễn ra theo kế hoạch: người tổ chức có việc đột xuất, chủ trì không thể tham dự, hoặc mục tiêu cuộc họp không còn phù hợp. Khi đó, hệ thống cần cung cấp cơ chế hủy cuộc họp một cách chính thức, có kiểm soát, và đảm bảo tài nguyên phòng họp được giải phóng kịp thời.

Tính năng này thuộc module `meetings` / `meeting-management`, nằm trong giai đoạn "trước cuộc họp" (pre-meeting) của meeting lifecycle.

Tính năng liên quan tới: actor (organizer, host, admin), meeting entity, room booking, meeting events, room events, notifications, audit logs.

### 1.2 Mục tiêu

Mục tiêu của tính năng này là cho phép **Meeting Organizer, Meeting Host hoặc System Admin** hủy một cuộc họp đã được lên lịch nhằm:
- Cập nhật trạng thái cuộc họp thành `cancelled` một cách chính thức.
- Giải phóng phòng họp đã đặt để người khác có thể sử dụng.
- Lưu vết lý do hủy, timeline event, và audit log để truy vết.
- Thông báo kịp thời đến toàn bộ participants về việc hủy cuộc họp.

### 1.3 Giá trị mang lại

- **Người dùng**: Có thể chủ động hủy cuộc họp khi không còn nhu cầu, tránh chiếm dụng lịch của người khác.
- **Quản trị hệ thống**: Có quyền hủy cuộc họp vi phạm chính sách hoặc cần điều phối tài nguyên.
- **Vận hành phòng họp**: Giải phóng phòng ngay khi meeting bị hủy, tăng hiệu suất sử dụng phòng.
- **Dữ liệu và báo cáo**: Giữ lại lịch sử meeting đã hủy phục vụ audit, báo cáo và phân tích no-show.

### 1.4 Giả định

- Cuộc họp đã được tạo và duyệt, hiện ở trạng thái `scheduled`.
- Việc hủy meeting là thao tác một chiều, không hỗ trợ khôi phục.
- Người dùng muốn hủy lại cuộc họp sau khi đã hủy phải tạo cuộc họp mới.
- Thông báo hủy được gửi bất đồng bộ qua background job; HTTP request không chờ email gửi xong.
- Hệ thống có sẵn cơ chế queue notification và background job.
- `meetingId` là UUID hợp lệ theo định dạng của hệ thống.

### 1.5 Cần làm rõ

Các clarify issues đã được xử lý và áp dụng vào spec:

1. **`room_booking_usages.usage_status`**: Giá trị chính xác là `not_started`. Khi cancel: IF tồn tại AND `usage_status = 'not_started'` → update `released`. IF chưa tồn tại → NOT create mới. Không update nếu usage đang `in_use`, `completed`, `no_show`.
2. **Organizer/Host**: Organizer = `meetings.organizer_id`, Host = `meetings.host_id`. `created_by` chỉ dùng audit, không dùng để xác định quyền hủy.
3. **`cancelledAt`**: DB v3.2 Compact không có cột `cancelled_at`. `cancelledAt` trong response derived from `meetings.updated_at`.
4. **`room_bookings.cancellation_reason`**: DB có cột này. Khi cancel: `status = 'cancelled'` (không phải `released`), `cancellation_reason = cancellationReason`.
5. **Event type**: `meeting_events.event_type = 'status_changed'` với `old_value_json`/`new_value_json`/`metadata_json`. `room_events.event_type = 'room_released'`.
6. **AC**: Đã cập nhật để kiểm tra các trường trên.

---

## 2. Actor & Roles

### 2.1 Danh sách actor

| Actor | Vai trò trong tính năng | Quyền / Trách nhiệm chính |
|---|---|---|
| Meeting Organizer (`meetings.organizer_id`) | Người tổ chức cuộc họp | Được phép hủy meeting nếu `currentUser.id = meetings.organizer_id` |
| Meeting Host (`meetings.host_id`) | Người chủ trì cuộc họp | Được phép hủy meeting nếu `currentUser.id = meetings.host_id` |
| System Admin (permission `meeting.cancel.any`) | Quản trị viên hệ thống | Được phép hủy bất kỳ meeting nào |
| Participant (thường) | Người tham dự cuộc họp | Không được phép hủy meeting |

### 2.2 Role & Permission Rules

- `meeting.cancel.own`: cấp cho Meeting Organizer và Meeting Host – cho phép hủy meeting khi `currentUser.id` trùng với `meetings.organizer_id` hoặc `meetings.host_id`. **KHÔNG dùng `meetings.created_by` để xác định quyền hủy**; `created_by` chỉ phục vụ audit/metadata của record.
- `meeting.cancel.any`: cấp cho System Admin – cho phép hủy bất kỳ meeting nào trong hệ thống mà không cần kiểm tra `organizer_id`/`host_id`.
- Participant thường không có permission `meeting.cancel.own` hoặc `meeting.cancel.any` nên không được phép hủy.

### 2.3 Actor Constraints

- Tất cả actor phải đã đăng nhập và có session/token hợp lệ.
- Organizer chỉ được hủy meeting nếu `currentUser.id = meetings.organizer_id`; Host chỉ được hủy nếu `currentUser.id = meetings.host_id`. **Không dùng `meetings.created_by`** để xác định quyền hủy.
- System Admin có `meeting.cancel.any` được hủy mọi meeting không phụ thuộc `organizer_id`/`host_id`.
- Participant không được hủy dù có biết meetingId.

---

## 3. Functional Requirements

> Tất cả Functional Requirements viết theo EARS.
> Keyword EARS giữ bằng tiếng Anh, nội dung nghiệp vụ viết bằng tiếng Việt.

### 3.1 Core Requirements (Ubiquitous)

```text
FR-001: THE system SHALL yêu cầu xác thực người dùng trước khi cho phép thực hiện bất kỳ thao tác hủy meeting nào.
FR-002: THE system SHALL kiểm tra quyền của người dùng đối với meeting dựa trên permission `meeting.cancel.own` (yêu cầu `currentUser.id = meetings.organizer_id` hoặc `currentUser.id = meetings.host_id`) hoặc `meeting.cancel.any` trước khi xử lý yêu cầu hủy. `meetings.created_by` KHÔNG được dùng để xác định quyền hủy.
FR-003: THE system SHALL chỉ cho phép hủy meeting khi meeting đang ở trạng thái `scheduled`.
FR-004: THE system SHALL chỉ cho phép hủy meeting khi thời gian hiện tại nhỏ hơn `start_time` của meeting.
FR-005: THE system SHALL đảm bảo không xóa dữ liệu vật lý của meeting, participants, booking hoặc event khi hủy.
```

### 3.2 Event-driven Requirements

```text
FR-006: WHEN người dùng hợp lệ gửi yêu cầu hủy meeting kèm `cancellationReason` (optional), THE system SHALL trim khoảng trắng và kiểm tra độ dài tối đa 1000 ký tự trước khi lưu.
FR-007: WHEN yêu cầu hủy meeting được xác nhận hợp lệ, THE system SHALL cập nhật `meetings.status` thành `cancelled`.
FR-008: WHEN meeting status được cập nhật thành `cancelled`, THE system SHALL cập nhật `meetings.updated_by` và `meetings.updated_at`.
FR-009: WHEN meeting được hủy và có room booking liên quan đang ở trạng thái `pending` hoặc `approved`, THE system SHALL cập nhật `room_bookings.status = 'cancelled'`, `room_bookings.cancellation_reason` bằng giá trị `cancellationReason` (nếu request có truyền), và `room_bookings.updated_at`. Không dùng status `released` cho user-triggered cancellation; `released` chỉ dành cho auto-release/no-show/early-empty release behavior.
FR-010: IF `room_booking_usages` tồn tại cho booking liên quan và `usage_status = 'not_started'`, THEN THE system SHALL cập nhật `usage_status = 'released'`, `released_at`, `released_by`, và `release_reason` (lấy từ `cancellationReason` nếu có).
FR-011: IF `room_booking_usages` chưa tồn tại cho booking liên quan, THEN THE system SHALL NOT tạo mới usage record chỉ vì mục đích hủy meeting.
FR-012: WHEN meeting được hủy thành công, THE system SHALL tạo bản ghi `meeting_events` với `event_type = 'status_changed'`, `description` mô tả việc hủy meeting, `old_value_json = { "status": "scheduled" }`, `new_value_json = { "status": "cancelled" }`, và `metadata_json = { "action": "cancel_meeting", "reason": cancellationReason }`.
FR-013: WHEN meeting được hủy và có phòng được giải phóng, THE system SHALL tạo bản ghi `room_events` với `event_type = 'room_released'`, `description` mô tả việc giải phóng phòng do hủy meeting, và `metadata_json` chứa thông tin meeting và reason.
FR-014: WHEN meeting được hủy thành công, THE system SHALL tạo bản ghi `audit_logs` cho hành động hủy meeting.
FR-015: WHEN meeting được hủy và có phòng được giải phóng, THE system SHALL tạo bản ghi `audit_logs` cho hành động giải phóng phòng.
FR-016: WHEN meeting được hủy thành công, THE system SHALL tạo notification record trong `notifications` với type `cancellation`, channel `email` và `in_app`, kèm recipient JSON chứa danh sách participants.
FR-017: WHEN notification được tạo, THE system SHALL tạo background job trong `background_jobs` với type `send_email` để gửi email thông báo hủy đến participants.
```

### 3.3 State-driven Requirements

```text
FR-018: WHILE meeting đang ở trạng thái `scheduled`, THE system SHALL cho phép Organizer, Host và System Admin thực hiện hủy meeting (nếu thỏa điều kiện thời gian).
FR-019: WHILE meeting đang ở trạng thái `in_progress`, `completed` hoặc `cancelled`, THE system SHALL không cho phép hủy meeting bằng endpoint này.
FR-020: WHILE phòng có booking đã bị hủy, THE system SHALL coi phòng là trống trong khoảng thời gian của booking đã hủy khi kiểm tra availability cho booking mới.
```

### 3.4 Optional Feature Requirements

```text
FR-021: WHERE người dùng truyền `cancellationReason` trong request, THE system SHALL lưu giá trị đã trim vào `meetings.cancellation_reason`.
FR-022: WHERE room booking tồn tại cho meeting, THE system SHALL giải phóng booking theo quy tắc đã định (FR-009, FR-010).
FR-023: WHERE `room_booking_usages` tồn tại cho booking liên quan với `usage_status = 'not_started'`, THE system SHALL cập nhật `usage_status = 'released'` kèm `released_at`, `released_by`, và `release_reason`. WHERE usage record chưa tồn tại, THE system SHALL NOT tạo mới.
```

### 3.5 Unwanted Behavior Requirements

```text
FR-024: IF người dùng chưa xác thực, THEN THE system SHALL trả về lỗi xác thực và không thực hiện thay đổi dữ liệu.
FR-025: IF người dùng không có quyền `meeting.cancel.own` (không thỏa `currentUser.id = meetings.organizer_id` hoặc `currentUser.id = meetings.host_id`) và không có `meeting.cancel.any`, THEN THE system SHALL từ chối yêu cầu và trả về lỗi 403 Forbidden.
FR-026: IF meeting không tồn tại hoặc đã bị xóa mềm, THEN THE system SHALL trả về lỗi 404 Not Found.
FR-027: IF meeting không ở trạng thái `scheduled`, THEN THE system SHALL từ chối yêu cầu và trả về lỗi 409 Conflict với thông báo phù hợp.
FR-028: IF thời gian hiện tại đã bằng hoặc vượt quá `start_time` của meeting, THEN THE system SHALL từ chối yêu cầu và trả về lỗi 409 Conflict.
FR-029: IF `meetingId` không đúng định dạng UUID, THEN THE system SHALL trả về lỗi 400 Bad Request.
FR-030: IF `cancellationReason` vượt quá 1000 ký tự, THEN THE system SHALL trả về lỗi 422 Unprocessable Entity.
FR-031: IF có concurrent request đã hủy meeting trước đó, THEN THE system SHALL trả về lỗi 409 Conflict và không tạo duplicate notification.
FR-032: IF việc queue notification thất bại (background job không được tạo), THEN THE system SHALL không rollback việc hủy meeting, ghi log/audit lỗi, và trả về response với `notificationStatus = failed_to_queue`.
FR-033: IF request body chứa field không được phép (ví dụ `deleteMeeting`, `restore`, `forceDelete`), THEN THE system SHALL từ chối yêu cầu do validation fail.
```

### 3.6 Workflow Requirements

```text
FR-034: WHEN yêu cầu hủy meeting được gửi đến, THE system SHALL thực hiện các bước sau trong cùng một transaction:
  1. Kiểm tra authentication và authorization (dùng `organizer_id`/`host_id`, không dùng `created_by`).
  2. Kiểm tra meeting tồn tại, status là `scheduled`, và `start_time > now`.
  3. Khóa (lock) meeting record và room booking liên quan để ngăn race condition.
  4. Cập nhật `meetings.status` thành `cancelled`, lưu `cancellation_reason`, `updated_by`, `updated_at`.
  5. Giải phóng room booking nếu có: cập nhật `room_bookings.status = 'cancelled'`, `cancellation_reason`, `updated_at`; và usage nếu `not_started`.
  6. Tạo meeting event (`event_type = 'status_changed'`) và room event (`event_type = 'room_released'` nếu có phòng).
  7. Tạo audit logs.
  8. Tạo notification record và background job cho email.
  9. Trả về success response.
FR-035: IF bất kỳ bước nào trong transaction (FR-034) thất bại, THEN THE system SHALL rollback toàn bộ transaction và trả về lỗi phù hợp.
```

### 3.7 Data & State Requirements

```text
FR-036: THE system SHALL derive `cancelledAt` trong API response từ `meetings.updated_at` sau khi hủy thành công. KHÔNG có cột `cancelled_at` trong DB v3.2 Compact; thời điểm hủy chính xác có thể lấy từ `meeting_events.event_time` nếu cần audit.
FR-037: THE system SHALL KHÔNG xóa dữ liệu vật lý khỏi bảng `meetings`, `meeting_participants`, `room_bookings`, `room_booking_usages` khi hủy meeting.
FR-038: THE system SHALL KHÔNG set mù `rooms.current_status` thành `available` khi hủy meeting; trạng thái phòng được tính dựa trên booking/usage/event hiện hành.
```

### 3.8 Notification / Audit Requirements

```text
FR-039: WHEN notification cancellation được tạo, THE system SHALL đảm bảo tiêu đề (subject) có tiền tố `[CANCELLED]` hoặc `[ĐÃ HỦY]`.
FR-040: WHEN notification cancellation được gửi, THE system SHALL bao gồm `cancellationReason` trong nội dung thông báo nếu có.
FR-041: WHEN meeting có cả internal participants và external participants, THE system SHALL bao gồm cả hai nhóm trong danh sách nhận notification nếu có email hợp lệ.
```

### 3.9 Complex / Combined Requirements

```text
FR-042: WHILE meeting đang ở trạng thái `scheduled` VÀ thời gian hiện tại < `start_time`, WHEN người dùng có quyền `meeting.cancel.own` (thỏa `currentUser.id = meetings.organizer_id` hoặc `currentUser.id = meetings.host_id`) hoặc `meeting.cancel.any` gửi yêu cầu hủy, THE system SHALL thực hiện toàn bộ quy trình hủy meeting trong transaction.
FR-043: WHILE có room booking liên quan ở trạng thái `pending` hoặc `approved`, WHEN meeting bị hủy, THE system SHALL cập nhật `room_bookings.status = 'cancelled'`, `room_bookings.cancellation_reason = cancellationReason` (nếu có), và `room_bookings.updated_at`.
FR-044: WHERE notification queue thất bại, WHILE việc hủy meeting đã thành công, THE system SHALL ghi audit log lỗi và trả về `notificationStatus = failed_to_queue` trong response.
```

### 3.10 Traceability

| Requirement ID | EARS Pattern | Nguồn / Use Case liên quan | Ghi chú |
|---|---|---|---|
| FR-001 | Ubiquitous | UC-MM-04 | Xác thực bắt buộc |
| FR-002 | Ubiquitous | UC-MM-04 | Phân quyền dùng organizer_id/host_id |
| FR-003 | Ubiquitous | UC-MM-04, BR-002 | Kiểm tra status |
| FR-004 | Ubiquitous | UC-MM-04, BR-002 | Kiểm tra thời gian |
| FR-005 | Ubiquitous | UC-MM-04, BR-004 | Không hard delete |
| FR-006 | Event-driven | UC-MM-04, BR-010 | Cancellation reason |
| FR-007 | Event-driven | UC-MM-04 | Update status |
| FR-008 | Event-driven | UC-MM-04 | Audit fields |
| FR-009 | Event-driven | UC-MM-04, BR-005 | Release booking + cancellation_reason |
| FR-010 | Event-driven | UC-MM-04 | Usage not_started → released |
| FR-011 | Event-driven | UC-MM-04 | Do NOT create usage if not exists |
| FR-012 | Event-driven | UC-MM-04 | Meeting event: status_changed |
| FR-013 | Event-driven | UC-MM-04 | Room event: room_released |
| FR-014 | Event-driven | UC-MM-04 | Audit log: cancel |
| FR-015 | Event-driven | UC-MM-04 | Audit log: release room |
| FR-016 | Event-driven | UC-MM-04, BR-006 | Notification |
| FR-017 | Event-driven | UC-MM-04, BR-006 | Background job |
| FR-018 | State-driven | UC-MM-04, BR-001 | Cho phép hủy |
| FR-019 | State-driven | UC-MM-04 | Không cho hủy |
| FR-020 | State-driven | UC-MM-04, BR-005 | Availability |
| FR-021 | Optional | UC-MM-04, BR-010 | Reason optional |
| FR-022 | Optional | UC-MM-04 | Booking optional |
| FR-023 | Optional | UC-MM-04 | Usage not_started conditional |
| FR-024 | Unwanted | UC-MM-04, E3 | Auth error |
| FR-025 | Unwanted | UC-MM-04, E3 | Forbidden (organizer_id/host_id) |
| FR-026 | Unwanted | UC-MM-04, E4 | Not found |
| FR-027 | Unwanted | UC-MM-04, E2 | Status conflict |
| FR-028 | Unwanted | UC-MM-04, E1 | Time conflict |
| FR-029 | Unwanted | UC-MM-04, E5 | UUID invalid |
| FR-030 | Unwanted | UC-MM-04, E6 | Reason too long |
| FR-031 | Unwanted | UC-MM-04, E7 | Concurrent cancel |
| FR-032 | Unwanted | UC-MM-04, E8 | Queue fail |
| FR-033 | Unwanted | UC-MM-04 | Unexpected field |
| FR-034 | Complex | UC-MM-04 | Workflow |
| FR-035 | Complex | UC-MM-04 | Rollback |
| FR-036 | Ubiquitous | UC-MM-04 | cancelledAt from updated_at |
| FR-037 | Ubiquitous | UC-MM-04, BR-004 | No physical delete |
| FR-038 | Ubiquitous | UC-MM-04 | Room status |
| FR-039 | Ubiquitous | UC-MM-04, BR-011 | Subject prefix |
| FR-040 | Ubiquitous | UC-MM-04, BR-010 | Reason in notif |
| FR-041 | Ubiquitous | UC-MM-04, BR-012 | Both participant groups |
| FR-042 | Complex | UC-MM-04 | State+Event |
| FR-043 | Complex | UC-MM-04, BR-005 | State+Event (booking + reason) |
| FR-044 | Complex | UC-MM-04, E8 | Optional+Unwanted |

---

## 4. Non-functional Requirements

### 4.1 Performance

```text
NFR-001: THE system SHALL hoàn thành xử lý yêu cầu hủy meeting và trả về response trong vòng dưới 2 giây (không tính thời gian gửi email bất đồng bộ).
NFR-002: THE system SHALL hỗ trợ ít nhất 10 yêu cầu hủy meeting đồng thời mà không gây race condition hoặc data inconsistency.
```

### 4.2 Security

```text
NFR-003: THE system SHALL yêu cầu xác thực trước khi cho phép truy cập endpoint hủy meeting.
NFR-004: THE system SHALL kiểm tra quyền cho mọi thao tác hủy meeting.
NFR-005: THE system SHALL KHÔNG expose thông tin nhạy cảm của participant trong error response.
NFR-006: IF request chứa credential không hợp lệ hoặc hết hạn, THEN THE system SHALL từ chối yêu cầu.
```

### 4.3 Reliability & Consistency

```text
NFR-007: THE system SHALL sử dụng database transaction để đảm bảo tính nguyên tử (atomicity) cho các bước cập nhật meeting + booking + event + audit trong cùng một operation.
NFR-008: THE system SHALL sử dụng row-level lock hoặc pessimistic lock trên meeting record và room booking record để ngăn race condition khi có concurrent cancel request.
NFR-009: IF một persistence operation bắt buộc thất bại, THEN THE system SHALL rollback toàn bộ transaction và không để dữ liệu ở trạng thái không nhất quán.
```

### 4.4 Usability

```text
NFR-010: THE system SHALL trả về thông báo lỗi rõ ràng, bằng tiếng Việt, có thể hiển thị được cho người dùng.
NFR-011: THE system SHALL sử dụng format response nhất quán theo convention của dự án (success/error format chuẩn).
```

### 4.5 Observability

```text
NFR-012: THE system SHALL ghi audit log cho mọi hành động hủy meeting và giải phóng phòng.
NFR-013: THE system SHALL ghi log lỗi khi notification queue thất bại.
NFR-014: THE system SHALL hỗ trợ request/correlation id để trace audit và log khi cần.
```

### 4.6 Maintainability

```text
NFR-015: THE system SHALL giữ logic hủy meeting trong module meetings, không phân tán sang module khác.
NFR-016: THE system SHALL cung cấp test cases cho: success flow, validation failures, authorization failures, business rule failures (state conflict, time conflict, concurrent cancel).
```

---

## 5. Data Model

### 5.1 Entity liên quan

| Entity / Table | Vai trò trong tính năng | Ghi chú |
|---|---|---|
| `meetings` | Lưu thông tin cuộc họp, cập nhật status, cancellation_reason | Cập nhật, không xóa |
| `room_bookings` | Lưu thông tin đặt phòng, cập nhật status khi hủy | Cập nhật, không xóa |
| `room_booking_usages` | Lưu thông tin sử dụng phòng, cập nhật usage_status | Cập nhật nếu tồn tại |
| `meeting_events` | Lưu timeline event hủy meeting | Tạo mới |
| `room_events` | Lưu event giải phóng phòng | Tạo mới nếu có phòng |
| `notifications` | Lưu thông báo hủy gửi participants | Tạo mới |
| `background_jobs` | Lưu job gửi email bất đồng bộ | Tạo mới |
| `audit_logs` | Lưu audit cho hành động hủy và release phòng | Tạo mới |

### 5.2 Dữ liệu đầu vào (Request Body)

| Field | Type dự kiến | Bắt buộc | Mô tả | Validation |
|---|---|---|---|---|
| `cancellationReason` | string | Không | Lý do hủy cuộc họp | Trim khoảng trắng, tối đa 1000 ký tự |

### 5.3 Dữ liệu đầu ra (Response)

| Field | Type dự kiến | Mô tả |
|---|---|---|
| `meetingId` | uuid | ID của meeting vừa hủy |
| `status` | string | Giá trị `cancelled` |
| `cancelledAt` | ISO-8601 datetime | Thời điểm hủy (derived from `meetings.updated_at`; DB v3.2 Compact không có cột `cancelled_at`) |
| `cancelledBy` | uuid | ID người thực hiện hủy |
| `roomReleased` | boolean | `true` nếu có room booking được giải phóng, `false` nếu không |
| `releasedBookingId` | uuid hoặc null | ID của booking đã giải phóng, null nếu không có |
| `notificationStatus` | string | `queued`, `failed_to_queue`, hoặc `skipped` |

### 5.4 State / Status Model

| Entity | Status | Ý nghĩa | Có thể chuyển sang | Điều kiện chuyển |
|---|---|---|---|---|
| `meetings` | `scheduled` | Cuộc họp đã lên lịch | `cancelled` | Người có quyền hủy, thời gian chưa bắt đầu |
| `meetings` | `cancelled` | Cuộc họp đã hủy | (terminal) | Không thể chuyển sang trạng thái khác |
| `room_bookings` | `pending` | Booking chờ xác nhận | `cancelled` | Meeting bị hủy |
| `room_bookings` | `approved` | Booking đã xác nhận | `cancelled` | Meeting bị hủy |
| `room_bookings` | `cancelled` | Booking đã hủy | (terminal) | Booking không thể phục hồi |
| `room_booking_usages` | `not_started` | Usage chưa bắt đầu | `released` | Meeting bị hủy, cancel thành công |
| `room_booking_usages` | `released` | Usage đã giải phóng | (terminal) | Không thể quay lại `not_started` |

### 5.5 Data Constraints

- `meetings.status` không được chuyển từ `cancelled` về trạng thái khác.
- `meetings.cancellation_reason` chỉ được set khi meeting bị hủy.
- `room_bookings.status` được set thành `cancelled` (không dùng `released`) khi meeting bị hủy do user action; `released` chỉ dành cho auto-release/no-show behavior.
- `room_bookings.cancellation_reason` được copy từ `meetings.cancellation_reason` nếu có.
- `room_booking_usages` KHÔNG được tạo mới chỉ vì mục đích hủy meeting. Nếu usage chưa tồn tại, bỏ qua bước update usage.
- `room_booking_usages.usage_status` chỉ được update từ `not_started` → `released`. Các trạng thái khác (`in_use`, `completed`, `no_show`) không được thay đổi bởi feature này.
- Không xóa record khỏi các bảng liên quan khi hủy (soft update, không hard delete).
- Trạng thái phòng (`rooms.current_status`) không được set mù mà phải tính từ dữ liệu hiện hành.

### 5.6 Data Lifecycle

- **Tạo**: meeting được tạo → status `scheduled`.
- **Cập nhật**: khi hủy → `cancelled` + `cancellation_reason` + `updated_at` + `updated_by`.
- **Không xóa**: dữ liệu meeting, booking, participants được giữ lại để phục vụ audit, báo cáo.
- **Sử dụng cho báo cáo**: meeting đã hủy được tính vào báo cáo no-show, utilization, thống kê meeting.

### 5.7 Data-related EARS Requirements

```text
FR-DATA-001: WHEN meeting được hủy, THE system SHALL cập nhật `meetings.status = 'cancelled'`, `meetings.cancellation_reason` (nếu có), `meetings.updated_by`, `meetings.updated_at`. `cancelledAt` trong API response SHALL được lấy từ `meetings.updated_at`.
FR-DATA-002: WHEN room booking được giải phóng, THE system SHALL cập nhật `room_bookings.status = 'cancelled'`, `room_bookings.cancellation_reason = cancellationReason` (nếu có), và `room_bookings.updated_at`. Không dùng status `released` cho user-triggered cancellation.
FR-DATA-003: WHEN room_booking_usages tồn tại với `usage_status = 'not_started'`, THE system SHALL cập nhật `usage_status = 'released'`, `released_at`, `released_by`, và `release_reason`.
FR-DATA-004: IF room_booking_usages chưa tồn tại cho booking liên quan, THEN THE system SHALL NOT tạo mới usage record.
FR-DATA-005: IF meeting không tồn tại trong database, THEN THE system SHALL reject request với lỗi 404.
FR-DATA-006: IF meeting đã ở trạng thái `cancelled`, THEN THE system SHALL reject request với lỗi 409.
```

---

## 6. Error Handling

> Error requirements viết theo EARS Unwanted Behavior Pattern.

### 6.1 Validation Errors

```text
ERR-001: IF `meetingId` không đúng định dạng UUID, THEN THE system SHALL trả về 400 Bad Request.
ERR-002: IF `cancellationReason` vượt quá 1000 ký tự, THEN THE system SHALL trả về 422 Unprocessable Entity.
ERR-003: IF request body chứa field không được phép, THEN THE system SHALL trả về 400 Bad Request.
```

### 6.2 Authentication / Authorization Errors

```text
ERR-004: IF người dùng không được xác thực, THEN THE system SHALL trả về 401 Unauthorized.
ERR-005: IF người dùng không có quyền `meeting.cancel.own` hoặc `meeting.cancel.any`, THEN THE system SHALL trả về 403 Forbidden.
ERR-006: IF người dùng có `meeting.cancel.own` nhưng không phải organizer/host của meeting đó, THEN THE system SHALL trả về 403 Forbidden.
```

### 6.3 Business Rule Errors

```text
ERR-007: IF meeting đang ở trạng thái `in_progress` hoặc thời gian hiện tại >= `start_time`, THEN THE system SHALL trả về 409 Conflict với message "Cuộc họp đã bắt đầu. Bạn không thể hủy mà chỉ có thể chọn 'Kết thúc sớm'."
ERR-008: IF meeting đã ở trạng thái `completed` hoặc `cancelled`, THEN THE system SHALL trả về 409 Conflict với message "Trạng thái cuộc họp không hợp lệ để thực hiện thao tác này."
ERR-009: IF meeting không tồn tại hoặc đã bị xóa mềm, THEN THE system SHALL trả về 404 Not Found.
```

### 6.4 Conflict Errors

```text
ERR-010: IF có concurrent request đã hủy meeting trước đó, THEN THE system SHALL trả về 409 Conflict và không tạo duplicate notification.
ERR-011: IF dữ liệu đã bị thay đổi bởi operation khác (optimistic lock failure), THEN THE system SHALL xử lý theo project concurrency policy.
```

### 6.5 Integration / External Service Errors

```text
ERR-012: IF queue notification thất bại (background_job không được tạo), THEN THE system SHALL không rollback meeting cancellation, ghi audit/lỗi, và trả về `notificationStatus = failed_to_queue`.
```

### 6.6 Error Response Expectations

| Field | Mô tả |
|---|---|
| `statusCode` | HTTP status code |
| `message` | Thông báo lỗi bằng tiếng Việt |
| `error` | Loại lỗi ngắn gọn |
| `code` | Mã lỗi nội bộ |
| `details` | Chi tiết lỗi validation/business nếu cần |
| `timestamp` | Thời điểm xảy ra lỗi |
| `path` | API path |

---

## 7. Acceptance Criteria

> Acceptance Criteria viết theo Given / When / Then format.

### 7.1 Happy Path

```text
AC-001 (Cancel success - Organizer):
Given một meeting đang ở trạng thái `scheduled` với `start_time > now`,
  Và `currentUser.id = meetings.organizer_id` (người dùng là Organizer),
  Và người dùng có permission `meeting.cancel.own`,
When người dùng gửi request POST đến endpoint hủy meeting với `cancellationReason` hợp lệ,
Then hệ thống trả về 200 OK,
  Và `meetings.status` được cập nhật thành `cancelled`,
  Và `meetings.cancellation_reason` được lưu,
  Và `meetings.updated_by` và `meetings.updated_at` được cập nhật,
  Và `cancelledAt` trong response được lấy từ `meetings.updated_at` (không phải từ cột `cancelled_at`),
  Và room booking liên quan (nếu có) được chuyển `status = 'cancelled'` + `cancellation_reason`,
  Và `meeting_events` được tạo với `event_type = 'status_changed'`,
  Và `room_events` được tạo với `event_type = 'room_released'` (nếu có phòng),
  Và audit log được ghi cho hành động hủy và release room,
  Và notification được queue với trạng thái `queued`.

AC-002 (Cancel success - Host):
Given một meeting đang ở trạng thái `scheduled`,
  Và `currentUser.id = meetings.host_id` (người dùng là Host),
  Và người dùng có permission `meeting.cancel.own`,
When người dùng gửi request hủy meeting,
Then hệ thống trả về 200 OK và hủy meeting thành công.

AC-003 (Cancel success - System Admin):
Given một meeting đang ở trạng thái `scheduled`,
  Và người dùng hiện tại là System Admin có permission `meeting.cancel.any`,
When người dùng gửi request hủy meeting,
Then hệ thống trả về 200 OK và hủy meeting thành công dù Admin không phải organizer/host.
```

### 7.2 Authorization Cases

```text
AC-004 (Forbidden - participant thường):
Given một meeting đang ở trạng thái `scheduled`,
  Và người dùng hiện tại là participant thường (không phải organizer/host/admin),
When người dùng gửi request hủy meeting,
Then hệ thống trả về 403 Forbidden,
  Và meeting không bị thay đổi trạng thái.

AC-005 (Forbidden - không phải organizer/host của meeting):
Given một meeting đang ở trạng thái `scheduled`,
  Và người dùng có permission `meeting.cancel.own` nhưng `currentUser.id != meetings.organizer_id` và `currentUser.id != meetings.host_id`,
When người dùng gửi request hủy meeting,
Then hệ thống trả về 403 Forbidden,
  Và `meetings.created_by` không được dùng để xác định quyền hủy.
```

### 7.3 Business Rule Cases

```text
AC-006 (Conflict - meeting in_progress):
Given một meeting đang ở trạng thái `in_progress`,
When người dùng hợp lệ gửi request hủy meeting,
Then hệ thống trả về 409 Conflict với message "Cuộc họp đã bắt đầu...".

AC-007 (Conflict - meeting completed):
Given một meeting đang ở trạng thái `completed`,
When người dùng hợp lệ gửi request hủy meeting,
Then hệ thống trả về 409 Conflict với message "Trạng thái cuộc họp không hợp lệ...".

AC-008 (Conflict - meeting already cancelled):
Given một meeting đã ở trạng thái `cancelled`,
When người dùng hợp lệ gửi request hủy meeting,
Then hệ thống trả về 409 Conflict với message "Trạng thái cuộc họp không hợp lệ...".

AC-009 (Conflict - meeting started):
Given một meeting có `start_time` <= thời gian hiện tại,
When người dùng hợp lệ gửi request hủy meeting,
Then hệ thống trả về 409 Conflict với message "Cuộc họp đã bắt đầu...".
```

### 7.4 Validation Cases

```text
AC-010 (Not found):
Given meetingId không tồn tại trong database,
When người dùng gửi request hủy meeting,
Then hệ thống trả về 404 Not Found.

AC-011 (Invalid UUID):
Given meetingId không đúng định dạng UUID,
When người dùng gửi request hủy meeting,
Then hệ thống trả về 400 Bad Request.

AC-012 (Reason too long):
Given cancellationReason vượt quá 1000 ký tự,
When người dùng gửi request hủy meeting,
Then hệ thống trả về 422 Unprocessable Entity.
```

### 7.5 State Transition Cases

```text
AC-013 (Room booking released with cancelled status and cancellation_reason):
Given một meeting có room booking đang ở trạng thái `approved`,
When meeting được hủy thành công,
Then `room_bookings.status` được cập nhật thành `cancelled` (không phải `released`),
  Và `room_bookings.cancellation_reason` được set bằng `cancellationReason` từ request,
  Và `room_bookings.updated_at` được cập nhật,
  Và phòng được coi là trống trong khoảng thời gian đó cho booking mới.

AC-014 (No room booking):
Given một meeting không có room booking,
When meeting được hủy thành công,
Then response có `roomReleased = false` và `releasedBookingId = null`.

AC-015 (Usage not_started → released):
Given một meeting có room booking usage record với `usage_status = 'not_started'`,
When meeting được hủy thành công,
Then `usage_status` được cập nhật thành `released`,
  Và `released_at`, `released_by`, `release_reason` được set.

AC-016 (Usage not created when not exists):
Given một meeting có room booking nhưng không có room_booking_usages record,
When meeting được hủy thành công,
Then hệ thống KHÔNG tạo mới usage record,
  Và response vẫn trả về 200 OK với `roomReleased = true`.

AC-017 (Meeting event type is status_changed):
Given meeting được hủy thành công,
When `meeting_events` được tạo,
Then `event_type = 'status_changed'`,
  Và `old_value_json = { "status": "scheduled" }`,
  Và `new_value_json = { "status": "cancelled" }`,
  Và `metadata_json.action = "cancel_meeting"`.

AC-018 (Room event type is room_released):
Given meeting có room booking được hủy thành công,
When `room_events` được tạo,
Then `event_type = 'room_released'`.
```

### 7.6 Notification / Audit Cases

```text
AC-019 (Notification with [CANCELLED] prefix):
Given meeting được hủy thành công,
When notification được tạo,
Then subject của notification có tiền tố `[CANCELLED]` hoặc `[ĐÃ HỦY]`.

AC-020 (Notification includes reason):
Given meeting được hủy với `cancellationReason` được cung cấp,
When notification được tạo,
Then nội dung notification bao gồm `cancellationReason`.

AC-021 (Audit log created):
Given meeting được hủy thành công,
When hệ thống hoàn tất operation,
Then audit log được ghi cho hành động hủy meeting và release room (nếu có).
```

### 7.7 Concurrency Cases

```text
AC-022 (Concurrent cancel):
Given hai request hủy cùng một meeting được gửi đồng thời,
When request đầu tiên hoàn tất thành công,
Then request thứ hai trả về 409 Conflict,
  Và chỉ có một notification được tạo (không duplicate).
```

### 7.8 Acceptance Criteria Traceability

| AC ID | Requirement ID liên quan | Kịch bản test chính |
|---|---|---|
| AC-001 | FR-001, FR-002, FR-003, FR-004, FR-006, FR-007, FR-008, FR-009, FR-010, FR-012, FR-013, FR-014, FR-015, FR-016, FR-017, FR-034 | Cancel success - Organizer |
| AC-002 | FR-001, FR-002, FR-018 | Cancel success - Host |
| AC-003 | FR-001, FR-002, FR-018 | Cancel success - System Admin |
| AC-004 | FR-025, ERR-005 | Forbidden - participant |
| AC-005 | FR-025, ERR-006 | Forbidden - wrong organizer |
| AC-006 | FR-027, ERR-007 | Conflict - in_progress |
| AC-007 | FR-027, ERR-008 | Conflict - completed |
| AC-008 | FR-027, ERR-008 | Conflict - already cancelled |
| AC-009 | FR-028, ERR-007 | Conflict - started |
| AC-010 | FR-026, ERR-009 | Not found |
| AC-011 | FR-029, ERR-001 | Invalid UUID |
| AC-012 | FR-030, ERR-002 | Reason too long |
| AC-013 | FR-009, FR-020, FR-043 | Room booking cancelled + reason |
| AC-014 | FR-022 | No room booking |
| AC-015 | FR-010 | Usage not_started → released |
| AC-016 | FR-011 | Usage not created when not exists |
| AC-017 | FR-012 | Meeting event: status_changed |
| AC-018 | FR-013 | Room event: room_released |
| AC-019 | FR-039 | Notification subject prefix |
| AC-020 | FR-040 | Notification includes reason |
| AC-021 | FR-014, FR-015 | Audit log created |
| AC-022 | FR-031, ERR-010 | Concurrent cancel |

---

## 8. Out of Scope

Các nội dung sau **không thuộc phạm vi** của feature này:

### 8.1 Không triển khai trong feature này

- **Xóa vĩnh viễn meeting khỏi database**: Feature này chỉ hủy (soft update), không hard delete.
- **Khôi phục meeting đã hủy**: Meeting đã cancelled là terminal state, không hỗ trợ un-cancel.
- **Hủy toàn bộ recurring series**: Feature này chỉ hủy một meeting record/occurrence cụ thể.
- **Kết thúc sớm meeting đang diễn ra**: Meeting in_progress phải dùng feature "End Meeting" riêng.
- **Sửa thời gian/phòng meeting**: Không phải chức năng hủy.
- **Phê duyệt yêu cầu hủy meeting**: Hủy là hành động trực tiếp, không qua approval workflow.
- **Retry chi tiết từng email recipient**: Nếu chưa có notification recipient table riêng, không retry từng recipient.
- **Gửi email thực tế đồng bộ trong HTTP request**: Email phải qua background job.
- **Không thêm bảng/cột mới**: Chỉ dùng các bảng đã có trong Database v3.2 Compact.

### 8.2 Có thể xem xét ở feature khác

- Hủy toàn bộ recurring series (feature riêng cho recurring meeting management).
- Kết thúc sớm meeting đang diễn ra (feature cho live-meeting/live-session).
- Reschedule meeting (feature cho update meeting time).
- Gửi cancellation survey sau khi hủy.
- Tính năng "hủy hàng loạt" nhiều meeting cùng lúc.

### 8.3 Out-of-scope EARS Guardrails

```text
OOS-001: THE system SHALL NOT implement hard delete of meeting data as part of this feature.
OOS-002: THE system SHALL NOT create new database tables or fields beyond what is specified in this document.
OOS-003: THE system SHALL NOT implement recurring series cancellation as part of this feature.
OOS-004: THE system SHALL NOT implement early meeting end (for in_progress meetings) as part of this feature.
OOS-005: THE system SHALL NOT send emails synchronously within the HTTP request lifecycle.
```
