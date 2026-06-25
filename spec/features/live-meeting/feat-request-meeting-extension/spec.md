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

UC-IMM-02 sử dụng **Hybrid Extension Request**. Nếu không có room conflict trong khoảng thời gian gia hạn, hệ thống tự động approve và apply extension ngay. Nếu có room conflict, hệ thống tạo pending manual request và gửi thông báo cho Manager/Approver để giải quyết; việc Manager phê duyệt hay xử lý conflict nằm ngoài scope của UC-IMM-02.

### 1.2 Mục tiêu

Mục tiêu của tính năng này là cho phép Host gửi yêu cầu gia hạn phiên họp đang diễn ra:
- **Trường hợp phòng trống (Không conflict)**: Tự động ghi nhận `meeting_requests` với trạng thái `applied`, cập nhật thời gian kết thúc của `meetings`, `room_bookings`, `room_booking_usages`, ghi log và push thông báo cho người trong phòng.
- **Trường hợp trùng lịch (Có conflict)**: Ghi nhận yêu cầu vào `meeting_requests` dưới dạng chờ xử lý (`pending`), không thay đổi lịch phòng hiện tại, và tự động tìm kiếm Approver/Manager hợp lệ để gửi thông báo ưu tiên cao.

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
BR-005: Hệ thống phải kiểm tra room conflict trong khoảng `[oldEndTime, requestedNewEndTime)`.
BR-006: Nếu không có room conflict, hệ thống tự động approve và apply extension.
BR-007: Nếu không có room conflict, request được lưu với `approval_mode = auto`, `approval_status = applied`, `conflict_check_status = clear`.
BR-008: Nếu có room conflict, hệ thống không apply extension, không update meeting/booking.
BR-009: Nếu có room conflict, request được lưu với `approval_mode = manual`, `approval_status = pending`, `conflict_check_status = blocked`.
BR-010: Khi có room conflict, hệ thống phải thông báo cho Host rằng yêu cầu đã được gửi đến Manager để xử lý.
BR-011: Khi có room conflict, system SHALL notify Manager/Approver with an in-app notification and websocket event if available.
BR-012: UC-IMM-02 không xử lý Manager approve/reject; việc đó thuộc feature review/resolve riêng.
BR-013: Hệ thống không được tạo overlap booking trong UC-IMM-02.
BR-014: Không tự động đổi phòng, hủy meeting sau, dời meeting sau, hoặc override booking trong UC-IMM-02.
BR-015: System SHALL load meeting extension policy from `system_configs` with key `meeting.extension.policy`.
BR-016: If config is missing, inactive, or partially invalid, system SHALL fallback to default policy: `allowedExtensionMinutes = [15, 30, 60]`, `maxExtensionCountPerMeeting = 2`, `maxTotalExtensionMinutesPerMeeting = 60`, `autoApproveWhenNoRoomConflict = true`, `manualPendingWhenRoomConflict = true`, `notifyManagerEmail = false`.
BR-017: Chỉ request `approval_status = applied` mới được tính vào số lần/tổng thời lượng đã gia hạn.
BR-018: Notification CTA cho Manager SHALL be `view_extension_request`.
BR-019: Notification SHALL NOT include direct approve/reject action in UC-IMM-02.
BR-020: Email notification is optional and disabled by default in v1.

---

## 4. Functional Requirements

