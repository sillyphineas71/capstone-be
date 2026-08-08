# Feature Specification: Cập nhật phòng họp (Update Meeting Room)

- **Feature ID**: UC-MM-03
- **Feature Name**: Cập nhật phòng họp
- **Module / Domain**: meetings, rooms, scheduling, notifications
- **Created Date**: 2026-06-09
- **Status**: Draft
- **Source Documents**:
  - Database v3.2 Compact (39 tables)
  - AGENTS.md — Backend Agent Guide
  - Feature Table — UC-MM-03

---

## 📝 CHANGELOG & REVISION HISTORY
| Ngày cập nhật | Tóm tắt thay đổi | Các dòng thay đổi |
| :--- | :--- | :--- |
| 2026-06-09 | Cập nhật theo kết quả clarify: recurring meeting, booking status, conflict rule, changeReason, room capacity null, notification retry, permission | Các phần 1.4, 2.2, 3.1, 3.2, 3.5, 6.2, 6.3, 10.3, 10.4, 11, 13, 14, 15, 16, 18 |
| 2026-08-08 | [Xử lý xung đột phòng/giờ họp — Nhóm A] Room conflict check chỉ tính booking `approved`/`active` là chặn; booking `pending` KHÔNG còn chặn đổi phòng. Xem `KE_HOACH_XU_LY_XUNG_DOT_PHONG_GIO_HOP_2026-08-08.md` ở root repo. | FR-005, FR-027, BR18, mục ghi chú dòng ~854 |
| 2026-08-08 | [Xử lý xung đột phòng/giờ họp — Nhóm B] Áp dụng buffer tối thiểu 15 phút (mặc định, `system_configs.room_booking_buffer_minutes`) giữa booking mới và booking `approved`/`active` liền kề cùng phòng khi đổi phòng — back-to-back không còn hợp lệ. | FR-005, FR-027, BR18 |
| 2026-08-08 | [Xử lý xung đột phòng/giờ họp — Nhóm D] `GET /meetings/:meetingId/available-rooms` trả thêm field `pendingConflicts` cho mỗi phòng (danh sách meeting request `pending` khác đang xin cùng phòng/giờ) — chỉ mang tính thông tin cho nút "Kiểm tra trùng lịch & phòng" (Nhóm C), KHÔNG loại phòng khỏi danh sách, KHÔNG áp dụng buffer. | FR-005 |

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

Feature UC-MM-03 thuộc nhóm Meeting Management / Scheduling Management / Room Utilization Management.

Trong quy trình meeting lifecycle, sau khi cuộc họp đã được lên lịch (scheduled), có nhiều tình huống phát sinh khiến địa điểm tổ chức cần thay đổi:
- Cần phòng lớn hơn do bổ sung khách mời.
- Phòng cũ bị hỏng thiết bị (điều hòa, máy chiếu, camera, micro).
- Cần đổi sang phòng có thiết bị phù hợp hơn.
- Cần di chuyển địa điểm để thuận tiện cho người tham gia.

Hiện tại hệ thống chưa có chức năng cho phép đổi phòng sau khi meeting đã được scheduled mà vẫn giữ nguyên thời gian, participants và các thông tin khác.

Feature này chỉ tác động vào địa điểm/phòng họp, không thay đổi title, time, participants, agenda, recording policy hay recurrence rule.

### 1.2 Mục tiêu

Mục tiêu của tính năng này là cho phép **người tổ chức (organizer) hoặc chủ trì (host) cuộc họp** thực hiện **cập nhật phòng họp vật lý của một cuộc họp đã được lên lịch** nhằm **thích ứng với thay đổi về nhu cầu sử dụng phòng mà không phải hủy và tạo lại cuộc họp**.

### 1.3 Giá trị mang lại

- Người tổ chức chủ động điều chỉnh địa điểm mà không cần hủy/tạo lại meeting.
- Giảm gián đoạn lịch họp khi có sự cố phòng.
- Đảm bảo room booking luôn phản ánh đúng địa điểm thực tế.
- Duy trì tính nhất quán của dữ liệu meeting (participants, thời gian, agenda không bị ảnh hưởng).
- Ghi nhận đầy đủ audit trail cho mọi thay đổi phòng.

### 1.4 Giả định

- Meeting đã được tạo và đang ở trạng thái `scheduled`.
- Phòng mới đã tồn tại trong hệ thống và đang active.
- Người dùng đã đăng nhập và có quyền thao tác.
- Hệ thống sử dụng `timestamptz` cho mọi trường thời gian.
- Feature chỉ áp dụng cho một scheduled meeting instance cụ thể. Nếu meeting là một occurrence đã có record riêng, hệ thống update trực tiếp `meetings.room_id` của record đó. Không tự động break recurring series trong feature này.

### 1.5 Cần làm rõ

Không có.

---

## 2. Actor & Roles

### 2.1 Danh sách actor

| Actor | Vai trò trong tính năng | Quyền / Trách nhiệm chính |
|---|---|---|
| Internal Employee | Người tổ chức (organizer) hoặc chủ trì (host) cuộc họp | Được đổi phòng nếu là `organizer_id` hoặc `host_id` của meeting |
| Manager | Người tổ chức (organizer) hoặc chủ trì (host) cuộc họp | Được đổi phòng nếu là `organizer_id` hoặc `host_id` của meeting |
| Senior Admin / System Admin | Quản trị viên hệ thống | Được đổi phòng thay cho host nếu có permission phù hợp |
| Participant | Người tham gia cuộc họp | Chỉ nhận thông báo, tuyệt đối không được cập nhật phòng |

### 2.2 Role & Permission Rules

- Internal Employee và Manager (Organizer/Host) được phép đổi phòng meeting của chính họ.
- Senior Admin / System Admin có thể đổi phòng thay người khác nếu có permission `meeting.room.update`.
- Participant thông thường không có quyền đổi phòng dưới bất kỳ hình thức nào.
- Permission chuẩn cho quyền đổi phòng là `meeting.room.update`.

