# Feature Specification: Tạo chương trình họp (Create Meeting Agenda)

- **Feature ID**: UC-MM-09
- **Feature Name**: Tạo chương trình họp (Agenda)
- **Module / Domain**: meetings
- **Created Date**: 2026-06-15
- **Status**: Draft
- **Source Documents**:
  - Database v3.2 Compact (39 tables)
  - AGENTS.md — Backend Agent Guide
  - Feature Table — UC-MM-09
  - docs/SPEC_ALIGNMENT_WITH_DB_V3_2_COMPACT.md

---

## 📝 CHANGELOG & REVISION HISTORY
| Ngày cập nhật | Tóm tắt thay đổi | Các dòng thay đổi |
| :--- | :--- | :--- |
| 2026-06-15 | Tạo spec lần đầu cho UC-MM-09 Tạo chương trình họp | Toàn bộ file |
| 2026-06-15 | Cập nhật spec theo kết quả clarify: idempotency, validation order, host resolution, max items, error codes, ACs bổ sung, GET metadata, in_progress lock, notification deferred | Các mục 2, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16, 17, 18, 19 |
| 2026-06-15 | Fix consistency Round 3: GET JSON mục 9.1 (meetingStatus enum, durationStatus tách riêng, xóa duplicate key), bảng 8.2 đồng bộ thứ tự priority với FR-033, edge cases mục 16 (hard limit + external participant), thêm AC-016/AC-026 Given/When/Then, cập nhật traceability | Mục 8.2, 9.1, 15.6, 15.7, 16, 19 |

## Hướng dẫn viết EARS Requirements

Functional Requirements trong spec này viết theo EARS.
Keyword EARS giữ nguyên bằng tiếng Anh. Nội dung nghiệp vụ viết bằng tiếng Việt.

| Keyword | Vai trò |
|---|---|
| THE system SHALL | Yêu cầu luôn đúng, không phụ thuộc event/state/option/error |
| WHEN | Trigger/event xảy ra tại một thời điểm |
| WHILE | Hành vi đúng trong suốt một trạng thái |
| WHERE | Yêu cầu chỉ áp dụng khi feature/capability/config tồn tại |
| IF ... THEN | Xử lý lỗi, ngoại lệ, điều kiện không mong muốn |

---

## 1. Feature Summary

### 1.1 Bối cảnh

Feature UC-MM-09 thuộc nhóm Meeting Management — giai đoạn Tiền cuộc họp (Pre-meeting).

Trong quy trình meeting lifecycle, sau khi cuộc họp đã được lên lịch (scheduled) với đầy đủ thông tin thời gian, phòng họp và danh sách người tham gia, người tổ chức cần có công cụ để soạn thảo kịch bản chi tiết cho buổi họp. Agenda giúp:

- Phân bổ thời gian hợp lý cho từng nội dung thảo luận.
- Giao trách nhiệm rõ ràng cho từng cá nhân phụ trách trình bày.
- Giúp người tham gia chuẩn bị trước nội dung liên quan.
- Làm timeline hỗ trợ Host điều phối khi cuộc họp diễn ra.

Hiện tại hệ thống chưa có module quản lý agenda riêng biệt cho phép host tạo, sắp xếp và quản lý chương trình họp.

### 1.2 Mục tiêu

Mục tiêu của tính năng này là cho phép **người tổ chức (organizer) hoặc chủ trì (host)** tạo, cập nhật, sắp xếp và quản lý danh sách agenda item cho một cuộc họp đã được lên lịch, nhằm chuẩn bị kịch bản chi tiết và phân công trách nhiệm rõ ràng trước giờ họp.

### 1.3 Giá trị mang lại

- Host chủ động lên kế hoạch nội dung chi tiết trước cuộc họp.
- Người tham gia biết trước nội dung, thời lượng và người phụ trách từng phần.
- Giảm tình trạng "cháy timeline" nhờ kiểm soát tổng thời lượng agenda so với meeting duration.
- Tăng hiệu quả cuộc họp nhờ phân bổ thời gian hợp lý.
- Dữ liệu agenda có thể tái sử dụng cho in-meeting timer và post-meeting minutes.

### 1.4 Giả định

- Meeting đã được tạo và đang ở trạng thái scheduled.
- Meeting đã có start_time và end_time hợp lệ (end_time > start_time).
- Meeting đã có danh sách internal participants để chọn owner cho agenda item.
- Bảng meeting_agendas đã tồn tại trong database v3.2 Compact với các cột mô tả ở phần Data Model Impact.
- Hệ thống sử dụng 	imestamptz cho mọi trường thời gian.

### 1.5 Cần làm rõ

Xem phần Clarifications Needed (mục 18).

---

## 2. Actors & Permissions

### 2.1 Danh sách actor

| Actor | Vai trò trong tính năng | Quyền / Trách nhiệm chính |
|---|---|---|
| Internal Employee | Người tổ chức (organizer) hoặc chủ trì (host) cuộc họp | Tạo/sửa/xóa/reorder agenda nếu là organizer_id hoặc host_id |
| Senior Admin / System Admin | Quản trị viên hệ thống | Được quản lý agenda thay host nếu có permission meeting.agenda.write |
| Participant (internal) | Người tham gia nội bộ cuộc họp | Chỉ xem agenda read-only qua API authenticated. Không được tạo/sửa/xóa/reorder |
| External Participant | Khách mời ngoài tổ chức | Không có JWT/internal account, không gọi API authenticated. Có thể nhận agenda qua email/reminder/invitation (deferred) |

### 2.2 Role & Permission Rules

- **Host resolution:** Dùng meetings.host_id là nguồn chính thức để xác định Host.
- meeting_participants.participant_role = host chỉ là role hiển thị/tham dự, không dùng làm nguồn cấp quyền write.
- User được write agenda nếu currentUser.id === meetings.organizer_id hoặc currentUser.id === meetings.host_id.
- Nếu host_id null, chỉ organizer được write.
- Senior Admin / System Admin có thể write agenda thay người khác nếu có permission meeting.agenda.write.
- Participant internal được read agenda qua API authenticated (GET).
- External participant không có JWT/internal account, không được gọi API authenticated trong scope này.
- Permission chuẩn cho quyền write agenda: meeting.agenda.write. Permission cho quyền read: meeting.agenda.read.

### 2.3 Actor Constraints

- Phải đăng nhập hợp lệ trước khi truy cập chức năng.
- Write: phải là meetings.organizer_id hoặc meetings.host_id, hoặc admin có permission meeting.agenda.write.
- Read (API authenticated): phải là internal participant, organizer, host của meeting.
- External participant không gọi API GET agenda (không có JWT).
- Meeting phải tồn tại, không bị xóa mềm.
- Write: meeting phải ở trạng thái scheduled.

---

## 3. Preconditions

