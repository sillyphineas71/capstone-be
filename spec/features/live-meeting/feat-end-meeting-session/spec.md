# Feature Specification: Kết thúc phiên họp (End Meeting Session)

- **Feature ID**: UC-IMM-05
- **Feature Name**: Kết thúc phiên họp
- **Module / Domain**: live-meeting
- **Created Date**: 2026-06-17
- **Status**: Draft
- **Source Documents**:
  - Database v3.2 Compact (39 tables)
  - AGENTS.md - Backend Agent Guide v1.1
  - API_CONTRACT_v1.0_with_system_roles.md (UC-98)
  - SPEC_ALIGNMENT_WITH_DB_V3_2_COMPACT.md
  - Spec UC-IMM-01 (feat-start-meeting-session)
  - Spec UC-IMM-03 (feat-process-meeting-extension-request)
  - Use Case nhập từ user: UC-IMM-05

---

## 📝 CHANGELOG & REVISION HISTORY
| Ngày cập nhật | Tóm tắt thay đổi | Các dòng thay đổi |
| :--- | :--- | :--- |
| 2026-06-17 | Tạo spec lần đầu cho UC-IMM-05 Kết thúc phiên họp | Toàn bộ file |
| 2026-06-17 | Cập nhật Clarification: cancel pending extension, chốt enum usage/booking/event, chuẩn hóa transaction lock. | Các mục 1.4, 1.5, 3, 5, 6, 7, 8 |

---

## Hướng dẫn viết EARS Requirements

Functional Requirements trong spec này viết theo EARS.
Keyword EARS giữ nguyên bằng tiếng Anh. Nội dung nghiệp vụ viết bằng tiếng Việt.

| Keyword | Vai trò |
| --- | --- |
| `THE system SHALL` | Yêu cầu luôn đúng, không phụ thuộc event/state/option/error |
| `WHEN` | Trigger/event xảy ra tại một thời điểm |
| `WHILE` | Hành vi đúng trong suốt một trạng thái |
| `WHERE` | Yêu cầu chỉ áp dụng khi feature/capability/config tồn tại |
| `IF ... THEN` | Xử lý lỗi, ngoại lệ, điều kiện không mong muốn |

---

## 1. Context & Goal

### 1.1 Bối cảnh

Tính năng UC-IMM-05 thuộc nhóm In-Meeting Management, module `live-meeting`.

Trong quy trình meeting lifecycle, sau khi cuộc họp đã được bắt đầu (`in_progress`), bước tiếp theo là kết thúc phiên họp khi Host hoặc người có quyền quyết định rằng cuộc họp đã hoàn tất. Đây là mốc chuyển trạng thái từ giai đoạn trong cuộc họp (in-meeting) sang giai đoạn sau cuộc họp (post-meeting).

Hiện tại hệ thống đã có cơ chế bắt đầu phiên họp (UC-IMM-01) và xử lý gia hạn phiên họp (UC-IMM-02, UC-IMM-03), nhưng chưa có cơ chế cho phép kết thúc phiên họp một cách chính thức: ghi nhận mốc thời gian kết thúc thực tế (`actual_end_time`), cập nhật trạng thái cuộc họp, giải phóng phòng nếu kết thúc sớm, đồng bộ trạng thái realtime đến participants, và xử lý các pending extension request nếu có.

Tính năng này liên quan tới: actor (Host, Business Admin), meeting entity (chuyển `IN_PROGRESS` → `COMPLETED`), meeting events (`meeting_ended`), room booking/usage (release nếu kết thúc sớm), room events, audit logs, realtime/WebSocket clients, và tương tác với extension request đang pending (nếu có).

### 1.2 Mục tiêu

Mục tiêu của tính năng này là cho phép **Host** (hoặc **Business Admin** với quyền override) kết thúc một phiên họp đang `IN_PROGRESS` nhằm:
- Chuyển trạng thái cuộc họp từ `IN_PROGRESS` sang `COMPLETED`.
- Ghi nhận mốc thời gian kết thúc thực tế (`actual_end_time`) bằng server time.
- Nếu kết thúc sớm hơn `end_time` dự kiến, giải phóng phòng họp để phòng hiển thị `AVAILABLE`.
- Tạo timeline event (`meeting_ended`) trong `meeting_events`.
- Tạo `room_events` nếu có release phòng.
- Ghi audit log cho hành động kết thúc phiên họp.
- Gửi realtime/WebSocket notification cho các participant đang mở dashboard.
- Xử lý hợp lý mối quan hệ với pending extension request (nếu có).

### 1.3 Giá trị mang lại

- **Host / Business Admin**: Có thể chủ động kết thúc cuộc họp khi nội dung đã hoàn tất, ghi nhận mốc thời gian thực tế.
- **Participants**: Nhận trạng thái cuộc họp realtime, biết khi nào phiên họp kết thúc.
- **Vận hành phòng họp**: Phòng được release sớm nếu kết thúc trước giờ, tối ưu tài nguyên phòng và giảm no-show/phantom booking.
- **Dữ liệu và báo cáo**: `actual_end_time` là dữ liệu quan trọng cho utilization, no-show detection, duration analytics, và audit.

### 1.4 Giả định