### 2.3 Actor Constraints

- Phải đăng nhập hợp lệ trước khi truy cập chức năng.
- Phải là organizer, host, hoặc admin có quyền.
- Meeting phải tồn tại, không bị xóa mềm, và đang ở trạng thái `scheduled`.
- Meeting chưa bắt đầu (`now < start_time`).

---

## 3. Functional Requirements

### 3.1 Core Requirements

```text
FR-001: THE system SHALL chỉ cho phép cập nhật phòng họp khi người dùng là organizer_id hoặc host_id của meeting, hoặc có permission `meeting.room.update`.

FR-002: THE system SHALL chỉ cho phép cập nhật phòng họp nếu phòng mới khác phòng hiện tại của meeting.

FR-003: THE system SHALL giữ nguyên toàn bộ các trường dữ liệu khác của meeting (title, description, start_time, end_time, participants, agendas, recording_policy, recurrence_rule) khi cập nhật phòng.

FR-004: THE system SHALL xác nhận phòng mới tồn tại, active và không ở trạng thái maintenance/inactive/deleted trước khi cho phép đổi phòng.
```

### 3.2 Event-driven Requirements

```text
FR-005: WHEN người dùng gửi yêu cầu lấy danh sách phòng khả dụng cho một meeting, THE system SHALL lọc danh sách phòng còn trống (không có booking status `approved`, `active` trùng giờ HOẶC cách nhau ít hơn `bufferMinutes` phút — mặc định 15, `system_configs.room_booking_buffer_minutes`; booking `pending` của meeting/request khác KHÔNG loại phòng khỏi danh sách và không áp dụng buffer) trong khoảng thời gian từ meeting.start_time đến meeting.end_time, loại bỏ các phòng thiếu cấu hình capacity (capacity = null), và ngoại trừ phòng hiện tại nếu được yêu cầu. [Nhóm D, 2026-08-08] Mỗi phòng trả kèm `pendingConflicts: [{meetingTitle, requesterName, startTime, endTime}]` — các booking `pending` khác (không phải của chính meetingId đang sửa) overlap khung giờ tại đúng phòng đó, chỉ để cảnh báo thông tin, không ảnh hưởng danh sách trả về.

FR-006: WHEN người dùng chọn phòng mới và gửi yêu cầu cập nhật, THE system SHALL kiểm tra lại room conflict tại thời điểm submit để tránh race condition.

FR-007: WHEN yêu cầu đổi phòng hợp lệ được submit, THE system SHALL thực hiện toàn bộ các bước sau trong cùng một transaction: release booking cũ, tạo booking mới, cập nhật meetings.room_id.

FR-008: WHEN booking cũ được release thành công, THE system SHALL ghi nhận room_events với event_type phù hợp (ví dụ room_released) cho phòng cũ.

FR-009: WHEN booking mới được tạo thành công, THE system SHALL ghi nhận room_events với event_type phù hợp (ví dụ room_reserved) cho phòng mới.

FR-010: WHEN meetings.room_id được cập nhật thành công, THE system SHALL ghi meeting_events với event_type là room_changed, lưu old_room_id và new_room_id.

FR-011: WHEN việc đổi phòng hoàn tất, THE system SHALL ghi audit_logs với old_value_json chứa thông tin phòng cũ và new_value_json chứa thông tin phòng mới.

FR-012: WHEN việc đổi phòng hoàn tất, THE system SHALL tạo notification và/hoặc background_job để gửi thông báo đổi phòng đến toàn bộ participants.

FR-013: WHEN capacity của phòng mới nhỏ hơn tổng số participant (internal + external), THE system SHALL trả về soft-warning kèm room capacity và attendee count, yêu cầu user xác nhận trước khi tiếp tục.

FR-014: WHEN user xác nhận override capacity sau soft-warning, THE system SHALL cho phép đổi phòng và ghi nhận capacity_override = true trong audit log.

FR-015: WHEN người dùng hủy sau soft-warning capacity, THE system SHALL không thực hiện bất kỳ thay đổi nào.
```

### 3.3 State-driven Requirements

```text
FR-016: WHILE meeting đang ở trạng thái `scheduled`, người dùng có quyền và now < start_time, THE system SHALL cho phép thực hiện đổi phòng.

FR-017: WHILE meeting đang ở trạng thái `in_progress`, `completed`, `cancelled`, hoặc now >= start_time, THE system SHALL chặn mọi yêu cầu đổi phòng.

FR-018: WHILE phòng mới đang ở trạng thái inactive/maintenance/deleted, THE system SHALL không cho phép chọn phòng đó làm địa điểm mới.
```

### 3.4 Optional Feature Requirements

```text
FR-019: WHERE hệ thống có cấu hình dùng meeting_requests để lưu snapshot audit, THE system SHALL tạo meeting_request với request_type = update_room, approval_mode = auto, approval_status = applied, không chặn người dùng bằng approval flow thủ công.

FR-020: WHERE hệ thống có background queue để gửi notification, THE system SHALL tạo background_job để xử lý gửi thông báo đổi phòng đến participants.
```

### 3.5 Unwanted Behavior Requirements

