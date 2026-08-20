# Feature Specification: Yêu cầu gia hạn phiên họp (Request Meeting Extension)

- **Feature ID**: UC-IMM-02
- **Feature Name**: Yêu cầu gia hạn phiên họp
- **Module / Domain**: live-meeting
- **Created Date**: 2026-06-16
- **Status**: Draft
- **Source Documents**:
  - Database v3.2 Compact (39 tables)
  - AGENTS.md - Backend Agent Guide v1.1
  - API_CONTRACT_v1.0_with_system_roles.md (UC-95, UC-96, UC-97)
  - SPEC_ALIGNMENT_WITH_DB_V3_2_COMPACT.md
  - Use Case nhập từ user: UC-IMM-02

---

## CHANGELOG & REVISION HISTORY
| Ngày cập nhật | Tóm tắt thay đổi | Các dòng thay đổi |
| :--- | :--- | :--- |
| 2026-08-21 | **Yêu cầu trực tiếp mới nhất của team, thay thế toàn bộ luồng Manager pending cho trường hợp có conflict.** Chuyển từ "Hybrid Extension Request" (auto-apply / pending-Manager) sang "Buffer-based Auto Decision": hệ thống chỉ so `requestedNewEndTime` với `(cuộc họp kế tiếp cùng phòng).startTime - bufferMinutesBeforeNextMeeting` (mặc định 15 phút). Không vi phạm buffer → auto-apply ngay (không đổi). Vi phạm buffer → **tự động từ chối ngay lập tức** (không tạo pending, không gửi Manager), trả về lý do từ chối + thông tin cuộc họp kế tiếp + thông tin liên hệ (email, SĐT) của Host cuộc họp kế tiếp để 2 Host tự thoả thuận. `extensionMinutes` không còn giới hạn theo tập cố định `[15,30,60]` — Host nhập số phút tự do (1-240), FE gợi ý nút bấm nhanh 15/40/60. Endpoint `decide` (UC-IMM-03) vẫn giữ nguyên code nhưng không còn được luồng này gọi tới — xem mục 10. Không sửa `spec/features/live-meeting/feat-process-meeting-extension-request/` (feature riêng, coi như deprecated cho use case này). | Mục 1.2, 3 (BR-006→BR-012 mới), 4 (FR-009→FR-018 sửa), 5, 6.1, 6.4, 7, 8 (AC-001→AC-020 sửa), 9.2, 10 |
| 2026-06-16 | Giải quyết 2 marker Clarification cuối: xác định policy từ `system_configs` và cấu trúc Notification payload | Mục 1.4, 3, 4, 6.2, 8 |
| 2026-06-16 | Chuyển đổi sang luồng Hybrid Extension Request: tự động duyệt nếu phòng trống, tạo pending request và notify Manager nếu có conflict | Toàn bộ file |
| 2026-06-16 | Chuyển đổi luồng từ auto-approve sang manual approval bắt buộc theo quyết định mới | Toàn bộ file |
| 2026-06-16 | Tạo spec lần đầu cho UC-IMM-02 Yêu cầu gia hạn phiên họp | Toàn bộ file |

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

Tính năng UC-IMM-02 thuộc nhóm In-Meeting Management, module live-meeting.

Trong quy trình meeting lifecycle, sau khi cuộc họp đã được bắt đầu (`in_progress`), có trường hợp nội dung chưa hoàn tất nhưng sắp đến giờ kết thúc dự kiến. Host cần khả năng yêu cầu gia hạn thêm thời gian để tiếp tục thảo luận.

UC-IMM-02 (bản 2026-08-21) sử dụng **Buffer-based Auto Decision**: hệ thống tự quyết định applied/rejected ngay lập tức dựa trên khoảng đệm (buffer) so với cuộc họp kế tiếp cùng phòng, không còn bước Manager duyệt thủ công cho use case này.

### 1.2 Mục tiêu

