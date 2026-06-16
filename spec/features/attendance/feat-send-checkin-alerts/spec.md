# Feature Specification: Send Check-in Alerts

## 📝 CHANGELOG & REVISION HISTORY
| Ngày cập nhật | Tóm tắt thay đổi | Các dòng thay đổi |
| :--- | :--- | :--- |
| 2026-06-16 | Bổ sung các giải pháp từ quá trình Clarify (Grace period, Redis idempotency, Partial failure, v.v.) | Các mục 1.5, 2.2, 3.1, 3.2, 3.7, 3.12 |

- **Feature ID**: UC-APM-10
- **Feature Name**: Gửi cảnh báo người tham dự chưa check-in
- **Module / Domain**: attendance-presence / notifications
- **Created Date**: 2026-06-16
- **Status**: Draft
- **Source Documents**:
  - AGENTS.md
  - API_CONTRACT_v1.0_with_system_roles.md (UC-92)
  - Database v3.2 Compact (39 tables)
  - Spec template (`.specify/templates/spec-template.md`)

---

## Hướng dẫn viết EARS Requirements

Functional Requirements trong spec này phải ưu tiên viết theo EARS.
EARS giúp requirement rõ trigger, rõ điều kiện, rõ system response, dễ trace sang plan/task/test.

### EARS Keyword Rules

| Keyword | Vai trò | Khi nào dùng |
|---|---|---|
| `THE system SHALL` | Yêu cầu luôn đúng, không phụ thuộc event/state/option/error | Ubiquitous Requirement |
| `WHEN` | Trigger/event xảy ra tại một thời điểm | Event-driven Requirement |
| `WHILE` | Hành vi đúng trong suốt một trạng thái | State-driven Requirement |
| `WHERE` | Yêu cầu chỉ áp dụng khi feature/capability/config tồn tại | Optional Feature Requirement |
| `IF ... THEN` | Xử lý lỗi, ngoại lệ, điều kiện không mong muốn | Unwanted Behavior Requirement |

### Quy tắc viết câu EARS trong spec này

```
[Requirement ID]: [EARS keyword bằng tiếng Anh] [Nội dung điều kiện viết bằng tiếng Việt], THE system SHALL [Nội dung phản hồi viết bằng tiếng Việt].
```

Hoặc với lỗi/ngoại lệ:

```
[Requirement ID]: IF [Nội dung lỗi/ngoại lệ viết bằng tiếng Việt], THEN THE system SHALL [Nội dung phản hồi viết bằng tiếng Việt].
```

---

## 1. Context & Goal

### 1.1 Bối cảnh

Feature này thuộc module **attendance-presence** tích hợp với **notifications**.

Khi cuộc họp chính thức bắt đầu (trạng thái `in_progress`), một số người tham dự bắt buộc vẫn chưa thực hiện check-in tại phòng họp (qua QR, face recognition hoặc manual check-in). Điều này gây ảnh hưởng đến tiến độ cuộc họp, giảm kỷ luật giờ giấc và khiến Host không nắm được tình hình tham dự thực tế.

UC-APM-10 là một **tiến trình tự động chạy nền** (`cron job`) do System thực hiện, nhằm phát hiện người tham dự bắt buộc chưa check-in và gửi cảnh báo sau một khoảng thời gian dung sai (`grace period`) có thể cấu hình.

Feature này nằm trong giai đoạn **trong cuộc họp** (in-meeting phase) của meeting lifecycle.

API Contract đã định nghĩa endpoint internal: `POST /api/v1/internal/meetings/{meetingId}/late-checkin-alerts` (UC-92).

### 1.2 Mục tiêu

Mục tiêu của feature này là cho phép **System** tự động phát hiện người tham dự nội bộ bắt buộc chưa check-in sau một khoảng thời gian dung sai kể từ khi meeting chuyển sang `in_progress`, và gửi cảnh báo qua email kèm thông báo tổng hợp cho Host nhằm thúc đẩy tuân thủ kỷ luật giờ giấc và giúp Host điều hành buổi họp hiệu quả.

### 1.3 Giá trị mang lại

- Giúp người tham dự bắt buộc nhận được nhắc nhở kịp thời khi chưa check-in.
- Giúp Host nắm được danh sách người chưa tham dự để chủ động điều phối.
- Giảm tỷ lệ đi muộn, tăng kỷ luật giờ giấc qua cơ chế cảnh báo tự động.
- Lưu vết đầy đủ vào `meeting_events` và `audit_logs` phục vụ truy vết và báo cáo.