```text
FR-021: IF người dùng chưa đăng nhập, THEN THE system SHALL trả về 401 Unauthorized.

FR-022: IF người dùng không có quyền đổi phòng (không phải organizer, host, hoặc admin), THEN THE system SHALL trả về 403 Forbidden và không thay đổi dữ liệu.

FR-023: IF meeting không tồn tại hoặc đã bị xóa mềm, THEN THE system SHALL trả về 404 Not Found.

FR-024: IF meeting không ở trạng thái `scheduled`, THEN THE system SHALL trả về 409 Conflict và message: "Chỉ có thể đổi phòng cho cuộc họp đang ở trạng thái Đã lên lịch."

FR-025: IF now >= meeting.start_time hoặc meeting đang ở trạng thái `in_progress`, THEN THE system SHALL chặn đổi phòng và trả về lỗi phù hợp.

FR-026: IF phòng mới không active hoặc đang maintenance/inactive/deleted, THEN THE system SHALL trả về lỗi và message: "Phòng họp này hiện không khả dụng."

FR-027: IF phòng mới bị người khác đặt (tồn tại booking với status `approved` hoặc `active` trùng giờ hoặc cách nhau ít hơn `bufferMinutes` phút) trong khoảng thời gian của meeting tại thời điểm submit, THEN THE system SHALL trả về 409 Conflict và message: "Phòng họp này vừa được đặt bởi người khác. Vui lòng chọn một phòng khả dụng khác." Booking `pending` của request khác không kích hoạt lỗi này và không áp dụng buffer.

FR-031: IF request trỏ vào recurring series master thay vì một instance cụ thể, THEN THE system SHALL trả về 409 Conflict với mã `RECURRING_SERIES_UPDATE_NOT_SUPPORTED`.

FR-032: IF phòng mới được chọn thiếu cấu hình capacity (capacity = null), THEN THE system SHALL trả về 422 Unprocessable Entity với mã `ROOM_CAPACITY_NOT_CONFIGURED`.

FR-028: IF người dùng chọn lại chính phòng hiện tại, THEN THE system SHALL trả về lỗi validation với message: "Phòng họp mới phải khác phòng họp hiện tại."

FR-029: IF transaction thất bại (release booking cũ, tạo booking mới, hoặc update meeting không thành công), THEN THE system SHALL rollback toàn bộ thay đổi và trả về lỗi. Không được để meeting trỏ sang phòng mới nhưng booking vẫn ở phòng cũ.

FR-030: IF background job gửi notification thất bại sau khi đổi phòng thành công, THEN THE system SHALL không rollback transaction chính, ghi lỗi vào background_jobs hoặc audit_logs, và response vẫn thể hiện update room thành công.
```

### 3.6 Traceability

| Requirement ID | EARS Pattern | Nguồn / Use Case liên quan | Ghi chú |
|---|---|---|---|
| FR-001 | Ubiquitous | UC-MM-03, BR2, BR1 | Permission check |
| FR-002 | Ubiquitous | UC-MM-03, BR6 | Same-room guard |
| FR-003 | Ubiquitous | UC-MM-03, BR3 | Data preservation |
| FR-004 | Ubiquitous | UC-MM-03, BR7 | Room active check |
| FR-005 | Event-driven | UC-MM-03, NF step 7 | Available room search |
| FR-006 | Event-driven | UC-MM-03, BR9 | Conflict re-check on submit |
| FR-007 | Event-driven | UC-MM-03, BR10 | Transaction boundary |
| FR-008 | Event-driven | UC-MM-03, POST6 | Room event old |
| FR-009 | Event-driven | UC-MM-03, POST6 | Room event new |
| FR-010 | Event-driven | UC-MM-03, POST5 | Meeting event |
| FR-011 | Event-driven | UC-MM-03, POST7 | Audit log |
| FR-012 | Event-driven | UC-MM-03, POST8, BR13 | Notification |
| FR-013 | Event-driven | UC-MM-03, AF2, BR11 | Capacity warning |
| FR-014 | Event-driven | UC-MM-03, AF2 | Override confirm |
| FR-015 | Event-driven | UC-MM-03, AF2 | Cancel on warning |
| FR-016 | State-driven | UC-MM-03, BR4 | Scheduled only |
| FR-017 | State-driven | UC-MM-03, BR5 | Block in-progress/completed |
| FR-018 | State-driven | UC-MM-03, BR7 | Room inactive guard |
| FR-019 | Optional Feature | UC-MM-03, Business decision | meeting_requests usage |
| FR-020 | Optional Feature | UC-MM-03, POST8 | Background job |
| FR-021 | Unwanted Behavior | UC-MM-03, E1 | Unauthorized |
| FR-022 | Unwanted Behavior | UC-MM-03, E2 | Forbidden |
| FR-023 | Unwanted Behavior | UC-MM-03, E3 | Not found |
| FR-024 | Unwanted Behavior | UC-MM-03, E4 | Invalid status |
| FR-025 | Unwanted Behavior | UC-MM-03, E5 | Started/in-progress |
| FR-026 | Unwanted Behavior | UC-MM-03, E6 | Room inactive |
| FR-027 | Unwanted Behavior | UC-MM-03, E7 | Concurrency conflict |
| FR-028 | Unwanted Behavior | UC-MM-03, AF1 | Same room |
| FR-029 | Unwanted Behavior | UC-MM-03, E9 | Transaction failure |
| FR-030 | Unwanted Behavior | UC-MM-03, AF5 | Notification failure |

---

## 4. Non-functional Requirements

```text
NFR-001: THE system SHALL đảm bảo toàn bộ các thay đổi dữ liệu (release booking cũ, tạo booking mới, update meetings.room_id, ghi event/audit) nằm trong cùng một transaction. Nếu bất kỳ bước nào thất bại, toàn bộ thay đổi phải được rollback.

NFR-002: THE system SHALL kiểm tra lại room conflict tại thời điểm submit (chứ không chỉ dựa vào danh sách phòng hiển thị trước đó) để tránh race condition khi nhiều người dùng cùng thao tác.

NFR-003: THE system SHALL xử lý double-click submit bằng cách áp dụng idempotency check hoặc khóa optimistic/lock ở tầng database để ngăn tạo duplicate booking.

NFR-004: THE system SHALL trả về danh sách phòng khả dụng trong vòng 3 giây dưới tải bình thường (dưới 100 phòng active).

NFR-005: THE system SHALL ghi audit log với đầy đủ thông tin: actor_id, action (update_room), target_type (meeting), target_id, old_value_json (phòng cũ), new_value_json (phòng mới), timestamp.

NFR-006: THE system SHALL enforce RBAC cho mọi endpoint liên quan đến đổi phòng, kiểm tra quyền trước khi xử lý business logic.

NFR-007: THE system SHALL xử lý notification gửi participants một cách bất đồng bộ (qua background job hoặc queue), không block response trả về cho người dùng.

NFR-008: THE system SHALL đảm bảo meetings.room_id luôn trỏ đến một phòng tồn tại và hợp lệ sau khi cập nhật (referential integrity).

NFR-009: THE system SHALL trả về response với thông tin rõ ràng: meetingId, oldRoom, newRoom, oldBookingId, newBookingId, startTime, endTime, notificationStatus, updatedAt.

NFR-010: THE system SHALL sử dụng timestamptz (timestamp with time zone) cho mọi trường thời gian để đảm bảo tính nhất quán xuyên múi giờ.
```

