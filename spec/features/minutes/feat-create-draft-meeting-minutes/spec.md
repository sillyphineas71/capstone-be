# Feature Specification: Tạo biên bản họp nháp (Create Draft Meeting Minutes)

## 📝 CHANGELOG & REVISION HISTORY
| Ngày cập nhật | Tóm tắt thay đổi | Các dòng thay đổi |
| :--- | :--- | :--- |
| 2026-07-02 | Khởi tạo spec cho UC-MKM-01, mở rộng Trigger/PRE-2 để cho phép tạo biên bản ngay khi cuộc họp đang diễn ra (không chỉ sau khi kết thúc), theo thảo luận với Product Owner | Toàn bộ file |

> Nguồn gốc: UC-MKM-01 "Tạo biên bản họp nháp" (Feature Table). Bản gốc chỉ mô tả Trigger là "sau khi cuộc họp kết thúc", nhưng PRE-2 gốc đã cho phép cả trạng thái "đang diễn ra". Spec này chính thức hóa hướng "đang diễn ra HOẶC đã kết thúc" để hỗ trợ Host/thư ký ghi chép biên bản theo thời gian thực (họp đến đâu ghi đến đó), thay vì bắt buộc chờ họp kết thúc mới được khởi tạo.

## 1. Context & Goal

### 1.1 Bối cảnh
Sau (hoặc trong khi) một cuộc họp diễn ra, Host cần khởi tạo một bản ghi biên bản họp (meeting minutes) ở trạng thái nháp (DRAFT) để bắt đầu soạn thảo nội dung: kết luận, quyết định, đầu việc phát sinh. Đây là bước đầu tiên trong vòng đời biên bản họp (draft → published/issued), tách biệt với `meeting_notes` (ghi chú nhanh trong lúc họp, đã có ở UC-IMM-09) và với `transcripts` (bản ghi lời thoại tự động).

### 1.2 Mục tiêu
Cho phép Host của một cuộc họp tạo duy nhất một bản ghi `meeting_minutes` ở trạng thái DRAFT, tự động kế thừa các thông tin nền tảng của cuộc họp (tiêu đề, thời gian, danh sách người tham dự tại thời điểm tạo), để Host có thể bắt đầu soạn thảo ngay — kể cả khi cuộc họp vẫn đang diễn ra.

### 1.3 Giá trị mang lại
- Giảm rủi ro quên/sai sót nội dung do phải chờ đến khi họp kết thúc mới bắt đầu ghi chép.
- Cho phép mô hình làm việc "họp đến đâu, ghi biên bản đến đó" mà vẫn đảm bảo tính toàn vẹn dữ liệu đối soát (BR2).
- Chuẩn hóa dữ liệu đầu vào cho các bước sau: chỉnh sửa nháp, ban hành chính thức (các feature khác, ngoài phạm vi UC-MKM-01).

### 1.4 Giả định
- Chỉ có một Host duy nhất trên mỗi `meeting` (`meetings.host_id`), theo entity `MeetingEntity` hiện có.
- Bảng `meeting_minutes` đã tồn tại sẵn trong DB baseline (Database v3.2 Compact), không cần migration tạo bảng mới.
- Việc soạn thảo nội dung chi tiết, autosave định kỳ, và ban hành chính thức (publish) là các use case/feature riêng, sẽ được đặc tả sau (xem mục 8 - Out of Scope).
- Danh sách người tham dự thực tế được lấy từ `meeting_participants.attendance_status/joined_at/left_at` tại thời điểm tạo biên bản; nếu cuộc họp còn đang diễn ra, dữ liệu này có thể chưa đầy đủ (một số người chưa check-in/check-out) — đây là hành vi được chấp nhận theo mô hình real-time (xem FR-006).