Mục tiêu của tính năng này là cho phép Host gửi yêu cầu gia hạn phiên họp đang diễn ra:
- **Trường hợp không vi phạm buffer** (không có cuộc họp kế tiếp cùng phòng, hoặc `requestedNewEndTime <= cuộc họp kế tiếp.startTime - bufferMinutesBeforeNextMeeting`, mặc định buffer = 15 phút): Tự động ghi nhận `meeting_requests` với trạng thái `applied`, cập nhật thời gian kết thúc của `meetings`, `room_bookings`, `room_booking_usages`, ghi log và push thông báo cho người trong phòng.
- **Trường hợp vi phạm buffer**: Tự động ghi nhận `meeting_requests` với trạng thái `rejected`, KHÔNG thay đổi lịch phòng hiện tại, KHÔNG gửi Manager. Trả về ngay cho Host: lý do từ chối, thông tin cuộc họp kế tiếp (tiêu đề, giờ bắt đầu, phòng), và thông tin liên hệ của Host cuộc họp kế tiếp (họ tên, email, số điện thoại) để 2 Host tự thoả thuận trực tiếp.

### 1.3 Giả định

- Cuộc họp đang ở trạng thái `in_progress` và có `room_id` (phòng vật lý).
- Nguồn thời gian chính xác để kiểm tra conflict lấy từ Server time.
- Mọi meeting chỉ có tối đa một active room booking tại một thời điểm.

### 1.4 Cần làm rõ

- *(Không còn điểm nào cần làm rõ. Toàn bộ các marker `[NEEDS CLARIFICATION]` đã được giải quyết.)*

---

## 2. Actor & Roles

### Primary Actor
- **Internal Employee trong vai trò Host**: Người chủ trì, có quyền khởi tạo yêu cầu gia hạn. Quyền đề xuất: `meeting.extension.request.own` (hoặc theo convention API).

### Secondary Actor
- **Manager / Approver**: Người nhận thông báo và sẽ xử lý yêu cầu gia hạn bị conflict (nhưng hành động xử lý không thuộc scope feature này). Hệ thống resolve theo cấp quản lý của Host hoặc phòng ban.

### Không được submit thay Host
- Organizer nếu không phải Host.
- Participant thường.
- External participant.
- Business Admin / System Admin, trừ khi API contract hiện tại có admin override riêng.

---

## 3. Business Rules

