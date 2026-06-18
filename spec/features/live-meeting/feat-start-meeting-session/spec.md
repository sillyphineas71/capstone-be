# Feature Specification: Bắt đầu phiên họp (Start Meeting Session)

- **Feature ID**: UC-IMM-01
- **Feature Name**: Bắt đầu phiên họp
- **Module / Domain**: live-meeting
- **Created Date**: 2026-06-16
- **Status**: Draft
- **Source Documents**:
  - Database v3.2 Compact (39 tables)
  - AGENTS.md — Backend Agent Guide v1.1
  - API_CONTRACT_v1.0_with_system_roles.md
  - Use Case nhập từ user: UC-IMM-01

---

## 📝 CHANGELOG & REVISION HISTORY
| Ngày cập nhật | Tóm tắt thay đổi | Các dòng thay đổi |
| :--- | :--- | :--- |
| 2026-06-16 | Tạo spec lần đầu cho UC-IMM-01 Bắt đầu phiên họp | Toàn bộ file |
| 2026-06-16 | Implement code toàn bộ feature (18 tasks): module, enum, seed, DTO, error constants, types, service, controller, WebSocket, AF1 internal service, tests | Mục 3, 5, 7
| 2026-06-16 | Cập nhật spec sau khi clarify: time window (-15m), WebSocket payload, permission, cập nhật booking status, cơ chế lock chống race condition, và out of scope warning. | Các mục 1.5, 2.2, 3, 5, 6, 8 |

---

## Hướng dẫn viết EARS Requirements

Functional Requirements trong spec này viết theo EARS.
Keyword EARS giữ nguyên bằng tiếng Anh. Nội dung nghiệp vụ viết bằng tiếng Việt.

| Keyword | Vai trò |
|---|---|
| `THE system SHALL` | Yêu cầu luôn đúng, không phụ thuộc event/state/option/error |
| `WHEN` | Trigger/event xảy ra tại một thời điểm |
| `WHILE` | Hành vi đúng trong suốt một trạng thái |
| `WHERE` | Yêu cầu chỉ áp dụng khi feature/capability/config tồn tại |
| `IF ... THEN` | Xử lý lỗi, ngoại lệ, điều kiện không mong muốn |

---

## 1. Context & Goal

### 1.1 Bối cảnh

Tính năng UC-IMM-01 thuộc nhóm In-Meeting Management, module `live-meeting`.

Trong quy trình meeting lifecycle, sau khi cuộc họp đã được tạo, duyệt và lên lịch (scheduled), bước tiếp theo là bắt đầu phiên họp thực tế. Đây là mốc chuyển trạng thái quan trọng từ giai đoạn trước cuộc họp (pre-meeting) sang giai đoạn trong cuộc họp (in-meeting).

Hiện tại hệ thống chưa có cơ chế cho phép Host hoặc Organizer chủ động bắt đầu phiên họp, ghi nhận mốc thời gian bắt đầu thực tế (`actual_start_time`), cập nhật trạng thái phòng họp, và đồng bộ trạng thái realtime đến participants.

Tính năng này liên quan tới: actor (Host, Organizer), meeting entity, meeting events, room booking, room booking usage, audit logs, realtime/WebSocket clients, và thiết bị check-in (Door Face Attendance Terminal) cho alternative flow.

### 1.2 Mục tiêu

Mục tiêu của tính năng này là cho phép **Host** hoặc **Organizer** chủ động bắt đầu phiên họp nhằm:
- Chuyển trạng thái cuộc họp từ `scheduled` sang `in_progress`.
- Ghi nhận mốc thời gian bắt đầu thực tế (`actual_start_time`) bằng server time.
- Tạo timeline event (`meeting_started`) trong `meeting_events`.
- Cập nhật trạng thái sử dụng phòng họp sang `in_use` và `active`.
- Ghi audit log cho hành động bắt đầu phiên họp.
- Đồng bộ trạng thái realtime đến participants qua WebSocket với payload chuẩn hóa.
- Hỗ trợ bắt đầu phiên họp qua thiết bị check-in (Door Face Attendance Terminal) thông qua internal service.

### 1.3 Giá trị mang lại

- **Host / Organizer**: Có thể chủ động bắt đầu cuộc họp đúng thời điểm, ghi nhận mốc thời gian thực tế phục vụ theo dõi utilization.
- **Participants**: Nhận được trạng thái cuộc họp realtime, biết khi nào phiên họp chính thức bắt đầu.
- **Vận hành phòng họp**: Cập nhật trạng thái phòng sang `in_use` ngay khi meeting bắt đầu, giúp phát hiện no-show và giải phóng phòng kịp thời.
- **Dữ liệu và báo cáo**: `actual_start_time` là dữ liệu quan trọng cho utilization, no-show detection, và audit.

