# Feature Specification: Gửi cảnh báo kết thúc phiên họp và xung đột lịch

- **Feature ID**: UC-IMM-13
- **Feature Name**: Gửi cảnh báo kết thúc phiên họp và xung đột lịch
- **Module / Domain**: live-meeting
- **Created Date**: 2026-06-19
- **Status**: Draft
- **Source Documents**:
  - Database v3.2 Compact (39 tables)
  - AGENTS.md — Backend Agent Guide v1.1
  - API_CONTRACT_v1.0_with_system_roles.md (UC-106, UC-107)
  - Spec UC-IMM-12 (feat-schedule-meeting-time-warning) — upstream trigger
  - Spec UC-IMM-02 (feat-request-meeting-extension) — business context cho extensionAllowed
  - Spec UC-IMM-03 (feat-process-meeting-extension-request) — business context cho extensionAllowed
  - SPEC_ALIGNMENT_WITH_DB_V3_2_COMPACT.md

---

## 📝 CHANGELOG & REVISION HISTORY

| Ngày cập nhật | Tóm tắt thay đổi | Các dòng thay đổi |
| :--- | :--- | :--- |
| 2026-06-19 | Tạo spec lần đầu cho UC-IMM-13 Gửi cảnh báo kết thúc phiên họp và xung đột lịch | Toàn bộ file |
| 2026-06-19 | Cập nhật theo clarification: thêm `conflictBufferMinutes` từ system_configs, xử lý job chạy trễ (`remainingMinutes ≤ 0`), tách WebSocket payload theo đối tượng nhận, làm rõ quy tắc recipient từ `meetings.host_id` và conflict detection query với tên cột đúng | Mục 1.4, 1.5, BR-03 BR-07 BR-13~BR-17, FR-003 FR-007 FR-010~FR-012 FR-031~FR-040, 6.1 6.3 6.4 6.9, AC-009~AC-011 |

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

Tính năng UC-IMM-13 thuộc nhóm In-Meeting Management, module `live-meeting`.

Feature này là **downstream consumer** của UC-IMM-12 (feat-schedule-meeting-time-warning): UC-IMM-12 enqueue một BullMQ delayed job vào queue `live-meeting-warnings`; khi job đó fired đúng tại `warningScheduledAt`, UC-IMM-13 là processor xử lý thực tế — gửi notification và push WebSocket.

Trước khi gửi cảnh báo, UC-IMM-13 phải kiểm tra xem phòng họp có booking kế tiếp của nhóm khác ngay sau `meeting.end_time` hay không. Kết quả kiểm tra quyết định một trong hai nhánh:

- **Nhánh A — Standard Warning**: Phòng trống sau khi cuộc họp kết thúc. Host và participants nhận thông báo thông thường, bao gồm tùy chọn yêu cầu gia hạn nhanh.
- **Nhánh B — Escalated Conflict Warning**: Phòng đã có booking tiếp theo của nhóm khác. Host và participants nhận thông báo ưu tiên cao, nội dung ghi rõ không thể gia hạn, payload chứa `extensionAllowed: false` để frontend khóa chức năng gia hạn, không có CTA gia hạn.

UC-IMM-13 kết hợp hai UC trong API contract:
- **UC-106** — Gửi cảnh báo thời gian còn lại (`meeting_time_warning`).
- **UC-107** — Gửi cảnh báo xung đột thời gian kết thúc (`meeting_time_conflict_warning`).

### 1.2 Mục tiêu

Mục tiêu của tính năng này là:
- Khi BullMQ delayed job từ UC-IMM-12 fired, kiểm tra trạng thái phòng và gửi đúng loại cảnh báo cho Host và participants.
- Đảm bảo rằng payload notification luôn chứa `extensionAllowed` để frontend có thể hiển thị hoặc khóa tùy chọn gia hạn đúng ngữ cảnh.
- Cập nhật `background_jobs.status = completed` sau khi xử lý thành công.
- Ghi `meeting_events.event_type = warning_sent` vào timeline meeting.

### 1.3 Giá trị mang lại

- **Host và Participants**: Nhận cảnh báo đúng thời điểm, biết còn bao nhiêu phút và phòng có trống hay bị xung đột để chuẩn bị kết thúc hoặc yêu cầu gia hạn.
- **Host**: Khi phòng bị xung đột, UI khóa nút gia hạn ngay từ notification — tránh Host gửi extension request lên backend rồi nhận lỗi.
- **Vận hành**: Tránh tình trạng cuộc họp trễ ảnh hưởng đến nhóm tiếp theo sử dụng phòng.
- **Hệ thống**: `background_jobs` phản ánh đúng trạng thái job đã hoàn tất; `meeting_events` có timeline warning_sent đầy đủ.

### 1.4 Giả định

- BullMQ đã được cấu hình trong hệ thống (queue `live-meeting-warnings`).
- UC-IMM-12 đã enqueue đúng job với `jobId = meeting-time-warning:{meetingId}` và payload `{ meetingId, warningScheduledAt, endTime }`.
- Server time là nguồn thời gian duy nhất.
- `meeting.status` vẫn là `in_progress` khi job fired trong trường hợp thông thường; job processor phải guard check trước khi xử lý.
- Conflict detection dựa trên `room_bookings` với cùng `room_id`, khác `meeting_id` hiện tại, `reserved_start_time >= meeting.end_time`, `status IN ('pending', 'approved', 'active')`. Sắp xếp theo `reserved_start_time ASC`, lấy 1 bản ghi đầu tiên. Tên cột DB chính xác là `reserved_start_time` và `reserved_end_time`.
- Conflict buffer được đọc từ `system_configs` với key `meeting_warning_conflict_buffer_minutes`, mặc định = 0 phút. Branch B kích hoạt khi booking kế tiếp có `reserved_start_time <= meeting.end_time + conflictBufferMinutes`.
- Host là người nhận notification chính, xác định từ `meetings.host_id`. Fallback nếu `meetings.host_id` null: `meeting_participants.participant_role = 'host'`. Không filter theo `meeting_participants.status` (field này không tồn tại trong DB Compact v3.2). Không dùng `attendance_status` để quyết định người nhận.
- Nếu mở rộng gửi cho tất cả participants: chỉ include những người có `meeting_participants.invitation_status IN ('accepted', 'tentative', 'pending')`, loại trừ `declined`.
- Nếu BullMQ job chạy trễ và `remainingMinutes = floor((meeting.end_time - now()) / 60000) <= 0`, hệ thống clamp về 0 và gửi cảnh báo dạng "quá giờ" miễn là meeting vẫn `in_progress`.
- Notification đi qua `NotificationsService` — không gọi trực tiếp vào bảng `notifications`.
- `NotificationType` enum cần bổ sung hai giá trị mới: `meeting_time_warning` và `meeting_time_conflict_warning`. Vì cột DB là `VARCHAR(60)`, đây là thay đổi code-level enum trong TypeScript, không cần migration ALTER TYPE.
- UC-IMM-13 không tự gửi email — channel mặc định là `in_app` + `websocket`.

### 1.5 Cần làm rõ

*(Không còn điểm nào cần làm rõ. Toàn bộ câu hỏi mở đã được giải quyết và cập nhật vào spec.)*

Các quyết định đã được giải quyết:
- **Conflict buffer**: Hệ thống đọc `conflictBufferMinutes` từ `system_configs.meeting_warning_conflict_buffer_minutes`, mặc định = 0. Branch B kích hoạt khi `nextBooking.reserved_start_time <= meeting.end_time + conflictBufferMinutes`. Xem BR-03, BR-17, FR-037.
- **WebSocket payload tách theo đối tượng**: Host nhận payload đầy đủ với control flags (`extensionAllowed`, `disableExtensionReason`, `warningLevel`, `nextBooking`). Participant và Room Display nhận payload an toàn không có control flags. Xem BR-17, FR-032, mục 6.4.