FR-001: THE system SHALL allow only the Host to submit a meeting extension request.
FR-002: THE system SHALL validate meeting is `in_progress`.
FR-003: THE system SHALL validate meeting has active room booking.
FR-004: THE system SHALL read the extension duration policy from `system_configs` (`meeting.extension.policy`) or use the default fallback `[15, 30, 60]`.
FR-005: THE system SHALL validate `extensionMinutes` and extension limits based on the loaded policy.
FR-006: THE system SHALL calculate `requestedNewEndTime = oldEndTime + extensionMinutes`.
FR-007: THE system SHALL check room conflict in `[oldEndTime, requestedNewEndTime)`.
FR-008: THE system SHALL create a `meeting_requests` record for every valid extension request.
FR-009: THE system SHALL auto-approve and apply the extension when no room conflict exists.
FR-010: THE system SHALL set `approval_mode = auto`, `approval_status = applied`, `conflict_check_status = clear` for conflict-free extension.
FR-011: THE system SHALL update `meetings.end_time`, `room_bookings.reserved_end_time`, and `room_booking_usages.reserved_end_time` only in the conflict-free auto-approve path.
FR-012: THE system SHALL create a manual pending request when room conflict exists.
FR-013: THE system SHALL set `approval_mode = manual`, `approval_status = pending`, `conflict_check_status = blocked` when room conflict exists.
FR-014: THE system SHALL store conflict details in `meeting_requests.conflict_summary_json`.
FR-015: THE system SHALL notify Host that the request is waiting for Manager handling when conflict exists.
FR-016: THE system SHALL notify Manager/Approver when conflict-based pending request is created via `in_app` and `websocket` channels.
FR-017: THE system SHALL include a `view_extension_request` CTA in the notification payload.
FR-018: THE system SHALL NOT include approve/reject logic or actions in the notification for UC-IMM-02.
FR-019: THE system SHALL NOT create overlap room bookings in any path.
FR-020: THE system SHALL record meeting event and audit log for auto-applied extension.
FR-021: THE system SHALL record request/audit trace for conflict-based pending request.

---

## 5. Logic xác định Manager/Approver

Trong UC-IMM-02 chỉ cần resolve Manager để gửi thông báo (không xử lý approve/reject). Quy tắc tìm kiếm Approver:
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
- Value JSON chuẩn (Ví dụ):
  ```json
  {
    "allowedExtensionMinutes": [15, 30, 60],
    "maxExtensionCountPerMeeting": 2,
    "maxTotalExtensionMinutesPerMeeting": 60,
    "autoApproveWhenNoRoomConflict": true,
    "manualPendingWhenRoomConflict": true,
    "approvalExpiresAtStrategy": "old_end_time",
    "notifyManagerInApp": true,
    "notifyManagerWebSocket": true,
    "notifyManagerEmail": false
  }
  ```

### 6.2 `notifications` Mapping
Khi có room conflict, hệ thống tạo notification cho Manager/Approver:
- `notification_type = meeting_extension_request`
- `channel = in_app`
- `related_entity_type = meeting_request`
- `related_entity_id = requestId`
- `recipient_scope = user_list`
- `recipient_user_ids_json = [managerId/approverIds]`
- `priority = high`
- `payload_json` chứa:
  ```json
  {
    "type": "meeting_extension_request",
    "title": "Yêu cầu gia hạn cuộc họp cần xử lý",
    "message": "Cuộc họp \"{meetingTitle}\" tại phòng \"{roomName}\" đang yêu cầu gia hạn thêm {extensionMinutes} phút nhưng bị trùng lịch với cuộc họp tiếp theo.",
    "meetingId": "uuid",
    "meetingTitle": "string",
    "requestId": "uuid",
    "roomId": "uuid",
    "roomName": "string",
    "hostId": "uuid",
    "hostName": "string",
    "oldEndTime": "datetime",
    "requestedNewEndTime": "datetime",
    "extensionMinutes": 15,
    "conflictCheckStatus": "blocked",
    "conflicts": [
      {
        "conflictingMeetingId": "uuid",
        "conflictingBookingId": "uuid",
        "conflictStartTime": "datetime",
        "conflictEndTime": "datetime"
      }
    ],
    "cta": {
      "type": "view_extension_request",
      "label": "Xem yêu cầu gia hạn",
      "target": "/meeting-requests/{requestId}"
    }
  }
  ```

### 6.3 Mapping cho Auto applied (Case A)
- `meeting_requests.approval_mode = auto`
- `meeting_requests.approval_status = applied`
- `meeting_requests.conflict_check_status = clear`
- `meeting_requests.applied_at = now()`