BR-001: Chỉ Host của meeting được gửi yêu cầu gia hạn.
BR-002: Meeting phải đang ở trạng thái `in_progress`.
BR-003: Meeting phải có active room booking.
BR-004: Mọi yêu cầu gia hạn hợp lệ đều phải tạo `meeting_requests` để audit/tracking.
BR-005: Hệ thống phải xác định cuộc họp kế tiếp gần nhất cùng phòng (booking có `status` thuộc `pending/approved/active` và `reserved_start_time > oldEndTime`, sắp theo `reserved_start_time` tăng dần, lấy phần tử đầu tiên).
BR-006: Nếu không tồn tại cuộc họp kế tiếp, hệ thống tự động approve và apply extension (không giới hạn bởi buffer).
BR-007: Nếu tồn tại cuộc họp kế tiếp và `requestedNewEndTime <= (cuộc họp kế tiếp.reserved_start_time - bufferMinutesBeforeNextMeeting)`, hệ thống tự động approve và apply extension. Request được lưu với `approval_mode = auto`, `approval_status = applied`, `conflict_check_status = clear`.
BR-008: Nếu `requestedNewEndTime > (cuộc họp kế tiếp.reserved_start_time - bufferMinutesBeforeNextMeeting)` (vi phạm buffer), hệ thống KHÔNG apply extension, KHÔNG update meeting/booking, và **tự động từ chối ngay lập tức** — không tạo trạng thái chờ xử lý (`pending`) và không chuyển cho Manager.
BR-009: Khi vi phạm buffer, request được lưu với `approval_mode = auto`, `approval_status = rejected`, `conflict_check_status = blocked`, `rejection_reason` mô tả rõ lý do (thời gian yêu cầu, buffer, cuộc họp kế tiếp).
BR-010: Khi vi phạm buffer, hệ thống phải trả về ngay cho Host (trong response API, đồng bộ) thông tin cuộc họp kế tiếp (id, title, startTime, endTime, roomName) và thông tin liên hệ Host cuộc họp kế tiếp (id, fullName, email, phoneNumber) để 2 Host tự thoả thuận trực tiếp.
BR-011: Khi vi phạm buffer, hệ thống SHALL notify chính Host đang gửi yêu cầu (KHÔNG notify Manager/Approver của Host) qua `in_app` + `websocket`, kèm nguyên payload lý do/thông tin liên hệ ở BR-010.
BR-012: UC-IMM-02 (từ 2026-08-21) không còn tạo pending request hay tương tác với Manager/Approver cho trường hợp conflict. Endpoint `decide` của UC-IMM-03 vẫn tồn tại trong code nhưng không còn được luồng này gọi tới (xem mục 10 Out of Scope).
BR-013: Hệ thống không được tạo overlap booking trong UC-IMM-02.
BR-014: Không tự động đổi phòng, hủy meeting sau, dời meeting sau, hoặc override booking trong UC-IMM-02.
BR-015: System SHALL load meeting extension policy from `system_configs` with key `meeting.extension.policy`.
BR-016: If config is missing, inactive, or partially invalid, system SHALL fallback to default policy: `maxExtensionCountPerMeeting = 2`, `maxTotalExtensionMinutesPerMeeting = 60`, `bufferMinutesBeforeNextMeeting = 15`. `allowedExtensionMinutes = [15, 30, 60]` được giữ lại trong config chỉ mang tính gợi ý cho FE (preset button), KHÔNG còn được BE dùng để validate `extensionMinutes` (xem BR-016a).
BR-016a: `extensionMinutes` là số phút tự do do Host nhập, chỉ ràng buộc bởi `1 <= extensionMinutes <= 240` (DTO-level) và các giới hạn `maxExtensionCountPerMeeting`/`maxTotalExtensionMinutesPerMeeting` (tính trên các request đã `applied`).
BR-017: Chỉ request `approval_status = applied` mới được tính vào số lần/tổng thời lượng đã gia hạn.
BR-018: (Đã bỏ — không còn CTA gửi Manager trong luồng này. Giữ số thứ tự để tránh xáo trộn mapping AC/FR cũ.)
BR-019: Notification gửi cho Host khi bị từ chối KHÔNG chứa hành động approve/reject của Manager — chỉ chứa thông tin liên hệ để Host tự xử lý với Host cuộc họp sau.
BR-020: Email notification is optional and disabled by default in v1.
BR-021: `phoneNumber` của Host cuộc họp kế tiếp có thể `null` nếu user chưa cập nhật hồ sơ; FE phải ẩn nút gọi khi `null`, không hiển thị chuỗi rỗng.

---

## 4. Functional Requirements