---

## 5. API Contract Summary

### 5.1 GET /meetings/{meetingId}/available-rooms

Lấy danh sách phòng khả dụng trong khung thời gian của meeting.

**Query Parameters:**

| Parameter | Type | Bắt buộc | Mô tả |
|---|---|---|---|
| capacityWarningMode | boolean | Không | Nếu true, hệ thống tính capacityWarning cho mỗi phòng dựa trên attendee count hiện tại |
| includeCurrentRoom | boolean | Không | Nếu true, vẫn bao gồm phòng hiện tại trong danh sách (mặc định false) |

**Response:**

```json
[
  {
    "roomId": "uuid",
    "roomName": "Phòng Họp A",
    "roomCode": "PHA-01",
    "capacity": 20,
    "location": "Tầng 5, Tòa nhà Alpha",
    "equipmentFlags": ["projector", "whiteboard", "camera", "microphone"],
    "availabilityStatus": "available",
    "isCurrentRoom": false,
    "capacityWarning": null
  },
  {
    "roomId": "uuid",
    "roomName": "Phòng Họp B",
    "roomCode": "PHB-02",
    "capacity": 8,
    "location": "Tầng 3, Tòa nhà Alpha",
    "equipmentFlags": ["projector"],
    "availabilityStatus": "available",
    "isCurrentRoom": false,
    "capacityWarning": {
      "roomCapacity": 8,
      "attendeeCount": 12,
      "message": "Sức chứa của phòng (8 người) nhỏ hơn số lượng người tham dự hiện tại (12 người)."
    }
  }
]
```

### 5.2 PATCH /meetings/{meetingId}/room

Cập nhật phòng họp cho meeting.

**Request Body:**

```json
{
  "newRoomId": "uuid",
  "confirmCapacityOverride": false,
  "changeReason": "Need larger room"
}
```

| Field | Type | Bắt buộc | Mô tả |
|---|---|---|---|
| newRoomId | uuid | Có | ID của phòng mới |
| confirmCapacityOverride | boolean | Không | Xác nhận override capacity warning (mặc định false) |
| changeReason | string | Không | Lý do đổi phòng (tối đa 500 ký tự) |

**Success Response (200):**

```json
{
  "meetingId": "uuid",
  "oldRoom": {
    "id": "uuid",
    "name": "Phòng Họp A"
  },
  "newRoom": {
    "id": "uuid",
    "name": "Phòng Họp B"
  },
  "oldBookingId": "uuid",
  "newBookingId": "uuid",
  "startTime": "2026-06-10T09:00:00.000Z",
  "endTime": "2026-06-10T10:00:00.000Z",
  "notificationStatus": "queued",
  "updatedAt": "2026-06-09T10:30:00.000Z"
}
```

**Capacity Warning Response (422):**

```json
{
  "code": "ROOM_CAPACITY_WARNING",
  "message": "Sức chứa của phòng (8 người) nhỏ hơn số lượng người tham dự hiện tại (12 người). Bạn có chắc chắn muốn tiếp tục?",
  "roomCapacity": 8,
  "attendeeCount": 12,
  "requiresConfirmation": true
}
```

**Conflict Response (409):**

```json
{
  "code": "ROOM_CONFLICT",
  "message": "Phòng họp này vừa được đặt bởi người khác. Vui lòng chọn một phòng khả dụng khác."
}
```

**Error Response (4xx/5xx):**

```json
{
  "code": "ERROR_CODE",
  "message": "Thông báo lỗi tương ứng"
}
```

---

## 6. Data Model Impact

### 6.1 Entity liên quan

| Entity / Table | Vai trò trong tính năng | Ghi chú |
|---|---|---|
| meetings | Cập nhật room_id, updated_by, updated_at | Không thay đổi các trường khác |
| rooms | Kiểm tra trạng thái active, capacity, equipment | Chỉ đọc, không ghi |
| room_bookings | Release booking cũ, tạo booking mới | booking cũ → released/cancelled; booking mới → booking_type = relocated |
| meeting_participants | Tính attendee count để so sánh với capacity | Chỉ đọc |
| meeting_external_participants | Tính attendee count (bao gồm cả external) | Chỉ đọc |
| meeting_requests | Lưu snapshot audit nếu dùng | request_type = update_room, approval_mode = auto |
| meeting_events | Ghi event room_changed | Lưu old_room_id, new_room_id |
| room_events | Ghi event release cho phòng cũ, reserve cho phòng mới | event_type = room_released / room_reserved |
| notifications | Tạo notification cho participants | Lưu recipient summary/JSON |
| background_jobs | Tạo job gửi email/in-app notification | Dùng queue nếu hệ thống hỗ trợ |
| audit_logs | Ghi old_value_json và new_value_json | Actor, action, target_type, target_id |

### 6.2 Dữ liệu bị tác động

**meetings** (update):
- `room_id` → ID phòng mới
- `updated_by` → ID người thực hiện
- `updated_at` → Timestamp hiện tại

**meeting_requests** (insert):
- `meeting_id` = ID meeting
- `request_type` = `update_room`
- `approval_mode` = `auto`
- `approval_status` = `applied`
- `request_payload_json` = chứa `changeReason` và `confirmCapacityOverride`

**room_bookings** (booking cũ):
- Chuyển `status` sang `released` (không dùng `cancelled` vì cuộc họp không bị hủy).
- Ghi nhận `released_by`, `released_at` nếu có column.