### 1.4 Giả định

- Cuộc họp đã được tạo, duyệt và hiện ở trạng thái `scheduled`.
- Hệ thống có sẵn cơ chế WebSocket hoặc realtime để đồng bộ trạng thái tới participants.
- Server time được dùng làm nguồn thời gian chính thống (không tin client time).
- `actual_start_time` là dữ liệu bất biến sau khi đã ghi nhận.
- Việc gửi realtime notification được xử lý best-effort sau transaction commit, không rollback dữ liệu chính nếu realtime thất bại.

### 1.5 Cần làm rõ

Đã làm rõ và chốt quyết định ở các phần dưới. (Không còn câu hỏi mở).

---

## 2. Actor & Roles

### 2.1 Danh sách actor

| Actor | Vai trò trong tính năng | Quyền / Trách nhiệm chính |
|---|---|---|
| Internal Employee (Host) | Người chủ trì cuộc họp, có quyền bắt đầu phiên họp | Khởi tạo hành động start meeting |
| Organizer | Người tổ chức cuộc họp, có quyền bắt đầu phiên họp | Khởi tạo hành động start meeting |
| Internal Participants | Người tham gia cuộc họp, nhận trạng thái realtime | Nhận thông báo realtime khi meeting started |
| Check-in Device / Internal Service | Service từ module `iot`/`attendance` xử lý check-in (AF1) | Gọi internal endpoint để trigger start meeting sau khi normalize raw event |
| Realtime/WebSocket clients | WebSocket client nhận trạng thái realtime | Nhận và hiển thị trạng thái in_progress |

### 2.2 Role & Permission Rules

- **Quyền bắt buộc**: `meeting.session.start`.
- Host (`participant_role = host` trong `meeting_participants`) hoặc Organizer (`organizer_id` trong `meetings`) phải có quyền này.
- Ngoài permission, backend bắt buộc kiểm tra quyền sở hữu (ownership): `currentUserId = meetings.host_id` HOẶC `currentUserId = meetings.organizer_id`.
- *Lưu ý implement*: Nếu permission `meeting.session.start` chưa tồn tại trong seed hiện tại, tiến trình implement phải thêm migration/seed phù hợp cho bảng `permissions` và map role tương ứng. Không dùng các quyền quá rộng như `meeting.update.own`.

### 2.3 Actor Constraints

- Host hoặc Organizer phải được xác thực (JWT hợp lệ).
- Module `iot`/`attendance` gọi internal service phải được tin cậy.

---

## 3. Functional Requirements

### 3.1 Core Requirements

```text
FR-001: THE system SHALL cho phép Host hoặc Organizer bắt đầu phiên họp thông qua API endpoint.
FR-002: THE system SHALL chỉ cho phép bắt đầu phiên họp khi meeting đang ở trạng thái `scheduled`.
FR-003: THE system SHALL ghi nhận `actual_start_time` bằng server time hiện tại, không chấp nhận client time.
FR-004: THE system SHALL đảm bảo `actual_start_time` là bất biến: nếu đã có giá trị, API không được ghi đè.
FR-004a: THE system SHALL chỉ cho phép bắt đầu phiên họp trong khoảng thời gian hợp lệ: từ [start_time - 15 phút] đến trước [end_time].
```

### 3.2 Event-driven Requirements

```text
FR-005: WHEN Host hoặc Organizer gửi yêu cầu bắt đầu phiên họp, THE system SHALL kiểm tra quyền, trạng thái meeting, và time window trước khi cập nhật.
FR-006: WHEN yêu cầu bắt đầu phiên họp được xác thực thành công, THE system SHALL chuyển trạng thái meeting sang `in_progress` và ghi nhận `actual_start_time`.
FR-007: WHEN meeting được chuyển sang `in_progress`, THE system SHALL tạo bản ghi `meeting_events` với `event_type = meeting_started`.
FR-008: WHEN meeting được chuyển sang `in_progress`, THE system SHALL ghi `audit_logs` cho hành động bắt đầu phiên họp.
FR-009: WHEN meeting được chuyển sang `in_progress`, THE system SHALL cập nhật `room_bookings.status = active` (nếu có booking approved) VÀ cập nhật `room_booking_usages` (usage_status = in_use, actual_start_time = now()) nếu có record tương ứng.
```

### 3.3 State-driven Requirements