### 6.4 Mapping cho Conflict pending (Case B)
- `meeting_requests.approval_mode = manual`
- `meeting_requests.approval_status = pending`
- `meeting_requests.conflict_check_status = blocked`
- `meeting_requests.conflict_summary_json = {...}`
- `meeting_requests.request_payload_json.approvalExpiresAt = oldEndTime`
- `meeting_requests.rule_snapshot_json.approverIds = [...]`

*Lưu ý: Không dùng bảng `schedule_conflicts`.*

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

- AC-001: Host gửi yêu cầu gia hạn khi meeting đang `in_progress` và không có room conflict thì hệ thống auto approve/apply.
- AC-002: Khi auto apply thành công, `meetings.end_time`, `room_bookings.reserved_end_time`, `room_booking_usages.reserved_end_time` được cập nhật.
- AC-003: Khi auto apply thành công, `meeting_requests.approval_mode = auto`, `approval_status = applied`, `conflict_check_status = clear`.
- AC-004: Khi có room conflict, hệ thống không update meeting/booking.
- AC-005: Khi có room conflict, hệ thống tạo `meeting_requests.approval_mode = manual`, `approval_status = pending`, `conflict_check_status = blocked`.
- AC-006: Khi có room conflict, Host nhận message rằng yêu cầu đã được gửi đến Manager xử lý.
- AC-007: Khi có room conflict, Manager/Approver nhận được in-app/websocket notification.
- AC-008: Nếu có room conflict nhưng không resolve được Manager/Approver, API trả `409 MEETING_EXTENSION_NO_APPROVER`.
- AC-009: Non-host bị chặn không được gửi yêu cầu gia hạn.
- AC-010: Meeting không `in_progress` bị chặn.
- AC-011: UC-IMM-02 không cung cấp approve/reject endpoint cho Manager.
- AC-012: Hệ thống không tạo overlap booking trong mọi trường hợp của UC-IMM-02.
- AC-013: Chỉ request đã `applied` mới tính vào số lần/tổng phút gia hạn.
- AC-014: Notification failure cho Manager trong conflict path khiến request không được tạo thành công và trả lỗi phù hợp.
- AC-015: Nếu config `meeting.extension.policy` tồn tại và active, system dùng policy đó để validate `extensionMinutes`.
- AC-016: Nếu config không tồn tại, system fallback về `[15, 30, 60]`.
- AC-017: Khi có room conflict, Manager nhận notification có `type = meeting_extension_request`.
- AC-018: Notification cho Manager có CTA `view_extension_request`.
- AC-019: Notification không chứa approve/reject action trực tiếp trong UC-IMM-02.
- AC-020: Email notification không được gửi mặc định trong v1.

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

### 9.2 Response — Pending khi có conflict (201/200)

```json
{
  "success": true,
  "data": {
    "requestId": "uuid",
    "meetingId": "uuid",
    "approvalMode": "manual",
    "status": "pending",
    "oldEndTime": "2026-06-16T10:00:00+07:00",
    "requestedNewEndTime": "2026-06-16T10:15:00+07:00",
    "extensionMinutes": 15,
    "conflictCheckStatus": "blocked",
    "message": "Phòng đã có lịch sau thời gian hiện tại. Yêu cầu gia hạn đã được gửi đến Manager để xử lý.",
    "managerNotificationSent": true
  }
}
```

---

## 10. Out of Scope

Các nội dung sau không thuộc UC-IMM-02:
- Manager approve/reject pending extension request.
- Direct approve/reject action in notification.
- Dời meeting sau sang phòng khác.
- Hủy meeting sau.
- Rút ngắn meeting sau.
- Override booking để tạo overlap.
- Resolve room booking conflict.
- Endpoint approve/reject manual request.
- Email notification template cho Manager, nếu chưa có convention hiện tại.
- Background job tự động xử lý pending request hết hạn.