**room_bookings** (booking mới - insert):
- `booking_type` = `relocated`
- `meeting_id` = ID meeting
- `room_id` = ID phòng mới
- `reserved_start_time` = meetings.start_time
- `reserved_end_time` = meetings.end_time
- `booked_by` = ID người thực hiện
- Status là `approved`.

**meeting_events** (insert):
- `meeting_id` = ID meeting
- `event_type` = `room_changed`
- `old_value` / `new_value` chứa thông tin phòng.
- `metadata_json` = chứa `changeReason` và `confirmCapacityOverride`.

**room_events** (insert cho phòng cũ và phòng mới):
- `room_id` = ID phòng cũ/phòng mới
- `event_type` = `room_released` / `room_reserved`

**audit_logs** (insert):
- `actor_id` = ID người thực hiện
- `action` = `update_room`
- `target_type` = `meeting`
- `target_id` = meeting ID
- `old_value_json` = thông tin phòng cũ
- `new_value_json` = chứa thông tin phòng mới, `changeReason` và `confirmCapacityOverride`.

### 6.3 State / Status Model

**Meeting status (chỉ đọc để kiểm tra)**:

| Status | Cho phép đổi phòng? | Lý do |
|---|---|---|
| draft | Có | Nếu được phép theo design tổng thể |
| scheduled | Có | Precondition chính |
| pending_approval | Không | Chờ duyệt, chưa confirmed |
| in_progress | Không | Đã bắt đầu |
| completed | Không | Đã kết thúc |
| cancelled | Không | Đã hủy |

**Room booking status (bị tác động)**:

| Booking | Status cũ | Status mới |
|---|---|---|
| Booking cũ | approved | released |
| Booking mới | — | approved |

---

## 7. Error Handling

### 7.1 Validation Errors

```text
ERR-001: IF newRoomId bị thiếu hoặc không phải UUID hợp lệ, THEN THE system SHALL trả về 400 Bad Request.

ERR-002: IF changeReason vượt quá 500 ký tự, THEN THE system SHALL trả về 400 Bad Request.
```

### 7.2 Authentication / Authorization Errors

```text
ERR-003: IF người dùng chưa đăng nhập, THEN THE system SHALL trả về 401 Unauthorized.

ERR-004: IF người dùng không có quyền đổi phòng cho meeting này, THEN THE system SHALL trả về 403 Forbidden và message: "Bạn không có quyền cập nhật phòng họp cho cuộc họp này."
```

### 7.3 Business Rule Errors

```text
ERR-005: IF meeting không tồn tại hoặc đã bị xóa mềm, THEN THE system SHALL trả về 404 Not Found.

ERR-006: IF meeting không ở trạng thái `scheduled`, THEN THE system SHALL trả về 409 Conflict và message: "Chỉ có thể đổi phòng cho cuộc họp đang ở trạng thái Đã lên lịch."

ERR-007: IF now >= meeting.start_time hoặc meeting ở trạng thái `in_progress`, THEN THE system SHALL trả về lỗi phù hợp và message: "Không thể đổi phòng trên hệ thống khi cuộc họp đã bắt đầu."

ERR-008: IF phòng mới không active hoặc đang maintenance/inactive/deleted, THEN THE system SHALL trả về lỗi và message: "Phòng họp này hiện không khả dụng."
```

### 7.4 Conflict Errors

```text
ERR-009: IF phòng mới đã bị booking bởi người khác trong cùng khung giờ, THEN THE system SHALL trả về 409 Conflict và message kèm hướng dẫn refresh danh sách.

ERR-010: IF người dùng chọn phòng trùng với phòng hiện tại, THEN THE system SHALL trả về 422 Unprocessable Entity và message: "Phòng họp mới phải khác phòng họp hiện tại."
```

### 7.5 Error Response Expectations

| Field | Mô tả |
|---|---|
| code | Mã lỗi nội bộ (ví dụ ROOM_CONFLICT, ROOM_CAPACITY_WARNING) |
| message | Thông báo lỗi có thể hiển thị cho người dùng |
| details | Chi tiết bổ sung nếu cần (validation errors, capacity info) |

---

## 8. Acceptance Criteria

### 8.1 Happy Path

```text
AC-001:
Given một meeting đang ở trạng thái scheduled và người dùng là organizer của meeting,
When người dùng chọn phòng mới khả dụng và gửi yêu cầu cập nhật phòng,
Then hệ thống cập nhật meetings.room_id, release booking cũ, tạo booking mới, ghi event/audit, và trả về response thành công.

AC-002:
Given một meeting đang ở trạng thái scheduled và người dùng là host của meeting,
When người dùng gửi yêu cầu cập nhật phòng với phòng mới khả dụng,
Then hệ thống xử lý thành công tương tự AC-001.

AC-003:
Given một meeting đang ở trạng thái scheduled và người dùng là admin có quyền quản trị,
When người dùng gửi yêu cầu cập nhật phòng cho meeting của người khác,
Then hệ thống cho phép thực hiện và ghi audit log với actor là admin.
```

### 8.2 Authorization Cases

```text
AC-004:
Given người dùng là participant (không phải organizer, host, hoặc admin) của meeting,
When người dùng gửi yêu cầu cập nhật phòng,
Then hệ thống trả về 403 Forbidden và không thay đổi dữ liệu.

AC-005:
Given người dùng chưa đăng nhập,
When người dùng gửi yêu cầu cập nhật phòng,
Then hệ thống trả về 401 Unauthorized.
```

### 8.3 Business Rule Cases