### 1.4 Giả định

- Meeting đã được chuyển sang trạng thái `in_progress` bởi live-meeting flow (không thuộc phạm vi UC này).
- Notification Service hoạt động bình thường hoặc có cơ chế queue/retry khi lỗi.
- Hệ thống có cấu hình `system_configs` cho grace period và các tham số liên quan; nếu config không tồn tại, dùng default an toàn.
- Chỉ xử lý participant nội bộ (internal) có `meeting_participants.is_required = true`.
- External participants không thuộc scope chính của UC này.
- Không có public API cho end-user; chỉ có internal endpoint cho scheduler/test (UC-92).

### 1.5 Cần làm rõ

Đã giải quyết các vấn đề:
1. **Thời điểm tính grace period**: Dùng `COALESCE(meetings.actual_start_time, meetings.start_time) + grace_minutes`.
2. **Cron architecture**: Gọi trực tiếp Service layer. Internal HTTP endpoint chỉ dùng cho test/manual.
3. **Host summary**: Gửi tối đa 1 lần mỗi `meeting_id + host_id + alert_type + grace_minutes`.
4. **Auth**: Internal API dùng service-to-service API key / signed token.
5. **Participant**: Cần cả `is_required = true` VÀ `attendance_required = true`.
6. **Idempotency**: Dùng Redis keys (`attendance:checkin-alert:...`).
7. **Partial failure**: Xử lý độc lập từng recipient, không rollback toàn bộ.

---

## 2. Actor & Roles

### 2.1 Danh sách actor

| Actor | Vai trò trong tính năng | Quyền / Trách nhiệm chính |
|---|---|---|
| System | Primary Actor - thực thi cron job quét meeting và gửi cảnh báo | Chạy background scheduler, kiểm tra attendance, tạo notification/event/audit log |
| Participant | Recipient - người tham dự bắt buộc chưa check-in | Nhận email cảnh báo nhắc nhở check-in |
| Host | Recipient - chủ cuộc họp | Nhận thông báo tổng hợp danh sách người chưa check-in |
| INTERNAL_SERVICE | System Role (API contract) | Gọi internal endpoint trigger late-checkin-alerts nếu cần |

### 2.2 Role & Permission Rules

- System (internal scheduler) không cần permission check vì chạy nội bộ và gọi trực tiếp vào Service layer của ứng dụng.
- Endpoint `POST /api/v1/internal/meetings/{meetingId}/late-checkin-alerts` là optional (chủ yếu cho manual trigger/test), yêu cầu xác thực bằng service-to-service API key hoặc signed internal token, không dùng end-user JWT thông thường.
- Participant và Host chỉ là recipient, không chủ động gọi API trong UC này.
- Không yêu cầu end-user API cho tính năng này.

### 2.3 Actor Constraints

- System: phải có khả năng chạy cron job và truy cập database.
- Participant: phải có tài khoản active, có email hợp lệ trong bảng `users`.
- Host: phải là host của meeting; nếu Host đồng thời là required participant chưa check-in, Host cũng bị xử lý như participant vi phạm.

---

## 3. Functional Requirements

### 3.1 Core Requirements

```
FR-001: THE system SHALL chạy một cron job định kỳ để quét các meeting đang ở trạng thái `in_progress` nhằm phát hiện người tham dự bắt buộc chưa check-in.
FR-002: THE system SHALL chỉ xử lý các meeting đã vượt quá grace period kể từ thời điểm `COALESCE(meetings.actual_start_time, meetings.start_time)`.
FR-003: THE system SHALL chỉ xử lý các participant nội bộ có `meeting_participants.is_required = true` và `meeting_participants.attendance_required = true` (nếu có `is_required = true` nhưng `attendance_required = false` thì miễn trừ).
```

### 3.2 Event-driven Requirements

```
FR-004: WHEN cron job phát hiện một meeting `in_progress` đã vượt quá grace period, THE system SHALL lấy danh sách participant nội bộ bắt buộc của meeting đó.
FR-005: WHEN danh sách participant bắt buộc chưa check-in được xác định, THE system SHALL tạo notification type `late_checkin_alert` cho từng participant vi phạm.
FR-006: WHEN có ít nhất một participant vi phạm, THE system SHALL gửi thông báo tổng hợp cho Host của meeting tối đa 1 lần cho mỗi mốc grace period (nếu config `notify_host_enabled = true`).
```