```text
FR-010: WHILE meeting đang ở trạng thái `scheduled`, THE system SHALL cho phép Host và Organizer bắt đầu phiên họp nếu thời gian hiện tại nằm trong time window hợp lệ.
FR-011: WHILE meeting đang ở trạng thái `completed`, hoặc `cancelled`, THE system SHALL không cho phép bắt đầu phiên họp.
FR-012: WHILE `actual_start_time` đã có giá trị, THE system SHALL xử lý yêu cầu start meeting theo cơ chế idempotent (trả về 200 OK với alreadyStarted=true).
FR-012a: WHILE xử lý request start meeting, THE system SHALL sử dụng Database Row Lock (SELECT FOR UPDATE) trên bảng meetings để chống race condition khi có nhiều request đồng thời.
```

### 3.4 Optional Feature Requirements

```text
FR-013: WHERE thiết bị Door Face Attendance Terminal được cấu hình cho phòng họp, THE system SHALL cung cấp internal service cho module `iot`/`attendance` kích hoạt start meeting (Alternative Flow AF1).
FR-014: WHERE cơ chế WebSocket/realtime được kích hoạt, THE system SHALL phát event realtime đến participants khi meeting started thành công.
```

### 3.5 Unwanted Behavior Requirements

```text
FR-015: IF meeting không tồn tại (bao gồm đã bị soft-delete), THEN THE system SHALL từ chối yêu cầu và trả về lỗi MEETING_NOT_FOUND.
FR-016: IF người dùng không phải Host hoặc Organizer của meeting, THEN THE system SHALL từ chối yêu cầu và trả về lỗi FORBIDDEN.
FR-017: IF meeting không ở trạng thái `scheduled` (và chưa in_progress), THEN THE system SHALL từ chối yêu cầu và trả về lỗi MEETING_NOT_IN_SCHEDULED_STATUS.
FR-017a: IF người dùng/thiết bị kích hoạt start sớm hơn (start_time - 15 phút), THEN THE system SHALL từ chối yêu cầu và trả về lỗi MEETING_START_TOO_EARLY.
FR-017b: IF người dùng/thiết bị kích hoạt start bằng hoặc sau end_time, THEN THE system SHALL từ chối yêu cầu và trả về lỗi MEETING_START_WINDOW_EXPIRED.
FR-018: IF `actual_start_time` đã có giá trị (meeting đã in_progress trước đó), THEN THE system SHALL xử lý idempotent: không tạo event trùng lặp, trả về 200 OK kèm cờ `alreadyStarted: true`.
FR-019: IF meeting ở trạng thái `completed`, THEN THE system SHALL từ chối yêu cầu và trả về lỗi MEETING_ALREADY_COMPLETED.
FR-020: IF meeting ở trạng thái `cancelled`, THEN THE system SHALL từ chối yêu cầu và trả về lỗi MEETING_CANCELLED.
FR-021: IF meeting ở trạng thái `pending_approval`, THEN THE system SHALL từ chối yêu cầu và trả về lỗi MEETING_PENDING_APPROVAL.
FR-022: IF ghi `meeting_events` hoặc `audit_logs` thất bại, THEN THE system SHALL rollback toàn bộ transaction và trả về lỗi server.
FR-023: IF cập nhật `room_bookings` hoặc `room_booking_usages` thất bại, THEN THE system SHALL rollback toàn bộ transaction và trả về lỗi server.
FR-024: IF push realtime notification thất bại sau khi transaction commit, THEN THE system SHALL giữ nguyên dữ liệu meeting đã cập nhật và ghi log lỗi realtime (best-effort).
FR-024a: IF có nhiều meeting cùng match với Host + room + time window từ thiết bị (AF1), THEN THE system SHALL không tự động start để tránh kích hoạt nhầm, và ghi nhận lỗi MEETING_START_AMBIGUOUS_DEVICE_MATCH.
```

### 3.6 Workflow Requirements

```text
FR-025: WHEN Host hoặc Organizer gửi yêu cầu start meeting, THE system SHALL thực hiện tuần tự: lock row (SELECT FOR UPDATE), kiểm tra quyền, kiểm tra trạng thái và time window, cập nhật meetings, cập nhật room_bookings, cập nhật room_booking_usages, ghi meeting_events, ghi audit_logs, commit transaction, và phát realtime event (best-effort).
FR-026: WHEN alternative flow AF1 được kích hoạt, module `iot`/`attendance` SHALL phân tích event và gọi internal service `startMeetingFromDeviceCheckIn` của `live-meeting` với payload chuẩn (deviceId, roomId, recognizedUserId, sourceType).
```

### 3.7 Authorization Requirements