| ID | Mô tả |
|---|---|
| PRE1 | Người dùng đã đăng nhập hợp lệ và JWT token còn hiệu lực. |
| PRE2 | Người dùng có quyền thao tác (organizer/host/admin có permission phù hợp). |
| PRE3 | Meeting tồn tại, không bị xóa mềm (deleted_at IS NULL). |
| PRE4 | Meeting đang ở trạng thái scheduled. |
| PRE5 | Meeting có start_time và end_time hợp lệ (end_time > start_time). |
| PRE6 | Meeting đã có danh sách internal participants (để chọn owner). |

---

## 4. Postconditions

| ID | Mô tả |
|---|---|
| POST1 | Các agenda item được lưu/ghi vào bảng meeting_agendas theo đúng transaction. |
| POST2 | agenda_order của các item được đảm bảo sequential, không trùng, không gaps (1, 2, 3...). |
| POST3 | Các item cũ không còn trong request bị xóa khỏi database. |
| POST4 | Dữ liệu agenda cũ được thay thế hoàn toàn (atomic replace). |
| POST5 | Hệ thống ghi udit_logs cho thao tác create/update/delete/reorder agenda. |
| POST6 | Hệ thống ghi meeting_events với event_type phù hợp (vd: genda_updated) nếu module đã support. |
| POST7 | Response trả về danh sách agenda item đã được lưu, sorted theo agenda_order ASC. |

---

## 5. User Stories

- **US-01**: Với vai trò là Host, tôi muốn tạo danh sách agenda item cho cuộc họp đã lên lịch để người tham gia biết trước nội dung và chuẩn bị.
- **US-02**: Với vai trò là Host, tôi muốn chỉ định người phụ trách cho từng agenda item để phân công trách nhiệm rõ ràng.
- **US-03**: Với vai trò là Host, tôi muốn sắp xếp thứ tự các agenda item để phản ánh đúng trình tự cuộc họp.
- **US-04**: Với vai trò là Host, tôi muốn hệ thống cảnh báo nếu tổng thời lượng agenda vượt quá thời gian cuộc họp.
- **US-05**: Với vai trò là Participant, tôi muốn xem agenda của cuộc họp để biết nội dung và chuẩn bị trước.

---

## 6. Functional Requirements

### 6.1 Core Requirements

`	ext
FR-001: THE system SHALL cho phép Host/Organizer tạo, cập nhật, xóa và sắp xếp agenda item cho một meeting thông qua một single atomic request.

FR-002: THE system SHALL chỉ cho phép Host/Organizer hoặc admin có permission meeting.agenda.write thực hiện thao tác write agenda.

FR-003: THE system SHALL cho phép tất cả participant (internal, external, organizer, host) xem agenda của meeting.
`

### 6.2 Event-driven Requirements

`	ext
FR-004: WHEN Host/Organizer gửi yêu cầu PUT agendas với danh sách item hợp lệ, THE system SHALL thực hiện atomic replace: xóa các item không còn trong request, tạo item mới (không có id), cập nhật item đã có id, và normalize agenda_order.

FR-005: WHEN Host/Organizer gửi yêu cầu PUT agendas với mảng items rỗng, THE system SHALL xóa toàn bộ agenda của meeting (atomic clear).

FR-006: WHEN hệ thống kiểm tra validity của từng agenda item, THE system SHALL validate rằng ownerId (nếu có) thuộc danh sách meeting_participants.user_id của meeting.

FR-007: WHEN tổng plannedDurationMinutes của tất cả item trong request vượt quá meeting duration (tính bằng phút giữa end_time - start_time), THE system SHALL chặn lưu và trả về lỗi.

FR-008: WHEN agenda được lưu thành công, THE system SHALL ghi udit_logs với action = 'agenda_saved', target_type = 'meeting', target_id = meetingId, ghi rõ action_type (create/update/delete/reorder) và tóm tắt thay đổi trong new_value_json.

FR-009: WHERE meeting có các event_type hỗ trợ trong bảng meeting_events, THE system SHALL ghi meeting_event với event_type = 'agenda_updated' sau khi lưu agenda thành công.

FR-010: WHEN Host/Organizer gửi request PUT agendas với items chứa id không thuộc meeting hiện tại (id của item thuộc meeting khác), THE system SHALL trả về lỗi và từ chối toàn bộ request.
`

### 6.3 State-driven Requirements

`	ext
FR-011: WHILE meeting đang ở trạng thái scheduled, THE system SHALL cho phép Host/Organizer thực hiện thao tác write agenda.

FR-012: WHILE meeting đang ở trạng thái pending_approval, cancelled, completed, THE system SHALL chặn mọi thao tác write agenda.

FR-013: WHILE meeting đang ở trạng thái in_progress, THE system SHALL chặn write agenda (out-of-scope cho feature hiện tại; có thể mở ở feature sau).

FR-014: WHILE một agenda item có plannedDurationMinutes <= 0, THE system SHALL không cho phép lưu item đó.
`

### 6.4 Optional Feature Requirements

`	ext
FR-015: WHERE feature notification/reminder/invitation trong tương lai cần include agenda, các feature đó có thể đọc meeting_agendas để lấy dữ liệu (deferred integration, không implement trong UC-MM-09).

FR-016: WHERE hệ thống có module meeting_events, THE system MAY ghi meeting_event nhưng không bắt buộc (deferred, audit chính dùng audit_logs).
`

### 6.5 Unwanted Behavior Requirements