### 3.3 State-driven Requirements

```
FR-007: WHILE meeting đang ở trạng thái `in_progress`, THE system SHALL cho phép cron job kiểm tra attendance status của participants.
FR-008: WHILE cron job đang xử lý một meeting, THE system SHALL không block luồng xử lý của meeting khác (xử lý batch độc lập).
```

### 3.4 Optional Feature Requirements

```
FR-009: WHERE `attendance.checkin_alert.enabled` được cấu hình trong `system_configs`, THE system SHALL kích hoạt cron job cảnh báo check-in.
FR-010: WHERE hệ thống có support `in_app` hoặc `websocket` notification channel, THE system SHALL có thể gửi cảnh báo qua các channel đó như không bắt buộc (secondary channel).
```

### 3.5 Unwanted Behavior Requirements

```
FR-011: IF participant đã check-in (attendance_status IN ('present', 'late') hoặc attendance_records.check_in_time IS NOT NULL) tại thời điểm re-check ngay trước khi gửi, THEN THE system SHALL không gửi cảnh báo cho participant đó.
FR-012: IF participant không có email hợp lệ hoặc tài khoản inactive (users.is_active = false), THEN THE system SHALL bỏ qua participant đó và ghi nhận partial failure vào notification hoặc audit metadata.
FR-013: IF meeting không còn ở trạng thái `in_progress` tại thời điểm scan, THEN THE system SHALL bỏ qua meeting đó và không xử lý cảnh báo.
FR-014: IF meeting chưa vượt quá grace period kể từ start_time, THEN THE system SHALL bỏ qua meeting đó trong lần scan hiện tại.
FR-015: IF notification/email provider gặp lỗi khi gửi, THEN THE system SHALL enqueue retry qua background job và không làm crash toàn bộ cron.
```

### 3.6 Workflow Requirements

```
FR-016: WHEN cron job khởi tạo một phiên xử lý cảnh báo, THE system SHALL quét các meeting theo time window với index phù hợp, không full scan.
FR-017: WHEN một participant được xác định vi phạm, THE system SHALL re-check attendance status ngay trước khi enqueue notification để tránh gửi nhầm.
FR-018: WHEN notification được tạo thành công, THE system SHALL ghi `meeting_events` với event type `attendance_checkin_alert_sent`.
FR-019: WHEN tất cả cảnh báo cho một meeting được xử lý xong, THE system SHALL ghi `audit_logs` với actor là `System`.
```

### 3.7 Authorization Requirements

```
FR-020: IF internal endpoint `/api/v1/internal/meetings/{meetingId}/late-checkin-alerts` (optional) được gọi, THEN THE system SHALL xác thực bằng service-to-service API key hoặc signed internal token.
FR-021: IF request gọi internal endpoint không có service API key / internal token hợp lệ, THEN THE system SHALL từ chối request.
```

### 3.8 Data & State Requirements

```
FR-022: WHEN cron job tạo notification type `late_checkin_alert`, THE system SHALL persist notification với `related_entity_type = 'meeting'` và `related_entity_id = meetingId`.
FR-023: WHEN cron job ghi `meeting_events`, THE system SHALL lưu event type `attendance_checkin_alert_sent` và metadata JSON chứa danh sách participant_id đã được gửi cảnh báo.
FR-024: THE system SHALL sử dụng `system_configs` để đọc config, không hard-code giá trị.
```

### 3.9 Notification / Audit Requirements

```
FR-025: WHEN participant vi phạm được xác định, THE system SHALL tạo notification record với channel là `email`, type là `late_checkin_alert`.
FR-026: WHEN Host summary được gửi, THE system SHALL tạo notification record riêng cho Host với nội dung danh sách participants chưa check-in.
FR-027: WHEN bất kỳ cảnh báo nào được gửi hoặc bỏ qua do lỗi, THE system SHALL ghi audit log với action `checkin_alert_sent` hoặc `checkin_alert_skipped`.
```

### 3.10 Integration / Device Requirements

```
FR-028: WHERE camera/face recognition integration được cấu hình phục vụ attendance, THE system SHALL ưu tiên đọc `meeting_participants.attendance_status` trước, sau đó đối chiếu `attendance_records` và `attendance_events`.
```