- Meeting hiện tại đang ở trạng thái `IN_PROGRESS`.
- Server time được dùng làm nguồn thời gian chính thống (không tin client time).
- `actual_end_time` là dữ liệu bất biến sau khi đã ghi nhận (không cho phép ghi đè).
- Việc gửi realtime notification được xử lý best-effort sau transaction commit.
- Phòng được release chỉ khi `now() < meetings.end_time` (kết thúc sớm hơn dự kiến).
- `room_bookings.status` hiện hành phải là `active` đối với meeting đang `IN_PROGRESS`.

### 1.5 Cần làm rõ

*(Đã làm rõ và chốt quy trình lock transaction, cancel pending extension, chuẩn hóa các enum trạng thái trong buổi clarify).*

---

## 2. Actor & Roles

### 2.1 Danh sách actor

| Actor | Vai trò trong tính năng | Quyền / Trách nhiệm chính |
| --- | --- | --- |
| Internal Employee (Host) | Người chủ trì cuộc họp, có quyền kết thúc phiên họp của chính mình | Khởi tạo hành động end meeting |
| Business Admin | Người quản trị có quyền override, kết thúc phiên họp bất kỳ đang `IN_PROGRESS` | End meeting của phòng ban khác trong trường hợp đặc biệt |
| Participants | Người tham gia cuộc họp, nhận trạng thái realtime | Nhận thông báo realtime khi meeting ended |
| Realtime/WebSocket clients | WebSocket client nhận trạng thái realtime | Nhận và hiển thị trạng thái `COMPLETED` |

### 2.2 Role & Permission Rules

- **Quyền cơ bản**: `meeting.session.end` cho Host (end meeting của chính mình).
- **Quyền override**: `meeting.session.end.any` hoặc quyền Business Admin override (end meeting bất kỳ đang `IN_PROGRESS`).
- Host được phép end meeting nếu họ là `host_id` hoặc `organizer_id` của meeting đó VÀ có permission `meeting.session.end`.
- Business Admin được phép end meeting bất kỳ nếu có permission override tương ứng.
- Backend kiểm tra cả permission lẫn ownership trước khi cho phép thao tác (trừ override).
- Participant thông thường không được phép end toàn bộ meeting (kể cả khi họ là participant duy nhất còn lại).

### 2.3 Actor Constraints

- Host hoặc Business Admin phải được xác thực (JWT hợp lệ).
- Meeting phải đang ở trạng thái `IN_PROGRESS`.

---

## 3. Functional Requirements

### 3.1 Core Requirements

```text
FR-001: THE system SHALL cho phép Host (có permission `meeting.session.end`) kết thúc phiên họp của chính mình thông qua API endpoint.
FR-002: THE system SHALL chỉ cho phép kết thúc phiên họp khi meeting đang ở trạng thái `IN_PROGRESS`.
FR-003: THE system SHALL ghi nhận `actual_end_time` bằng server time hiện tại, không chấp nhận client time.
FR-004: THE system SHALL đảm bảo `actual_end_time` là bất biến: nếu đã có giá trị (meeting đã `COMPLETED`), API không được ghi đè.
```

### 3.2 Event-driven Requirements

```text
FR-005: WHEN Host hoặc Business Admin gửi yêu cầu kết thúc phiên họp, THE system SHALL kiểm tra quyền, trạng thái meeting, và ownership trước khi cập nhật.
FR-006: WHEN yêu cầu kết thúc phiên họp được xác thực thành công, THE system SHALL chuyển trạng thái meeting sang `COMPLETED` và ghi nhận `actual_end_time = now()`.
FR-007: WHEN meeting được chuyển sang `COMPLETED`, THE system SHALL tạo bản ghi `meeting_events` với `event_type = meeting_ended`, `event_time = now()`, `source_type = manual`.
FR-008: WHEN meeting được chuyển sang `COMPLETED`, THE system SHALL ghi `audit_logs` với `action_type = end_meeting`, `entity_type = meeting`, `entity_id = meetingId`.
FR-009: WHEN `now() < meetings.end_time` (kết thúc sớm), THE system SHALL cập nhật `room_booking_usages.actual_end_time = now()` và `usage_status = completed`, đồng thời cập nhật `room_bookings.status = completed` (nếu booking đang `active`).
FR-010: WHEN phòng được release do kết thúc sớm, THE system SHALL tạo `room_events` với `event_type = room_released`, `description = 'Room released because meeting ended early.'`, và `metadata_json` chứa `reason: 'meeting_ended_early'`, `plannedEndTime`, `actualEndTime`.
FR-011: WHEN meeting được kết thúc thành công, THE system SHALL phát realtime/WebSocket event `meeting.ended` đến các participant đang kết nối (sau khi transaction commit).
```

### 3.3 State-driven Requirements

```text
FR-012: WHILE meeting đang ở trạng thái `IN_PROGRESS`, THE system SHALL cho phép Host và Business Admin (có quyền) kết thúc phiên họp.
FR-013: WHILE meeting đang ở trạng thái `SCHEDULED`, `COMPLETED`, hoặc `CANCELLED`, THE system SHALL không cho phép kết thúc phiên họp.
FR-014: WHILE `actual_end_time` đã có giá trị (meeting đã `COMPLETED`), THE system SHALL xử lý yêu cầu end meeting theo cơ chế idempotent: trả về lỗi 409 vì meeting đã kết thúc.
```