`	ext
FR-017: IF người dùng chưa đăng nhập, THEN THE system SHALL trả về 401 Unauthorized.

FR-018: IF người dùng không có quyền write (không phải organizer, host, admin), THEN THE system SHALL trả về 403 Forbidden và không thay đổi dữ liệu.

FR-019: IF meeting không tồn tại hoặc đã bị xóa mềm, THEN THE system SHALL trả về 404 Not Found.

FR-020: IF meeting không ở trạng thái scheduled, THEN THE system SHALL trả về 409 Conflict và message: "Chỉ có thể chỉnh sửa chương trình họp khi cuộc họp đang ở trạng thái Đã lên lịch."

FR-021: IF request PUT agendas có items missing hoặc items = null, THEN THE system SHALL trả về 400 với mã `AGENDA_ITEMS_REQUIRED`. Mảng items rỗng (được chấp nhận = clear agenda).

FR-022: IF bất kỳ item nào trong request thiếu 	itle (undefined/null/empty sau trim), THEN THE system SHALL trả về 422 Unprocessable Entity với mã AGENDA_TITLE_REQUIRED.

FR-023: IF bất kỳ item nào có plannedDurationMinutes không phải integer > 0, THEN THE system SHALL trả về 422 với mã AGENDA_INVALID_DURATION.

FR-024: IF ownerId được cung cấp nhưng không thuộc meeting_participants.user_id của meeting, THEN THE system SHALL trả về 422 với mã AGENDA_OWNER_NOT_PARTICIPANT.

FR-025: IF request chứa item có id trùng lặp, THEN THE system SHALL trả về 422 với mã AGENDA_DUPLICATE_ITEM_ID.

FR-026: IF request chứa item id không thuộc meeting hiện tại (không tồn tại hoặc thuộc meeting khác), THEN THE system SHALL trả về 422 với mã AGENDA_ITEM_NOT_IN_MEETING.

FR-027: IF tổng plannedDurationMinutes > meeting duration, THEN THE system SHALL trả về 422 với mã AGENDA_DURATION_OVERFLOW.

FR-028: IF transaction thất bại trong quá trình lưu agenda, THEN THE system SHALL rollback toàn bộ thay đổi, không để tình trạng lưu một phần.

FR-029: IF request PUT agendas có items.length > 50, THEN THE system SHALL trả về 422 với mã `AGENDA_ITEM_LIMIT_EXCEEDED`.

FR-030: IF bất kỳ item nào có description.length > 2000 ký tự, THEN THE system SHALL trả về 422 với mã `AGENDA_DESCRIPTION_TOO_LONG`.

FR-031: IF meeting có `start_time` hoặc `end_time` null, hoặc `end_time <= start_time`, THEN THE system SHALL trả về 409 với mã `MEETING_TIME_INVALID_FOR_AGENDA`.

FR-032: IF request PUT agendas có payload tương đương trạng thái hiện tại trong DB (no-op), THEN THE system SHALL trả về 200, không tạo duplicate item, không thay đổi updated_at, không ghi audit log mới.

FR-033: IF một điều kiện business validation thất bại, THEN THE system SHALL trả lỗi đầu tiên theo thứ tự ưu tiên: Authentication/token (401) -> Route param meetingId invalid UUID (400) -> Payload malformed (400) -> items missing/null/not array (400) -> Meeting not found/deleted (404) -> Read/write permission (403) -> Meeting time invalid (409) -> Meeting status blocked (409) -> Item limit > 50 (422) -> Duplicate item id (422) -> Item id not in meeting (422) -> Field validation: title empty/title > 255/description > 2000/duration invalid (422) -> Owner not participant (422) -> Duration overflow (422). Không gom nhiều lỗi business vào một response.

### 6.6 Traceability

| Requirement ID | EARS Pattern | Nguồn / Use Case liên quan | Ghi chú |
|---|---|---|---|
| FR-001 | Ubiquitous | UC-MM-09, NF step 7-8 | Atomic replace |
| FR-002 | Ubiquitous | UC-MM-09, BR2 | Permission write |
| FR-003 | Ubiquitous | UC-MM-09 | Permission read |
| FR-004 | Event-driven | UC-MM-09, NF step 7 | Atomic replace logic |
| FR-005 | Event-driven | UC-MM-09, BR empty array | Clear agenda |
| FR-006 | Event-driven | UC-MM-09, BR owner validation | Owner check |
| FR-007 | Event-driven | UC-MM-09, E1 | Duration overflow |
| FR-008 | Event-driven | UC-MM-09, POST5 | Audit log |
| FR-009 | Optional Feature | UC-MM-09 | Meeting event (optional) |
| FR-010 | Event-driven | UC-MM-09 | Cross-meeting item guard |
| FR-011 | State-driven | UC-MM-09, PRE4 | Scheduled only |
| FR-012 | State-driven | UC-MM-09 | Block non-scheduled |
| FR-013 | State-driven | UC-MM-09, out-of-scope | In-progress block |
| FR-014 | State-driven | UC-MM-09, BR | Invalid duration |
| FR-015 | Optional Feature | UC-MM-09, deferred | Notification deferred - không implement trong UC-MM-09 |
| FR-016 | Optional Feature | UC-MM-09, DM-03 | Meeting event optional/deferred |
| FR-017 | Unwanted Behavior | UC-MM-09, E auth | 401 |
| FR-018 | Unwanted Behavior | UC-MM-09, E permission | 403 |
| FR-019 | Unwanted Behavior | UC-MM-09, E meeting | 404 |
| FR-020 | Unwanted Behavior | UC-MM-09, E status | 409 |
| FR-021 | Unwanted Behavior | UC-MM-09 | Null items guard |
| FR-022 | Unwanted Behavior | UC-MM-09, BR | Title required |
| FR-023 | Unwanted Behavior | UC-MM-09, BR | Invalid duration |
| FR-024 | Unwanted Behavior | UC-MM-09, E2 | Owner invalid |
| FR-025 | Unwanted Behavior | UC-MM-09 | Duplicate id |
| FR-026 | Unwanted Behavior | UC-MM-09 | Item not found |
| FR-027 | Unwanted Behavior | UC-MM-09, E1 | Duration overflow |
| FR-028 | Unwanted Behavior | UC-MM-09 | Transaction atomicity |
| FR-029 | Unwanted Behavior | UC-MM-09, VR-01 | Max 50 items |
| FR-030 | Unwanted Behavior | UC-MM-09, VR-02 | Description too long |
| FR-031 | Unwanted Behavior | UC-MM-09, EH-02 | Meeting time invalid |
| FR-032 | Unwanted Behavior | UC-MM-09, BL-01 | No-op detection |
| FR-033 | Unwanted Behavior | UC-MM-09, BL-02 | Validation priority order |

---

## 7. Business Rules

| ID | Mô tả |
|---|---|
| BR1 | Host/Organizer có toàn quyền write agenda. Participants chỉ có quyền read. |
| BR2 | Chỉ cho phép write agenda khi meeting status là scheduled. |
| BR3 | Tổng plannedDurationMinutes của tất cả item không được vượt quá meeting duration (từ start_time đến end_time). |
| BR4 | ownerId phải là internal participant của meeting (meeting_participants.user_id). Không hỗ trợ external participant làm owner vì FK đến users.id. |
| BR5 | agenda_order được backend normalize theo thứ tự array trong request (1, 2, 3...). Không cho phép client tự đặt order tùy ý. |
| BR6 | Save agenda là atomic replace: items không còn trong request sẽ bị xóa, items mới được tạo, items hiện có được cập nhật. |
| BR7 | Meeting đã in_progress, completed, cancelled thì không cho chỉnh agenda. |
| BR8 | Title là bắt buộc, trim whitespace, độ dài 1-255 ký tự. |
| BR9 | plannedDurationMinutes phải là integer > 0. |
| BR10 | ownerId là optional nhưng nếu có phải validate. Nếu không có owner, item vẫn được lưu với owner_id = null. |
| BR11 | Empty items array được chấp nhận: xóa toàn bộ agenda. |
| BR12 | Mọi thay đổi agenda phải được ghi audit log. |
| BR13 | Tên của owner được resolve và trả về cùng response để FE hiển thị. |
| BR14 | Không cho phép item id thuộc meeting khác trong request. |
| BR15 | Double-click cùng payload -> kết quả cuối giống nhau. No-op nếu payload giống DB: trả 200, không ghi dữ liệu thừa. |
| BR16 | Tối đa 50 agenda items trong một request. |
| BR17 | `description` tối đa 2000 ký tự. |
| BR18 | items missing hoặc items = null trả 400 `AGENDA_ITEMS_REQUIRED`. items = [] được chấp nhận (clear). |
| BR19 | Nếu `start_time` hoặc `end_time` null, hoặc `end_time <= start_time`, chặn PUT agenda với 409. |
| BR20 | UC-MM-09 chỉ validate tổng agenda duration tại thời điểm submit. Feature khác (vd update meeting time) chịu trách nhiệm revalidate/cảnh báo overflow. |
| BR21 | `meeting_agendas.status` luôn là 'planned' khi tạo mới. Các status runtime (in_progress, done, skipped) là out-of-scope. |
| BR22 | `created_by` và `updated_by` là UUID FK tới `users.id`. Insert mới: cả hai = currentUser.id. Update: giữ created_by, set updated_by = currentUser.id. |

---

## 8. Validation Rules

### 8.1 DTO-level Validation (trả 400)

| Field | Điều kiện | Error code |
|---|---|---|
| `items` | Missing, null, không phải array | `AGENDA_ITEMS_REQUIRED` |
| `items[]` | Không phải object | `AGENDA_INVALID_PAYLOAD` |
| `items[].id` | Invalid UUID format (nếu có) | `AGENDA_INVALID_PAYLOAD` |
| `items[].title` | Missing hoặc không phải string | `AGENDA_INVALID_PAYLOAD` |
| `items[].plannedDurationMinutes` | Không phải number | `AGENDA_INVALID_PAYLOAD` |
| `items[].agendaOrder` | Không phải integer (nếu client gửi) | `AGENDA_INVALID_PAYLOAD` |
| `meetingId` | Invalid UUID format | `AGENDA_INVALID_PAYLOAD` |
| JSON body | Malformed JSON | `AGENDA_INVALID_PAYLOAD` |

### 8.2 Service-level Validation (trả 403/404/409/422)

| Rule | Error code | HTTP status | Thứ tự ưu tiên |
|---|---|---|---|
| Unauthenticated | `UNAUTHORIZED` | 401 | 1 |
| meetingId UUID invalid | `AGENDA_INVALID_PAYLOAD` | 400 | 2 |
| Meeting không tồn tại hoặc deleted | `MEETING_NOT_FOUND` | 404 | 3 |
| User không có quyền read/write | `AGENDA_READ_FORBIDDEN` / `AGENDA_WRITE_FORBIDDEN` | 403 | 4 |
| `start_time` hoặc `end_time` null, hoặc `end_time <= start_time` | `MEETING_TIME_INVALID_FOR_AGENDA` | 409 | 5 |
| Meeting không ở `scheduled` (write) | `AGENDA_MEETING_STATUS_BLOCKED` | 409 | 6 |
| items.length > 50 | `AGENDA_ITEM_LIMIT_EXCEEDED` | 422 | 7 |
| Duplicate item `id` trong request | `AGENDA_DUPLICATE_ITEM_ID` | 422 | 8 |
| Item `id` không thuộc meeting này | `AGENDA_ITEM_NOT_IN_MEETING` | 422 | 9 |
| title trim xong rỗng | `AGENDA_TITLE_REQUIRED` | 422 | 10 |
| title > 255 ký tự sau trim | `AGENDA_TITLE_TOO_LONG` | 422 | 10 |
| `description` > 2000 ký tự | `AGENDA_DESCRIPTION_TOO_LONG` | 422 | 10 |
| `plannedDurationMinutes <= 0` | `AGENDA_INVALID_DURATION` | 422 | 10 |
| `ownerId` không thuộc `meeting_participants` | `AGENDA_OWNER_NOT_PARTICIPANT` | 422 | 11 |
| Tổng `plannedDurationMinutes` > meeting duration | `AGENDA_DURATION_OVERFLOW` | 422 | 12 |

### 8.3 Normalization

- `agenda_order`: Backend normalize theo thứ tự array (1, 2, 3...). Client gửi order nào cũng bị bỏ qua.
- `status`: Mọi item tạo mới có status = 'planned'.
- `created_by` / `updated_by`: Insert mới set cả hai = currentUser.id. Update giữ created_by, set updated_by = currentUser.id.

---

## 9. API Contract Draft

### 9.1 GET /api/v1/meetings/{meetingId}/agendas

Lấy danh sách agenda của một meeting. Tất cả participant (bao gồm organizer, host) đều có thể xem.

**Response (200):**

`json
{
  "meetingId": "uuid",
  "meetingTitle": "Sprint Review",
  "meetingStatus": "scheduled",
  "meetingDurationMinutes": 60,
  "totalPlannedDurationMinutes": 45,
  "remainingDurationMinutes": 15,
  "durationStatus": "valid",
  "isLockedForEditing": false,
  "lockReason": null,
  "items": [
    {
      "id": "uuid",
      "agendaOrder": 1,
      "title": "Project context",
      "description": "Brief overview of current sprint",
      "ownerId": "uuid",
      "ownerName": "Nguyen Van A",
      "plannedDurationMinutes": 15,
      "status": "planned"
    }
  ]
}
`

**Notes:**
- Trả về mảng items empty [] nếu meeting chưa có agenda.
- Items được sort theo agenda_order ASC.

### 9.2 PUT /api/v1/meetings/{meetingId}/agendas

Atomic replace toàn bộ agenda list. Host/Organizer gửi danh sách items mong muốn; backend tự normalize và thực hiện create/update/delete trong một transaction.

**Request Body:**

`json
{
  "items": [
    {
      "id": "uuid-optional-for-existing-item",
      "title": "Project context",
      "description": "Brief overview of current sprint",
      "ownerId": "uuid",
      "plannedDurationMinutes": 15
    },
    {
      "title": "KPI review",
      "description": null,
      "ownerId": "uuid",
      "plannedDurationMinutes": 20
    }
  ]
}
`

| Field | Type | Bắt buộc | Mô tả |
|---|---|---|---|
| items | Array | Có | Danh sách agenda item. Không null. Mảng rỗng = clear toàn bộ. |
| items[].id | UUID | Không | UUID của item hiện có cần update. Bỏ qua với item mới. |
| items[].title | String | Có | Tiêu đề item, 1-255 ký tự sau trim. |
| items[].description | String | Không | Mô tả chi tiết, tối đa 2000 ký tự. |
| items[].ownerId | UUID / null | Không | User ID phụ trách item. Phải là internal participant. |
| items[].plannedDurationMinutes | Integer | Có | Thời lượng dự kiến (phút), > 0. |

**Notes:**
- gendaOrder không gửi từ client; backend normalize theo thứ tự array (bắt đầu từ 1).
- Backend tự quyết định: nếu item có id → update; không có id → create; item hiện có không xuất hiện trong request → delete.
- Tất cả xảy ra trong một database transaction.

**Success Response (200):**

`json
{
  "meetingId": "uuid",
  "totalPlannedDurationMinutes": 35,
  "remainingDurationMinutes": 25,
  "items": [
    {
      "id": "uuid",
      "agendaOrder": 1,
      "title": "Project context",
      "description": "Brief overview of current sprint",
      "ownerId": "uuid",
      "ownerName": "Nguyen Van A",
      "plannedDurationMinutes": 15,
      "status": "planned"
    },
    {
      "id": "uuid",
      "agendaOrder": 2,
      "title": "KPI review",
      "description": null,
      "ownerId": "uuid",
      "ownerName": "Tran Thi B",
      "plannedDurationMinutes": 20,
      "status": "planned"
    }
  ]
}
`

### 9.3 Error Responses

**Duration Overflow (422):**

`json
{
  "code": "AGENDA_DURATION_OVERFLOW",
  "message": "Tổng thời lượng phân bổ đang vượt quá quỹ thời gian của cuộc họp.",
  "details": {
    "meetingDurationMinutes": 60,
    "totalPlannedDurationMinutes": 75,
    "overflowMinutes": 15
  }
}
`

**Owner Not Participant (422):**

`json
{
  "code": "AGENDA_OWNER_NOT_PARTICIPANT",
  "message": "Người phụ trách không nằm trong danh sách người tham gia nội bộ của cuộc họp.",
  "details": {
    "ownerId": "invalid-uuid",
    "itemTitle": "Project context"
  }
}
`

**Meeting Status Blocked (409):**

`json
{
  "code": "AGENDA_MEETING_STATUS_BLOCKED",
  "message": "Chỉ có thể chỉnh sửa chương trình họp khi cuộc họp đang ở trạng thái Đã lên lịch.",
  "details": {
    "meetingId": "uuid",
    "currentStatus": "cancelled",
    "allowedStatus": "scheduled"
  }
}
`

**Item Not In Meeting (422):**

`json
{
  "code": "AGENDA_ITEM_NOT_IN_MEETING",
  "message": "Một hoặc nhiều agenda item trong request không thuộc cuộc họp hiện tại.",
  "details": {
    "itemIds": ["uuid1", "uuid2"]
  }
}
`

---

## 10. Data Model Impact

### 10.1 Entity liên quan

| Entity / Table | Vai trò trong tính năng | Ghi chú |
|---|---|---|
| meetings | Kiểm tra trạng thái, duration, quyền organizer/host | Chỉ đọc, không ghi |
| meeting_participants | Validate ownerId là internal participant | Chỉ đọc |
| meeting_agendas | Bảng chính: create/update/delete agenda item | Ghi: insert, update, delete |
| meeting_events | Ghi event sau khi lưu agenda thành công | Ghi: insert (optional) |
| audit_logs | Ghi audit cho thao tác write | Ghi: insert |

### 10.2 meeting_agendas columns sử dụng

| Column | Vai trò | Ghi chú |
|---|---|---|
| id | PK, UUID | Do database tự sinh |
| meeting_id | FK → meetings.id | Xác định meeting |
| agenda_order | Thứ tự item (integer) | Backend normalize từ 1 |
| 	itle | Tiêu đề item | Required, 1-255 chars |
| description | Mô tả chi tiết | Optional, text |
| owner_id | FK → users.id | Người phụ trách, nullable |
| planned_duration_minutes | Thời lượng dự kiến (phút) | Required, integer > 0 |
| ctual_duration_minutes | Thời lượng thực tế | Không dùng trong feature này |
| 
esult_note | Ghi chú kết quả | Không dùng trong feature này |
| `status` | Trạng thái item, varchar(30) NOT NULL DEFAULT 'planned' | DB dùng varchar, không dùng PostgreSQL enum. TypeORM entity dùng string column. UC-MM-09 chỉ insert/update 'planned'. Runtime status (in_progress, done, skipped) out-of-scope |
| created_by | Người tạo | Ghi nhận user id |
| updated_by | Người cập nhật | Ghi nhận user id |
| created_at | Thời gian tạo | timestamptz |
| updated_at | Thời gian cập nhật | timestamptz |

### 10.3 Kết luận

- **Dùng bảng có sẵn meeting_agendas.**
- **Không thêm bảng mới.**
- **Không thay đổi schema** vì bảng đã có đầy đủ cột cần thiết.
- owner_id → users.id (FK), validate thêm bằng meeting_participants.
- ctual_duration_minutes, 
esult_note, status runtime (in_progress, done, skipped) không thuộc phạm vi pre-meeting agenda.

---

## 11. Authorization Rules

| Endpoint | Minimum Role | Permission | Ghi chú |
|---|---|---|---|
| GET /meetings/{id}/agendas | Internal Participant | meeting.agenda.read | Internal participant, organizer, host được xem. External participant không có JWT, không gọi API |
| PUT /meetings/{id}/agendas | Host/Organizer | meeting.agenda.write | Source: meetings.host_id hoặc meetings.organizer_id. Admin có permission được write |

Chi tiết:

- **Read**: User có trong meeting_participants (role internal) hoặc là organizer_id/host_id của meeting được xem agenda.
- **Write**: organizer_id hoặc host_id của meeting (meetings.host_id, không dùng participant_role). Admin có permission meeting.agenda.write cũng được phép.
- **in_progress meeting**: GET vẫn trả agenda với isLockedForEditing: true. PUT bị chặn.
- **Anonymous**: Không được phép truy cập (401).

---

## 12. Transaction Boundary

PUT /api/v1/meetings/{meetingId}/agendas phải thực hiện trong một database transaction:

1. **BEGIN TRANSACTION**
2. Load meeting (with lock: SELECT ... FOR UPDATE nếu cần pessimistic lock hoặc dùng optimistic locking)
3. Validate: meeting tồn tại, không deleted, status = scheduled
4. Validate: user là organizer/host hoặc có permission meeting.agenda.write
5. Validate: từng item trong request
   - title không empty, trim, 1-255 chars
   - plannedDurationMinutes > 0
   - ownerId (nếu có) ∈ meeting_participants
   - Nếu item có id: id phải tồn tại và thuộc meeting này
   - Không duplicate id trong request
6. Validate: tổng plannedDurationMinutes ≤ meeting duration (end_time - start_time)
7. **Delete** items trong DB không còn trong request (WHERE meeting_id = X AND id NOT IN (list existing ids))
8. **Update** items có id trong request
9. **Insert** items không có id trong request
10. Normalize agenda_order = index + 1 theo thứ tự array
11. Ghi udit_logs
12. Ghi meeting_events (nếu module support - optional)
13. **COMMIT TRANSACTION**
14. Nếu bất kỳ bước nào fail → **ROLLBACK**

**No-op Detection:** Nếu payload giống DB hiện tại (so sánh JSON items), service trả 200, không chạy transaction, không ghi audit log.

**Lưu ý:** Notification/background_job (nếu có) nằm ngoài transaction chính. Không rollback transaction nếu notification fail.

---

## 13. Error Handling

### 13.1 Error Code Table

| HTTP Status | Error Code | Ý nghĩa | Thứ tự ưu tiên |
|---|---|---|---|
| 401 | `UNAUTHORIZED` | Chưa đăng nhập | 1 |
| 400 | `AGENDA_INVALID_PAYLOAD` | Payload malformed / UUID invalid / field sai type | 2 |
| 400 | `AGENDA_ITEMS_REQUIRED` | items missing hoặc items = null | 2 |
| 404 | `MEETING_NOT_FOUND` | MeetingId sai hoặc deleted | 3 |
| 403 | `AGENDA_READ_FORBIDDEN` | User không có quyền read agenda | 4 |
| 403 | `AGENDA_WRITE_FORBIDDEN` | User không có quyền write agenda | 4 |
| 409 | `AGENDA_MEETING_STATUS_BLOCKED` | Meeting không ở scheduled (write) | 5 |
| 409 | `MEETING_TIME_INVALID_FOR_AGENDA` | start_time/end_time null hoặc end_time <= start_time | 6 |
| 422 | `AGENDA_TITLE_REQUIRED` | Title trống sau trim | 7 |
| 422 | `AGENDA_TITLE_TOO_LONG` | Title > 255 ký tự sau trim | 8 |
| 422 | `AGENDA_INVALID_DURATION` | plannedDurationMinutes <= 0 | 9 |
| 422 | `AGENDA_DESCRIPTION_TOO_LONG` | description > 2000 ký tự | 9 |
| 422 | `AGENDA_DUPLICATE_ITEM_ID` | Trùng id trong request | 10 |
| 422 | `AGENDA_ITEM_NOT_IN_MEETING` | Item id không thuộc meeting | 12 |
| 422 | `AGENDA_OWNER_NOT_PARTICIPANT` | ownerId không thuộc meeting_participants | 12 |
| 422 | `AGENDA_ITEM_LIMIT_EXCEEDED` | items.length > 50 | 14 |
| 422 | `AGENDA_DURATION_OVERFLOW` | Tổng planned > meeting duration | 14 |
| 500 | `INTERNAL_ERROR` | Lỗi server không xác định | - |### 13.2 Error Response Format

`json
{
  "code": "ERROR_CODE",
  "message": "Thông báo lỗi bằng tiếng Việt, có thể hiển thị cho người dùng.",
  "details": {}
}
`

---

## 14. Audit / Notification Considerations

### 14.1 Audit Log

Mỗi thao tác PUT agendas thành công phải ghi udit_logs:

| Field | Giá trị |
|---|---|
| ction | genda_saved |
| ctor_id | User ID thực hiện |
| 	arget_type | meeting |
| 	arget_id | Meeting ID |
| old_value_json | Danh sách agenda items trước khi thay đổi (JSON) |
| 
ew_value_json | Danh sách agenda items sau khi thay đổi (JSON) |
| ction_detail | Mô tả tóm tắt thay đổi: "Created 2 items, updated 1 item, deleted 1 item" |

### 14.2 Notification

**Không implement notification/background job skeleton trong UC-MM-09.**

- Không enqueue email/in-app notification khi agenda được lưu.
- Không tạo service/class/comment stub riêng cho notification.
- Notification/reminder/invitation feature có thể đọc agenda khi gửi thư nếu có includeAgenda (deferred).
- Nội dung notification gợi ý (cho feature sau): "Chương trình họp cho '[meeting title]' đã được cập nhật."

### 14.3 Meeting Events

Audit chính thức dùng audit_logs.old_value_json và audit_logs.new_value_json.
**Không bắt buộc ghi meeting_events.** Nếu module support, có thể ghi optional (deferred).

---

## 15. Acceptance Criteria

### 15.1 Happy Path

`	ext
AC-001:
Given một meeting đang ở trạng thái scheduled và người dùng là organizer/host của meeting,
When người dùng gửi PUT agendas với 2 item hợp lệ (title, plannedDurationMinutes, ownerId đều đúng),
Then hệ thống lưu 2 item thành công, trả về danh sách items sorted theo agenda_order ASC, và ghi audit log.