### 1.5 Cần làm rõ
- [NEEDS CLARIFICATION] Template biên bản chuẩn của doanh nghiệp (Other Information #1 trong Feature Table gốc) chưa có hệ thống quản lý template chính thức. Feature này chỉ khởi tạo `minutes_content` với một khung nội dung mặc định đơn giản (không phải template engine đầy đủ). Việc chọn template sẽ là feature riêng khi có yêu cầu rõ ràng.
- [NEEDS CLARIFICATION] Cơ chế auto-save mỗi 5 giây (Other Information #2) thuộc phạm vi feature "cập nhật nội dung biên bản nháp" (chưa triển khai), không thuộc UC-MKM-01.

## 2. Actor & Roles

### 2.1 Danh sách actor
- **Primary Actor**: Internal Employee giữ vai trò Host của cuộc họp (`meetings.host_id`).
- Secondary Actor: Không có.

### 2.2 Role & Permission Rules
- Permission code mới: `meeting.minutes.create`.
- Role mặc định được cấp: `INTERNAL_USER`, `MANAGER`, `BUSINESS_ADMIN`, `SYSTEM_ADMIN` (bất kỳ ai cũng có thể được gán làm Host).
- Việc sở hữu permission `meeting.minutes.create` là điều kiện cần nhưng chưa đủ: hệ thống còn kiểm tra thêm điều kiện **là Host của chính cuộc họp đó** (resource ownership), theo SEC-02 của Constitution.

### 2.3 Actor Constraints
- Người dùng không phải Host (kể cả Organizer, Participant thường, Admin) **không** được phép tạo biên bản nháp qua endpoint này ở phiên bản v1. (Trường hợp Admin cần hỗ trợ tạo hộ là ngoài phạm vi, xem mục 8.)
- Nếu `meetings.host_id` là NULL (cuộc họp chưa gán Host), request bị từ chối với lỗi nghiệp vụ rõ ràng (không suy luận sang Organizer).

## 3. Functional Requirements

### 3.1 Core Requirements (Ubiquitous)
- **FR-001**: THE system SHALL cho phép tạo tối đa MỘT bản ghi `meeting_minutes` đang hoạt động (chưa xóa mềm) cho mỗi `meeting_id`.
- **FR-002**: THE system SHALL gán `status = draft` cho mọi bản ghi `meeting_minutes` được tạo qua use case này.
- **FR-003**: THE system SHALL gán `visibility_level = private` mặc định cho biên bản nháp mới tạo, bất kể default của entity là `participants`, nhằm đảm bảo BR1 (chỉ Host nhìn thấy bản nháp).
- **FR-004**: THE system SHALL gán `prepared_by = <userId của Host thực hiện thao tác>`.

### 3.2 Event-driven Requirements
- **FR-005**: WHEN Host gửi request tạo biên bản họp cho một `meetingId` hợp lệ, THE system SHALL kiểm tra tuần tự: (1) meeting tồn tại và chưa bị xóa mềm, (2) người gọi là Host của meeting, (3) trạng thái meeting hợp lệ (xem FR-007), (4) chưa tồn tại `meeting_minutes` active cho meeting này, trước khi tạo bản ghi.
- **FR-006**: WHEN biên bản nháp được tạo, THE system SHALL lưu snapshot danh sách người tham dự tại thời điểm tạo vào `attendees_snapshot_json`, lấy từ `meeting_participants` (bao gồm `userId`, `participantRole`, `attendanceStatus`, `joinedAt`, `leftAt`). Snapshot này phản ánh trạng thái điểm danh TẠI THỜI ĐIỂM TẠO, kể cả khi cuộc họp chưa kết thúc và dữ liệu điểm danh có thể còn thay đổi sau đó.

### 3.3 State-driven Requirements
- **FR-007**: WHILE `meeting.status` KHÔNG thuộc tập {`in_progress`, `completed`}, THE system SHALL từ chối tạo biên bản họp (không cho tạo khi meeting còn ở `draft`, `pending_approval`, `scheduled`, hoặc đã `cancelled`).
- **FR-008**: WHILE `meeting.status = in_progress`, THE system SHALL vẫn cho phép tạo biên bản nháp (real-time authoring), với `meeting.actual_end_time` có thể là NULL trong response (chưa xác định).
- **FR-009**: WHILE `meeting.status = completed`, THE system SHALL trả về `meeting.actual_start_time`/`actual_end_time` đầy đủ trong response (đã chốt).

### 3.4 Optional Feature Requirements
- **FR-010**: WHERE Host cung cấp `title` tùy chỉnh trong request body, THE system SHALL dùng giá trị đó thay cho tiêu đề mặc định.
- **FR-011**: WHERE Host không cung cấp `title`, THE system SHALL sinh tiêu đề mặc định theo định dạng `"Biên bản họp: {meeting.title}"`.

### 3.5 Unwanted Behavior Requirements
- **FR-012**: IF người gọi không phải Host của meeting, THEN THE system SHALL từ chối request với lỗi 403 `NOT_MEETING_HOST`, không tiết lộ nội dung meeting.
- **FR-013**: IF đã tồn tại `meeting_minutes` active (status ≠ xóa mềm) cho `meetingId`, THEN THE system SHALL từ chối tạo bản ghi mới và trả về lỗi 409 `MINUTES_ALREADY_EXISTS` kèm `existingMinutesId`.
- **FR-014**: THE system SHALL NOT cho phép request body ghi đè các trường bị khóa cứng theo BR2 (`actual_start_time`, `actual_end_time`, danh sách điểm danh) — DTO không nhận các field này làm input.

### 3.6 Workflow Requirements
- **FR-015**: THE system SHALL thực hiện việc tạo bản ghi `meeting_minutes` trong một transaction duy nhất cùng với việc ghi audit log, đảm bảo tính nhất quán (ARCH constraint chung của dự án).

### 3.7 Data & State Requirements
- **FR-016**: THE system SHALL không thêm cột mới vào bảng `meeting_minutes` (đã có sẵn trong baseline DB v3.2 Compact); mọi dữ liệu kế thừa từ meeting được trả về trong response DTO (không phải lưu trùng lặp trong `meeting_minutes`), ngoại trừ `attendees_snapshot_json` vốn đã có sẵn trong bảng để phục vụ đúng mục đích lưu snapshot.
- **FR-017**: `meeting_minutes.minutes_content` SHALL được khởi tạo với khung nội dung mặc định (không rỗng) khi Host không cung cấp nội dung ban đầu.

### 3.8 Notification / Audit Requirements
- **FR-018**: THE system SHALL ghi một bản ghi `audit_logs` (action_type = `meeting_minutes_draft_created`, entity_type = `meeting_minutes`) khi tạo biên bản nháp thành công.
- **FR-019**: THE system SHALL NOT gửi notification cho participants khi tạo biên bản nháp (bản nháp chỉ Host nhìn thấy theo BR1).

### 3.9 Complex / Combined Requirements
- **FR-020**: IF `meeting.status = in_progress` AND người gọi là Host AND chưa có `meeting_minutes` active, THEN THE system SHALL tạo bản ghi với `attendees_snapshot_json` phản ánh trạng thái điểm danh hiện tại (có thể có participant `not_checked_in`).

### 3.10 Traceability
| FR ID | Nguồn gốc (UC gốc) |
| :--- | :--- |
| FR-001, FR-002 | Postconditions POST-1 |
| FR-003, FR-012 | BR1 |
| FR-006, FR-014, FR-016 | BR2 |
| FR-007, FR-008, FR-009 | Trigger + PRE-2 (mở rộng) |
| FR-010, FR-011 | Normal Flow bước 3 |
| FR-017 | Other Information #1 (rút gọn phạm vi) |

## 4. Non-functional Requirements

### 4.1 Performance
- API phải phản hồi trong < 500ms ở điều kiện bình thường (thao tác đơn giản: 1 lần đọc meeting + participants, 1 lần ghi).

### 4.2 Security
- Endpoint yêu cầu JWT hợp lệ (SEC-02) và permission `meeting.minutes.create`.
- Input validation strict (`whitelist: true, forbidNonWhitelisted: true`) theo SEC-03.
- Chỉ Host mới truy cập/nhìn thấy bản ghi vừa tạo (BR1) — enforcement chi tiết cho việc XEM biên bản thuộc feature "view detail" (ngoài phạm vi), nhưng response của chính API tạo chỉ trả về cho Host gọi request.

### 4.3 Reliability & Consistency
- Idempotency tự nhiên: gọi lại API cho cùng `meetingId` khi đã có bản ghi sẽ trả lỗi 409 thay vì tạo bản ghi trùng (ARCH-03).

### 4.4 Usability
- Response trả kèm đầy đủ dữ liệu kế thừa (tiêu đề, thời gian, phòng họp, danh sách tham dự) để FE hiển thị ngay giao diện soạn thảo mà không cần gọi thêm API.

### 4.5 Observability
- Log đủ thông tin để debug: meetingId, userId, kết quả (success/lỗi + code).

### 4.6 Maintainability
- Business logic đặt trong `MinutesService`, tách biệt khỏi `MeetingsService` theo đúng module boundary (`minutes` module).

## 5. Data Model

### 5.1 Entity liên quan
- `MeetingMinutesEntity` (bảng `meeting_minutes`) — bảng chính, tạo mới 1 dòng.
- `MeetingEntity` (bảng `meetings`) — đọc, không ghi.
- `MeetingParticipantEntity` (bảng `meeting_participants`) — đọc để dựng snapshot, không ghi.
- `AuditLogEntity` (bảng `audit_logs`) — ghi 1 dòng audit.

### 5.2 Dữ liệu đầu vào (Request Body)
```jsonc
{
  "title": "string, optional, max 255" // nếu bỏ trống, hệ thống tự sinh
}
```
Path param: `meetingId` (UUID, bắt buộc).

### 5.3 Dữ liệu đầu ra (Response)
```jsonc
{
  "success": true,
  "message": "Bien ban hop nhap da duoc tao thanh cong",
  "data": {
    "id": "uuid",
    "meetingId": "uuid",
    "title": "string",
    "status": "draft",
    "visibilityLevel": "private",
    "versionNo": 1,
    "minutesContent": "string",
    "preparedBy": "uuid",
    "createdAt": "ISO datetime",
    "meetingSnapshot": {
      "meetingTitle": "string",
      "actualStartTime": "ISO datetime | null",
      "actualEndTime": "ISO datetime | null",
      "roomId": "uuid | null",
      "meetingStatus": "in_progress | completed",
      "attendees": [
        {
          "userId": "uuid",
          "participantRole": "host | attendee | approver | note_taker",
          "attendanceStatus": "not_checked_in | present | absent | late | left_early",
          "joinedAt": "ISO datetime | null",
          "leftAt": "ISO datetime | null"
        }
      ]
    }
  }
}
```

### 5.4 State / Status Model
`meeting_minutes.status`: `draft → published → archived` (và `deleted` cho soft-delete). Feature này chỉ tạo ra trạng thái `draft`; các transition khác thuộc feature tương lai.

### 5.5 Data Constraints
- Unique nghiệp vụ: tối đa 1 `meeting_minutes` active per `meeting_id` (không có unique index ở DB — kiểm tra ở tầng service trong transaction; xem Risk ở plan.md).
- `visibility_level` luôn là `private` khi tạo qua feature này (ghi đè default entity).

### 5.6 Data Lifecycle
Tạo (feature này) → Chỉnh sửa nội dung/auto-save (feature tương lai) → Ban hành (publish, feature tương lai) → Lưu trữ (archive)/Xóa mềm.

### 5.7 Data-related EARS Requirements
Xem FR-001, FR-003, FR-006, FR-014, FR-016.

## 6. Error Handling

### 6.1 Validation Errors
- `title` vượt quá 255 ký tự → 400 `VALIDATION_ERROR`.
- `meetingId` không phải UUID hợp lệ → 400 (ParseUUIDPipe).

### 6.2 Authentication / Authorization Errors
- Không có JWT hợp lệ → 401.
- Không có permission `meeting.minutes.create` → 403 `FORBIDDEN`.
- Có permission nhưng không phải Host → 403 `NOT_MEETING_HOST`.

### 6.3 Business Rule Errors
- Meeting chưa gán Host (`hostId = null`) → 409 `MEETING_HOST_NOT_ASSIGNED`.
- Meeting ở trạng thái không hợp lệ (chưa `in_progress`/`completed`, hoặc `cancelled`) → 409 `MEETING_NOT_STARTED` hoặc `MEETING_CANCELLED` tương ứng.

### 6.4 Conflict Errors
- Đã tồn tại `meeting_minutes` active cho meeting → 409 `MINUTES_ALREADY_EXISTS` (kèm `existingMinutesId` trong `details`).

### 6.5 Integration / External Service Errors
- Không có (feature này không gọi external service).

### 6.6 Error Response Expectations
Theo format chuẩn dự án:
```jsonc
{
  "success": false,
  "message": "...",
  "error": { "code": "...", "details": {} },
  "timestamp": "...",
  "path": "..."
}
```

## 7. Acceptance Criteria

### 7.1 Happy Path
- **AC-001**: GIVEN meeting `M` có `status = in_progress` và `hostId = U`, WHEN `U` gọi POST tạo biên bản, THEN hệ thống trả 201 với `status = draft`, `visibilityLevel = private`, `preparedBy = U`.
- **AC-002**: GIVEN meeting `M` có `status = completed`, WHEN Host gọi API, THEN response chứa `actualStartTime`/`actualEndTime` đầy đủ.

### 7.2 Authorization Cases
- **AC-003**: GIVEN người gọi là Organizer nhưng không phải Host, WHEN gọi API, THEN trả 403 `NOT_MEETING_HOST`.
- **AC-004**: GIVEN người gọi không có permission `meeting.minutes.create`, WHEN gọi API, THEN trả 403 `FORBIDDEN`.

### 7.3 Business Rule Cases
- **AC-005**: GIVEN meeting `M` có `status = scheduled` (chưa bắt đầu), WHEN Host gọi API, THEN trả 409 `MEETING_NOT_STARTED`.
- **AC-006**: GIVEN meeting `M` có `status = cancelled`, WHEN Host gọi API, THEN trả 409 `MEETING_CANCELLED`.
- **AC-007**: GIVEN meeting `M` có `hostId = null`, WHEN bất kỳ ai gọi API, THEN trả 409 `MEETING_HOST_NOT_ASSIGNED`.

### 7.4 Validation Cases
- **AC-008**: GIVEN `title` dài 300 ký tự, WHEN gọi API, THEN trả 400 `VALIDATION_ERROR`.

### 7.5 State Transition Cases
- **AC-009**: GIVEN đã có `meeting_minutes` active cho `M`, WHEN Host gọi lại API cho cùng `M`, THEN trả 409 `MINUTES_ALREADY_EXISTS`.

### 7.6 Notification / Audit Cases
- **AC-010**: GIVEN tạo biên bản thành công, THEN có đúng 1 bản ghi `audit_logs` mới với `action_type = meeting_minutes_draft_created`.
- **AC-011**: GIVEN tạo biên bản thành công, THEN KHÔNG có notification nào được tạo/queue.

### 7.7 Concurrency Cases
- **AC-012**: GIVEN 2 request tạo biên bản đồng thời cho cùng `meetingId` (race condition), WHEN cả 2 gần như đồng thời, THEN chỉ 1 request thành công (201), request còn lại nhận 409 `MINUTES_ALREADY_EXISTS` (đảm bảo bằng transaction + kiểm tra lại trong cùng transaction, xem plan.md mục 7.1).

### 7.8 Acceptance Criteria Traceability
| AC ID | FR liên quan |
| :--- | :--- |
| AC-001, AC-002 | FR-001..FR-009 |
| AC-003, AC-004 | FR-012 |
| AC-005, AC-006, AC-007 | FR-007 |
| AC-008 | FR-010 |
| AC-009, AC-012 | FR-013 |
| AC-010, AC-011 | FR-018, FR-019 |

## 8. Out of Scope

### 8.1 Không triển khai trong feature này
- Chỉnh sửa nội dung biên bản nháp (update/autosave mỗi 5 giây).
- Xem danh sách biên bản họp (view list) / xem chi tiết biên bản (view detail) sau khi tạo.
- Ban hành chính thức (publish/issue) biên bản cho toàn bộ thành viên.
- Xóa biên bản họp.
- Quản lý template biên bản chuẩn doanh nghiệp (chọn nhiều mẫu).
- Cho phép Admin/thư ký không phải Host tạo biên bản hộ Host.

### 8.2 Có thể xem xét ở feature khác
- `feat-update-draft-meeting-minutes` (autosave, chỉnh sửa nội dung, refresh lại `attendees_snapshot_json` khi meeting chuyển sang `completed`).
- `feat-view-list-meeting-minutes`, `feat-view-detail-meeting-minutes`.
- `feat-issue-meeting-minutes` (publish/ban hành chính thức).
- `feat-delete-meeting-minutes` (soft-delete theo DATA-01).

### 8.3 Out-of-scope EARS Guardrails
- **FR-OOS-001**: THE system SHALL NOT cung cấp endpoint PATCH/PUT cho `meeting_minutes` trong phạm vi feature này.
- **FR-OOS-002**: THE system SHALL NOT cung cấp endpoint GET danh sách/chi tiết `meeting_minutes` trong phạm vi feature này.

## Assumptions
Xem mục 1.4.