### 3.4 Optional Feature Requirements

```text
FR-015: WHERE cơ chế WebSocket/realtime được kích hoạt, THE system SHALL phát event realtime đến participants khi meeting ended thành công.
FR-016: WHERE pending extension request tồn tại cho meeting hiện tại (`approval_status = pending`), THE system SHALL cập nhật các request này thành `cancelled` trong cùng transaction kết thúc cuộc họp.
```

### 3.5 Unwanted Behavior Requirements

```text
FR-017: IF meeting không tồn tại (bao gồm đã bị soft-delete), THEN THE system SHALL từ chối yêu cầu và trả về lỗi MEETING_NOT_FOUND.
FR-018: IF người dùng không phải Host, không phải Organizer của meeting và không có quyền override, THEN THE system SHALL từ chối yêu cầu và trả về lỗi FORBIDDEN.
FR-019: IF meeting không ở trạng thái `IN_PROGRESS`, THEN THE system SHALL từ chối yêu cầu và trả về lỗi MEETING_NOT_IN_PROGRESS.
FR-020: IF `actual_end_time` đã có giá trị (meeting đã `COMPLETED`), THEN THE system SHALL từ chối yêu cầu và trả về lỗi MEETING_ALREADY_COMPLETED mà không ghi đè dữ liệu.
FR-021: IF meeting ở trạng thái `SCHEDULED`, THEN THE system SHALL từ chối và trả về lỗi MEETING_NOT_STARTED.
FR-022: IF meeting ở trạng thái `CANCELLED`, THEN THE system SHALL từ chối và trả về lỗi MEETING_CANCELLED.
FR-023: IF ghi `meeting_events` hoặc `audit_logs` thất bại, THEN THE system SHALL rollback toàn bộ transaction và trả về lỗi server.
FR-024: IF cập nhật `room_booking_usages` hoặc `room_bookings` thất bại, THEN THE system SHALL rollback toàn bộ transaction và trả về lỗi server.
FR-024.1: IF không tìm thấy booking đang `active` tương ứng với meeting đang `IN_PROGRESS`, THEN THE system SHALL trả về lỗi `STATE_INVALID` (409) và không tự động cập nhật booking khác.
FR-025: IF push realtime notification thất bại sau khi transaction commit, THEN THE system SHALL giữ nguyên dữ liệu meeting đã cập nhật và ghi log lỗi realtime (best-effort).
```

### 3.6 Workflow Requirements

```text
FR-026: WHEN Host gửi yêu cầu end meeting, THE system SHALL thực hiện tuần tự trong một transaction với row lock phù hợp (lock `meetings`, lock active `room_bookings`, lock `room_booking_usages`, lock pending `meeting_requests`): cập nhật meetings, room_bookings, room_booking_usages, cancel pending extension requests, ghi meeting_events, room_events (nếu release phòng), audit_logs, sau đó commit transaction, và phát realtime event (best-effort).
FR-027: WHEN có nhiều request end meeting đồng thời đến cùng một meeting, THE system SHALL sử dụng database row lock (SELECT FOR UPDATE) để đảm bảo chỉ một request được xử lý; request sau sẽ phát hiện status đã thay đổi và trả lỗi MEETING_ALREADY_COMPLETED.
```

### 3.7 Authorization Requirements

```text
FR-028: IF the user is not authenticated, THEN THE system SHALL reject access to this feature.
FR-029: IF the user does not have `meeting.session.end`, THEN THE system SHALL reject the request without modifying data.
FR-030: WHEN the user performs end meeting action, THE system SHALL verify that the user is either the Host/Organizer (với permission `meeting.session.end`) or has explicit override permission `meeting.session.end.any`.
```

### 3.8 Data & State Requirements

```text
FR-031: WHEN end meeting thành công, THE system SHALL cập nhật `meetings.status = COMPLETED` và `meetings.actual_end_time = now()`.
FR-032: WHEN end meeting thành công, THE system SHALL ghi `meetings.updated_at = now()` và `meetings.updated_by = currentUserId`.
FR-033: WHEN end meeting thành công và `now() < meetings.end_time`, THE system SHALL cập nhật `room_booking_usages.actual_end_time = now()` và `usage_status = completed`, cập nhật `room_bookings.status = completed` (booking phải đang `active`).
FR-034: WHEN end meeting thành công và `now() >= meetings.end_time`, THE system SHALL cập nhật `room_booking_usages.actual_end_time = now()` và `usage_status = completed`, không cần release phòng vì booking đã hết hạn.
FR-035: WHEN end meeting thành công, THE system SHALL tạo `meeting_events` với `event_type = meeting_ended`, `source_type = manual`, `event_time = now()`, `actor_id = currentUserId`.
FR-036: WHERE phòng được release vì kết thúc sớm, THE system SHALL tạo `room_events` với `event_type = room_released`, `room_id`, `reference_meeting_id`, `event_time = now()`, `description = 'Room released because meeting ended early.'`, và `metadata_json.reason = 'meeting_ended_early'`.
```

### 3.9 Notification / Audit Requirements