FR-001: THE system SHALL allow only the Host to submit a meeting extension request.
FR-002: THE system SHALL validate meeting is `in_progress`.
FR-003: THE system SHALL validate meeting has active room booking.
FR-004: THE system SHALL read the extension policy from `system_configs` (`meeting.extension.policy`), including `bufferMinutesBeforeNextMeeting`, or use the default fallback (`maxExtensionCountPerMeeting=2`, `maxTotalExtensionMinutesPerMeeting=60`, `bufferMinutesBeforeNextMeeting=15`).
FR-005: THE system SHALL validate `extensionMinutes` is an integer in `[1, 240]` and validate count/total-minutes limits based on the loaded policy. THE system SHALL NOT restrict `extensionMinutes` to a fixed value set.
FR-006: THE system SHALL calculate `requestedNewEndTime = oldEndTime + extensionMinutes`.
FR-007: THE system SHALL find the nearest upcoming room booking (`status` in `pending/approved/active`, `reserved_start_time > oldEndTime`) in the same room, if any.
FR-008: THE system SHALL create a `meeting_requests` record for every valid extension request (both applied and rejected outcomes).
FR-009: THE system SHALL auto-approve and apply the extension when no upcoming booking exists, or when `requestedNewEndTime <= upcomingBooking.reserved_start_time - bufferMinutesBeforeNextMeeting`.
FR-010: THE system SHALL set `approval_mode = auto`, `approval_status = applied`, `conflict_check_status = clear` for the applied path.
FR-011: THE system SHALL update `meetings.end_time`, `room_bookings.reserved_end_time`, and `room_booking_usages.reserved_end_time` only in the applied path.
FR-012: THE system SHALL immediately reject (synchronously, in the same request/response cycle) when `requestedNewEndTime > upcomingBooking.reserved_start_time - bufferMinutesBeforeNextMeeting`. THE system SHALL NOT create a `pending` request or route it to a Manager/Approver.
FR-013: THE system SHALL set `approval_mode = auto`, `approval_status = rejected`, `conflict_check_status = blocked`, and populate `rejection_reason` when the buffer is violated.
FR-014: THE system SHALL store conflict details (`nextMeetingId`, `nextBookingId`, `nextMeetingStartTime`, `bufferMinutes`) in `meeting_requests.conflict_summary_json`.
FR-015: THE system SHALL return the next meeting's summary (id, title, startTime, endTime, roomName) and the next meeting host's contact info (id, fullName, email, phoneNumber) in the API response when the request is rejected due to buffer violation.
FR-016: THE system SHALL notify the requesting Host (not a Manager/Approver) via `in_app` and `websocket` channels when the request is auto-rejected, carrying the same rejection reason and contact info as FR-015.
FR-017: (Đã bỏ — không còn CTA `view_extension_request` cho Manager trong luồng này.)
FR-018: THE system SHALL NOT include Manager approve/reject actions in the notification for UC-IMM-02.
FR-019: THE system SHALL NOT create overlap room bookings in any path.
FR-020: THE system SHALL record meeting event and audit log for auto-applied extension.
FR-021: THE system SHALL record an audit log entry (`extend_meeting_auto_rejected`) for the auto-rejected path.

---

## 5. Logic xác định Manager/Approver

> **[Deprecated cho UC-IMM-02 từ 2026-08-21]** Từ khi áp dụng Buffer-based Auto Decision, UC-IMM-02 KHÔNG còn resolve hay notify Manager/Approver — mọi conflict được tự xử lý (reject + trả contact info Host cuộc họp sau) mà không cần Manager. Nội dung mục 5 dưới đây được giữ lại nguyên trạng chỉ vì code `resolveApprover()`/`handleConflictPath()` vẫn còn tồn tại trong `LiveMeetingService` (dùng nội bộ cho endpoint `decide` của UC-IMM-03, xem `spec/features/live-meeting/feat-process-meeting-extension-request/`), không phải vì UC-IMM-02 còn gọi tới.

Trong UC-IMM-02 (bản cũ, trước 2026-08-21) chỉ cần resolve Manager để gửi thông báo (không xử lý approve/reject). Quy tắc tìm kiếm Approver:
1. Ưu tiên lấy `users.direct_manager_id` của Host (nếu đang active).
2. Nếu không có direct manager, fallback sang `departments.manager_user_id` của phòng ban mà Host trực thuộc.
3. Nếu vẫn không có, fallback sang user/role có permission review/approve extension theo API contract hiện tại.
4. Nếu hoàn toàn không tìm được Manager/Approver hợp lệ nào:
   - KHÔNG tạo pending request conflict.
   - Trả về mã lỗi 409 `MEETING_EXTENSION_NO_APPROVER` với thông báo: *"Không tìm thấy Manager/Approver hợp lệ để xử lý yêu cầu gia hạn bị xung đột."*

Không được dùng `rooms.manager_id` (vì bảng `rooms` không có field này). Không fallback sang auto approve nếu có room conflict.

---

## 6. Data Model Impact

Không được phép thêm bảng mới, không thêm migration ngoài DB baseline v3.2 Compact.