### 3.11 Complex / Combined Requirements

```
FR-029: WHILE meeting đang `in_progress`, WHEN cron job phát hiện meeting vượt grace period, THE system SHALL kích hoạt luồng xử lý cảnh báo cho meeting đó.
FR-030: WHERE `attendance.checkin_alert.enabled = true`, WHILE cron job đang xử lý, IF notification service unavailable, THEN THE system SHALL enqueue retry và tiếp tục xử lý meeting khác.
FR-031: WHILE cron job xử lý meeting, IF participant vừa check-in (attendance_status thay đổi) sau re-check, THEN THE system SHALL bỏ qua participant đó.
```

### 3.12 Requirement Notes

- Idempotency: Không gửi nhiều hơn 1 cảnh báo. THE system SHOULD sử dụng Redis idempotency keys để chống duplicate lúc runtime:
  - `attendance:checkin-alert:{meetingId}:{participantId}:{graceMinutes}`
  - `attendance:checkin-alert-host:{meetingId}:{hostId}:{graceMinutes}`
  (Đồng thời vẫn lưu vết persistent vào `notifications`, `meeting_events` và `audit_logs`).
- Cron job chạy nhiều instance: phải có cơ chế idempotency qua Redis để tránh gửi trùng.
- Transaction & Partial Failure boundary: Xử lý best-effort trên từng recipient. Những notification tạo thành công sẽ được commit. Những recipient bị lỗi sẽ được ghi nhận là partial failure và retry độc lập. Tuyệt đối không rollback toàn bộ meeting chỉ vì 1 recipient bị lỗi.

### 3.13 Traceability

| Requirement ID | EARS Pattern | Nguồn / Use Case liên quan | Ghi chú |
|---|---|---|---|
| FR-001 | Ubiquitous | UC-APM-10 | Cron job scheduler |
| FR-002 | Ubiquitous | UC-APM-10 | Grace period check |
| FR-003 | Ubiquitous | UC-APM-10 | Required participant filter |
| FR-004 | Event-driven | UC-APM-10 | Trigger khi vượt grace period |
| FR-005 | Event-driven | UC-APM-10 | Tạo notification cho participant |
| FR-006 | Event-driven | UC-APM-10 | Host summary |
| FR-007 | State-driven | UC-APM-10 | Meeting in_progress |
| FR-008 | State-driven | UC-APM-10 | Batch processing |
| FR-009 | Optional Feature | UC-APM-10 | System config enabled |
| FR-010 | Optional Feature | UC-APM-10 | Secondary channel |
| FR-011 | Unwanted Behavior | UC-APM-10 | Re-check trước khi gửi |
| FR-012 | Unwanted Behavior | UC-APM-10 | Missing email / inactive account |
| FR-013 | Unwanted Behavior | UC-APM-10 | Meeting không còn in_progress |
| FR-014 | Unwanted Behavior | UC-APM-10 | Chưa vượt grace period |
| FR-015 | Unwanted Behavior | UC-APM-10 | Notification service failure |
| FR-016 | Workflow | UC-APM-10 | Query optimization |
| FR-017 | Workflow | UC-APM-10 | Re-check before send |
| FR-018 | Workflow | UC-APM-10 | Meeting event logging |
| FR-019 | Workflow | UC-APM-10 | Audit log |
| FR-020 | Authorization | UC-92 (API Contract) | Internal endpoint auth |
| FR-021 | Authorization | UC-92 (API Contract) | Invalid token rejection |
| FR-022 | Data & State | UC-APM-10 | Notification persistence |
| FR-023 | Data & State | UC-APM-10 | Meeting event metadata |
| FR-024 | Data & State | UC-APM-10 | Config-driven |
| FR-025 | Notification / Audit | UC-APM-10 | Email channel |
| FR-026 | Notification / Audit | UC-APM-10 | Host summary |
| FR-027 | Notification / Audit | UC-APM-10 | Audit logging |
| FR-028 | Integration / Device | UC-APM-10 | Attendance data sources |
| FR-029 | Complex | UC-APM-10 | State + Event |
| FR-030 | Complex | UC-APM-10 | Optional + State + Unwanted |
| FR-031 | Complex | UC-APM-10 | State + Unwanted |

---

## 4. Non-functional Requirements

### 4.1 Performance