---

## 2. Actor & Roles

### 2.1 Danh sách actor

| Actor | Vai trò trong tính năng | Ghi chú |
|---|---|---|
| System / INTERNAL_SERVICE | Actor chính — xử lý BullMQ job khi fired | Không có HTTP actor; job processor chạy nội bộ |
| BullMQ Job Processor | Trigger UC-IMM-13 khi delayed job `meeting-time-warning:{meetingId}` fired | Job được enqueue bởi UC-IMM-12 |
| Host | Nhận notification cảnh báo và CTA gia hạn (Branch A) hoặc bị khóa CTA (Branch B) | Không gọi API trực tiếp trong UC-IMM-13 |
| Meeting Participants | Nhận notification cảnh báo | Không gọi API trực tiếp |
| NotificationsService | Service nội bộ gửi notification và WebSocket | UC-IMM-13 gọi qua service, không ghi trực tiếp vào DB |

### 2.2 Role & Permission Rules

- UC-IMM-13 là **internal process** — không có HTTP endpoint riêng, không yêu cầu JWT user.
- Toàn bộ logic chạy trong BullMQ job processor của module `live-meeting`.
- Không có permission guard HTTP — quyền truy cập được đảm bảo bởi queue isolation.

### 2.3 Actor Constraints

- Toàn bộ logic trong UC-IMM-13 phải chạy **trong BullMQ job processor** (không phải HTTP request handler).
- Nếu notification gửi thất bại, job phải ghi lỗi và cập nhật `background_jobs.status = failed` — không retry vô hạn ở application level (BullMQ job options quản lý retry).
- Guard check: nếu meeting không còn `in_progress`, skip toàn bộ và ghi log WARN.

---

## 3. Business Rules

```text
BR-01: UC-IMM-13 chỉ được trigger bởi BullMQ job processor khi job `meeting-time-warning:{meetingId}` fired.
        Không có HTTP endpoint nào trigger UC-IMM-13 trực tiếp.

BR-02: Ngay khi job fired, hệ thống phải guard check: meeting phải đang ở trạng thái `in_progress`.
        Nếu meeting đã `completed` hoặc `cancelled`, bỏ qua toàn bộ logic và ghi log WARN (không phải lỗi).

BR-03: Hệ thống phải đọc `conflictBufferMinutes` từ `system_configs` với key
        `meeting_warning_conflict_buffer_minutes`, mặc định = 0 nếu key không tồn tại hoặc không parse được.
        Conflict detection: query `room_bookings` để tìm booking kế tiếp gần nhất với điều kiện:
        - `room_id = meeting.room_id`
        - `meeting_id != meeting hiện tại` (loại trừ booking của chính meeting này)
        - `reserved_start_time >= meeting.end_time`
        - `status IN ('pending', 'approved', 'active')`
        - Sắp xếp theo `reserved_start_time ASC`, lấy 1 bản ghi đầu tiên.
        Branch B kích hoạt khi booking kế tiếp tìm được có `reserved_start_time <= meeting.end_time + conflictBufferMinutes`.

BR-04: Nếu KHÔNG có conflict (Branch A — Standard Warning):
        - notification_type = `meeting_time_warning`
        - warningLevel = `standard` (hoặc `overdue` nếu remainingMinutes <= 0)
        - priority = NORMAL
        - payload chứa `extensionAllowed: true`
        - payload chứa CTA `request_extension`

BR-05: Nếu CÓ conflict (Branch B — Escalated Conflict Warning):
        - notification_type = `meeting_time_conflict_warning`
        - warningLevel = `strict` (hoặc `urgent` nếu remainingMinutes <= 0)
        - priority = HIGH
        - payload chứa `extensionAllowed: false` và `disableExtensionReason`
        - payload chứa thông tin về booking kế tiếp (`nextBooking`)
        - KHÔNG có CTA `request_extension`

BR-06: `extensionAllowed: false` trong payload notification là cơ chế chính để UI của Host khóa
        chức năng gia hạn, tránh gửi extension request không hợp lệ lên backend.
        Dù Host không nhận extension CTA, request gia hạn vẫn phải đi qua flow UC-95 (UC-IMM-02)
        để backend kiểm tra conflict lần cuối.

BR-07: Notification v1 chủ yếu gửi cho Host. Host được xác định từ `meetings.host_id`.
        Fallback nếu `meetings.host_id` null: tìm `meeting_participants.participant_role = 'host'`.
        Không filter participant theo `meeting_participants.status` (field này không tồn tại trong DB Compact v3.2).
        Không dùng `attendance_status` để quyết định người nhận (đây là trạng thái điểm danh runtime).
        Nếu mở rộng gửi cho tất cả participants: chỉ include những người có
        `meeting_participants.invitation_status IN ('accepted', 'tentative', 'pending')`,
        loại trừ `declined`.

BR-08: WebSocket event `meeting.time.warning` phải được push vào meeting room sau khi notification
        được tạo thành công. Payload WebSocket phải tách theo đối tượng nhận (xem BR-17).

BR-09: Sau khi xử lý thành công (notification tạo xong, WebSocket pushed), hệ thống phải:
        - Cập nhật `background_jobs.status = completed`, `completed_at = now()`.
        - Tạo `meeting_events` với `event_type = warning_sent`.

BR-10: Nếu meeting không có `room_id` (họp ảo/online không có phòng vật lý), hệ thống phải áp dụng
        Branch A (Standard Warning) vì không có phòng vật lý nên không thể có conflict booking.

BR-11: `remainingMinutes` trong notification payload được tính là
        `floor((meeting.end_time - now()) / 60000)` tại thời điểm job processor chạy,
        không phải giá trị từ khi job được enqueue (vì có thể có độ trễ queue).
        Nếu kết quả âm, clamp về 0 — không được gửi giá trị âm.

BR-12: Notification được tạo với channel `in_app` theo mặc định.
        WebSocket push là bước riêng biệt sau khi notification được lưu thành công.
        Email không được gửi trong v1.

BR-13: Nếu BullMQ job chạy trễ và tính ra `remainingMinutes < 0`,
        hệ thống PHẢI clamp `remainingMinutes = 0`. Không được gửi giá trị âm trong notification.

BR-14: Nếu `remainingMinutes <= 0` và meeting vẫn đang `in_progress`, hệ thống phải gửi cảnh báo
        dạng "quá giờ" (`warningLevel = overdue`). Cảnh báo quá giờ PHẢI được thực hiện, không skip.

BR-15: Nếu `remainingMinutes <= 0` VÀ có conflict booking tiếp theo (Branch B), hệ thống phải nâng
        cấp cảnh báo thành `warningLevel = urgent` (overdue + conflict combined).

BR-16: Job được skip (không gửi notification) chỉ trong 2 trường hợp:
        1. Meeting không còn ở trạng thái `in_progress` tại thời điểm job fired.
        2. `meeting_events` đã có bản ghi `event_type = warning_sent` với cùng `warningType`
           (idempotency guard — tránh duplicate khi BullMQ retry).

BR-17: WebSocket event `meeting.time.warning` phải tách payload theo đối tượng nhận:
        - Host: nhận payload đầy đủ gồm `extensionAllowed`, `disableExtensionReason`,
          `warningLevel`, `nextBooking`, và toàn bộ control flags.
        - Participants và Room Display: nhận payload an toàn không chứa control flags chỉ dành cho Host.
          Chỉ bao gồm: `meetingId`, `warningType`, `remainingMinutes`, `endTime`, `timestamp`.
```