```text
FR-037: WHEN end meeting thành công, THE system SHALL ghi `audit_logs` với `action_type = end_meeting`, `entity_type = meeting`, `entity_id = meetingId`, `actor_id = currentUserId`.
FR-038: WHEN end meeting thành công và realtime channel khả dụng, THE system SHALL phát WebSocket event sau khi transaction commit với event `meeting.ended` chứa payload `{ meetingId, status: 'completed', actualEndTime, roomReleased, endedBy }`.
FR-039: IF realtime push fails, THEN THE system SHALL keep the main business transaction result unchanged and record the delivery failure in logs.
```

### 3.10 Extension Request Interaction

```text
FR-040: WHERE có pending extension request (`meeting_requests` với `request_type = extend_meeting`, `approval_status = pending`) cho meeting hiện tại, WHEN meeting được kết thúc, THE system SHALL xử lý trong cùng transaction:
  - Cập nhật các request này thành `approval_status = cancelled`, `decision_by = currentUserId`, `decision_at = now()`, và `notes = 'Cancelled because meeting was ended by Host/Business Admin before extension decision.'`.
  - Không dùng trạng thái `rejected` vì đây không phải quyết định từ chối nghiệp vụ.
FR-041: IF meeting đã được gia hạn thành công trước đó (UC-IMM-02 hoặc UC-IMM-03 đã apply extension), THEN `meetings.end_time` và `room_bookings.reserved_end_time` hiện tại là mốc được extension, việc kết thúc sớm so với mốc này vẫn được coi là kết thúc sớm và phòng được release.
```

### 3.11 Complex / Combined Requirements

```text
FR-042: WHILE meeting đang ở trạng thái `IN_PROGRESS`, WHEN Host gửi yêu cầu end meeting, THE system SHALL thực hiện transaction boundary bắt buộc: lock `meetings`, lock active `room_bookings`, lock `room_booking_usages`, lock pending `meeting_requests`, sau đó cập nhật dữ liệu, insert event/log, commit, và cuối cùng push realtime event best-effort.
FR-043: WHILE có pending extension request cho meeting `IN_PROGRESS`, WHEN Host kết thúc meeting, THE system SHALL hủy (cancel) các pending request này ngay trong transaction end meeting để tránh việc approve sau khi meeting đã kết thúc.
```

### 3.12 Requirement Notes

- Meeting status `IN_PROGRESS` và `COMPLETED` sử dụng giá trị string enum phù hợp với DB v3.2 Compact (có thể là `in_progress`, `completed` - lowercase snake_case theo convention DB).
- `actual_end_time` được tính bằng server time, là timestamp với timezone (timestamptz).
- Lock sử dụng `SELECT FOR UPDATE` trên các bảng liên quan (meetings, room_bookings, room_booking_usages, meeting_requests) để đảm bảo đồng bộ transaction.
- Khi meeting `COMPLETED` và có pending extension, các request này phải được update thành `cancelled` ngay trong cùng transaction.
- Sau khi meeting đã `COMPLETED`, tính năng approve/review extension phải chặn mọi thao tác phê duyệt.
- Notification realtime được xử lý best-effort sau khi transaction đã commit thành công.

### 3.13 Traceability

| Requirement ID | EARS Pattern | Nguồn / Use Case liên quan | Ghi chú |
| --- | --- | --- | --- |
| FR-001 | Ubiquitous | UC-98, UC-IMM-05 | Core: cho phép Host end meeting |
| FR-002 | Ubiquitous | UC-IMM-05 | Chỉ end meeting IN_PROGRESS |
| FR-003 | Ubiquitous | UC-98 | actual_end_time = server time |
| FR-004 | Ubiquitous | UC-IMM-05 | actual_end_time bất biến |
| FR-005 | Event-driven | UC-98 | Validate trước khi end |
| FR-006 | Event-driven | UC-98 | Chuyển COMPLETED, ghi actual_end_time |
| FR-007 | Event-driven | UC-IMM-05 | meeting_events meeting_ended |
| FR-008 | Event-driven | UC-IMM-05 | audit_logs |
| FR-009 | Event-driven | UC-98 | Release phòng nếu kết thúc sớm |
| FR-010 | Event-driven | UC-IMM-05 | room_events nếu release phòng |
| FR-011 | Event-driven | UC-IMM-05 | Realtime notification |
| FR-012 | State-driven | UC-IMM-05 | WHILE IN_PROGRESS |
| FR-013 | State-driven | UC-IMM-05 | WHILE SCHEDULED/COMPLETED/CANCELLED |
| FR-014 | State-driven | UC-IMM-05 | Idempotent: từ chối nếu đã COMPLETED |
| FR-015 | Optional Feature | UC-IMM-05 | Realtime khi có WebSocket |
| FR-016 | Optional Feature | UC-IMM-05 | Pending extension không auto-apply |
| FR-017 | Unwanted Behavior | UC-98 | Meeting không tồn tại |
| FR-018 | Unwanted Behavior | UC-98 | Không đủ quyền |
| FR-019 | Unwanted Behavior | UC-98 | Meeting không IN_PROGRESS |
| FR-020 | Unwanted Behavior | UC-98 | Đã COMPLETED |
| FR-021 | Unwanted Behavior | UC-IMM-05 | Meeting SCHEDULED |
| FR-022 | Unwanted Behavior | UC-IMM-05 | Meeting CANCELLED |
| FR-023 | Unwanted Behavior | UC-IMM-05 | Rollback nếu event/audit thất bại |
| FR-024 | Unwanted Behavior | UC-IMM-05 | Rollback nếu booking/usage thất bại |
| FR-025 | Unwanted Behavior | UC-IMM-05 | Realtime failure: best-effort |
| FR-026 | Workflow | UC-98 | Transaction sequence |
| FR-027 | Workflow | UC-IMM-05 | Row lock chống race condition |
| FR-028 | Authorization | API Convention | Auth |
| FR-029 | Authorization | UC-98 | Permission check |
| FR-030 | Authorization | UC-IMM-05 | Ownership + override check |
| FR-031 | Data | UC-98 | Update meetings status, actual_end_time |
| FR-032 | Data | UC-IMM-05 | Update updated_by, updated_at |
| FR-033 | Data | UC-98 | Release phòng nếu kết thúc sớm |
| FR-034 | Data | UC-IMM-05 | Kết thúc đúng/trễ giờ |
| FR-035 | Data | UC-IMM-05 | meeting_events |
| FR-036 | Data | UC-IMM-05 | room_events nếu release phòng |
| FR-037 | Audit | UC-98 | audit_logs |
| FR-038 | Notification | UC-IMM-05 | WebSocket event |
| FR-039 | Notification | UC-IMM-05 | Best-effort realtime |
| FR-040 | Complex | UC-IMM-05 | Pending extension không auto-apply |
| FR-041 | Complex | UC-IMM-03 | Extension đã apply trước đó |
| FR-042 | Complex | UC-98, UC-IMM-05 | Full workflow transaction |
| FR-043 | Complex | UC-IMM-05 | Pending extension + end meeting |