```
NFR-001: THE system SHALL giới hạn cron job scan chỉ query các meeting trong time window phù hợp, không full scan toàn bộ bảng meetings.
NFR-002: THE system SHALL xử lý batch theo meeting, không gây quá tải database khi có nhiều meeting đồng thời.
NFR-003: THE system SHALL support `scan_interval_seconds` configurable để kiểm soát tần suất quét.
```

### 4.2 Security

```
NFR-004: THE system SHALL require INTERNAL_SERVICE authentication trước khi cho phép gọi internal endpoint.
NFR-005: THE system SHALL NOT log nội dung email chi tiết (chỉ log metadata: sent/thành công/thất bại).
NFR-006: THE system SHALL không để lộ thông tin cá nhân (email, token) trong log hoặc API response.
```

### 4.3 Reliability & Consistency

```
NFR-007: THE system SHALL sử dụng idempotency key hoặc meeting_events metadata để chống gửi trùng cảnh báo.
NFR-008: THE system SHALL re-check attendance status ngay trước khi enqueue notification để đảm bảo consistency.
NFR-009: IF cron job chạy nhiều instance song song, THEN THE system SHALL guarantee không gửi duplicate notifications qua distributed lock hoặc idempotency check.
```

### 4.4 Usability

```
NFR-010: THE system SHALL gửi email template chứa tên cuộc họp, phòng họp, giờ bắt đầu, số phút đã trễ và hướng dẫn check-in.
NFR-011: THE system SHALL gửi Host summary có danh sách participants vi phạm, không gửi email riêng lẻ cho Host.
```

### 4.5 Observability

```
NFR-012: THE system SHALL log correlation id / job id cho mỗi lần cron job chạy để trace.
NFR-013: THE system SHALL log số lượng meeting đã scan, số participant đã cảnh báo, số lỗi partial failure.
NFR-014: THE system SHALL record audit_logs cho tất cả các cảnh báo đã gửi hoặc bỏ qua.
```

### 4.6 Maintainability

```
NFR-015: THE system SHALL đọc tất cả config từ `system_configs`, không hard-code.
NFR-016: THE system SHALL phân tách logic cron job (scan + filter) khỏi logic notification (send + retry).
```

---

## 5. Data Model

### 5.1 Entity liên quan

| Entity / Table | Vai trò trong tính năng | Ghi chú |
|---|---|---|
| `meetings` | Xác định meeting in_progress, lấy start_time | Query theo status, start_time range |
| `rooms` | Lấy thông tin phòng họp cho email template | JOIN qua meetings.room_id |
| `meeting_participants` | Lọc required participant, đọc attendance_status | Filter is_required = true, attendance_required = true |
| `users` | Lấy email, check account active | JOIN qua meeting_participants.user_id |
| `attendance_records` | Kiểm tra check-in hợp lệ (is_present, check_in_time) | Re-check trước khi gửi |
| `attendance_events` | Log check-in/check-out events | Optional để đối chiếu |
| `presence_snapshots` | Ảnh chụp presence realtime | Optional để đối chiếu |
| `notifications` | Tạo notification record type `late_checkin_alert` | related_entity_type = 'meeting', channel = 'email' |
| `background_jobs` | Enqueue notification sending job | Xử lý async, retry nếu lỗi |
| `system_configs` | Lưu config keys: grace_minutes, scan_interval, enabled, channels | Không hard-code |
| `meeting_events` | Ghi event type `attendance_checkin_alert_sent` | Metadata JSON chứa danh sách participant_id |
| `audit_logs` | Ghi log hành động của System | Actor là System |

### 5.2 Dữ liệu đầu vào

Feature này không có input từ end-user. Đầu vào là dữ liệu có sẵn trong database.

### 5.3 Dữ liệu đầu ra

| Field | Type dự kiến | Mô tả |
|---|---|---|
| `notification` | record | Notification type `late_checkin_alert` cho mỗi participant |
| `meeting_event` | record | Event type `attendance_checkin_alert_sent` |
| `audit_log` | record | Audit log action `checkin_alert_sent` |

### 5.4 State / Status Model

Không có state model riêng cho feature này. Cron job chỉ kiểm tra và không thay đổi status của entities khác (chỉ đọc).

### 5.5 Data Constraints