---

## 4. Functional Requirements

### 4.1 Core Requirements

```text
FR-001: THE system SHALL kiểm tra trạng thái meeting (guard check) ngay khi BullMQ job fired,
        trước khi thực hiện bất kỳ bước xử lý nào.

FR-002: THE system SHALL tính `remainingMinutes = floor((meeting.end_time - now()) / 60000)`
        tại thời điểm job processor thực thi.

FR-003: THE system SHALL đọc `conflictBufferMinutes` từ `system_configs.meeting_warning_conflict_buffer_minutes`
        (mặc định = 0 nếu không có), sau đó query `room_bookings` để tìm booking kế tiếp gần nhất:
        cùng `room_id`, khác meeting hiện tại, `reserved_start_time >= meeting.end_time`,
        `status IN ('pending', 'approved', 'active')`, sắp xếp `reserved_start_time ASC` LIMIT 1.
        Branch B kích hoạt khi `nextBooking.reserved_start_time <= meeting.end_time + conflictBufferMinutes`.

FR-004: THE system SHALL xác định nhánh xử lý (Branch A hoặc Branch B) dựa trên kết quả
        conflict detection theo BR-03, BR-04, BR-05.

FR-005: THE system SHALL tạo bản ghi `notifications` thông qua NotificationsService với Host
        là người nhận chính (xác định từ `meetings.host_id`; fallback: `meeting_participants.participant_role = 'host'`),
        với đầy đủ các field được quy định trong mục 6.3.

FR-006: THE system SHALL push WebSocket event `meeting.time.warning` vào meeting room sau khi
        notification được tạo thành công, với payload được tách theo đối tượng nhận (xem mục 6.4).

FR-007: THE system SHALL cập nhật bản ghi `background_jobs` tương ứng:
        - Thành công: `status = completed`, `completed_at = now()`
        - Thất bại sau retry: `status = failed`, `error_message = <lý do>`

FR-008: THE system SHALL tạo bản ghi `meeting_events` với `event_type = warning_sent`
        sau khi notification được tạo và WebSocket được pushed thành công.
```

### 4.2 Event-driven Requirements

```text
FR-009: WHEN BullMQ job `meeting-time-warning:{meetingId}` fired, THE system SHALL
        trigger toàn bộ luồng xử lý UC-IMM-13.

FR-010: WHEN conflict detection phát hiện không có booking xung đột (hoặc booking kế tiếp có
        `reserved_start_time > meeting.end_time + conflictBufferMinutes`), THE system SHALL
        thực hiện Branch A: tạo `meeting_time_warning` notification với `extensionAllowed: true`,
        `warningLevel = standard` (hoặc `overdue` nếu `remainingMinutes <= 0`), và CTA `request_extension`.

FR-011: WHEN conflict detection phát hiện booking kế tiếp có
        `reserved_start_time <= meeting.end_time + conflictBufferMinutes`, THE system SHALL
        thực hiện Branch B: tạo `meeting_time_conflict_warning` notification với
        `extensionAllowed: false`, `disableExtensionReason` rõ ràng, priority = HIGH,
        `warningLevel = strict` (hoặc `urgent` nếu `remainingMinutes <= 0`),
        và thông tin `nextBooking` trong payload. KHÔNG có CTA `request_extension`.

FR-012: WHEN notification được tạo thành công, THE system SHALL push WebSocket event
        `meeting.time.warning` với payload tách theo đối tượng nhận:
        - Host payload: `{ meetingId, warningType, warningLevel, remainingMinutes, extensionAllowed, disableExtensionReason?, nextBooking?, endTime, timestamp }`.
        - Participant/Room Display payload (safe): `{ meetingId, warningType, remainingMinutes, endTime, timestamp }`.
```

### 4.3 State-driven Requirements

```text
FR-013: WHILE meeting đang ở trạng thái `in_progress` tại thời điểm job fired,
        THE system SHALL tiếp tục toàn bộ luồng xử lý UC-IMM-13.

FR-014: WHILE xử lý UC-IMM-13, THE system SHALL không thay đổi `meetings.status`,
        không cập nhật `meetings.end_time`, không tạo hoặc hủy `room_bookings`.
        UC-IMM-13 chỉ ghi `notifications`, `meeting_events`, và cập nhật `background_jobs`.
```

### 4.4 Optional Feature Requirements

```text
FR-015: WHERE meeting không có `room_id` (cuộc họp online không phòng vật lý),
        THE system SHALL áp dụng Branch A mà không thực hiện conflict detection
        (vì không có phòng để có booking xung đột).

FR-016: WHERE `background_jobs` record không tìm thấy theo `related_entity_id = meetingId`
        và `job_type = meeting_time_warning`, THE system SHALL vẫn tiếp tục gửi notification
        và ghi `meeting_events`, chỉ bỏ qua bước update `background_jobs` và ghi log WARN.
```

### 4.5 Unwanted Behavior Requirements

```text
FR-017: IF meeting không tồn tại trong DB tại thời điểm job fired,
        THEN THE system SHALL ghi log ERROR và dừng (no-op), không gửi notification.

FR-018: IF meeting.status không phải `in_progress` tại thời điểm job fired,
        THEN THE system SHALL bỏ qua toàn bộ notification logic, ghi log WARN, và dừng bình thường
        (không phải lỗi — meeting có thể đã kết thúc thủ công sau khi job được enqueue).
        Đây là trường hợp skip hợp lệ theo BR-16 điều kiện 1.

FR-019: IF conflict detection query thất bại (lỗi DB), THEN THE system SHALL
        fallback về Branch A (Standard Warning) và ghi log ERROR về lỗi conflict query,
        để tránh notification bị chặn hoàn toàn vì lỗi phụ.

FR-020: IF tạo `notifications` record thất bại, THEN THE system SHALL
        ghi log ERROR, cập nhật `background_jobs.status = failed`, và throw error để BullMQ
        có thể retry theo job options. KHÔNG tạo `meeting_events` nếu notification thất bại.

FR-021: IF push WebSocket thất bại sau khi notification đã được lưu thành công,
        THEN THE system SHALL ghi log WARN nhưng KHÔNG rollback notification đã tạo.
        `background_jobs.status` vẫn được set là `completed` và `meeting_events` vẫn được tạo.
        WebSocket failure là non-critical.

FR-022: IF `meeting.room_id` tồn tại nhưng không tìm thấy bản ghi phòng trong DB,
        THEN THE system SHALL áp dụng Branch A và ghi log WARN.

FR-031: WHEN tính `remainingMinutes = floor((meeting.end_time - now()) / 60000)` và kết quả < 0,
        THE system SHALL clamp `remainingMinutes = 0` và tiếp tục xử lý (không skip).
        Không được đưa giá trị âm vào bất kỳ field nào của notification hoặc WebSocket payload.

FR-032: WHILE `remainingMinutes <= 0` VÀ meeting đang `in_progress`, THE system SHALL
        gửi cảnh báo dạng "quá giờ" với `warningLevel = overdue` (Branch A)
        hoặc `warningLevel = urgent` (Branch B nếu có conflict). Không được skip trong trường hợp này.

FR-033: IF `meeting_events` đã có bản ghi `event_type = warning_sent` với cùng `warningType`
        (kiểm tra trước khi tạo notification), THEN THE system SHALL bỏ qua bước tạo notification,
        ack job thành công, và ghi log INFO (idempotency guard theo BR-16 điều kiện 2).

FR-034: THE system SHALL xác định Host từ `meetings.host_id`. IF `meetings.host_id` là null,
        THEN THE system SHALL fallback tìm Host qua `meeting_participants.participant_role = 'host'`.
        IF cả hai đều không tìm được, THEN THE system SHALL ghi log WARN và bỏ qua bước gửi notification
        (không throw error vì Host missing không nên block toàn bộ job).

FR-035: THE system SHALL đọc `conflictBufferMinutes` từ `system_configs` với key
        `meeting_warning_conflict_buffer_minutes` trước bước conflict detection.
        IF key không tồn tại hoặc không parse được thành integer không âm,
        THEN THE system SHALL dùng giá trị mặc định 0 và ghi log WARN.

FR-036: THE system SHALL KHÔNG filter danh sách participants theo `meeting_participants.status`
        vì field này không tồn tại trong schema DB v3.2 Compact.
        THE system SHALL KHÔNG dùng `attendance_status` để quyết định người nhận notification.

FR-037: WHERE mở rộng gửi notification cho tất cả participants (không chỉ Host), THE system SHALL
        chỉ include những người có `meeting_participants.invitation_status IN ('accepted', 'tentative', 'pending')`
        và loại trừ `invitation_status = 'declined'`.
```