---

## 4. Non-functional Requirements

### 4.1 Performance

```text
NFR-001: THE system SHALL respond to end meeting request within 3 seconds under normal load.
NFR-002: THE system SHALL support at least 50 concurrent end meeting requests.
```

### 4.2 Security

```text
NFR-003: THE system SHALL require authentication before allowing access to end meeting feature.
NFR-004: THE system SHALL enforce authorization (permission + ownership) for every end meeting operation.
NFR-005: THE system SHALL NOT expose unnecessary sensitive data in API responses or WebSocket payloads.
```

### 4.3 Reliability & Consistency

```text
NFR-006: THE system SHALL prevent partial updates using database transactions.
NFR-007: THE system SHALL keep related entity states consistent (meeting, booking, usage, events).
NFR-008: THE system SHALL use row-level locking (SELECT FOR UPDATE) to prevent race conditions during state transition.
NFR-009: THE system SHALL đảm bảo actual_end_time được ghi nhận chính xác dựa trên server time, không bị ảnh hưởng bởi clock drift của client.
```

### 4.4 Usability

```text
NFR-010: THE system SHALL return clear error messages that the client can interpret or display.
NFR-011: THE system SHALL use field names and response formats consistent with the project API convention (dùng snake_case mapping trong response DTO nếu cần).
```

### 4.5 Observability

```text
NFR-012: THE system SHALL log important processing errors for this feature.
NFR-013: THE system SHALL record audit logs for end meeting actions.
NFR-014: WHEN an unexpected error occurs during end meeting, THE system SHALL record enough diagnostic information for troubleshooting.
```

---

## 5. Data Model

> Không thêm bảng mới. Tất cả đều dùng bảng có sẵn trong DB v3.2 Compact.

### 5.1 Entity liên quan

| Entity / Table | Vai trò trong tính năng | Ghi chú |
| --- | --- | --- |
| `meetings` | Bảng lõi: cập nhật `status = COMPLETED`, `actual_end_time`, `updated_by`, `updated_at` | Trạng thái chuyển từ `IN_PROGRESS` sang `COMPLETED` |
| `meeting_events` | Ghi timeline event `meeting_ended` | `source_type = manual`, `actor_id` ghi nhận người kết thúc |
| `room_bookings` | Cập nhật `status = completed` nếu booking đang `active` và kết thúc sớm | Chỉ cập nhật khi cần release phòng |
| `room_booking_usages` | Cập nhật `actual_end_time = now()`, `usage_status = completed` | Luôn set `completed` cho cả kết thúc sớm và đúng giờ |
| `room_events` | Ghi event release phòng nếu kết thúc sớm | `event_type = room_released`, kèm lý do trong `metadata_json` |
| `audit_logs` | Ghi audit log cho hành động end meeting | `action_type = end_meeting` |
| `notifications` | INSERT notification cho các participant (in-app) | `notification_type = meeting_ended` |
| `meeting_requests` | Cập nhật pending extension request thành `cancelled` | Hủy các yêu cầu gia hạn chưa duyệt |

### 5.2 Dữ liệu đầu vào

| Field | Type dự kiến | Bắt buộc | Mô tả | Validation |
| --- | :---: | :---: | --- | --- |
| `meetingId` | UUID (path param) | Có | ID của cuộc họp cần kết thúc | UUID hợp lệ, meeting tồn tại |

Không có request body cho manual flow.

### 5.3 Dữ liệu đầu ra (API Response)