### 6.1 `system_configs` Mapping
Hệ thống sử dụng bảng `system_configs` để lưu policy:
- `config_key = meeting.extension.policy`
- `config_group = scheduling`
- `value_type = json`
- Value JSON chuẩn (Ví dụ, từ 2026-08-21):
  ```json
  {
    "allowedExtensionMinutes": [15, 30, 60],
    "maxExtensionCountPerMeeting": 2,
    "maxTotalExtensionMinutesPerMeeting": 60,
    "bufferMinutesBeforeNextMeeting": 15,
    "notifyManagerEmail": false
  }
  ```
  Ghi chú: `allowedExtensionMinutes` chỉ còn mang tính gợi ý preset cho FE, BE không dùng để validate. `autoApproveWhenNoRoomConflict`, `manualPendingWhenRoomConflict`, `approvalExpiresAtStrategy`, `notifyManagerInApp`, `notifyManagerWebSocket` đã bỏ vì không còn luồng Manager trong UC-IMM-02.

### 6.2 `notifications` Mapping (Case B — Auto-rejected)
Khi vi phạm buffer, hệ thống tạo notification cho chính **Host đang gửi yêu cầu** (KHÔNG phải Manager/Approver):
- `notification_type = meeting_request_rejected`
- `channel = in_app`
- `related_entity_type = meeting_request`
- `related_entity_id = requestId`
- `recipient_scope = user_list`
- `recipient_user_ids_json = [hostId]` (chính Host vừa request)
- `priority = high`
- `payload_json` chứa:
  ```json
  {
    "type": "meeting_extension_rejected",
    "title": "Yêu cầu gia hạn bị từ chối",
    "message": "Không thể gia hạn: vi phạm khoảng đệm 15 phút trước cuộc họp kế tiếp \"{nextMeetingTitle}\" (bắt đầu lúc {nextMeetingStartTime}).",
    "meetingId": "uuid",
    "requestId": "uuid",
    "extensionMinutes": 45,
    "nextMeeting": {
      "id": "uuid",
      "title": "string",
      "startTime": "datetime",
      "endTime": "datetime",
      "roomName": "string"
    },
    "nextMeetingHost": {
      "id": "uuid",
      "fullName": "string",
      "email": "string",
      "phoneNumber": "string|null"
    }
  }
  ```
  WS event tương ứng: `meeting.extension.rejected`, emit vào room `meeting:{meetingId}`.

### 6.3 Mapping cho Auto applied (Case A)
- `meeting_requests.approval_mode = auto`
- `meeting_requests.approval_status = applied`
- `meeting_requests.conflict_check_status = clear`
- `meeting_requests.applied_at = now()`

### 6.4 Mapping cho Auto-rejected do vi phạm buffer (Case B)
- `meeting_requests.approval_mode = auto`
- `meeting_requests.approval_status = rejected`
- `meeting_requests.conflict_check_status = blocked`
- `meeting_requests.rejection_reason = "..."` (mô tả lý do, xem BR-009)
- `meeting_requests.conflict_summary_json = { nextMeetingId, nextBookingId, nextMeetingStartTime, bufferMinutes, checkedAt }`
- `meeting_requests.decision_by = null` (hệ thống tự quyết định, không có người quyết định thủ công)
- `meeting_requests.applied_at = null`

*Lưu ý: Không dùng bảng `schedule_conflicts`. Không còn dùng `rule_snapshot_json.approverIds` trong path này (đã bỏ Manager).*

---

## 7. Error Handling

Không dùng `MEETING_EXTENSION_ROOM_CONFLICT` để chặn submit request khi bị trùng lịch, mà chuyển thành pending request. Mã lỗi trả về từ API chỉ phát sinh khi không hợp lệ hoặc lỗi quy trình:

| HTTP Status | Error Code | Mô tả |
|---:|---|---|
| 400 | MEETING_EXTENSION_INVALID_DURATION | Thời lượng gia hạn không hợp lệ |
| 403 | MEETING_EXTENSION_NOT_HOST | Nguời gửi yêu cầu không phải Host |
| 409 | MEETING_EXTENSION_NOT_IN_PROGRESS | Cuộc họp không ở trạng thái in_progress |
| 409 | MEETING_EXTENSION_NO_ACTIVE_BOOKING | Không có booking phòng đang active |
| 409 | MEETING_EXTENSION_LIMIT_EXCEEDED | Vượt quá 2 lần hoặc quá tổng 60 phút gia hạn (đã applied) |
| 409 | MEETING_EXTENSION_NO_APPROVER | Có conflict nhưng không resolve được Manager/Approver |
| 500 | MEETING_EXTENSION_MANAGER_NOTIFICATION_FAILED | Gặp lỗi không thể gửi thông báo tới Manager cho pending request |

---

## 8. Acceptance Criteria

- AC-001: Host gửi yêu cầu gia hạn khi meeting đang `in_progress` và không tồn tại cuộc họp kế tiếp cùng phòng (hoặc không vi phạm buffer) thì hệ thống auto approve/apply ngay.
- AC-002: Khi auto apply thành công, `meetings.end_time`, `room_bookings.reserved_end_time`, `room_booking_usages.reserved_end_time` được cập nhật.
- AC-003: Khi auto apply thành công, `meeting_requests.approval_mode = auto`, `approval_status = applied`, `conflict_check_status = clear`.
- AC-004: Khi `requestedNewEndTime` vi phạm buffer (`> nextMeeting.startTime - bufferMinutesBeforeNextMeeting`), hệ thống không update meeting/booking.
- AC-005: Khi vi phạm buffer, hệ thống tạo `meeting_requests.approval_mode = auto`, `approval_status = rejected`, `conflict_check_status = blocked`, có `rejection_reason`.
- AC-006: Khi vi phạm buffer, response API trả về ngay (đồng bộ, không cần chờ ai duyệt) `status = rejected`, `rejectionReason`, `nextMeeting`, `nextMeetingHost` (email + phoneNumber).
- AC-007: Khi vi phạm buffer, chính Host vừa gửi request (không phải Manager) nhận được in-app/websocket notification chứa cùng thông tin ở AC-006.
- AC-008: UC-IMM-02 (từ 2026-08-21) không còn phụ thuộc việc resolve Manager/Approver — mã lỗi `MEETING_EXTENSION_NO_APPROVER` không còn phát sinh từ luồng này.
- AC-009: Non-host bị chặn không được gửi yêu cầu gia hạn.
- AC-010: Meeting không `in_progress` bị chặn.
- AC-011: UC-IMM-02 không tự tạo pending request nào cho Manager xử lý nữa (endpoint `decide` của UC-IMM-03 vẫn tồn tại độc lập nhưng không còn nhận được request nào từ luồng này).
- AC-012: Hệ thống không tạo overlap booking trong mọi trường hợp của UC-IMM-02.
- AC-013: Chỉ request đã `applied` mới tính vào số lần/tổng phút gia hạn.
- AC-014: Notification failure cho Host trong path bị từ chối là best-effort (log lỗi), KHÔNG làm rollback quyết định `rejected` đã ghi nhận.
- AC-015: `extensionMinutes` không còn bị validate theo tập giá trị cố định; chỉ cần là số nguyên trong khoảng `[1, 240]`.
- AC-016: Nếu config `meeting.extension.policy` không tồn tại hoặc thiếu field, system fallback `bufferMinutesBeforeNextMeeting = 15`, `maxExtensionCountPerMeeting = 2`, `maxTotalExtensionMinutesPerMeeting = 60`.
- AC-017: Khi vi phạm buffer, Host nhận notification có `type = meeting_extension_rejected`.
- AC-018: (Đã bỏ — không còn CTA cho Manager trong luồng này.)
- AC-019: Notification không chứa approve/reject action trực tiếp trong UC-IMM-02.
- AC-020: Email notification không được gửi mặc định trong v1.
- AC-021: Nếu `nextMeetingHost.phoneNumber` là `null`, response/notification trả `null` (không phải chuỗi rỗng), FE ẩn nút gọi tương ứng.