### 4.6 Workflow Requirements

```text
FR-023: WHEN UC-IMM-13 được trigger bởi BullMQ job, THE system SHALL thực hiện tuần tự:
  1. Guard check: tìm meeting theo meetingId từ job payload.
  2. Guard check: kiểm tra meeting.status = in_progress. Nếu không → skip + ACK.
  3. Idempotency check: kiểm tra meeting_events đã có warning_sent cùng warningType chưa.
     Nếu đã có → skip + ACK (BR-16 điều kiện 2).
  4. Tính remainingMinutes = max(0, floor((meeting.end_time - now()) / 60000)).
  5. Đọc conflictBufferMinutes từ system_configs (mặc định 0).
  6. Resolve Host từ meetings.host_id (fallback participant_role = 'host').
  7. Nếu meeting có room_id: query room_bookings để detect conflict theo BR-03.
     Nếu meeting không có room_id: skip conflict detection → Branch A.
  8. Xác định branch và warningLevel:
     - Branch A + remainingMinutes > 0  → warningLevel = standard
     - Branch A + remainingMinutes = 0  → warningLevel = overdue
     - Branch B + remainingMinutes > 0  → warningLevel = strict
     - Branch B + remainingMinutes = 0  → warningLevel = urgent
  9. Tạo notifications record qua NotificationsService (recipient = Host).
  10. Push WebSocket event meeting.time.warning với payload tách theo đối tượng (BR-17).
  11. Update background_jobs.status = completed, completed_at = now().
  12. Ghi meeting_events event_type = warning_sent.
  13. Ghi log INFO với: meetingId, branch (A/B), warningLevel, remainingMinutes, notificationId.
```

### 4.7 Authorization Requirements

```text
FR-024: THE system SHALL không yêu cầu JWT token để thực thi UC-IMM-13,
        vì toàn bộ logic chạy trong BullMQ job processor (internal process).

FR-025: THE system SHALL không expose HTTP endpoint nào để trigger UC-IMM-13 từ bên ngoài.
```

### 4.8 Data & State Requirements

```text
FR-026: WHEN notification được tạo thành công, THE system SHALL ghi `notifications.delivery_status = sent`
        hoặc `queued` tùy theo convention hiện tại của NotificationsService.

FR-027: WHEN `meeting_events` record cho `warning_sent` được tạo, THE system SHALL ghi
        `metadata_json` chứa: `{ warningType, warningLevel, remainingMinutes, notificationId, extensionAllowed, conflictBufferMinutes, conflictBookingId? }`.

FR-028: THE system SHALL không tạo nhiều hơn một notification `warning_sent` event
        cho cùng một meeting trong cùng một lần job fired. (Idempotency tại BullMQ level
        đã đảm bảo job chỉ fired một lần theo jobId dedupe từ UC-IMM-12.)
```

### 4.9 Notification / Audit Requirements

```text
FR-029: WHEN UC-IMM-13 hoàn thành thành công, THE system SHALL tạo bản ghi
        `meeting_events` với `event_type = warning_sent`, `source_type = scheduler`,
        `actor_user_id = null`.

FR-030: THE system SHALL KHÔNG ghi `audit_logs` cho UC-IMM-13 vì đây là internal scheduler action,
        không phải hành động của user. Traceability đã được đảm bảo qua `meeting_events` và log hệ thống.
```

### 4.10 Traceability

| Requirement ID | EARS Pattern | Nguồn / Use Case liên quan | Ghi chú |
|---|---|---|---|
| FR-001 | Ubiquitous | UC-IMM-12 (upstream trigger) | Guard check bắt buộc trước mọi xử lý |
| FR-003 | Ubiquitous | API_CONTRACT UC-107, Clarification #1 | Conflict detection với `conflictBufferMinutes` và column `reserved_start_time` |
| FR-006 | Ubiquitous | API_CONTRACT WebSocket events, Clarification #3 | `meeting.time.warning` event với payload tách |
| FR-009 | Event-driven | UC-IMM-12 BullMQ job | Trigger chính |
| FR-010 | Event-driven | API_CONTRACT UC-106, Clarification #5 | Branch A — warningLevel standard/overdue |
| FR-011 | Event-driven | API_CONTRACT UC-107, Clarification #5 | Branch B — warningLevel strict/urgent |
| FR-012 | Event-driven | Clarification #3 | WebSocket payload tách Host vs Participant |
| FR-013 | State-driven | UC-IMM-01, UC-IMM-05 | Meeting phải còn `in_progress` |
| FR-017 | Unwanted Behavior | Guard | Meeting không tồn tại |
| FR-018 | Unwanted Behavior | UC-IMM-05 | Meeting đã kết thúc trước khi job fired |
| FR-019 | Unwanted Behavior | DB resilience | Conflict query thất bại → fallback Branch A |
| FR-020 | Unwanted Behavior | BullMQ retry | Notification tạo thất bại → mark failed |
| FR-023 | Workflow | Toàn bộ flow | Workflow tuần tự bắt buộc (13 bước) |
| FR-031 | Event-driven | Clarification #2 | Late job: clamp remainingMinutes = 0 |
| FR-032 | State-driven | Clarification #2 | Late job: gửi overdue/urgent warning, không skip |
| FR-033 | Unwanted Behavior | Clarification #2, BR-16 | Idempotency guard — skip duplicate |
| FR-034 | Unwanted Behavior | Clarification #4 | Host resolve từ meetings.host_id |
| FR-035 | Unwanted Behavior | Clarification #1 | conflictBufferMinutes từ system_configs |
| FR-036 | Ubiquitous | Clarification #4 | Không filter theo status/attendance_status |
| FR-037 | Optional Feature | Clarification #4 | invitation_status filter khi mở rộng |

---

## 5. Non-functional Requirements

### 5.1 Performance

```text
NFR-001: THE system SHALL hoàn thành toàn bộ luồng UC-IMM-13 (conflict check, tạo notification,
         push WebSocket, cập nhật background_jobs, ghi meeting_events) trong vòng 1 giây
         dưới điều kiện tải bình thường.

NFR-002: THE system SHALL không block các job processor khác trong cùng queue nếu UC-IMM-13
         mất nhiều thời gian hơn dự kiến (BullMQ worker isolation).
```

### 5.2 Security