| Field | Type dự kiến | Mô tả |
| --- | :---: | --- |
| `meetingId` | UUID | ID cuộc họp |
| `status` | string | `completed` |
| `actualEndTime` | ISO-8601 timestamptz | Thời gian kết thúc thực tế |
| `duration` | number (phút) | Thời lượng thực tế = actualEndTime - actualStartTime (tính bằng phút) |
| `roomReleased` | boolean | `true` nếu phòng được release do kết thúc sớm |

### 5.4 State / Status Model

**Meeting status transition (trong scope này):**
`IN_PROGRESS` -> `COMPLETED`

**Room booking status transition:**
`active` -> `completed` (nếu kết thúc sớm)

**Room booking usage status transition:**
`in_use` -> `completed` (kết thúc đúng giờ, trễ, hoặc sớm - luôn là `completed` vì cuộc họp đã diễn ra hợp lệ). Trạng thái `released` không dùng trong UC này.

### 5.5 Data Constraints

- `meetings.status` phải là `IN_PROGRESS` để có thể end.
- `meetings.actual_end_time` phải `NULL` trước khi end (nếu đã có giá trị, từ chối).
- `meetings.actual_end_time` chỉ được set một lần, không ghi đè.
- Các cập nhật dữ liệu (meetings, room_bookings, room_booking_usages, events, audit_logs) phải diễn ra trong cùng một transaction.
- Khi `now() < meetings.end_time`: phòng được release.
- Khi `now() >= meetings.end_time`: phòng không cần release (đã hết giờ).

### 5.6 Data Lifecycle

- Khi Host kết thúc meeting: `meetings.actual_end_time` được set.
- `meetings.status` chuyển sang `COMPLETED` - đây là terminal status (không thể chuyển lại).
- `room_booking_usages.actual_end_time` được cập nhật để phục vụ utilization calculation.
- `room_bookings.status` được cập nhật nếu cần release phòng.
- Dữ liệu sau khi kết thúc được dùng cho reporting, analytics, audit.

### 5.7 Data-related EARS Requirements

```text
FR-DATA-001: WHEN meeting được kết thúc thành công, THE system SHALL set `meetings.status = COMPLETED`, `meetings.actual_end_time = now()`, `meetings.updated_by = currentUserId`, `meetings.updated_at = now()`.
FR-DATA-002: WHEN meeting được kết thúc thành công, THE system SHALL set `room_booking_usages.actual_end_time = now()` và `usage_status = completed`.
FR-DATA-003: IF `now() < meetings.end_time`, THEN THE system SHALL set `room_booking_usages.usage_status = completed` và `room_bookings.status = completed` (yêu cầu booking hiện tại đang `active`).
FR-DATA-004: IF `actual_end_time` đã có giá trị, THEN THE system SHALL reject the request và không thay đổi dữ liệu.
FR-DATA-005: WHEN `meeting_events` được tạo, THE system SHALL ghi `event_type = meeting_ended`, `source_type = manual`, `actor_id = currentUserId`, `event_time = now()`.
```

### 5.8 Cần làm rõ

- *(Không có. Toàn bộ các bảng/cột đã có sẵn trong DB v3.2 Compact.)*

---

## 6. Error Handling

### 6.1 Validation Errors

```text
ERR-001: IF `meetingId` is missing or invalid UUID format, THEN THE system SHALL reject the request and return error code `VALIDATION_ERROR` (422).
```

### 6.2 Authentication / Authorization Errors

```text
ERR-002: IF the user is not authenticated, THEN THE system SHALL return error code `UNAUTHORIZED` (401).
ERR-003: IF the user lacks `meeting.session.end` (và không có quyền override), THEN THE system SHALL return error code `PERMISSION_DENIED` (403).
ERR-004: IF the user has `meeting.session.end` nhưng không phải Host/Organizer của meeting và không có quyền override `meeting.session.end.any`, THEN THE system SHALL return error code `PERMISSION_DENIED` (403).
```

### 6.3 Business Rule Errors

```text
ERR-005: IF the meeting does not exist or has been soft-deleted, THEN THE system SHALL return `MEETING_NOT_FOUND` (404).
ERR-006: IF the meeting status is not `IN_PROGRESS`, THEN THE system SHALL return error code `MEETING_NOT_IN_PROGRESS` (409).
ERR-007: IF the meeting is already `COMPLETED` (`actual_end_time` đã có giá trị), THEN THE system SHALL return error code `MEETING_ALREADY_COMPLETED` (409).
ERR-008: IF the meeting is `SCHEDULED` (chưa bắt đầu), THEN THE system SHALL return error code `MEETING_NOT_STARTED` (409).
ERR-009: IF the meeting is `CANCELLED`, THEN THE system SHALL return error code `MEETING_CANCELLED` (409).
ERR-009.1: IF không tìm thấy active booking của meeting đang `IN_PROGRESS`, THEN THE system SHALL return error code `STATE_INVALID` (409).
```

### 6.4 Conflict Errors

```text
ERR-010: IF concurrent end requests are received, THE system SHALL use DB row lock. First succeeds, subsequent ones detect status change and return `MEETING_ALREADY_COMPLETED` (409).
```

### 6.5 Error Response Format