---

## 9. API Contract

### Endpoint Host Submit
`POST /api/v1/meetings/{meetingId}/extension-requests`

**Request Body:**
```json
{
  "extensionMinutes": 15,
  "reason": "Nội dung họp chưa hoàn tất"
}
```

### 9.1 Response — Auto applied khi không conflict (201/200)

```json
{
  "success": true,
  "data": {
    "requestId": "uuid",
    "meetingId": "uuid",
    "approvalMode": "auto",
    "status": "applied",
    "oldEndTime": "2026-06-16T10:00:00+07:00",
    "newEndTime": "2026-06-16T10:15:00+07:00",
    "extensionMinutes": 15,
    "conflictCheckStatus": "clear",
    "message": "Gia hạn thành công."
  }
}
```

### 9.2 Response — Rejected do vi phạm buffer trước cuộc họp kế tiếp (200, 2026-08-21)

Ví dụ: cuộc họp hiện tại kết thúc lúc 13:00, cuộc họp kế tiếp cùng phòng bắt đầu 14:00, buffer = 15 phút → giới hạn auto-accept là 13:45. Host xin thêm 60 phút (đến 14:00) → vi phạm buffer:

```json
{
  "success": true,
  "data": {
    "requestId": "uuid",
    "meetingId": "uuid",
    "approvalMode": "auto",
    "status": "rejected",
    "oldEndTime": "2026-08-21T13:00:00+07:00",
    "requestedNewEndTime": "2026-08-21T14:00:00+07:00",
    "extensionMinutes": 60,
    "conflictCheckStatus": "blocked",
    "rejectionReason": "Khong the gia han: thoi gian yeu cau ket thuc luc 2026-08-21T07:00:00.000Z vi pham khoang dem 15 phut truoc cuoc hop ke tiep \"Review Q3\" (bat dau luc 2026-08-21T07:00:00.000Z). Vui long lien he truc tiep Host cuoc hop sau de thong nhat thoi gian gia han.",
    "nextMeeting": {
      "id": "uuid",
      "title": "Review Q3",
      "startTime": "2026-08-21T14:00:00+07:00",
      "endTime": "2026-08-21T15:00:00+07:00",
      "roomName": "Phòng họp A"
    },
    "nextMeetingHost": {
      "id": "uuid",
      "fullName": "Nguyễn Văn B",
      "email": "b.nguyen@company.com",
      "phoneNumber": "0901234567"
    }
  }
}
```

Lưu ý: Host xin thêm `<= 45` phút (đến `<=` 13:45) trong ví dụ trên sẽ rơi vào path 9.1 (auto applied), không phải path này.

---

## 10. Out of Scope

Các nội dung sau không thuộc UC-IMM-02 (bản 2026-08-21):
- Manager approve/reject pending extension request — **đã bị loại khỏi luồng UC-IMM-02**; nếu cần tính năng Manager duyệt gia hạn riêng biệt, phải là một use case mới, không phục hồi lại trong UC-IMM-02.
- Direct approve/reject action in notification.
- Dời meeting sau sang phòng khác.
- Hủy meeting sau.
- Rút ngắn meeting sau.
- Override booking để tạo overlap.
- Resolve room booking conflict.
- Cấu hình kênh liên hệ khác ngoài email/phone hiển thị trực tiếp (ví dụ: chat nội bộ, gọi trong app) — Host tự liên hệ ngoài hệ thống bằng thông tin được cung cấp.
- Email notification template cho Host bị từ chối, nếu chưa có convention hiện tại (v1 chỉ `in_app` + `websocket`).
- Background job tự động xử lý pending request hết hạn (không còn pending request nào phát sinh từ UC-IMM-02).
- `spec/features/live-meeting/feat-process-meeting-extension-request/` (UC-IMM-03, endpoint `decide`): vẫn tồn tại độc lập trong code nhưng không còn được UC-IMM-02 gọi tới; không nằm trong phạm vi sửa đổi lần này.