AC-002:
Given một meeting đang ở trạng thái scheduled và người dùng là organizer,
When người dùng gửi PUT agendas thay thế 2 item cũ bằng 3 item mới,
Then hệ thống xóa 2 item cũ, tạo 3 item mới, normalize agenda_order, ghi audit log.

AC-003:
Given một meeting đã có 3 agenda items,
When người dùng gửi PUT agendas với items = [],
Then hệ thống xóa toàn bộ agenda, trả về items = [].
`

### 15.2 Read Permission

`	ext
AC-004:
Given người dùng là participant (internal) của meeting,
When người dùng gửi GET agendas,
Then hệ thống trả về danh sách agenda items sorted theo agenda_order ASC.

AC-005:
Given người dùng là host của meeting,
When người dùng gửi PUT agendas với items hợp lệ,
Then hệ thống lưu thành công.
`

### 15.3 Authorization Cases

`	ext
AC-006:
Given người dùng là participant (không phải organizer/host/admin),
When người dùng gửi PUT agendas,
Then hệ thống trả về 403 Forbidden.

AC-007:
Given người dùng chưa đăng nhập,
When người dùng gửi GET hoặc PUT agendas,
Then hệ thống trả về 401 Unauthorized.
`

### 15.4 Business Rule Cases

`	ext
AC-008:
Given một meeting ở trạng thái completed,
When người dùng gửi PUT agendas,
Then hệ thống trả về 409 AGENDA_MEETING_STATUS_BLOCKED.