```text
AC-006:
Given một meeting ở trạng thái completed hoặc cancelled,
When người dùng gửi yêu cầu cập nhật phòng,
Then hệ thống trả về 409 Conflict và message: "Chỉ có thể đổi phòng cho cuộc họp đang ở trạng thái Đã lên lịch."

AC-007:
Given một meeting đang ở trạng thái scheduled nhưng now >= start_time (đã qua giờ bắt đầu),
When người dùng gửi yêu cầu cập nhật phòng,
Then hệ thống chặn với lỗi phù hợp.

AC-008:
Given người dùng chọn phòng trùng với phòng hiện tại của meeting,
When người dùng gửi yêu cầu cập nhật phòng,
Then hệ thống trả về lỗi validation và message: "Phòng họp mới phải khác phòng họp hiện tại."

AC-009:
Given người dùng chọn phòng mới đã bị booking bởi người khác trong cùng khung giờ,
When người dùng gửi yêu cầu cập nhật phòng,
Then hệ thống trả về 409 Conflict và message yêu cầu refresh danh sách phòng.
```

### 8.4 Capacity Warning Cases

```text
AC-010:
Given phòng mới có capacity nhỏ hơn attendee count (bao gồm internal + external participants),
When người dùng gửi yêu cầu cập nhật phòng với confirmCapacityOverride = false,
Then hệ thống trả về 422 ROOM_CAPACITY_WARNING với roomCapacity, attendeeCount, requiresConfirmation = true.

AC-011:
Given người dùng đã nhận được capacity warning,
When người dùng gửi lại yêu cầu với confirmCapacityOverride = true,
Then hệ thống cho phép đổi phòng và ghi nhận capacity_override trong audit log.
```

### 8.5 Data Integrity Cases

```text
AC-012:
Given một yêu cầu đổi phòng hợp lệ đang được xử lý,
When booking cũ được release thành công nhưng tạo booking mới thất bại,
Then hệ thống rollback toàn bộ transaction, booking cũ vẫn giữ nguyên trạng thái cũ, meetings.room_id không thay đổi.

AC-013:
Given việc đổi phòng thành công,
When kiểm tra dữ liệu,
Then booking cũ có status là released/cancelled, booking mới được tạo với booking_type = relocated và status phù hợp, meetings.room_id trỏ đến phòng mới.

AC-014:
Given việc đổi phòng thành công,
When kiểm tra audit log,
Then audit_logs có bản ghi với action = update_room, old_value_json chứa phòng cũ, new_value_json chứa phòng mới.

AC-015:
Given việc đổi phòng thành công,
When kiểm tra các trường khác của meeting,
Then title, description, start_time, end_time, participants, agendas không bị thay đổi.
```

### 8.6 Acceptance Criteria Traceability

| AC ID | Requirement ID liên quan | Kịch bản test chính |
|---|---|---|
| AC-001 | FR-001, FR-007, FR-010, FR-011, FR-012 | Organizer đổi phòng thành công |
| AC-002 | FR-001 | Host đổi phòng thành công |
| AC-003 | FR-001, FR-011 | Admin đổi phòng thành công |
| AC-004 | FR-022, ERR-004 | Participant bị chặn |
| AC-005 | FR-021, ERR-003 | Unauthenticated bị chặn |
| AC-006 | FR-024, ERR-006 | Meeting không scheduled |
| AC-007 | FR-025, ERR-007 | Meeting đã bắt đầu |
| AC-008 | FR-028, ERR-010 | Chọn phòng trùng |
| AC-009 | FR-027, ERR-009 | Conflict với booking khác |
| AC-010 | FR-013 | Capacity warning trả về |
| AC-011 | FR-014 | Override capacity được chấp nhận |
| AC-012 | FR-029 | Transaction rollback |
| AC-013 | FR-008, FR-009 | Booking cũ và mới đúng |
| AC-014 | FR-011 | Audit log được ghi |
| AC-015 | FR-003 | Các trường khác không đổi |

---

## 9. Out of Scope

Các nội dung sau **không thuộc phạm vi** của feature này:

- Cập nhật thời gian bắt đầu/kết thúc cuộc họp.
- Cập nhật tiêu đề, mô tả cuộc họp.
- Thêm/xóa participant (internal hoặc external).
- Thay đổi recording policy.
- Tạo meeting mới.
- Hủy meeting.
- Approve/reject meeting request thủ công.
- Xử lý ad-hoc meeting.
- Thay đổi recurrence rule cho toàn bộ chuỗi họp định kỳ.
- Quản lý thiết bị phòng họp.
- Sửa layout phòng/ghế.

### 9.1 Không triển khai trong feature này

- Không tạo API cho CRUD room độc lập.
- Không xử lý face attendance, presence detection, recording.
- Không xử lý no-show hay auto-release phòng.
- Không thêm bảng database mới.

### 9.2 Có thể xem xét ở feature khác

- Đổi phòng cho chuỗi recurring meeting (toàn bộ series).
- Request đổi phòng có approval flow thủ công.
- Tự động đề xuất phòng thay thế khi phòng cũ bị maintenance.
- Batch đổi phòng cho nhiều meeting cùng lúc.
- Dashboard lịch sử đổi phòng.

### 9.3 Out-of-scope EARS Guardrails

```text
OOS-001: THE system SHALL NOT cho phép cập nhật thời gian, title, participants, agenda, recording policy, hoặc recurrence rule trong feature này.

OOS-002: THE system SHALL NOT tạo bảng database mới.

OOS-003: THE system SHALL NOT tự động chuyển phòng nếu không có yêu cầu từ người dùng.
```

---

## 10. Notification Requirements

Thông báo đổi phòng phải được gửi đến tất cả participants (internal và external) sau khi đổi phòng thành công.

### 10.1 Nội dung thông báo

Mỗi thông báo cần chứa:

| Thành phần | Mô tả |
|---|---|
| meetingName | Tên cuộc họp |
| meetingTime | Thời gian họp (start_time → end_time) |
| oldRoom | Tên và vị trí phòng cũ (hiển thị gạch ngang hoặc làm mờ) |
| newRoom | Tên và vị trí phòng mới (in đậm/nổi bật) |
| changedBy | Tên người thực hiện đổi phòng |
| changeReason | Lý do đổi phòng nếu có |

### 10.2 Định dạng hiển thị (không bắt buộc implement template HTML)