```text
NFR-003: THE system SHALL NOT expose UC-IMM-13 qua bất kỳ HTTP endpoint công khai nào.

NFR-004: THE system SHALL chỉ gửi notification đến participants của meeting đó,
         không gửi đến người dùng không liên quan.

NFR-005: THE system SHALL NOT log nội dung chi tiết của payload_json trong log hệ thống thông thường
         (chỉ log metadData quan trọng như meetingId, warningType, remainingMinutes).
```

### 5.3 Reliability & Idempotency

```text
NFR-006: THE system SHALL đảm bảo tính idempotent: BullMQ dedupe jobId từ UC-IMM-12
         đảm bảo mỗi meeting chỉ có một warning job fired. UC-IMM-13 không cần xử lý
         duplicate job thêm ở application level.

NFR-007: THE system SHALL không tạo duplicate `warning_sent` meeting_events nếu job
         processor được gọi lại do BullMQ retry sau thất bại một phần.
         Guard: kiểm tra có `meeting_events.event_type = warning_sent` tồn tại trước khi tạo mới.
```

### 5.4 Observability

```text
NFR-008: THE system SHALL ghi log đầy đủ tại mỗi bước quan trọng: job received, guard check result,
         conflict detection result, branch selected (A/B), notification creation result, WebSocket result,
         background_jobs update result.

NFR-009: THE system SHALL ghi log WARN khi meeting đã kết thúc trước khi job fired (BR-11 guard).

NFR-010: THE system SHALL ghi log ERROR nếu conflict detection query thất bại
         (kèm meetingId và chi tiết lỗi) trước khi fallback sang Branch A.
```

### 5.5 Maintainability

```text
NFR-011: THE system SHALL tách biệt logic conflict detection, notification building, và WebSocket push
         vào các method riêng trong service để dễ test và maintain.

NFR-012: THE system SHALL có unit test cho: guard check, conflict detection (có/không conflict),
         Branch A notification build, Branch B notification build, background_jobs update,
         meeting_events creation, và các error path (FR-017 đến FR-022).
```

---

## 6. Data Model

### 6.1 Entity liên quan

| Entity / Table | Vai trò trong tính năng | Ghi chú |
|---|---|---|
| `meetings` | Đọc `status`, `end_time`, `room_id`, `host_id`, `title` cho guard check, tính remainingMinutes, resolve Host, và notification content | Read-only trong UC-IMM-13 |
| `meeting_participants` | Đọc `participant_role`, `invitation_status` để resolve Host (fallback) và filter participants nếu mở rộng | Read-only |
| `room_bookings` | Query để detect conflict: tìm booking kế tiếp cùng `room_id`, `reserved_start_time >= meeting.end_time`, `status IN ('pending', 'approved', 'active')`, ORDER BY `reserved_start_time ASC` LIMIT 1 | Read-only |
| `notifications` | Ghi bản ghi notification (Branch A hoặc Branch B) | Write — qua NotificationsService |
| `meeting_events` | Đọc để idempotency check; ghi `event_type = warning_sent` sau khi notification thành công | Read + Write |
| `background_jobs` | Cập nhật `status = completed/failed`, `completed_at` | Write |
| `system_configs` | Đọc key `meeting_warning_conflict_buffer_minutes` (mặc định = 0) trước bước conflict detection | Read-only |

### 6.2 Dữ liệu đầu vào (từ BullMQ job payload)

| Field | Type | Bắt buộc | Mô tả |
|---|---|---|---|
| `meetingId` | UUID | Có | ID của meeting cần gửi cảnh báo |
| `warningScheduledAt` | timestamptz | Có | Thời điểm job được schedule (từ UC-IMM-12) |
| `endTime` | timestamptz | Có | `meetings.end_time` tại thời điểm UC-IMM-12 enqueue (có thể đã thay đổi nếu có extension) |

> **Lưu ý**: `endTime` trong job payload là snapshot từ UC-IMM-12. UC-IMM-13 phải đọc lại `meetings.end_time` mới nhất từ DB khi job fired để tính `remainingMinutes` chính xác.

### 6.3 Notification Payload

#### Branch A — Standard Warning (`meeting_time_warning`)

`warningLevel` = `standard` (khi `remainingMinutes > 0`) hoặc `overdue` (khi `remainingMinutes = 0`).

```json
{
  "notification_type": "meeting_time_warning",
  "channel": "in_app",
  "priority": "normal",
  "subject": "Cuộc họp sắp kết thúc — còn {remainingMinutes} phút",
  "related_entity_type": "meeting",
  "related_entity_id": "{meetingId}",
  "recipient_scope": "user_list",
  "recipient_user_ids_json": ["{hostId}"],
  "payload_json": {
    "type": "meeting_time_warning",
    "warningType": "standard",
    "warningLevel": "standard | overdue",
    "title": "Cuộc họp sắp kết thúc",
    "message": "Cuộc họp \"{meetingTitle}\" tại phòng \"{roomName}\" còn {remainingMinutes} phút. Phòng trống sau cuộc họp.",
    "meetingId": "uuid",
    "meetingTitle": "string",
    "roomId": "uuid",
    "roomName": "string",
    "endTime": "ISO-8601",
    "remainingMinutes": 10,
    "conflictWithNextBooking": false,
    "extensionAllowed": true,
    "disableExtensionReason": null,
    "cta": {
      "type": "request_extension",
      "label": "Yêu cầu gia hạn",
      "target": "/meetings/{meetingId}/extension-requests"
    }
  }
}
```

> **Lưu ý**: Khi `warningLevel = overdue`, `message` thay bằng dạng quá giờ:
> `"Cuộc họp \"{meetingTitle}\" đã quá giờ kết thúc. Phòng trống sau cuộc họp."`

#### Branch B — Escalated Conflict Warning (`meeting_time_conflict_warning`)

`warningLevel` = `strict` (khi `remainingMinutes > 0`) hoặc `urgent` (khi `remainingMinutes = 0`).

```json
{
  "notification_type": "meeting_time_conflict_warning",
  "channel": "in_app",
  "priority": "high",
  "subject": "Cảnh báo: Phòng họp sắp bị xung đột — còn {remainingMinutes} phút",
  "related_entity_type": "meeting",
  "related_entity_id": "{meetingId}",
  "recipient_scope": "user_list",
  "recipient_user_ids_json": ["{hostId}"],
  "payload_json": {
    "type": "meeting_time_conflict_warning",
    "warningType": "conflict",
    "warningLevel": "strict | urgent",
    "title": "Cảnh báo: Phòng họp có lịch kế tiếp",
    "message": "Cuộc họp \"{meetingTitle}\" tại phòng \"{roomName}\" còn {remainingMinutes} phút. Phòng đã có lịch cuộc họp tiếp theo lúc {nextBookingStartTime}. Không thể gia hạn.",
    "meetingId": "uuid",
    "meetingTitle": "string",
    "roomId": "uuid",
    "roomName": "string",
    "endTime": "ISO-8601",
    "remainingMinutes": 10,
    "conflictWithNextBooking": true,
    "extensionAllowed": false,
    "disableExtensionReason": "Phòng đã có lịch cuộc họp kế tiếp. Không thể gia hạn.",
    "nextBooking": {
      "bookingId": "uuid",
      "reservedStartTime": "ISO-8601",
      "meetingId": "uuid | null",
      "meetingTitle": "string | null"
    },
    "cta": null
  }
}
```

> **Lưu ý**: Khi `warningLevel = urgent`, `message` thay bằng:
> `"Cuộc họp \"{meetingTitle}\" đã quá giờ kết thúc và phòng có lịch cuộc họp kế tiếp. Cần kết thúc ngay."`