- Không tạo table mới. Tất cả dữ liệu dùng 12 bảng hiện có trong database v3.2 compact.
- Idempotency constraint: không gửi duplicate notification cho cùng meeting_id + participant_id + grace_minutes qua kiểm tra `meeting_events.metadata_json` hoặc notification payload.
- `system_configs`: nếu key không tồn tại, dùng default value đã quy định.

### 5.6 Data Lifecycle

- Notification type `late_checkin_alert`: được tạo khi cron job phát hiện vi phạm, không tự động xóa.
- Meeting event `attendance_checkin_alert_sent`: được tạo mỗi lần gửi cảnh báo cho một meeting.
- Audit log: được tạo sau khi hoàn tất xử lý cảnh báo.

### 5.7 Data-related EARS Requirements

```
FR-DATA-001: WHEN một `late_checkin_alert` notification được tạo, THE system SHALL ghi `related_entity_type = 'meeting'`, `related_entity_id = meetingId`, `channel = 'email'`.
FR-DATA-002: WHEN `meeting_events` được ghi với event type `attendance_checkin_alert_sent`, THE system SHALL lưu `metadata_json` chứa danh sách participant_id đã gửi và thời gian gửi.
FR-DATA-003: IF một participant không có email hoặc account inactive, THEN THE system SHALL ghi nhận partial failure trong audit log metadata.
```

### 5.8 Cần làm rõ

Không có. Database v3.2 compact đã có đủ 12 bảng cần dùng.

---

## 6. Error Handling

### 6.1 Validation Errors

Feature này không có input validation từ end-user.

### 6.2 Authentication / Authorization Errors

```
ERR-001: IF internal endpoint được gọi không có INTERNAL_SERVICE token, THEN THE system SHALL trả về 401 Unauthorized.
ERR-002: IF internal endpoint được gọi với token không có permission `internal.system.notification`, THEN THE system SHALL trả về 403 Forbidden.
```

### 6.3 Business Rule Errors

```
ERR-003: IF meeting không ở trạng thái `in_progress` khi cron job xử lý, THEN THE system SHALL bỏ qua meeting đó.
ERR-004: IF meeting chưa vượt grace period, THEN THE system SHALL bỏ qua meeting đó trong lần scan hiện tại.
ERR-005: IF tất cả required participants đã check-in, THEN THE system SHALL không gửi notification nào và ghi system event nếu cần.
```

### 6.4 Conflict Errors

Không áp dụng. Feature này là read-only đối với entities chính.

### 6.5 Integration / Device / External Service Errors

```
ERR-006: IF Notification Service không khả dụng, THEN THE system SHALL enqueue background job retry.
ERR-007: IF email provider trả về lỗi, THEN THE system SHALL retry theo policy của background job, không crash cron job.
```

### 6.6 Error Response Expectations

Internal endpoint trả về HTTP 202 Accepted ngay cả khi có partial failure. Chi tiết lỗi ghi trong `audit_logs` và `background_jobs` metadata.

---

## 7. Acceptance Criteria

### 7.1 Happy Path

```
AC-001:
Given một meeting đang `in_progress` và đã vượt quá grace period,
When cron job chạy và phát hiện ít nhất một required participant chưa check-in,
Then system gửi email cảnh báo cho participant vi phạm, gửi summary cho Host, ghi meeting_events và audit_logs.

AC-002:
Given một meeting `in_progress` nhưng chưa vượt grace period,
When cron job chạy,
Then system bỏ qua meeting đó, không gửi notification nào.
```

### 7.2 Validation Cases

```
AC-003:
Given meeting không ở trạng thái `in_progress` (vd: `scheduled`, `ended`),
When cron job chạy,
Then system bỏ qua meeting đó.
```

### 7.3 Authorization Cases

```
AC-004:
Given request gọi internal endpoint `/api/v1/internal/meetings/{meetingId}/late-checkin-alerts` không có token hợp lệ,
When system nhận request,
Then system trả về 401 Unauthorized.

AC-005:
Given request gọi internal endpoint với token không có permission `internal.system.notification`,
When system nhận request,
Then system trả về 403 Forbidden.
```

### 7.4 Business Rule Cases

```
AC-006:
Given một meeting `in_progress`, tất cả required participants đã check-in (attendance_status IN ('present', 'late')),
When cron job chạy,
Then system không gửi bất kỳ cảnh báo nào.

AC-007:
Given một participant không có email hợp lệ hoặc account inactive,
When cron job xử lý và participant đó vi phạm,
Then system bỏ qua participant đó, ghi partial failure vào audit metadata.
```