Email nên có hiển thị trực quan:

```
Phòng họp đã thay đổi cho: "[Tên cuộc họp]"

Thời gian: 09:00 - 10:00, Thứ Năm, 10/06/2026

Địa điểm cũ: ~~Phòng Họp A (Tầng 5)~~
→ Địa điểm mới: Phòng Họp B (Tầng 3)

Người thực hiện: Nguyễn Văn A
Lý do: Cần phòng lớn hơn
```

### 10.3 Loại notification & Người nhận

- Danh sách người nhận (Recipient list) bao gồm: participants + external participants + organizer + host. Sau đó thực hiện deduplicate để đảm bảo không gửi trùng lặp.
- Organizer vẫn sẽ nhận được thông báo kể cả khi Host là người đổi phòng.
- Kênh thông báo: In-app notification (lưu trong bảng notifications), Email (xử lý qua background_jobs), Push notification nếu hệ thống hỗ trợ (optional).

### 10.4 Xử lý lỗi notification

- Sau khi đổi phòng thành công, notification/email được xử lý async qua `background_jobs`.
- Nếu notification job fail, retry tối đa 3 lần.
- Nếu vẫn fail, set job status `failed`, notification delivery status `failed` hoặc `partial_failed`, và ghi audit warning.
- Notification failure không rollback việc đổi phòng nếu transaction update room/booking đã thành công.

---

## 11. Edge Cases

| Edge Case | Mô tả | Xử lý |
|---|---|---|
| Double-click submit | Người dùng nhấn nút Lưu nhiều lần trước khi nhận response | Hệ thống cần idempotency check. Nếu booking mới đã tồn tại cho meeting này trong khung giờ này, throw lỗi hoặc trả về no-op. |
| User A và User B cùng chọn một phòng | Hai người cùng đổi phòng cho hai meeting khác nhau vào cùng một phòng trong khung giờ trùng | Conflict check tại thời điểm submit (FR-006) sẽ bắt được. Người submit sau nhận 409 Conflict. |
| Phòng bị chuyển sang maintenance trong lúc user đang mở form | Từ lúc hiển thị danh sách phòng đến lúc submit, phòng có thể bị inactive | Conflict check tại submit (FR-006) phát hiện và chặn. |
| Participant count thay đổi trước lúc submit | Participants được thêm/xóa trong lúc user đang chọn phòng | Tính attendee count tại thời điểm submit, không dùng cache. |
| Notification queue lỗi sau khi đổi phòng thành công | Transaction đổi phòng thành công nhưng background job thất bại | Không rollback. Retry tối đa 3 lần, nếu vẫn fail set job status failed và ghi audit warning. Response báo notificationStatus = "failed" hoặc "retry_pending". |
| Meeting bị cancel bởi người khác trong lúc user đang đổi phòng | Trạng thái meeting thay đổi từ scheduled → cancelled | Kiểm tra lại meeting status tại submit (FR-006). Nếu cancelled, trả về 409. |
| Timezone | Thời gian phải nhất quán xuyên múi giờ | Dùng timestamptz cho mọi trường. Server thống nhất múi giờ UTC. Client tự convert. |

---

## 12. Preconditions

| ID | Mô tả |
|---|---|
| PRE1 | Người dùng đã đăng nhập hợp lệ. |
| PRE2 | Người dùng có quyền thao tác (organizer/host/admin). |
| PRE3 | Meeting tồn tại và không bị xóa mềm. |
| PRE4 | Meeting đang ở trạng thái `scheduled`. |
| PRE5 | Meeting chưa bắt đầu: `now < start_time`. |
| PRE6 | Phòng mới tồn tại, active, không maintenance/inactive/deleted. |
| PRE7 | Phòng mới còn trống trong khoảng `start_time → end_time`. |

---

## 13. Postconditions

| ID | Mô tả |
|---|---|
| POST1 | `meetings.room_id` được cập nhật sang phòng mới. |
| POST2 | Booking cũ trong `room_bookings` chuyển sang `released`. |
| POST3 | Booking mới trong `room_bookings` được tạo với `booking_type = relocated`, status phù hợp. |
| POST4 | Các dữ liệu khác của meeting không đổi 100%. |
| POST5 | Hệ thống ghi `meeting_events` với event_type `room_changed`. |
| POST6 | Hệ thống ghi `room_events` cho phòng cũ (`room_released`) và phòng mới (`room_reserved`). |
| POST7 | Hệ thống ghi `audit_logs` cho hành động update room. |
| POST8 | Hệ thống tạo notification và/hoặc background_job để gửi thông báo. |
| POST9 | Response trả về đầy đủ thông tin phòng cũ, phòng mới, meeting id, booking mới, updatedAt. |

---

## 14. Main Flow

1. Người dùng truy cập "Lịch của tôi" hoặc danh sách quản lý cuộc họp.
2. Người dùng mở chi tiết meeting cần đổi phòng.
3. Người dùng chọn "Chỉnh sửa" hoặc "Đổi phòng họp".
4. Hệ thống tải thông tin hiện tại của meeting.
5. Hệ thống kiểm tra meeting có đang ở trạng thái `scheduled` và người dùng có quyền đổi phòng không.
6. Người dùng mở trường chọn phòng họp → gọi GET available-rooms.
7. Hệ thống lọc danh sách phòng khả dụng trong đúng khung thời gian `start_time → end_time` của meeting.
8. Người dùng xem sức chứa, vị trí, thiết bị và chọn phòng mới.
9. Người dùng nhấn "Lưu thay đổi" → gọi PATCH room.
10. Hệ thống kiểm tra lại lần cuối:
    - meeting vẫn `scheduled`
    - phòng mới vẫn active
    - phòng mới chưa bị booking bởi người khác
    - phòng mới khác phòng hiện tại
    - sức chứa phòng mới so với tổng số participants