### 6.4 WebSocket Event Schema

Event name: `meeting.time.warning`

WebSocket payload được tách theo đối tượng nhận (BR-17):

#### Host Payload (đầy đủ — chứa control flags)

```json
{
  "meetingId": "uuid",
  "warningType": "standard | conflict",
  "warningLevel": "standard | overdue | strict | urgent",
  "remainingMinutes": 10,
  "extensionAllowed": true,
  "disableExtensionReason": "string | null",
  "nextBooking": {
    "bookingId": "uuid",
    "reservedStartTime": "ISO-8601"
  },
  "endTime": "ISO-8601",
  "timestamp": "ISO-8601"
}
```

#### Participant / Room Display Payload (an toàn — không có control flags)

```json
{
  "meetingId": "uuid",
  "warningType": "standard | conflict",
  "remainingMinutes": 10,
  "endTime": "ISO-8601",
  "timestamp": "ISO-8601"
}
```

> **Lý do tách**: `extensionAllowed`, `disableExtensionReason`, `nextBooking`, và `warningLevel` là control flags chỉ dành cho Host để quyết định hiển thị/ẩn nút gia hạn. Participant và Room Display không cần và không nên nhận các flag này.

### 6.5 `meeting_events` Record

| Field | Giá trị |
|---|---|
| `meeting_id` | `meetingId` |
| `event_type` | `warning_sent` |
| `event_time` | `now()` |
| `actor_user_id` | `null` |
| `source_type` | `scheduler` |
| `description` | `"Time warning sent: {warningType}, {remainingMinutes} min remaining"` |
| `metadata_json` | `{ warningType, warningLevel, remainingMinutes, notificationId, extensionAllowed, conflictBufferMinutes, conflictBookingId? }` |

### 6.6 `background_jobs` Cập nhật

| Field | Giá trị khi thành công | Giá trị khi thất bại |
|---|---|---|
| `status` | `completed` | `failed` |
| `completed_at` | `now()` | `null` |
| `error_message` | `null` | Mô tả lỗi ngắn |
| `output_json` | `{ notificationId, warningType, remainingMinutes }` | `null` |

### 6.7 Enum mới cần bổ sung vào `NotificationType`

> Hai giá trị sau cần được thêm vào `NotificationType` enum trong `notification.entity.ts`.
> Vì cột DB là `VARCHAR(60)`, đây là thay đổi TypeScript enum, không cần migration ALTER TYPE.

| Enum Value | String Value | Dùng cho |
|---|---|---|
| `MEETING_TIME_WARNING` | `meeting_time_warning` | Branch A — Standard Warning (UC-106) |
| `MEETING_TIME_CONFLICT_WARNING` | `meeting_time_conflict_warning` | Branch B — Conflict Warning (UC-107) |

### 6.8 Data Constraints

- Host được xác định từ `meetings.host_id`; không filter theo `meeting_participants.status` (field không tồn tại trong DB Compact v3.2); không dùng `attendance_status`.
- Nếu mở rộng gửi cho participants: filter `invitation_status IN ('accepted', 'tentative', 'pending')`, loại trừ `declined`.
- `room_bookings` conflict query PHẢI dùng tên cột đúng: `reserved_start_time`, `reserved_end_time` (không phải `reserved_start_at`/`reserved_end_at`).
- Conflict query PHẢI loại trừ booking của chính meeting hiện tại (tránh self-conflict) và `status IN ('cancelled', 'released', 'rejected')`.
- Conflict query lấy `ORDER BY reserved_start_time ASC LIMIT 1`; sau đó so sánh `reserved_start_time <= meeting.end_time + conflictBufferMinutes`.

### 6.9 System Configs Mapping

| Key | Default | Dùng cho |
|---|---|---|
| `meeting_warning_before_minutes` | `10` | Đã dùng bởi UC-IMM-12 khi lập lịch job — UC-IMM-13 KHÔNG đọc lại key này |
| `meeting_warning_conflict_buffer_minutes` | `0` | UC-IMM-13 đọc để xác định conflict buffer window. Parse sang integer không âm; fallback = 0 nếu không parse được |

### 6.10 Cần làm rõ

*(Không còn điểm nào cần làm rõ sau clarification 2026-06-19.)*

---

## 7. Error Handling

### 7.1 Guard Errors

```text
ERR-001: IF meeting không tìm thấy theo meetingId từ job payload,
         THEN THE system SHALL ghi log ERROR và kết thúc job thành công (ack job)
         để tránh BullMQ retry vô nghĩa. Không gửi notification.

ERR-002: IF meeting.status không phải `in_progress`,
         THEN THE system SHALL ghi log WARN và kết thúc job thành công (ack job).
         Đây là trường hợp bình thường khi meeting đã kết thúc thủ công sau khi job được enqueue.
```

### 7.2 Conflict Detection Errors

```text
ERR-003: IF query `room_bookings` cho conflict detection gặp lỗi DB,
         THEN THE system SHALL ghi log ERROR với meetingId và stack trace,
         fallback về Branch A (Standard Warning), và tiếp tục xử lý bình thường.
         Đây là degraded mode — cảnh báo vẫn được gửi, nhưng không có thông tin conflict.

ERR-004: IF meeting.room_id tồn tại nhưng query phòng không trả về kết quả,
         THEN THE system SHALL áp dụng Branch A và ghi log WARN.
```

### 7.2b Late Job / Overdue Handling

```text
ERR-004b: IF `remainingMinutes` tính ra âm (job chạy trễ),
          THEN THE system SHALL clamp về 0, ghi log WARN với meetingId và độ trễ thực tế,
          và tiếp tục xử lý với warningLevel = overdue (Branch A) hoặc urgent (Branch B).
          Đây không phải lỗi — là trường hợp bình thường khi queue bị tải.

ERR-004c: IF `system_configs.meeting_warning_conflict_buffer_minutes` không parse được thành integer không âm,
          THEN THE system SHALL dùng default 0 và ghi log WARN với giá trị raw từ config.
```

### 7.3 Notification Errors

```text
ERR-005: IF tạo `notifications` record thất bại (lỗi DB hoặc NotificationsService),
         THEN THE system SHALL ghi log ERROR với chi tiết,
         cập nhật `background_jobs.status = failed`,
         KHÔNG tạo `meeting_events`,
         và throw error để BullMQ xử lý retry theo job options.

ERR-006: IF danh sách participant rỗng (meeting không có participant active),
         THEN THE system SHALL ghi log WARN và bỏ qua bước tạo notification,
         vẫn push WebSocket event và cập nhật background_jobs.status = completed.
```

### 7.4 WebSocket Errors

```text
ERR-007: IF push WebSocket thất bại sau khi notification đã được lưu,
         THEN THE system SHALL ghi log WARN nhưng KHÔNG rollback notification.
         Coi WebSocket failure là non-critical.
         background_jobs.status = completed và meeting_events vẫn được tạo.
```

### 7.5 Post-notification Write Errors

```text
ERR-008: IF update `background_jobs` thất bại sau khi notification đã gửi thành công,
         THEN THE system SHALL ghi log ERROR nhưng KHÔNG rollback notification.
         background_jobs inconsistency là known limitation (best-effort).

ERR-009: IF tạo `meeting_events` thất bại sau khi notification đã gửi thành công,
         THEN THE system SHALL ghi log ERROR nhưng KHÔNG rollback notification.
         meeting_events failure là non-critical cho core notification flow.
```

### 7.6 Error Response Expectations

UC-IMM-13 là internal process (không có HTTP response). Error handling thể hiện qua:

| Scenario | BullMQ Job Outcome | background_jobs.status | Log Level |
|---|---|---|---|
| Meeting không tồn tại | ACK (no retry) | N/A | ERROR |
| Meeting không còn `in_progress` | ACK (no retry) | N/A | WARN |
| Conflict query lỗi → fallback Branch A | Tiếp tục xử lý | `completed` | ERROR |
| Notification tạo thất bại | NACK → BullMQ retry | `failed` | ERROR |
| WebSocket push lỗi | ACK | `completed` | WARN |
| background_jobs update lỗi | ACK | Không thay đổi | ERROR |
| meeting_events tạo lỗi | ACK | `completed` | ERROR |

---

## 8. Acceptance Criteria

### 8.1 Happy Path — Branch A (Standard Warning, không có conflict)

```text
AC-001:
Given  một meeting `in_progress` với end_time = 14:00, now = 13:50 (remainingMinutes = 10)
  And  meeting có room_id = R1
  And  không có room_bookings active nào cho R1 với reserved_start_time >= 14:00
  And  BullMQ job `meeting-time-warning:{meetingId}` fired
When   UC-IMM-13 job processor xử lý job
Then   conflict detection trả về false (không có conflict)
  And  notification record được tạo với notification_type = meeting_time_warning
  And  notification.priority = normal
  And  notification.payload_json.extensionAllowed = true
  And  notification.payload_json.cta.type = request_extension
  And  notification.payload_json.conflictWithNextBooking = false
  And  WebSocket event meeting.time.warning được push với warningType = standard
  And  background_jobs.status = completed
  And  meeting_events record được tạo với event_type = warning_sent
```

### 8.2 Happy Path — Branch B (Conflict Warning, có booking tiếp theo)

```text
AC-002:
Given  một meeting `in_progress` với end_time = 14:00, now = 13:50
  And  meeting có room_id = R1
  And  có room_bookings record với room_id = R1, reserved_start_time = 14:00, status = approved
  And  system_configs.meeting_warning_conflict_buffer_minutes = 0
  And  BullMQ job `meeting-time-warning:{meetingId}` fired
When   UC-IMM-13 job processor xử lý job
Then   14:00 <= 14:00 + 0 phút → Branch B kích hoạt (conflict)
  And  notification record được tạo với notification_type = meeting_time_conflict_warning
  And  notification.priority = high
  And  notification.payload_json.extensionAllowed = false
  And  notification.payload_json.warningLevel = strict
  And  notification.payload_json.cta = null
  And  notification.payload_json.conflictWithNextBooking = true
  And  notification.payload_json.nextBooking.reservedStartTime = 14:00
  And  WebSocket event meeting.time.warning được push với warningType = conflict
  And  Host nhận WebSocket payload có extensionAllowed = false
  And  Participant nhận WebSocket payload an toàn không có extensionAllowed
  And  background_jobs.status = completed
  And  meeting_events record được tạo với event_type = warning_sent
```

### 8.3 Guard — Meeting đã kết thúc trước khi job fired

```text
AC-003:
Given  BullMQ job `meeting-time-warning:{meetingId}` fired
  And  meeting.status = completed (đã kết thúc thủ công trước đó bởi UC-IMM-05)
When   UC-IMM-13 job processor xử lý job
Then   hệ thống bỏ qua toàn bộ notification logic
  And  KHÔNG có notification nào được tạo
  And  KHÔNG có WebSocket event nào được push
  And  log WARN được ghi với lý do: "meeting already completed"
  And  job được ACK thành công (không retry)
```

### 8.4 Guard — Meeting không có room_id (họp online)

```text
AC-004:
Given  một meeting `in_progress` với room_id = null
  And  BullMQ job fired
When   UC-IMM-13 job processor xử lý job
Then   conflict detection bị skip
  And  hệ thống áp dụng Branch A (Standard Warning) mà không query room_bookings
  And  notification.payload_json.extensionAllowed = true
```

### 8.5 Degraded Mode — Conflict query lỗi DB

```text
AC-005:
Given  một meeting `in_progress` có room_id
  And  BullMQ job fired
  And  DB query cho room_bookings trả về lỗi kết nối
When   UC-IMM-13 job processor xử lý job
Then   hệ thống fallback về Branch A (Standard Warning)
  And  log ERROR được ghi về conflict query failure
  And  notification được tạo với notification_type = meeting_time_warning
  And  background_jobs.status = completed
```

### 8.6 Error — Notification tạo thất bại

```text
AC-006:
Given  một meeting `in_progress` đã qua conflict detection thành công
  And  NotificationsService.create() ném exception
When   UC-IMM-13 job processor xử lý job
Then   background_jobs.status = failed
  And  KHÔNG có meeting_events nào được tạo
  And  job được NACK để BullMQ retry theo job options
  And  log ERROR được ghi
```

### 8.7 Non-critical — WebSocket thất bại

```text
AC-007:
Given  notification record đã được tạo thành công
  And  WebSocket push ném exception
When   UC-IMM-13 xử lý WebSocket push
Then   hệ thống ghi log WARN
  And  background_jobs.status = completed (KHÔNG phải failed)
  And  meeting_events record vẫn được tạo với event_type = warning_sent
  And  notification record không bị rollback
```

### 8.8 Idempotency — Duplicate job fired (BullMQ retry)

```text
AC-008:
Given  UC-IMM-13 đã xử lý thành công một lần và meeting_events.warning_sent đã tồn tại
  And  BullMQ re-fires job (do retry hoặc duplicate)
When   UC-IMM-13 job processor xử lý lần thứ hai
Then   hệ thống phát hiện meeting_events.warning_sent đã tồn tại
  And  KHÔNG tạo duplicate notification
  And  KHÔNG tạo duplicate meeting_events
  And  job được ACK thành công
```

### 8.9 Late Job — remainingMinutes = 0 (Branch B Urgent)

```text
AC-009:
Given  một meeting `in_progress` với end_time = 13:50, now = 13:55 (remainingMinutes = -5)
  And  meeting có room_id = R1
  And  có room_bookings với room_id = R1, reserved_start_time = 13:50, status = approved
  And  system_configs.meeting_warning_conflict_buffer_minutes = 0
  And  BullMQ job `meeting-time-warning:{meetingId}` fired muộn lúc 13:55
When   UC-IMM-13 job processor xử lý job
Then   remainingMinutes được tính = floor((13:50 - 13:55) / 60000) = -5 → clamp về 0
  And  nextBooking.reserved_start_time (13:50) <= meeting.end_time + 0 (13:50) → Branch B
  And  warningLevel = urgent (overdue + conflict)
  And  notification được tạo với notification_type = meeting_time_conflict_warning
  And  notification.payload_json.remainingMinutes = 0 (không âm)
  And  notification.payload_json.warningLevel = urgent
  And  notification.payload_json.extensionAllowed = false
  And  log WARN được ghi về late job với độ trễ 5 phút
```

### 8.10 WebSocket Payload Split — Host nhận control flags, Participant không

```text
AC-010:
Given  một meeting `in_progress` với conflict (Branch B), Host = userA, Participant = userB
When   UC-IMM-13 push WebSocket event `meeting.time.warning`
Then   Host (userA) nhận payload có: extensionAllowed, disableExtensionReason, warningLevel, nextBooking
  And  Participant (userB) nhận payload chỉ có: meetingId, warningType, remainingMinutes, endTime, timestamp
  And  Participant payload KHÔNG chứa extensionAllowed
  And  Participant payload KHÔNG chứa nextBooking
```

### 8.11 Conflict Buffer — branch phụ thuộc conflictBufferMinutes