AC-009:
Given một meeting ở trạng thái cancelled,
When người dùng gửi PUT agendas,
Then hệ thống trả về 409 AGENDA_MEETING_STATUS_BLOCKED.

AC-010:
Given một meeting scheduled với duration 60 phút,
When người dùng gửi PUT agendas với tổng plannedDurationMinutes = 75 phút,
Then hệ thống trả về 422 AGENDA_DURATION_OVERFLOW với overflowMinutes = 15.

AC-011:
Given một item có ownerId không thuộc internal participants,
When người dùng gửi PUT agendas,
Then hệ thống trả về 422 AGENDA_OWNER_NOT_PARTICIPANT.

AC-012:
Given một item có title = "" (sau trim),
When người dùng gửi PUT agendas,
Then hệ thống trả về 422 AGENDA_TITLE_REQUIRED.

AC-013:
Given một item có plannedDurationMinutes = 0,
When người dùng gửi PUT agendas,
Then hệ thống trả về 422 AGENDA_INVALID_DURATION.
`

### 15.5 Data Integrity Cases

`	ext
AC-014:
Given request chứa item id thuộc meeting khác,
When người dùng gửi PUT agendas,
Then hệ thống trả về 422 AGENDA_ITEM_NOT_IN_MEETING, không thay đổi dữ liệu.