```json
{
  "success": false,
  "message": "Meeting is already completed",
  "error": {
    "code": "MEETING_ALREADY_COMPLETED",
    "details": {
      "meetingId": "uuid",
      "currentStatus": "completed",
      "actualEndTime": "2026-06-10T10:28:00+07:00"
    }
  },
  "timestamp": "2026-06-10T10:28:00+07:00",
  "path": "/api/v1/live-meetings/{meetingId}/end"
}
```

### 6.6 Error Code Map

| Error Code | HTTP | Mô tả |
| ---: | ---: | --- |
| `VALIDATION_ERROR` | 422 | meetingId invalid format |
| `UNAUTHORIZED` | 401 | Chưa đăng nhập |
| `PERMISSION_DENIED` | 403 | Không đủ quyền hoặc không phải Host |
| `MEETING_NOT_FOUND` | 404 | Meeting không tồn tại |
| `MEETING_NOT_IN_PROGRESS` | 409 | Meeting không ở trạng thái IN_PROGRESS |
| `MEETING_ALREADY_COMPLETED` | 409 | Meeting đã kết thúc trước đó (idempotent) |
| `MEETING_NOT_STARTED` | 409 | Meeting chưa bắt đầu (SCHEDULED) |
| `MEETING_CANCELLED` | 409 | Meeting đã bị hủy |
| `STATE_INVALID` | 409 | Không tìm thấy active booking tương ứng |
| `INTERNAL_ERROR` | 500 | Lỗi server không xác định |

---

## 7. Acceptance Criteria

### 7.1 Happy Path

```text
AC-001 (Kết thúc phiên họp thành công - đúng giờ):
Given một meeting đang `IN_PROGRESS`, `now() >= meetings.end_time`,
When Host gửi yêu cầu end meeting,
Then hệ thống chuyển meeting sang `COMPLETED`, ghi `actual_end_time`, cập nhật `room_booking_usages.actual_end_time = now()` và `usage_status = completed`, tạo meeting_events (meeting_ended), ghi audit_logs, và phát realtime notification.

AC-002 (Kết thúc phiên họp thành công - sớm hơn dự kiến):
Given một meeting đang `IN_PROGRESS`, `now() < meetings.end_time` (còn thời gian),
When Host gửi yêu cầu end meeting,
Then hệ thống chuyển meeting sang `COMPLETED`, ghi `actual_end_time`, cập nhật `room_booking_usages.actual_end_time = now()` và `usage_status = completed`, cập nhật `room_bookings.status = completed`, tạo room_events `room_released`, tạo meeting_events, ghi audit_logs, và phát realtime notification `meeting.ended` kèm `roomReleased: true`.
```

### 7.2 Validation Cases

```text
AC-003 (MeetingId không hợp lệ):
Given `meetingId` không phải UUID hợp lệ hoặc không tồn tại,
When user gửi yêu cầu end meeting,
Then hệ thống trả về 422 VALIDATION_ERROR hoặc 404 MEETING_NOT_FOUND.
```

### 7.3 Authorization Cases

```text
AC-004 (Không đăng nhập):
Given user không có JWT token hợp lệ,
When user gửi yêu cầu end meeting,
Then hệ thống trả về 401 UNAUTHORIZED.

AC-005 (Không đủ quyền - participant cố tình end meeting):
Given user là participant thường (không phải Host, không phải Business Admin),
When user gửi yêu cầu end meeting,
Then hệ thống trả về 403 PERMISSION_DENIED.

AC-006 (Business Admin override thành công):
Given user là Business Admin có quyền override `meeting.session.end.any`, meeting đang `IN_PROGRESS`,
When user gửi yêu cầu end meeting (không phải meeting của mình),
Then hệ thống cho phép kết thúc meeting thành công.
```

### 7.4 Business Rule Cases

```text
AC-007 (Meeting không IN_PROGRESS):
Given meeting đang ở trạng thái `SCHEDULED`,
When Host gửi yêu cầu end meeting,
Then hệ thống trả về 409 MEETING_NOT_STARTED.

AC-008 (Meeting đã COMPLETED - idempotent reject):
Given meeting đã có `actual_end_time` (đã COMPLETED),
When Host gửi lại yêu cầu end meeting,
Then hệ thống trả về 409 MEETING_ALREADY_COMPLETED và không thay đổi dữ liệu.

AC-009 (Meeting đã CANCELLED):
Given meeting đã CANCELLED,
When Host gửi yêu cầu end meeting,
Then hệ thống trả về 409 MEETING_CANCELLED.
```

### 7.5 State Transition Cases

```text
AC-010 (Meeting status transition):
Given meeting đang `IN_PROGRESS`,
When end meeting thành công,
Then `meetings.status` chuyển sang `COMPLETED`, `actual_end_time` được set, không thể chuyển lại.

AC-011 (Room booking usage transition - early end):
Given meeting kết thúc sớm hơn `meetings.end_time`,
When end meeting thành công,
Then `room_booking_usages.usage_status = completed`, `room_bookings.status = completed`.

AC-012 (Room booking usage transition - on time end):
Given meeting kết thúc đúng giờ hoặc trễ hơn `meetings.end_time`,
When end meeting thành công,
Then `room_booking_usages.usage_status = completed`, không cần release phòng.
```