### 7.5 State Transition Cases

Không áp dụng. Feature này không thay đổi state của entities.

### 7.6 Audit / Notification Cases

```
AC-008:
Given cron job gửi cảnh báo thành công,
When system hoàn tất xử lý,
Then `meeting_events` có record event type `attendance_checkin_alert_sent` với metadata chứa danh sách participant_id đã gửi.

AC-009:
Given cron job gửi cảnh báo thành công,
When system hoàn tất,
Then `audit_logs` có record action `checkin_alert_sent` với actor là `System`.
```

### 7.7 Integration / Device Cases

Không áp dụng.

### 7.8 Acceptance Criteria Traceability

| AC ID | Requirement ID liên quan | Kịch bản test chính |
|---|---|---|
| AC-001 | FR-001, FR-004, FR-005, FR-006 | Cron gửi cảnh báo thành công |
| AC-002 | FR-002, FR-014 | Grace period chưa vượt |
| AC-003 | FR-013 | Meeting không in_progress |
| AC-004 | FR-020, FR-021 | Unauthorized access |
| AC-005 | FR-020 | Forbidden access |
| AC-006 | FR-011 | Tất cả đã check-in |
| AC-007 | FR-012 | Participant thiếu email |
| AC-008 | FR-018, FR-022, FR-023 | Meeting event được ghi |
| AC-009 | FR-019, FR-027 | Audit log được ghi |

---

## 8. Out of Scope

### 8.1 Không triển khai trong feature này

- Tạo meeting, duyệt meeting, start/end meeting.
- Ghi nhận check-in bằng QR/face/manual.
- Cập nhật attendance thủ công.
- Báo cáo thống kê tỷ lệ đi muộn.
- No-show release phòng.
- Cấu hình giao diện quản trị cho grace period.
- Thêm bảng database mới.
- Gửi SMS/push notification (chỉ email là channel bắt buộc).
- Xử lý external participants.

### 8.2 Có thể xem xét ở feature khác

- Dashboard quản trị cho attendance metrics.
- Tích hợp SMS notification channel.
- Auto-release phòng khi no-show.
- Cảnh báo cho external participants.

### 8.3 Out-of-scope EARS Guardrails

```
OOS-001: THE system SHALL NOT tạo table mới trong feature này; tất cả dùng 12 bảng hiện có.
OOS-002: THE system SHALL NOT gửi SMS/push notification nếu không có config và API contract yêu cầu.
OOS-003: THE system SHALL NOT xử lý external participants (không có trong `meeting_participants`) trong scope UC-APM-10.
OOS-004: THE system SHALL NOT thay đổi attendance_status của participants; chỉ đọc dữ liệu.
OOS-005: THE system SHALL NOT thực hiện auto-release room hoặc no-show handling.
OOS-006: THE system SHALL NOT ghi nhận check-in; chỉ phát hiện người chưa check-in.
```

---

## Checklist tự kiểm tra trước khi hoàn tất spec

- [x] Spec đã có đủ 8 thành phần chính.
- [x] Functional Requirements đã viết theo EARS.
- [x] Requirement sử dụng keyword EARS bằng tiếng Anh: `THE system SHALL`, `WHEN`, `WHILE`, `WHERE`, `IF`, `THEN`.
- [x] Đã có đủ 5 EARS basic patterns: Ubiquitous, Event-driven, State-driven, Optional Feature, Unwanted Behavior.
- [x] Đã cân nhắc Complex / Combined EARS Requirements.
- [x] Mỗi requirement có mã ID rõ ràng.
- [x] Requirement có thể kiểm thử được.
- [x] Không mô tả quá sâu implementation.
- [x] Không tự ý thêm feature ngoài tài liệu nguồn.
- [x] Không tự ý thêm database table/field mới.
- [x] Error handling đã bao gồm authentication, authorization, business rule, integration failure.
- [x] Error requirements đã format `IF ... THEN THE system SHALL ...`.
- [x] Acceptance Criteria dùng Given / When / Then.
- [x] Traceability đã liên kết AC với FR.
- [x] Out of Scope đủ rõ để tránh agent tự mở rộng.
- [x] Các phần thiếu thông tin đã được đưa vào `Cần làm rõ`.