```text
FR-027: IF the user is not authenticated, THEN THE system SHALL reject access to this feature.
FR-028: IF the user does not have `meeting.session.start` permission, THEN THE system SHALL reject the request without modifying data.
FR-029: WHEN the user performs start meeting action, THE system SHALL verify ownership (Host/Organizer) before processing business logic.
FR-030: WHERE the request comes from an internal device service (AF1), THE system SHALL verify the internal service call without requiring standard JWT user auth.
```

### 3.8 Data & State Requirements

```text
FR-031: WHEN start meeting thành công, THE system SHALL cập nhật `meetings.status = in_progress` và `meetings.actual_start_time = now()`.
FR-032: WHEN start meeting thành công, THE system SHALL ghi `meetings.updated_at = now()` và `meetings.updated_by = currentUserId` (hoặc system đối với AF1).
FR-033: WHEN start meeting thành công, THE system SHALL tạo `meeting_events` với `event_type = meeting_started`, `source_type = manual` (hoặc `device`), `event_time = now()`.
FR-034: WHEN start meeting thành công, THE system SHALL cập nhật `room_bookings.status = active` (nếu đang `approved`) và `room_booking_usages.usage_status = in_use` cùng `actual_start_time = now()` (nếu tồn tại).
```

### 3.9 Notification / Audit Requirements

```text
FR-035: WHEN start meeting thành công, THE system SHALL ghi `audit_logs` với `action_type = start_meeting`, `entity_type = meeting`, `entity_id = meetingId`.
FR-036: WHEN start meeting thành công và realtime channel khả dụng, THE system SHALL phát WebSocket event với `eventType = meeting.session.started` chứa payload chuẩn (meetingId, status, actualStartTime, scheduledStartTime, scheduledEndTime, roomId, startedBy, occurredAt).
FR-037: IF realtime push fails, THEN THE system SHALL keep the main business transaction result unchanged and record the delivery failure in logs.
```

### 3.10 Integration / Device Requirements

```text
FR-038: WHERE Door Face Attendance Terminal được cấu hình, module `iot`/`attendance` SHALL chịu trách nhiệm nhận và chuẩn hóa raw event.
FR-039: WHEN event được chuẩn hóa, module đó SHALL gọi internal service của `live-meeting` để kích hoạt start meeting (với time window validation tương tự manual start).
```

### 3.11 Complex / Combined Requirements

```text
FR-041: WHILE meeting đang ở trạng thái `scheduled`, WHEN Host gửi yêu cầu start meeting, THE system SHALL lock record, kiểm tra time window `[start_time - 15m, end_time)`, nếu hợp lệ thì thực hiện toàn bộ thay đổi data trong 1 transaction và push realtime event khi hoàn tất.
```

---

## 4. Non-functional Requirements

### 4.1 Performance

```text
NFR-001: THE system SHALL respond to start meeting request within 3 seconds under normal load.
NFR-002: THE system SHALL support at least 50 concurrent start meeting requests.
```

### 4.2 Security

```text
NFR-003: THE system SHALL require authentication before allowing access to start meeting feature.
NFR-004: THE system SHALL enforce authorization (permission + ownership) for every start meeting operation.
NFR-005: THE system SHALL NOT expose unnecessary sensitive data in API responses or WebSocket payloads.
```

### 4.3 Reliability & Consistency

```text
NFR-007: THE system SHALL prevent partial updates using database transactions.
NFR-008: THE system SHALL keep related entity states consistent (meeting, booking, usage).
NFR-009: THE system SHALL use row-level locking (SELECT FOR UPDATE) to prevent race conditions during state transition.
```

### 4.4 Usability

```text
NFR-010: THE system SHALL return clear error messages that the client can interpret or display.
```

---

## 5. Data Model

### 5.1 Entity liên quan

| Entity / Table | Vai trò trong tính năng |
|---|---|
| `meetings` | Bảng lõi: cập nhật status, actual_start_time, updated_by, updated_at |
| `meeting_events` | Ghi timeline event meeting_started |
| `room_bookings` | Booking phòng liên quan: cập nhật status = active nếu đang approved |
| `room_booking_usages` | Usage thực tế: cập nhật actual_start_time, usage_status = in_use nếu tồn tại |
| `audit_logs` | Ghi audit log cho hành động start meeting |

### 5.2 Dữ liệu đầu vào

| Field | Type dự kiến | Bắt buộc | Mô tả |
|---|---|---|---|
| `meetingId` | UUID (path param) | Có | ID của cuộc họp cần bắt đầu |

Không có request body cho manual flow.