### 7.6 Audit / Notification Cases

```text
AC-013 (Audit log cho end meeting):
Given end meeting thành công,
When transaction hoàn tất,
Then `audit_logs` có record với `action_type = end_meeting`, `entity_id = meetingId`, `actor_id = currentUserId`.

AC-014 (Meeting events cho end meeting):
Given end meeting thành công,
When transaction hoàn tất,
Then `meeting_events` có record với `event_type = meeting_ended`, `source_type = manual`.

AC-015 (Realtime notification):
Given WebSocket/realtime đang hoạt động,
When transaction end meeting commit thành công,
Then các participant đang kết nối nhận được event `meeting.ended` với payload `{ meetingId, status: 'completed', actualEndTime, roomReleased, endedBy }`.
```

### 7.7 Extension Request Interaction Cases

```text
AC-016 (Kết thúc meeting khi có pending extension):
Given meeting đang `IN_PROGRESS`, có `meeting_requests` với `request_type = extend_meeting`, `approval_status = pending`,
When Host kết thúc meeting,
Then meeting chuyển sang `COMPLETED` bình thường, các pending extension request được update thành `cancelled` trong cùng transaction với lý do meeting đã ended.

AC-017 (Kết thúc meeting sau khi extension đã được apply):
Given meeting đã được gia hạn thành công (UC-IMM-02/03), `meetings.end_time` đã là extended end time,
When Host kết thúc sớm hơn extended end time,
Then phòng được release (roomReleased = true), các cập nhật booking/usage dựa trên extended end time.
```

### 7.8 Concurrency Cases

```text
AC-018 (Race condition - double end meeting):
Given hai request end meeting đến cùng lúc cho cùng một meeting,
When cả hai request được xử lý,
Then request đầu tiên thành công (meeting -> COMPLETED), request thứ hai phát hiện `actual_end_time` đã có giá trị và trả về 409 MEETING_ALREADY_COMPLETED.
```

### 7.9 Acceptance Criteria Traceability

| AC ID | Requirement ID liên quan | Kịch bản test chính |
| --- | --- | --- |
| AC-001 | FR-001, FR-006, FR-007, FR-008, FR-034 | End đúng giờ |
| AC-002 | FR-001, FR-006, FR-009, FR-010, FR-036 | End sớm, release phòng |
| AC-003 | FR-017, ERR-001, ERR-005 | MeetingId không hợp lệ |
| AC-004 | FR-028, ERR-002 | Chưa đăng nhập |
| AC-005 | FR-029, FR-030, ERR-003 | Participant không đủ quyền |
| AC-006 | FR-001, FR-030, ERR-004 | Business Admin override |
| AC-007 | FR-021, ERR-008 | Meeting SCHEDULED |
| AC-008 | FR-004, FR-020, ERR-007 | Meeting đã COMPLETED |
| AC-009 | FR-022, ERR-009 | Meeting CANCELLED |
| AC-010 | FR-031, FR-013 | Status transition |
| AC-011 | FR-033, FR-009 | Room booking usage early end |
| AC-012 | FR-034 | Room booking usage on time |
| AC-013 | FR-037 | Audit log |
| AC-014 | FR-035 | Meeting events |
| AC-015 | FR-038 | Realtime notification |
| AC-016 | FR-040 | Pending extension + end meeting |
| AC-017 | FR-041 | Extension đã apply + end sớm |
| AC-018 | FR-027, ERR-010 | Race condition |

---

## 8. Out of Scope

Các nội dung sau **không thuộc phạm vi** của feature UC-IMM-05:

- Bắt đầu phiên họp (thuộc UC-IMM-01).
- Yêu cầu gia hạn phiên họp (thuộc UC-IMM-02).
- Phê duyệt/từ chối yêu cầu gia hạn (thuộc UC-IMM-03).
- Xử lý recording/transcription/minutes/document khi meeting kết thúc.
- Tính presence duration (UC-89) - chỉ trigger, không implement trong feature này.
- Email notification (chỉ in-app notification và realtime WebSocket).
- Ghi âm/ghi hình tự động khi meeting kết thúc.
- Tự động detect no-show (thuộc utilization module).
- Tạo biên bản họp (minutes).
- Thêm bảng/cột mới vào database.

### 8.1 Không triển khai trong feature này

- Không implement endpoint cho Business Admin override nếu chưa có trong API contract (chỉ thiết kế permission guard hỗ trợ override pattern).
- Không trigger tính presence duration (chỉ ghi chú trong response như UC-98 gợi ý).

### 8.2 Có thể xem xét ở feature khác

- Integration: trigger presence duration calculation (UC-89).
- Enhancement: auto-end meeting nếu tất cả participants đã leave.
- Enhancement: cho phép Business Admin end meeting qua dashboard admin.

### 8.3 Out-of-scope EARS Guardrails

```text
OOS-001: THE system SHALL NOT implement start meeting functionality in this feature.
OOS-002: THE system SHALL NOT implement extension request approval/rejection in this feature.
OOS-003: THE system SHALL NOT create new database tables or columns for this feature.
OOS-004: THE system SHALL NOT implement recording/transcription/minutes management in this feature.
OOS-005: THE system SHALL NOT send email notifications for meeting end events in this feature.
```