AC-015:
Given request chứa item có id = null,
When người dùng gửi PUT agendas,
Then hệ thống xử lý item đó như item mới (create).

AC-016:
Given một PUT agendas request đang xử lý,
When transaction thất bại (ví dụ database lỗi),
Then hệ thống rollback, không item nào được ghi, agenda giữ nguyên trạng thái cũ.
`

### 15.6 Acceptance Criteria Traceability

| AC ID | Requirement ID liên quan | Kịch bản test chính |
|---|---|---|
| AC-001 | FR-001, FR-004, FR-008 | Host tạo agenda thành công |
| AC-002 | FR-004 | Atomic replace agenda |
| AC-003 | FR-005 | Clear agenda |
| AC-004 | FR-003 | Participant xem agenda |
| AC-005 | FR-001, FR-002 | Host write agenda |
| AC-006 | FR-018 | Participant bị chặn write |
| AC-007 | FR-017 | Unauthenticated bị chặn |
| AC-008 | FR-012, FR-020 | Meeting completed |
| AC-009 | FR-012, FR-020 | Meeting cancelled |
| AC-010 | FR-007, FR-027 | Duration overflow |
| AC-011 | FR-006, FR-024 | Owner invalid |
| AC-012 | FR-022 | Title empty |
| AC-013 | FR-014, FR-023 | Duration invalid |
| AC-014 | FR-010, FR-026 | Item thuộc meeting khác |
| AC-015 | FR-004 | Item không id = create |
| AC-016 | FR-028 | Transaction rollback khi lưu agenda thất bại |

### 15.7 Additional Clarified Cases

```text
AC-017:
Given một meeting ở trạng thái pending_approval,
When Host/Organizer gửi PUT agendas,
Then hệ thống trả về 409 AGENDA_MEETING_STATUS_BLOCKED.