### 5.3 Dữ liệu đầu ra (API Response)

| Field | Type dự kiến | Mô tả |
|---|---|---|
| `meetingId` | UUID | ID cuộc họp |
| `status` | string | `in_progress` |
| `actualStartTime` | ISO-8601 timestamptz | Thời gian bắt đầu thực tế |
| `alreadyStarted` | boolean | `true` nếu request trùng lặp và được xử lý idempotent |

### 5.4 State / Status Model

**Meeting status transition:**
`scheduled` -> `in_progress`

**Room booking status transition:**
`approved` -> `active`

**Room booking usage status transition:**
`not_started` -> `in_use`

### 5.5 Data Constraints

- Time window hợp lệ: `meetings.start_time - 15 phút <= now() < meetings.end_time`.
- `meetings.status` phải là `scheduled`.
- Các cập nhật dữ liệu phải diễn ra trong 1 transaction.

---

## 6. Error Handling

### 6.1 Validation Errors

```text
ERR-001: IF `meetingId` is missing or invalid UUID format, THEN THE system SHALL reject the request.
```

### 6.2 Authentication / Authorization Errors

```text
ERR-002: IF the user is not authenticated, THEN THE system SHALL return 401.
ERR-003: IF the user lacks `meeting.session.start` or ownership, THEN THE system SHALL return 403.
```

### 6.3 Business Rule Errors

```text
ERR-005: IF the meeting does not exist or has been soft-deleted, THEN THE system SHALL return MEETING_NOT_FOUND (404).
ERR-006: IF the meeting status is not `scheduled`, THEN THE system SHALL return MEETING_NOT_IN_SCHEDULED_STATUS (409).
ERR-007: IF the meeting already has `actual_start_time` (already in_progress), THEN THE system SHALL process idempotently (return 200 OK with alreadyStarted=true).
ERR-008: IF the meeting is already `completed` or `cancelled`, THEN THE system SHALL return 409.
ERR-016: IF current time is before `start_time - 15m`, THEN THE system SHALL return MEETING_START_TOO_EARLY (409).
ERR-017: IF current time is on or after `end_time`, THEN THE system SHALL return MEETING_START_WINDOW_EXPIRED (409).
ERR-018: IF multiple meetings match device check-in, THEN THE system SHALL return MEETING_START_AMBIGUOUS_DEVICE_MATCH (409).
```

### 6.4 Conflict Errors

```text
ERR-013: IF concurrent start requests are received, THE system SHALL use DB row lock. First succeeds, subsequent ones return 200 OK idempotently.
```

---

## 7. Acceptance Criteria

### 7.1 Happy Path
```text
AC-001:
Given một meeting `scheduled`, time hiện tại nằm trong khoảng [start_time - 15m, end_time)
When Host gửi yêu cầu start meeting
Then hệ thống chuyển meeting sang `in_progress`, ghi `actual_start_time`, update booking/usage, tạo sự kiện và audit log, trả 200 OK.
```

### 7.2 Time Window Constraints
```text
AC-017:
Given meeting `scheduled` lúc 10:00, thời gian hiện tại là 09:30
When Host gửi yêu cầu start
Then hệ thống chặn và trả lỗi MEETING_START_TOO_EARLY.

AC-018:
Given meeting `scheduled` kết thúc lúc 11:00, thời gian hiện tại là 11:05
When Host gửi yêu cầu start
Then hệ thống chặn và trả lỗi MEETING_START_WINDOW_EXPIRED.
```

### 7.3 Idempotent / Concurrency
```text
AC-019:
Given meeting đang `in_progress` (đã start thành công)
When Host gửi lại yêu cầu start meeting
Then hệ thống trả 200 OK với cờ alreadyStarted=true, không tạo thêm timeline event trùng lặp.
```

---

## 8. Out of Scope

Các nội dung sau **không thuộc phạm vi** của feature UC-IMM-01:

- Kết thúc phiên họp (end meeting) và gia hạn cuộc họp (extend meeting).
- Điều khiển agenda, tạo biên bản họp (minutes), ghi âm/ghi hình/transcription.
- Sửa lịch, phòng, participant sau khi meeting đã scheduled.
- Lên lịch cảnh báo sắp hết giờ họp (nhắc nhở trước 10 phút / `warningScheduledAt`). Đây là feature Scheduling riêng.
- Tự động trigger no-show detection.
- Gửi email notification.
- Mở public webhook/device endpoint nhận raw event từ thiết bị. (Phần này thuộc trách nhiệm của module `iot` / `attendance`, module `live-meeting` chỉ cung cấp internal service).