```text
AC-011:
Given  meeting end_time = 14:00, system_configs.meeting_warning_conflict_buffer_minutes = 5
  And  room_bookings có booking kế tiếp với reserved_start_time = 14:03, status = approved
When   UC-IMM-13 chạy conflict detection
Then   14:03 <= 14:00 + 5 phút (14:05) → Branch B kích hoạt
  And  notification_type = meeting_time_conflict_warning

Given  room_bookings có booking kế tiếp với reserved_start_time = 14:06, status = approved
When   UC-IMM-13 chạy conflict detection  
Then   14:06 > 14:00 + 5 phút (14:05) → Branch A kích hoạt
  And  notification_type = meeting_time_warning
```

### 8.12 Acceptance Criteria Traceability

| AC ID | Requirement ID liên quan | Kịch bản test chính |
|---|---|---|
| AC-001 | FR-003, FR-010, FR-006, FR-007, FR-008 | Branch A happy path |
| AC-002 | FR-003, FR-011, FR-006, FR-007, FR-008 | Branch B happy path |
| AC-003 | FR-018, ERR-002 | Guard: meeting đã ended |
| AC-004 | FR-015 | Meeting online không có phòng |
| AC-005 | FR-019, ERR-003 | Degraded: conflict query DB lỗi |
| AC-006 | FR-020, ERR-005 | Notification tạo thất bại |
| AC-007 | FR-021, ERR-007 | WebSocket thất bại — non-critical |
| AC-008 | NFR-007, FR-033 | Idempotency duplicate job |
| AC-009 | FR-031, FR-032, BR-13, BR-14, BR-15 | Late job: remainingMinutes clamped về 0, warningLevel = urgent |
| AC-010 | FR-012, BR-17 | WebSocket payload tách Host vs Participant/Room Display |
| AC-011 | FR-003, FR-035, BR-03 | Conflict detection với conflictBufferMinutes |

---

## 9. Dependencies

### 9.1 Upstream dependencies (phải hoàn thành trước)

| Feature / UC | Lý do phụ thuộc |
|---|---|
| UC-IMM-12 (feat-schedule-meeting-time-warning) | Enqueue BullMQ job mà UC-IMM-13 consume. Không có UC-IMM-12 thì UC-IMM-13 không bao giờ được trigger. |
| UC-IMM-01 (feat-start-meeting-session) | Trigger UC-IMM-12 → UC-IMM-13 chain. Meeting phải ở `in_progress`. |
| UC-IMM-02 (feat-request-meeting-extension) | Context cho `extensionAllowed: true` payload. Spec extension request là downstream consumer của CTA trong notification Branch A. |
| UC-IMM-03 (feat-process-meeting-extension-request) | Khi extension được approved, UC-IMM-12 AF1 reset job. UC-IMM-13 sẽ fire lại với end_time mới. |
| UC-IMM-05 (feat-end-meeting-session) | Khi meeting kết thúc thủ công, UC-IMM-12 AF3 cancel job → UC-IMM-13 không fired. Guard check trong UC-IMM-13 cũng bảo vệ race condition nếu cancel chậm. |

### 9.2 Infrastructure dependencies

| Infrastructure | Lý do phụ thuộc |
|---|---|
| BullMQ + Redis | Queue backend — UC-IMM-13 là job processor trong queue `live-meeting-warnings` |
| PostgreSQL | Đọc `meetings`, `room_bookings`, `meeting_participants`; ghi `notifications`, `meeting_events`, `background_jobs` |
| WebSocket Gateway | Push `meeting.time.warning` event vào meeting room |
| NotificationsService | Service nội bộ để tạo notification record |

---

## 10. Out of Scope

Các nội dung sau **không thuộc phạm vi** của feature UC-IMM-13:

- **Lập lịch warning job** — đây là trách nhiệm của UC-IMM-12. UC-IMM-13 chỉ xử lý khi job đã fired.
- **Gia hạn phiên họp** — đây là trách nhiệm của UC-IMM-02 và UC-IMM-03. UC-IMM-13 chỉ gửi cảnh báo và CTA.
- **Kết thúc phiên họp** — đây là trách nhiệm của UC-IMM-05.
- **Tự động hủy booking** hoặc **dời lịch cuộc họp tiếp theo** khi phát hiện conflict. UC-IMM-13 chỉ gửi cảnh báo.
- **Email notification** — không gửi email trong v1. Chỉ `in_app` và WebSocket.
- **Pop-up UI hay modal** — đây là trách nhiệm của frontend. Backend chỉ cung cấp `payload_json.extensionAllowed = false` để frontend quyết định UI.
- **Thay đổi schema database** — không thêm bảng mới. Chỉ thêm 2 enum values vào `NotificationType` TypeScript enum (code-level, không phải DB migration).
- **HTTP endpoint riêng** cho UC-IMM-13 — không có. Feature này là internal BullMQ job processor.
- **Multiple warning levels** (ví dụ: cảnh báo 30 phút và 10 phút) — ngoài scope. UC-IMM-12 chỉ enqueue 1 job.
- **Tự động đánh dấu no-show** khi meeting sắp hết giờ — đây là trách nhiệm của module `utilization`.
- **Pause/resume meeting và tác động đến warning** — ngoài scope MVP.

### 10.1 Out-of-scope EARS Guardrails

```text
OOS-001: THE system SHALL NOT tự động approve, reject, hoặc cancel extension request
         trong UC-IMM-13. Chỉ gửi cảnh báo.

OOS-002: THE system SHALL NOT tạo bảng database mới trong UC-IMM-13.

OOS-003: THE system SHALL NOT gửi email notification trong UC-IMM-13 v1.

OOS-004: THE system SHALL NOT thay đổi meeting.status, meetings.end_time,
         room_bookings, hoặc room_booking_usages trong UC-IMM-13.

OOS-005: THE system SHALL NOT expose HTTP endpoint nào để trigger UC-IMM-13 từ bên ngoài.
```

---

## Checklist tự kiểm tra

- [x] Spec có đủ 8 thành phần chính (Context, Actors, Business Rules, FR, NFR, Data Model, Error Handling, Acceptance Criteria, Out of Scope).
- [x] Functional Requirements viết theo EARS với keyword tiếng Anh.
- [x] Có đủ 5 EARS basic patterns: Ubiquitous (FR-001..008), Event-driven (FR-009..012), State-driven (FR-013..014), Optional Feature (FR-015..016), Unwanted Behavior (FR-017..022).
- [x] Có Complex/Combined EARS Requirements (FR-023 Workflow).
- [x] Mỗi requirement có mã ID rõ ràng.
- [x] Hai nhánh (Standard Warning và Escalated Conflict Warning) được mô tả rõ trong FR-010, FR-011, BR-04, BR-05, và Acceptance Criteria.
- [x] Business Rule BR-06 xác nhận `extensionAllowed: false` là cơ chế khóa UI của Host.
- [x] Notification đi qua NotificationsService (không ghi trực tiếp DB).
- [x] WebSocket event được quy định (FR-006, FR-012).
- [x] Không thêm bảng mới; chỉ thêm 2 enum values code-level (ghi rõ ở 6.7).
- [x] Không tự ý thêm feature ngoài tài liệu nguồn (UC-106, UC-107).
- [x] Error handling bao gồm guard, conflict query, notification failure, WebSocket failure.
- [x] Acceptance Criteria dùng Given/When/Then.
- [x] Traceability liên kết AC với FR/ERR.
- [x] Out of Scope đủ rõ với EARS guardrails.
- [x] Không có Prisma, không thêm bảng ngoài DB baseline v3.2 Compact.