AC-018:
Given Host/Organizer gửi PUT agendas với payload tương đương trạng thái hiện tại (no-op),
When hệ thống phát hiện không có thay đổi,
Then hệ thống trả 200, không tạo duplicate item, không thay đổi updated_at, không ghi audit log.

AC-019:
Given request PUT agendas với items missing hoặc items = null,
When hệ thống xử lý,
Then hệ thống trả 400 AGENDA_ITEMS_REQUIRED.

AC-020:
Given request PUT agendas với hơn 50 items,
When hệ thống xử lý,
Then hệ thống trả 422 AGENDA_ITEM_LIMIT_EXCEEDED.

AC-021:
Given meeting thiếu start_time hoặc end_time, hoặc end_time <= start_time,
When Host/Organizer gửi PUT agendas,
Then hệ thống trả 409 MEETING_TIME_INVALID_FOR_AGENDA.

AC-022:
Given một item có description > 2000 ký tự,
When Host/Organizer gửi PUT agendas,
Then hệ thống trả 422 AGENDA_DESCRIPTION_TOO_LONG.

AC-023:
Given một meeting ở trạng thái in_progress,
When internal participant gửi GET agendas,
Then hệ thống trả agenda với isLockedForEditing = true và lockReason = 'MEETING_NOT_SCHEDULED'.

AC-024:
Given Host/Organizer gửi PUT agendas thành công,
When kiểm tra audit log,
Then audit_logs có bản ghi với actor_id, action_type = 'agenda_saved', entity_type = 'meeting_agenda', entity_id = meetingId, old_value_json, new_value_json, severity = 'info'.

AC-025:
Given Host/Organizer gửi PUT agendas với item có id không thuộc meeting hiện tại,
When hệ thống xử lý,
Then hệ thống trả 422 AGENDA_ITEM_NOT_IN_MEETING.

AC-026:
Given một agenda item có title dài hơn 255 ký tự,
When Host/Organizer gửi PUT agendas,
Then hệ thống trả về 422 AGENDA_TITLE_TOO_LONG và không thay đổi dữ liệu.
```

| AC-016 | FR-028 | Transaction rollback |
| AC-017 | FR-020 (mở rộng) | Pending approval meeting |
| AC-018 | FR-032 | No-op PUT |
| AC-019 | FR-021 | Items missing/null |
| AC-020 | FR-029 | Max items limit |
| AC-021 | FR-031 | Meeting time invalid |
| AC-022 | FR-030 | Description too long |
| AC-023 | FR-011, FR-013 | in_progress GET lock |
| AC-024 | FR-008 | Audit content |
| AC-025 | FR-010 | Item not in meeting |
| AC-026 | FR-023a | Title dài hơn 255 ký tự |

---

## 16. Edge Cases

| Edge Case | Mô tả | Xử lý |
|---|---|---|
| Double-click submit | User nhấn Lưu nhiều lần trước khi nhận response | Service detect no-op nếu request payload (id, agendaOrder, title, description, ownerId, plannedDurationMinutes, status) giống DB hiện tại sau normalization. Trả 200, không tạo duplicate, không cập nhật updated_at, không ghi audit log. |
| Owner bị xóa khỏi meeting trước lúc submit | Participant bị remove trong lúc user đang soạn agenda | Validate ownerId tại submit, không dùng cache. Nếu không còn trong participant list → báo lỗi. |
| Meeting bị cancel bởi người khác trong lúc soạn agenda | Trạng thái meeting thay đổi từ scheduled → cancelled | Kiểm tra lại meeting status tại submit. Nếu cancelled, trả về 409. |
| Meeting duration thay đổi trước lúc submit | start_time/end_time bị sửa bởi người khác | Tính meeting duration tại thời điểm submit. Nếu duration mới nhỏ hơn tổng planned → báo overflow. Feature update meeting time chịu trách nhiệm revalidate/cảnh báo, không phải UC-MM-09. |
| Item id không tồn tại trong DB | Client gửi id sai hoặc item đã bị xóa bởi request trước | Kiểm tra từng item id trong DB. Nếu không tồn tại, trả 404 AGENDA_ITEM_NOT_IN_MEETING. |
| Item có ownerId là chính user request | Host giao chính mình phụ trách item | Cho phép. ownerId = hostId là hợp lệ nếu host nằm trong participant list. |
| Agenda quá nhiều items | Request có hơn 50 agenda items | Chặn lưu và trả 422 `AGENDA_ITEM_LIMIT_EXCEEDED`. Không warning-only. |
| Timezone | Thời gian meeting ở múi giờ khác | Dùng timestamptz. Tính duration bằng phút giữa end_time - start_time. |
| OwnerId = null | Không gán người phụ trách | Cho phép. Item vẫn lưu với owner_id = null. |
| Meeting có external participants | Khách mời ngoài không có internal JWT/account | External participant không thể làm owner và không được gọi API GET agenda trong scope này. Agenda cho external chỉ có thể được gửi qua email/reminder/invitation ở feature khác. |

---

## 17. Out of Scope

Các nội dung sau **không thuộc phạm vi** của feature này:

- UI drag-and-drop agenda reorder (backend support sẵn, FE tự implement).
- Cập nhật ctual_duration_minutes, 
esult_note trong agenda item (thuộc in-meeting feature).
- Cập nhật status agenda item: in_progress, done, skipped (thuộc in-meeting feature).
- Real-time timeline tracking trong in-meeting.
- Tạo meeting mới.
- Sửa thời gian meeting để "nới" agenda.
- Thêm participant mới.
- Hỗ trợ external participant làm owner (meeting_agendas.owner_id FK tới users.id).
- Gửi email/notification ngay sau mỗi lần lưu agenda (deferred integration).
- Tạo bảng database mới.
- AI đề xuất agenda tự động.
- Import agenda từ file/template.

### 17.1 EARS Guardrails

`	ext
OOS-001: THE system SHALL NOT cho phép cập nhật actual_duration_minutes, result_note, hoặc status item trong feature này.

OOS-002: THE system SHALL NOT tạo bảng database mới.

OOS-003: THE system SHALL NOT gửi notification/email ngay sau khi lưu agenda (deferred).

OOS-004: THE system SHALL NOT hỗ trợ external participant làm owner agenda.