11. Nếu có capacity warning, hệ thống trả soft-warning và yêu cầu user xác nhận.
12. Nếu user xác nhận (confirmCapacityOverride = true) hoặc không có warning, hệ thống thực hiện update trong transaction.
13. Release booking cũ (status → released).
14. Tạo booking mới với booking_type = relocated.
15. Cập nhật `meetings.room_id`, `updated_by`, `updated_at`.
16. Ghi meeting event (room_changed), room events, audit log.
17. Tạo notification/background job để gửi thông báo.
18. Hệ thống trả response thành công.

---

## 15. Alternative Flows

**AF1: Chọn lại phòng hiện tại**
Hệ thống trả lỗi validation: "Phòng họp mới phải khác phòng họp hiện tại."

**AF2: Phòng mới có capacity nhỏ hơn attendee count**
Hệ thống trả soft-warning (422 ROOM_CAPACITY_WARNING). Nếu user chọn "Tiếp tục" (confirmCapacityOverride = true), hệ thống cho phép update và ghi nhận capacity_override. Nếu user chọn "Hủy", không cập nhật.

**AF3: Không có phòng khả dụng**
Hệ thống trả danh sách rỗng. Không thay đổi dữ liệu.

**AF4: Admin đổi phòng thay cho host**
Hệ thống cho phép nếu có permission. Audit log ghi rõ actor là admin.

**AF5: Notification job thất bại**
Sau khi đổi phòng thành công, hệ thống gửi notification async. Nếu fail, retry tối đa 3 lần. Nếu vẫn fail, set job status `failed`, notification delivery status `failed` hoặc `partial_failed`, và ghi audit warning. Không rollback transaction chính. Response báo notificationStatus = "failed" hoặc "retry_pending".

---

## 16. Business Rules

| ID | Mô tả |
|---|---|
| BR1 | Participants chỉ có quyền nhận thông tin, không có quyền đổi phòng. |
| BR2 | Chỉ organizer/creator, host hoặc admin có quyền mới được đổi phòng. |
| BR3 | Feature chỉ cập nhật phòng họp. Không thay đổi title, time, participants, agenda, recording policy. |
| BR4 | Chỉ cho đổi phòng khi meeting status là `scheduled`. |
| BR5 | Không cho đổi phòng nếu meeting đã `in_progress`, `completed`, `cancelled`, hoặc đã qua giờ bắt đầu. |
| BR6 | Phòng mới phải khác phòng hiện tại. |
| BR7 | Phòng mới phải active và không maintenance/inactive. |
| BR8 | Phòng mới phải không có booking overlap trong cùng khung giờ. |
| BR9 | Kiểm tra conflict phải thực hiện lại tại submit, không chỉ dựa vào danh sách đã hiển thị. |
| BR10 | Update meeting room và update booking phải nằm trong cùng transaction. |
| BR11 | Capacity nhỏ hơn attendee count là soft-warning, không phải hard-block. |
| BR12 | Attendee count tính cả internal và external participants. |
| BR13 | Sau khi đổi phòng thành công, hệ thống phải tạo notification cho participants. |
| BR14 | Nội dung thông báo phải làm nổi bật sự thay đổi: phòng cũ → phòng mới. |
| BR15 | Hệ thống phải ghi audit log cho hành động đổi phòng. |
| BR16 | Hệ thống phải ghi meeting event để xem lại timeline thay đổi. |
| BR17 | Không được tạo thêm bảng mới ngoài database v3.2 Compact. |
| BR18 | Các booking có status `approved` hoặc `active` được xem là đang chiếm phòng khi check conflict — kể cả khi chỉ cách nhau ít hơn `bufferMinutes` phút (mặc định 15, `system_configs.room_booking_buffer_minutes`, Nhóm B 2026-08-08), không chỉ khi overlap trực tiếp. Booking `pending` của meeting/request KHÁC không được xem là đang chiếm phòng và không áp dụng buffer — nhiều request pending có thể trùng phòng/giờ, Manager quyết định ở bước duyệt. |
| BR19 | Bỏ qua booking có status cancelled, released, pending (của meeting/request khác), hoặc booking cũ của chính meeting đang đổi phòng khi check conflict. |
| BR20 | Nếu phòng có capacity = null, coi như lỗi cấu hình, không cho phép đổi sang phòng này và trả lỗi ROOM_CAPACITY_NOT_CONFIGURED. |
| BR21 | Request đổi phòng trỏ vào recurring series master sẽ bị từ chối với RECURRING_SERIES_UPDATE_NOT_SUPPORTED. |

---

## 17. Assumptions

- Meeting đã được scheduled với room_id hợp lệ.
- Hệ thống có sẵn các bảng rooms, room_bookings, meeting_events, room_events, notifications, background_jobs, audit_logs trong database v3.2 Compact.
- Permission check dựa trên RBAC hiện có (roles, permissions, user_roles, role_permissions).
- API prefix là `/api/v1` theo convention dự án.
- Capacity của phòng được lấy từ rooms.capacity.
- Attendee count = count(meeting_participants) + count(meeting_external_participants).
- Soft-delete cho meeting đã được implement (meetings.deleted_at).
- Status của room booking được lưu trong room_bookings.status.
- Timezone mặc định của server là UTC, dữ liệu lưu dạng timestamptz.

---

## 18. Clarifications Needed

Đã clarify và cập nhật các phần (2026-06-09):
- Xử lý recurring meeting instance (chỉ áp dụng 1 instance, không support series master).
- Status booking cũ là `released`.
- Quy tắc check conflict (cập nhật 2026-08-08, xem BR18/BR19): bỏ qua `released`/`cancelled`/`pending` (của booking khác), chỉ tính `approved`/`active`.
- Xử lý khi `rooms.capacity = null` là lỗi cấu hình (`ROOM_CAPACITY_NOT_CONFIGURED`).
- Nơi lưu trữ `changeReason` và `confirmCapacityOverride` (requests, events, audit logs).
- Thông báo cho cả Organizer và Host sau khi deduplicate.
- Retry background job notification tối đa 3 lần, ghi audit warning nếu fail.
- Dùng đúng permission `meeting.room.update`.