OOS-005: THE system SHALL NOT thay đổi meeting time để accommodate agenda duration.

OOS-006: THE system SHALL NOT implement notification/background job skeleton cho agenda trong UC-MM-09.

OOS-007: THE system SHALL NOT cho phép external participant gọi API authenticated GET agendas.

OOS-008: THE system SHALL NOT cho phép PUT agenda khi meeting ở trạng thái `in_progress`.

OOS-009: THE system SHALL NOT cập nhật `meeting_agendas.status` sang in_progress/done/skipped.

OOS-010: THE system SHALL NOT ghi `meeting_events` bắt buộc cho agenda (audit chính dùng audit_logs).

OOS-011: THE system SHALL NOT tự động invalidate agenda khi meeting time thay đổi (feature khác chịu trách nhiệm).
`

---

## 18. Clarifications Needed

Tất cả clarify high-priority đã được chốt và cập nhật vào spec.

| # | Vấn đề | Trạng thái | Ghi chú |
|---|---|---|---|
| CL-01 | Có cho phép Host/Organizer chỉnh agenda khi meeting `in_progress`? | Resolved: Chặn. Chỉ cho phép khi `scheduled`. | Đã cập nhật FR-013, SB-01 |
| CL-02 | `ownerId` có bắt buộc không? | Resolved: Optional. Null được chấp nhận. | BR10 giữ nguyên |
| CL-03 | Giới hạn số lượng items tối đa? | Resolved: 50 items. | FR-029, VR-01 |
| CL-04 | Meeting event `agenda_updated` có cần ghi không? | Resolved: Không bắt buộc. Audit chính dùng audit_logs. | DM-03, FR-016 |
| CL-05 | Giới hạn description? | Resolved: 2000 ký tự. | FR-030, VR-02 |
---

## 19. Traceability Matrix

| UC-MM-09 Requirement | FR ID | AC ID | Business Rule | Error Code |
|---|---|---|---|---|
| Atomic save agenda list | FR-001, FR-004 | AC-001, AC-002, AC-015 | BR6 | - |
| Permission write | FR-002 | AC-005, AC-006, AC-007 | BR1, BR2 | AGENDA_WRITE_FORBIDDEN |
| Permission read | FR-003 | AC-004 | BR1 | AGENDA_WRITE_FORBIDDEN |
| Renormalize agenda_order | FR-004 | AC-001, AC-002 | BR5 | - |
| Empty items = clear | FR-005 | AC-003 | BR11 | - |
| Owner là participant | FR-006 | AC-011 | BR4 | AGENDA_OWNER_NOT_PARTICIPANT |
| Validate duration overflow | FR-007 | AC-010 | BR3 | AGENDA_DURATION_OVERFLOW |
| Audit log | FR-008 | AC-001 | BR12 | - |
| Meeting event | FR-009 | - | - | - |
| Item id wrong meeting | FR-010 | AC-014 | BR14 | AGENDA_ITEM_NOT_IN_MEETING |
| Scheduled only | FR-011 | AC-008, AC-009 | BR2, BR7 | AGENDA_MEETING_STATUS_BLOCKED |
| Block non-scheduled | FR-012 | AC-008, AC-009 | BR7 | AGENDA_MEETING_STATUS_BLOCKED |
| Block in-progress | FR-013 | - | BR7 | AGENDA_MEETING_STATUS_BLOCKED |
| Duration > 0 | FR-014 | AC-013 | BR9 | AGENDA_INVALID_DURATION |
| Notification deferred | FR-015 | - | - | - |
| Meeting event optional | FR-016 | - | - | - |
| Unauthenticated | FR-017 | AC-007 | - | UNAUTHORIZED |
| Forbidden | FR-018 | AC-006 | BR1 | AGENDA_WRITE_FORBIDDEN |
| Meeting not found | FR-019 | - | - | MEETING_NOT_FOUND |
| Invalid status | FR-020 | AC-008, AC-009 | BR7 | AGENDA_MEETING_STATUS_BLOCKED |
| Null items | FR-021 | - | - | AGENDA_INVALID_PAYLOAD |
| Title required | FR-022 | AC-012 | BR8 | AGENDA_TITLE_REQUIRED |
| Invalid duration | FR-023 | AC-013 | BR9 | AGENDA_INVALID_DURATION |
| Owner not participant | FR-024 | AC-011 | BR4 | AGENDA_OWNER_NOT_PARTICIPANT |
| Duplicate item id | FR-025 | - | - | AGENDA_DUPLICATE_ITEM_ID |
| Item not found | FR-026 | AC-025 | - | AGENDA_ITEM_NOT_IN_MEETING |
| Duration overflow | FR-027 | AC-010 | BR3 | AGENDA_DURATION_OVERFLOW |
| Transaction rollback | FR-028 | AC-016 | BR6 | INTERNAL_ERROR |
| Meeting time invalid | FR-031 | AC-021 | BR19 | MEETING_TIME_INVALID_FOR_AGENDA |
| Max items limit | FR-029 | AC-020 | BR16 | AGENDA_ITEM_LIMIT_EXCEEDED |
| Description too long | FR-030 | AC-022 | BR17 | AGENDA_DESCRIPTION_TOO_LONG |
| No-op detection | FR-032 | AC-018 | BR15 | - |
| Validation priority | FR-033 | - | BL-02 | - |
| Items required | FR-021 | AC-019 | BR18 | AGENDA_ITEMS_REQUIRED |
| Pending approval block | FR-020 | AC-017 | BR7 | AGENDA_MEETING_STATUS_BLOCKED |
| in_progress GET lock | FR-011, FR-013 | AC-023 | BR7 | - |
| Audit content | FR-008 | AC-024 | BR12 | - |
| Item not in meeting | FR-010 | AC-025 | BR14 | AGENDA_ITEM_NOT_IN_MEETING |
| Title too long | FR-023a | AC-026 | BR8 | AGENDA_TITLE_TOO_LONG |

---
## Appendices

### A. Meeting Duration Calculation

Meeting duration (phút) = EXTRACT(EPOCH FROM (end_time - start_time)) / 60

Ví dụ: start_time = 2026-06-15 09:00, end_time = 2026-06-15 10:30 → duration = 90 phút.

### B. agenda_order Normalization Logic

```text
items.forEach((item, index) => {
  item.agendaOrder = index + 1;
});
```

Backend luôn ghi đè `agenda_order` bằng index của item trong mảng request + 1. Client gửi order nào cũng bị bỏ qua.

### C. Atomic Replace Logic

```text
Input: request.items (desired final state)
1. Load existing items từ DB WHERE meeting_id = :meetingId
2. existingIds = existing items map by id
3. requestIds = items có id trong request
4. toDelete = existing items WHERE id NOT IN requestIds
5. toUpdate = request items WHERE id IS NOT NULL AND id IN existingIds
6. toCreate = request items WHERE id IS NULL
7. BEGIN TX
8. DELETE toDelete
9. UPDATE toUpdate
10. INSERT toCreate
11. Normalize agenda_order = index + 1 cho tất cả items (sau delete/update theo thứ tự array)
12. COMMIT
