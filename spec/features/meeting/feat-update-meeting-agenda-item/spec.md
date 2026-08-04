# Feature Specification: Chỉnh sửa agenda item (Update Single Meeting Agenda Item)

- **Feature ID**: UC-MM-10
- **Feature Name**: Chỉnh sửa agenda item (tương ứng UC-28 trong Feature Table / API Contract v1.0)
- **Module / Domain**: meetings
- **Created Date**: 2026-07-17
- **Status**: Draft
- **Source Documents**:
  - `docs/API_CONTRACT_v1.0_with_system_roles.md` — UC-28 (Chỉnh sửa agenda)
  - `spec/features/meeting/feat-create-meeting-agenda/spec.md` — UC-MM-09 (Tạo chương trình họp, atomic replace)
  - Database v3.2 Compact (39 tables)
  - CLAUDE.md — Backend Agent Guide

---

## 📝 CHANGELOG & REVISION HISTORY
| Ngày cập nhật | Tóm tắt thay đổi | Các dòng thay đổi |
| :--- | :--- | :--- |
| 2026-07-17 | Tạo spec lần đầu cho UC-MM-10 (UC-28 Chỉnh sửa agenda). Quyết định kiến trúc: giữ PUT atomic-replace (UC-MM-09) và bổ sung PATCH single-item (hybrid, theo lựa chọn người dùng) | Toàn bộ file |
| 2026-07-26 | Đính chính hiện trạng (BE-06): code controller từng khai route thiếu prefix `meetings/` (chạy nhầm ở root path), đã sửa lại `meetings.controller.ts` ngày 2026-07-26 cho khớp đúng path đã đặc tả ở mục 9.1 của spec này. Spec không thay đổi nội dung, chỉ code được sửa. | Ghi chú, không đổi nội dung đặc tả |
| 2026-08-04 | Đồng bộ với fix UC-MM-09 (2026-08-04): nới rule chỉnh sửa agenda item cho phép cả `pending_approval` lẫn `scheduled` (trước đây chỉ `scheduled`, khiến agenda của meeting nhân viên tạo — luôn ở pending_approval chờ duyệt — không thể chỉnh sửa được). Vẫn chặn in_progress/completed/cancelled. | Mục Feature Summary, Preconditions, FR-010/011/017, BR2, bảng lỗi |

## Hướng dẫn viết EARS Requirements

Functional Requirements trong spec này viết theo EARS. Keyword EARS giữ nguyên bằng tiếng Anh. Nội dung nghiệp vụ viết bằng tiếng Việt.

| Keyword | Vai trò |
|---|---|
| THE system SHALL | Yêu cầu luôn đúng |
| WHEN | Trigger/event tại một thời điểm |
| WHILE | Hành vi đúng trong suốt một trạng thái |
| WHERE | Yêu cầu chỉ áp dụng khi feature/config tồn tại |
| IF ... THEN | Xử lý lỗi/ngoại lệ |

---

## 1. Feature Summary

### 1.1 Bối cảnh

UC-MM-09 (`feat-create-meeting-agenda`) đã triển khai `GET /meetings/{id}/agendas` và `PUT /meetings/{id}/agendas` theo mô hình **atomic replace**: mỗi lần Host/Organizer muốn sửa dù chỉ một agenda item, FE phải gửi lại toàn bộ danh sách agenda item hiện có (kèm item đã sửa) trong một request PUT.

Feature Table gốc (UC-28 — Chỉnh sửa agenda) và `docs/API_CONTRACT_v1.0_with_system_roles.md` lại đặc tả một endpoint **PATCH riêng theo từng item** (`PATCH /meetings/{meetingId}/agendas/{agendaId}`). Endpoint này **chưa được implement** trong code hiện tại (`meetings.controller.ts` chỉ có `GET` và `PUT` cho route `agendas`). Frontend (`FE_SmarTracking`) cũng chưa có bất kỳ lời gọi API nào liên quan đến agenda.

Sau khi phân tích, đội ngũ đã quyết định theo hướng **Hybrid**: giữ nguyên `PUT /agendas` (bulk save khi soạn thảo nhiều item cùng lúc) và bổ sung thêm `PATCH /agendas/{agendaId}` (sửa nhanh một item, ví dụ inline-edit trên UI) — hai luồng ghi dùng chung transaction lock và service logic để tránh xung đột dữ liệu.

### 1.2 Mục tiêu

Cho phép Host/Organizer/Admin (có quyền) chỉnh sửa **một** agenda item cụ thể của một meeting đang `pending_approval` hoặc `scheduled`, mà không cần gửi lại toàn bộ danh sách agenda.

### 1.3 Giá trị mang lại

- Giảm payload khi FE chỉ cần sửa 1 field của 1 item (vd đổi tiêu đề, đổi thời lượng).
- Hỗ trợ thao tác inline-edit (sửa nhanh 1 dòng trong bảng agenda) mà không phải reload/gửi lại toàn bộ danh sách.
- Giữ nguyên tính atomic và validate nghiệp vụ (duration overflow, owner hợp lệ) đã có từ UC-MM-09.

### 1.4 Giả định

- `meeting_agendas` đã tồn tại (không tạo bảng mới), dùng chung entity `MeetingAgendaEntity` với UC-MM-09.
- Meeting đã có `start_time`/`end_time` hợp lệ.
- `PUT /meetings/{id}/agendas` (UC-MM-09) tiếp tục hoạt động song song, không bị thay thế.

### 1.5 Cần làm rõ

Xem mục 18 (Clarifications Needed) — tất cả điểm mơ hồ đã được phân tích và resolve trong lần viết spec đầu tiên vì đã có quyết định kiến trúc rõ ràng từ người dùng (Hybrid).

---

## 2. Actors & Permissions

### 2.1 Danh sách actor

| Actor | Vai trò | Quyền / Trách nhiệm chính |
|---|---|---|
| Internal Employee | Organizer hoặc Host của meeting | Được PATCH agenda item nếu `currentUser.id === meetings.organizer_id` hoặc `=== meetings.host_id` |
| Senior Admin / System Admin | Quản trị viên | Được PATCH thay host nếu có permission `meeting.agenda.write` |
| Participant (internal) | Người tham gia nội bộ | Chỉ đọc qua `GET /agendas` (UC-MM-09). Không được PATCH |
| External Participant | Khách mời ngoài tổ chức | Không có JWT, không gọi API này |

### 2.2 Role & Permission Rules

- Giữ nguyên mô hình đã thiết lập ở UC-MM-09: **không** dùng 4 permission tách rời `meeting.agenda.create/read/update/delete` như bản API Contract gốc mô tả cho UC-26..29. Thay vào đó dùng **`meeting.agenda.write`** (ghi, bao gồm cả PATCH và DELETE single-item) và **`meeting.agenda.read`** (đọc) — đồng nhất với permission model đã build. Đây là một sai khác có chủ đích so với API Contract gốc, xem mục 18 CL-01.
- Host resolution: dùng `meetings.host_id` làm nguồn chính thức. `meeting_participants.participant_role = host` chỉ là role hiển thị.
- Nếu `host_id` null, chỉ organizer được write.

### 2.3 Actor Constraints

- Phải đăng nhập hợp lệ.
- Write: `meetings.organizer_id` hoặc `meetings.host_id`, hoặc admin có permission `meeting.agenda.write`.
- Meeting phải tồn tại, không bị xóa mềm.
- Meeting phải ở trạng thái `pending_approval` hoặc `scheduled`.
- `agendaId` trong path phải thuộc đúng `meetingId` trong path.

---

## 3. Preconditions

| ID | Mô tả |
|---|---|
| PRE1 | Người dùng đã đăng nhập hợp lệ, JWT còn hiệu lực. |
| PRE2 | Người dùng có quyền write (organizer/host/admin có permission `meeting.agenda.write`). |
| PRE3 | Meeting tồn tại, không bị xóa mềm. |
| PRE4 | Meeting đang ở trạng thái `pending_approval` hoặc `scheduled`. |
| PRE5 | Meeting có `start_time`/`end_time` hợp lệ (`end_time > start_time`). |
| PRE6 | Agenda item với `agendaId` tồn tại và thuộc `meetingId`. |

---

## 4. Postconditions

| ID | Mô tả |
|---|---|
| POST1 | Field được cung cấp trong request được cập nhật vào `meeting_agendas`. Field không cung cấp giữ nguyên. |
| POST2 | Nếu `agendaOrder` thay đổi, các item khác trong cùng meeting được renormalize để giữ thứ tự sequential 1..N, không trùng, không gap. |
| POST3 | `updated_by = currentUser.id`, `updated_at` được refresh (trừ khi no-op). |
| POST4 | `audit_logs` được ghi với `action_type = 'agenda_item_updated'`. |
| POST5 | Response trả về agenda item đã cập nhật (kèm `ownerName`) và tổng hợp thời lượng (`totalPlannedDurationMinutes`, `remainingDurationMinutes`) của toàn bộ agenda. |
| POST6 | Không có item nào khác bị đổi field nghiệp vụ (title/description/owner/duration) ngoại trừ tác dụng phụ renormalize `agenda_order`. |

---

## 5. User Stories

- **US-01**: Với vai trò Host, tôi muốn sửa nhanh tiêu đề/thời lượng của một agenda item mà không phải gửi lại toàn bộ danh sách agenda.
- **US-02**: Với vai trò Host, tôi muốn đổi vị trí (thứ tự) của một agenda item và hệ thống tự dịch chuyển các item khác cho hợp lý.
- **US-03**: Với vai trò Host, tôi muốn hệ thống từ chối lưu nếu sau khi sửa, tổng thời lượng agenda vượt quá thời lượng cuộc họp.
- **US-04**: Với vai trò Organizer, tôi muốn đổi người phụ trách (owner) của một agenda item.

---

## 6. Functional Requirements

### 6.1 Core Requirements

```text
FR-001: THE system SHALL cho phép Host/Organizer/Admin (có permission meeting.agenda.write) cập nhật một agenda item cụ thể qua PATCH /meetings/{meetingId}/agendas/{agendaId}, chỉ thay đổi field được cung cấp trong request (partial update).

FR-002: THE system SHALL giữ nguyên giá trị của field không được cung cấp trong request body (không ghi đè bằng null/undefined).

FR-003: THE system SHALL chỉ cho phép cập nhật các field: title, description, ownerId, plannedDurationMinutes, agendaOrder qua endpoint này. THE system SHALL NOT cho phép cập nhật status, actualDurationMinutes, resultNote (thuộc in-meeting feature, ngoài phạm vi — đồng nhất OOS-001/OOS-009 của UC-MM-09).
```

### 6.2 Event-driven Requirements

```text
FR-004: WHEN request PATCH có agendaOrder khác agendaOrder hiện tại của item, THE system SHALL dịch chuyển (shift) agenda_order của các item khác trong cùng meeting để duy trì thứ tự sequential 1..N, không trùng, không gap (giống thuật toán "move item trong mảng").

FR-005: WHEN request PATCH có ownerId, THE system SHALL validate ownerId thuộc meeting_participants.user_id của meeting đó.

FR-006: WHEN request PATCH có plannedDurationMinutes, THE system SHALL tính lại tổng plannedDurationMinutes của toàn bộ agenda (dùng giá trị mới cho item đang sửa, giữ nguyên cho các item khác) và so với meeting duration.

FR-007: WHEN agenda item được cập nhật thành công, THE system SHALL ghi audit_logs với action_type = 'agenda_item_updated', entity_type = 'meeting_agenda', entity_id = agendaId, old_value_json/new_value_json chỉ chứa các field thay đổi (diff), kèm danh sách agendaId khác bị ảnh hưởng bởi renormalize order (nếu có).

FR-008: WHEN request PATCH payload không làm thay đổi bất kỳ field nào so với giá trị hiện tại trong DB (no-op), THE system SHALL trả 200 với dữ liệu hiện tại, không ghi audit log mới, không cập nhật updated_at.

FR-009: WHEN PATCH và PUT /agendas (UC-MM-09) được gọi đồng thời trên cùng meeting, THE system SHALL dùng chung cơ chế lock ở mức meeting row (pessimistic_write trong transaction) để đảm bảo 2 luồng ghi không lost-update lẫn nhau.
```

### 6.3 State-driven Requirements

```text
FR-010: WHILE meeting đang ở trạng thái pending_approval hoặc scheduled, THE system SHALL cho phép PATCH agenda item.

FR-011: WHILE meeting đang ở trạng thái in_progress, completed, cancelled, THE system SHALL chặn PATCH agenda item (đồng nhất BR2/BR7 của UC-MM-09).
```

### 6.4 Optional Feature Requirements

```text
FR-012: WHERE feature notification cần thông báo khi agenda item thay đổi, feature đó có thể đọc audit_logs action = 'agenda_item_updated' (deferred, không implement trong UC-MM-10).
```

### 6.5 Unwanted Behavior Requirements

```text
FR-013: IF người dùng chưa đăng nhập, THEN THE system SHALL trả 401 UNAUTHORIZED.

FR-014: IF người dùng không có quyền write, THEN THE system SHALL trả 403 AGENDA_WRITE_FORBIDDEN, không thay đổi dữ liệu.

FR-015: IF meeting không tồn tại hoặc đã bị xóa mềm, THEN THE system SHALL trả 404 MEETING_NOT_FOUND.

FR-016: IF agendaId không tồn tại hoặc không thuộc meetingId trong path, THEN THE system SHALL trả 404 AGENDA_ITEM_NOT_FOUND.

FR-017: IF meeting không ở trạng thái pending_approval hoặc scheduled, THEN THE system SHALL trả 409 AGENDA_MEETING_STATUS_BLOCKED.

FR-018: IF meeting.start_time hoặc end_time null, hoặc end_time <= start_time, THEN THE system SHALL trả 409 MEETING_TIME_INVALID_FOR_AGENDA.

FR-019: IF title được cung cấp nhưng rỗng sau trim, THEN THE system SHALL trả 422 AGENDA_TITLE_REQUIRED.

FR-020: IF title được cung cấp và dài hơn 255 ký tự sau trim, THEN THE system SHALL trả 422 AGENDA_TITLE_TOO_LONG.

FR-021: IF description được cung cấp và dài hơn 2000 ký tự, THEN THE system SHALL trả 422 AGENDA_DESCRIPTION_TOO_LONG.

FR-022: IF plannedDurationMinutes được cung cấp và không phải integer > 0, THEN THE system SHALL trả 422 AGENDA_INVALID_DURATION.

FR-023: IF ownerId được cung cấp và không thuộc meeting_participants của meeting, THEN THE system SHALL trả 422 AGENDA_OWNER_NOT_PARTICIPANT.

FR-024: IF sau khi áp dụng thay đổi, tổng plannedDurationMinutes toàn bộ agenda > meeting duration, THEN THE system SHALL trả 422 AGENDA_DURATION_OVERFLOW.

FR-025: IF agendaOrder được cung cấp nhưng không phải integer trong khoảng [1, tổng số agenda item hiện có của meeting], THEN THE system SHALL trả 422 AGENDA_INVALID_ORDER.

FR-026: IF request body chứa field không nằm trong whitelist (status, actualDurationMinutes, resultNote, meetingId, id, hoặc field lạ khác), THEN THE system SHALL trả 400 AGENDA_INVALID_PAYLOAD (ValidationPipe forbidNonWhitelisted).

FR-027: IF request body rỗng ({}) hoặc không có field hợp lệ nào được cung cấp, THEN THE system SHALL trả 400 AGENDA_UPDATE_PAYLOAD_EMPTY.

FR-028: IF transaction thất bại trong quá trình cập nhật, THEN THE system SHALL rollback toàn bộ, agenda item và các item bị ảnh hưởng bởi renormalize giữ nguyên giá trị cũ.

FR-029: IF một điều kiện validation thất bại, THEN THE system SHALL trả lỗi đầu tiên theo thứ tự ưu tiên: Authentication (401) -> Route param (meetingId/agendaId) invalid UUID (400) -> Payload malformed/field không whitelist (400) -> Payload rỗng (400) -> Meeting not found (404) -> Agenda item not found (404) -> Write permission (403) -> Meeting time invalid (409) -> Meeting status blocked (409) -> Field validation: title/description/duration/agendaOrder (422) -> Owner not participant (422) -> Duration overflow (422). Không gom nhiều lỗi business vào một response.
```

### 6.6 Traceability

| Requirement ID | EARS Pattern | Ghi chú |
|---|---|---|
| FR-001..003 | Ubiquitous | Partial update, field whitelist |
| FR-004..009 | Event-driven | Order shift, owner/duration revalidate, audit, lock |
| FR-010..011 | State-driven | pending_approval + scheduled |
| FR-012 | Optional | Notification deferred |
| FR-013..029 | Unwanted Behavior | Error handling đầy đủ |

---

## 7. Business Rules

| ID | Mô tả |
|---|---|
| BR1 | Chỉ Host/Organizer (`meetings.host_id`/`meetings.organizer_id`) hoặc Admin có permission `meeting.agenda.write` được PATCH. Dùng chung permission với UC-MM-09, không tách riêng `meeting.agenda.update`. |
| BR2 | Chỉ cho phép PATCH khi `meeting.status` là `pending_approval` hoặc `scheduled`. |
| BR3 | PATCH là partial update — field không gửi trong body giữ nguyên giá trị cũ trong DB. |
| BR4 | Không cho phép PATCH các field runtime (`status`, `actualDurationMinutes`, `resultNote`) — thuộc in-meeting feature, ngoài phạm vi UC-MM-10. |
| BR5 | `agendaOrder` khi thay đổi sẽ kích hoạt renormalize toàn bộ danh sách item của meeting đó (dịch chuyển các item nằm giữa vị trí cũ và vị trí mới). |
| BR6 | Tổng `plannedDurationMinutes` của toàn bộ agenda (sau thay đổi) không được vượt meeting duration. |
| BR7 | `ownerId` (nếu có trong request) phải là internal participant của meeting. |
| BR8 | Mọi thay đổi phải ghi audit log riêng biệt (`action_type = 'agenda_item_updated'`), khác với `'agenda_saved'` của PUT (UC-MM-09). |
| BR9 | PATCH và PUT (UC-MM-09) dùng chung lock ở mức meeting row (`pessimistic_write`) trong transaction để tránh race condition giữa 2 luồng ghi đồng thời trên cùng meeting. |
| BR10 | `agendaId` phải thuộc đúng `meetingId` trong path — nếu không tồn tại hoặc thuộc meeting khác, trả 404 `AGENDA_ITEM_NOT_FOUND` (khác với `AGENDA_ITEM_NOT_IN_MEETING` 422 của PUT vì đây là resource lookup theo path, không phải validate 1 phần tử trong mảng bulk). |
| BR11 | Request body rỗng hoặc chỉ chứa field không hợp lệ bị từ chối — tránh no-op request gây nhầm lẫn cho client. |
| BR12 | No-op detection: nếu toàn bộ field cung cấp trong request đều giống giá trị hiện tại trong DB, trả 200 nhưng không ghi audit log mới, không đổi `updated_at`. |

---

## 8. Validation Rules

### 8.1 DTO-level Validation (trả 400)

| Field | Điều kiện | Error code |
|---|---|---|
| `meetingId` (path) | Invalid UUID | `AGENDA_INVALID_PAYLOAD` |
| `agendaId` (path) | Invalid UUID | `AGENDA_INVALID_PAYLOAD` |
| `title` | Không phải string (nếu có) | `AGENDA_INVALID_PAYLOAD` |
| `description` | Không phải string (nếu có) | `AGENDA_INVALID_PAYLOAD` |
| `ownerId` | Invalid UUID (nếu có) | `AGENDA_INVALID_PAYLOAD` |
| `plannedDurationMinutes` | Không phải number (nếu có) | `AGENDA_INVALID_PAYLOAD` |
| `agendaOrder` | Không phải integer (nếu có) | `AGENDA_INVALID_PAYLOAD` |
| body | Chứa field ngoài whitelist (`status`, `actualDurationMinutes`, `resultNote`, ...) | `AGENDA_INVALID_PAYLOAD` (`forbidNonWhitelisted`) |
| body | Rỗng hoặc mọi field đều `undefined` | `AGENDA_UPDATE_PAYLOAD_EMPTY` |

### 8.2 Service-level Validation (trả 403/404/409/422)

| Rule | Error code | HTTP status | Thứ tự ưu tiên |
|---|---|---|---|
| Unauthenticated | `UNAUTHORIZED` | 401 | 1 |
| Meeting không tồn tại/deleted | `MEETING_NOT_FOUND` | 404 | 2 |
| Agenda item không tồn tại/không thuộc meeting | `AGENDA_ITEM_NOT_FOUND` | 404 | 3 |
| User không có quyền write | `AGENDA_WRITE_FORBIDDEN` | 403 | 4 |
| `start_time`/`end_time` invalid | `MEETING_TIME_INVALID_FOR_AGENDA` | 409 | 5 |
| Meeting không ở `pending_approval`/`scheduled` | `AGENDA_MEETING_STATUS_BLOCKED` | 409 | 6 |
| `title` rỗng sau trim (nếu có) | `AGENDA_TITLE_REQUIRED` | 422 | 7 |
| `title` > 255 ký tự (nếu có) | `AGENDA_TITLE_TOO_LONG` | 422 | 7 |
| `description` > 2000 ký tự (nếu có) | `AGENDA_DESCRIPTION_TOO_LONG` | 422 | 7 |
| `plannedDurationMinutes <= 0` hoặc không integer (nếu có) | `AGENDA_INVALID_DURATION` | 422 | 7 |
| `agendaOrder` ngoài khoảng [1, N] (nếu có) | `AGENDA_INVALID_ORDER` | 422 | 8 |
| `ownerId` không thuộc `meeting_participants` (nếu có) | `AGENDA_OWNER_NOT_PARTICIPANT` | 422 | 9 |
| Tổng `plannedDurationMinutes` > meeting duration | `AGENDA_DURATION_OVERFLOW` | 422 | 10 |

### 8.3 Normalization

- Nếu `agendaOrder` thay đổi: các item nằm giữa vị trí cũ và vị trí mới được dịch chuyển ±1, toàn bộ danh sách vẫn đảm bảo 1..N liên tục.
- `updated_by` = `currentUser.id` khi có thay đổi thực sự (không áp dụng khi no-op).

---

## 9. API Contract Draft

### 9.1 PATCH /api/v1/meetings/{meetingId}/agendas/{agendaId}

**Request Body (tất cả optional, tối thiểu 1 field hợp lệ):**

```json
{
  "title": "Báo cáo sprint - cập nhật",
  "description": "Nội dung chi tiết mới",
  "ownerId": "uuid-or-null",
  "plannedDurationMinutes": 45,
  "agendaOrder": 2
}
```

| Field | Type | Bắt buộc | Mô tả |
|---|---|---|---|
| `title` | string | Không | 1-255 ký tự sau trim nếu có |
| `description` | string \| null | Không | Tối đa 2000 ký tự |
| `ownerId` | UUID \| null | Không | Phải là internal participant nếu có |
| `plannedDurationMinutes` | integer | Không | > 0 nếu có |
| `agendaOrder` | integer | Không | Trong khoảng [1, N] nếu có, kích hoạt renormalize |

**Success Response (200):**

```json
{
  "success": true,
  "message": "Cap nhat chuong trinh hop thanh cong",
  "data": {
    "id": "uuid",
    "meetingId": "uuid",
    "agendaOrder": 2,
    "title": "Báo cáo sprint - cập nhật",
    "description": "Nội dung chi tiết mới",
    "ownerId": "uuid",
    "ownerName": "Nguyen Van A",
    "plannedDurationMinutes": 45,
    "status": "planned",
    "updatedAt": "2026-07-17T10:00:00.000Z",
    "totalPlannedDurationMinutes": 80,
    "remainingDurationMinutes": 10
  }
}
```

### 9.2 Error Responses

**Agenda Item Not Found (404):**
```json
{
  "code": "AGENDA_ITEM_NOT_FOUND",
  "message": "Không tìm thấy mục agenda trong cuộc họp này.",
  "details": { "meetingId": "uuid", "agendaId": "uuid" }
}
```

**Update Payload Empty (400):**
```json
{
  "code": "AGENDA_UPDATE_PAYLOAD_EMPTY",
  "message": "Yêu cầu cập nhật phải chứa ít nhất một trường hợp lệ.",
  "details": {}
}
```

**Invalid Order (422):**
```json
{
  "code": "AGENDA_INVALID_ORDER",
  "message": "Vị trí agenda không hợp lệ.",
  "details": { "agendaOrder": 9, "maxAllowed": 4 }
}
```

---

## 10. Data Model Impact

### 10.1 Entity liên quan

| Entity / Table | Vai trò | Ghi chú |
|---|---|---|
| `meetings` | Kiểm tra trạng thái, duration, quyền | Chỉ đọc |
| `meeting_participants` | Validate `ownerId` | Chỉ đọc |
| `meeting_agendas` | Bảng chính: update 1 item (+ renormalize order các item khác) | Ghi: update |
| `audit_logs` | Ghi audit cho PATCH | Ghi: insert |

### 10.2 Kết luận

- Dùng lại `MeetingAgendaEntity` đã có từ UC-MM-09. **Không thêm bảng, không thêm cột.**
- Không cần enum/status mới.

---

## 11. Authorization Rules

| Endpoint | Minimum Role | Permission | Ghi chú |
|---|---|---|---|
| PATCH /meetings/{id}/agendas/{agendaId} | Host/Organizer | `meeting.agenda.write` | Cùng permission với PUT (UC-MM-09) |

---

## 12. Transaction Boundary

PATCH phải thực hiện trong một database transaction, **dùng chung lock resource với PUT (UC-MM-09)**:

1. **BEGIN TRANSACTION**
2. Load meeting với `pessimistic_write` lock (cùng cơ chế PUT dùng) — đảm bảo PATCH/DELETE/PUT loại trừ lẫn nhau trên cùng meeting
3. Validate: meeting tồn tại, không deleted, `start_time`/`end_time` hợp lệ, status ∈ {`pending_approval`, `scheduled`}
4. Validate: user có quyền write
5. Load agenda item theo `id = agendaId AND meeting_id = meetingId`; nếu không có → 404 `AGENDA_ITEM_NOT_FOUND`
6. Validate body không rỗng, không chứa field ngoài whitelist
7. Merge field được cung cấp vào bản sao working copy của item
8. Validate field đã merge: `title`, `description`, `plannedDurationMinutes`, `ownerId`, `agendaOrder`
9. **No-op detection**: so sánh working copy với item hiện tại; nếu giống hệt → trả response hiện tại, không update, không audit, COMMIT (rollback không cần thiết)
10. Nếu `agendaOrder` thay đổi: load toàn bộ item của meeting, tính shift plan, `UPDATE` `agenda_order` cho các item bị ảnh hưởng
11. Tính lại tổng `plannedDurationMinutes` toàn bộ agenda (dùng giá trị mới cho item đang sửa) và so với meeting duration → nếu vượt, `AGENDA_DURATION_OVERFLOW`
12. `UPDATE meeting_agendas` cho item đang sửa (`updated_by = currentUser.id`)
13. Ghi `audit_logs` (`action_type = 'agenda_item_updated'`)
14. **COMMIT TRANSACTION**
15. Nếu bất kỳ bước nào fail → **ROLLBACK**, trả lỗi tương ứng

---

## 13. Error Handling

### 13.1 Error Code Table

| HTTP Status | Error Code | Ý nghĩa |
|---|---|---|
| 401 | `UNAUTHORIZED` | Chưa đăng nhập |
| 400 | `AGENDA_INVALID_PAYLOAD` | Payload sai type/UUID/field ngoài whitelist |
| 400 | `AGENDA_UPDATE_PAYLOAD_EMPTY` | Body rỗng, không có field hợp lệ |
| 404 | `MEETING_NOT_FOUND` | meetingId sai/deleted |
| 404 | `AGENDA_ITEM_NOT_FOUND` | agendaId sai hoặc không thuộc meeting |
| 403 | `AGENDA_WRITE_FORBIDDEN` | Không có quyền write |
| 409 | `AGENDA_MEETING_STATUS_BLOCKED` | Meeting không ở `pending_approval`/`scheduled` |
| 409 | `MEETING_TIME_INVALID_FOR_AGENDA` | start/end time invalid |
| 422 | `AGENDA_TITLE_REQUIRED` | Title rỗng sau trim |
| 422 | `AGENDA_TITLE_TOO_LONG` | Title > 255 |
| 422 | `AGENDA_DESCRIPTION_TOO_LONG` | Description > 2000 |
| 422 | `AGENDA_INVALID_DURATION` | Duration <= 0 hoặc không integer |
| 422 | `AGENDA_INVALID_ORDER` | agendaOrder ngoài khoảng hợp lệ |
| 422 | `AGENDA_OWNER_NOT_PARTICIPANT` | ownerId không thuộc participants |
| 422 | `AGENDA_DURATION_OVERFLOW` | Tổng planned > meeting duration |
| 500 | `INTERNAL_ERROR` | Lỗi server |

---

## 14. Audit / Notification Considerations

### 14.1 Audit Log

| Field | Giá trị |
|---|---|
| `actionType` | `agenda_item_updated` |
| `userId` | Người thực hiện |
| `entityType` | `meeting_agenda` |
| `entityId` | `agendaId` |
| `oldValueJson` | Chỉ chứa field đã đổi, giá trị trước |
| `newValueJson` | Chỉ chứa field đã đổi, giá trị sau, kèm `reorderedAgendaIds` nếu có shift |
| `severity` | `info` |

### 14.2 Notification

Không implement notification trong UC-MM-10 (đồng nhất OOS-003/OOS-006 của UC-MM-09, deferred).

---

## 15. Acceptance Criteria

### 15.1 Happy Path

```text
AC-001:
Given một agenda item thuộc meeting đang scheduled, Host của meeting gửi PATCH chỉ với title mới,
When request được xử lý,
Then hệ thống chỉ cập nhật title, giữ nguyên các field khác, trả 200 và ghi audit log 'agenda_item_updated'.

AC-002:
Given một agenda item ở vị trí agendaOrder = 3 trong danh sách 5 item,
When Organizer gửi PATCH với agendaOrder = 1,
Then hệ thống dịch item đó lên vị trí 1, các item 1-2 cũ dịch xuống 2-3, item 4-5 giữ nguyên, danh sách vẫn sequential 1-5.

AC-003:
Given một agenda item có ownerId = null,
When Host gửi PATCH với ownerId hợp lệ (thuộc participants),
Then hệ thống cập nhật ownerId thành công, trả ownerName tương ứng.
```

### 15.2 Authorization Cases

```text
AC-004:
Given người dùng là participant thường (không phải organizer/host/admin),
When gửi PATCH agenda item,
Then hệ thống trả 403 AGENDA_WRITE_FORBIDDEN.

AC-005:
Given người dùng chưa đăng nhập,
When gửi PATCH agenda item,
Then hệ thống trả 401 UNAUTHORIZED.
```

### 15.3 Not Found Cases

```text
AC-006:
Given agendaId không tồn tại trong DB,
When Host gửi PATCH,
Then hệ thống trả 404 AGENDA_ITEM_NOT_FOUND.

AC-007:
Given agendaId tồn tại nhưng thuộc meeting khác (không phải meetingId trong path),
When Host gửi PATCH,
Then hệ thống trả 404 AGENDA_ITEM_NOT_FOUND, không thay đổi dữ liệu.
```

### 15.4 Business Rule Cases

```text
AC-008:
Given meeting ở trạng thái completed,
When Host gửi PATCH agenda item,
Then hệ thống trả 409 AGENDA_MEETING_STATUS_BLOCKED.

AC-009:
Given agenda item có plannedDurationMinutes hiện tại = 20, các item khác tổng 50, meeting duration = 60,
When Host gửi PATCH plannedDurationMinutes = 30 (tổng thành 80),
Then hệ thống trả 422 AGENDA_DURATION_OVERFLOW.

AC-010:
Given một ownerId không thuộc meeting_participants,
When Host gửi PATCH với ownerId đó,
Then hệ thống trả 422 AGENDA_OWNER_NOT_PARTICIPANT.

AC-011:
Given request PATCH với body = {},
When Host gửi request,
Then hệ thống trả 400 AGENDA_UPDATE_PAYLOAD_EMPTY.

AC-012:
Given request PATCH chứa field "status": "in_progress",
When Host gửi request,
Then hệ thống trả 400 AGENDA_INVALID_PAYLOAD (field không nằm trong whitelist).
```

### 15.5 No-op & Concurrency Cases

```text
AC-013:
Given Host gửi PATCH với title giống hệt giá trị hiện tại trong DB (không field nào khác),
When hệ thống xử lý,
Then hệ thống trả 200, không ghi audit log mới, không đổi updated_at.

AC-014:
Given một PATCH request đang xử lý và một PUT request (UC-MM-09) trên cùng meeting xảy ra gần như đồng thời,
When cả hai transaction cùng cố gắng lock meeting row,
Then một transaction chạy trước sẽ hoàn tất, transaction sau chờ lock rồi áp dụng thay đổi của mình lên state mới nhất (không mất dữ liệu của transaction trước).

AC-015:
Given transaction PATCH thất bại giữa chừng (ví dụ lỗi DB khi renormalize order),
When hệ thống rollback,
Then agenda item và các item liên quan giữ nguyên agenda_order/field cũ.
```

### 15.6 Acceptance Criteria Traceability

| AC ID | Requirement ID liên quan | Business Rule |
|---|---|---|
| AC-001 | FR-001, FR-002, FR-007 | BR3, BR8 |
| AC-002 | FR-004 | BR5 |
| AC-003 | FR-005 | BR7 |
| AC-004 | FR-014 | BR1 |
| AC-005 | FR-013 | - |
| AC-006 | FR-016 | BR10 |
| AC-007 | FR-016 | BR10 |
| AC-008 | FR-011, FR-017 | BR2 |
| AC-009 | FR-006, FR-024 | BR6 |
| AC-010 | FR-005, FR-023 | BR7 |
| AC-011 | FR-027 | BR11 |
| AC-012 | FR-003, FR-026 | BR4 |
| AC-013 | FR-008 | BR12 |
| AC-014 | FR-009 | BR9 |
| AC-015 | FR-028 | - |

---

## 16. Edge Cases

| Edge Case | Mô tả | Xử lý |
|---|---|---|
| PATCH chỉ agendaOrder, không field khác | Chỉ đổi vị trí | Vẫn tính lại tổng duration (không đổi vì plannedDurationMinutes không đổi), chỉ renormalize order |
| agendaOrder = giá trị hiện tại | Không có thay đổi thực sự về order | Coi là no-op cho field này, không renormalize nếu đây là field duy nhất khác biệt = 0 |
| agendaOrder = N (item cuối muốn thành đầu) | Dịch toàn bộ danh sách | Toàn bộ item giữa vị trí cũ/mới dịch 1 bậc, transaction xử lý tất cả trong 1 lượt UPDATE |
| Owner bị xóa khỏi participant ngay trước khi PATCH submit | Race condition với remove-participant | Validate ownerId tại thời điểm transaction, không dùng cache |
| PATCH đồng thời 2 field khác nhau bởi 2 user khác nhau trên cùng item | Lost update risk | Dùng `pessimistic_write` lock ở mức meeting row (không phải row-level trên agenda item) để serialize |
| PATCH khi meeting bị cancel bởi request khác ngay trước đó | State đổi giữa lúc user đang sửa | Lock + re-check status trong transaction → 409 nếu đã đổi |
| Body chỉ có `ownerId: null` (bỏ owner) | Hợp lệ, xóa owner khỏi item | Cho phép — `null` là giá trị hợp lệ để "un-assign" |
| Title chỉ có khoảng trắng | Coi như rỗng sau trim | 422 `AGENDA_TITLE_REQUIRED` |

---

## 17. Out of Scope

- Cập nhật `status`, `actualDurationMinutes`, `resultNote` (thuộc in-meeting feature).
- Bulk PATCH nhiều item cùng lúc (dùng `PUT /agendas` — UC-MM-09 — nếu cần sửa nhiều item).
- Di chuyển agenda item sang meeting khác.
- Optimistic locking bằng version field (dùng pessimistic lock trong transaction).
- Gửi notification/email ngay sau khi PATCH thành công (deferred).
- Ghi `meeting_events` bắt buộc (audit chính dùng `audit_logs`, đồng nhất UC-MM-09 OOS-010).

### 17.1 EARS Guardrails

```text
OOS-001: THE system SHALL NOT cho phép cập nhật status, actualDurationMinutes, hoặc resultNote qua PATCH single-item.

OOS-002: THE system SHALL NOT hỗ trợ PATCH nhiều item trong một request (dùng PUT cho bulk save).

OOS-003: THE system SHALL NOT gửi notification/email ngay sau khi PATCH thành công.

OOS-004: THE system SHALL NOT dùng optimistic locking version field cho agenda item.

OOS-005: THE system SHALL NOT cho phép agendaId thuộc meeting khác được cập nhật qua path của meeting hiện tại.
```

---

## 18. Clarifications Needed

| # | Vấn đề | Trạng thái | Ghi chú |
|---|---|---|---|
| CL-01 | Dùng 4 permission tách rời (`meeting.agenda.create/read/update/delete`) như API Contract gốc UC-26..29, hay tiếp tục dùng `meeting.agenda.write`/`meeting.agenda.read` như UC-MM-09 đã build? | Resolved: Dùng `meeting.agenda.write`/`meeting.agenda.read` để nhất quán với module đã triển khai, tránh 2 mô hình permission song song cho cùng 1 bảng. | Sai khác có chủ đích so với API Contract gốc |
| CL-02 | PATCH có nên cho phép sửa `status` sang `in_progress`/`done`/`skipped` như mẫu request trong API Contract gốc? | Resolved: Không. Đồng nhất với OOS-009 của UC-MM-09 — runtime status thuộc in-meeting feature. | FR-003, BR4 |
| CL-03 | Khi `agendaOrder` thay đổi, có cần optimistic locking (version/updated_at check) để tránh 2 người cùng sửa order? | Resolved: Không thêm version field mới. Dùng `pessimistic_write` lock ở mức meeting row (chung với PUT) — đủ để serialize ghi, tránh over-engineering ở MVP. | BR9 |
| CL-04 | Lỗi khi agendaId không tồn tại nên là 404 (resource lookup) hay 422 (giống `AGENDA_ITEM_NOT_IN_MEETING` của PUT)? | Resolved: 404 `AGENDA_ITEM_NOT_FOUND` — đúng ngữ nghĩa REST khi resource identifier nằm trên path, theo bảng HTTP status convention của CLAUDE.md mục 8.3. | BR10 |
| CL-05 | Request body rỗng `{}` nên xử lý thế nào? | Resolved: Từ chối với 400 `AGENDA_UPDATE_PAYLOAD_EMPTY` thay vì coi là no-op ngầm, để tránh nhầm lẫn phía client (client cần biết request của họ không có tác dụng). | BR11 |

---

## 19. Traceability Matrix

| UC-MM-10 Requirement | FR ID | AC ID | Business Rule | Error Code |
|---|---|---|---|---|
| Partial update | FR-001, FR-002, FR-003 | AC-001, AC-012 | BR3, BR4 | AGENDA_INVALID_PAYLOAD |
| Order shift | FR-004 | AC-002 | BR5 | AGENDA_INVALID_ORDER |
| Owner validate | FR-005 | AC-003, AC-010 | BR7 | AGENDA_OWNER_NOT_PARTICIPANT |
| Duration revalidate | FR-006, FR-024 | AC-009 | BR6 | AGENDA_DURATION_OVERFLOW |
| Audit | FR-007 | AC-001 | BR8 | - |
| No-op | FR-008 | AC-013 | BR12 | - |
| Shared lock với PUT | FR-009 | AC-014 | BR9 | - |
| Pending_approval + scheduled only | FR-010, FR-011, FR-017 | AC-008 | BR2 | AGENDA_MEETING_STATUS_BLOCKED |
| Unauthenticated | FR-013 | AC-005 | - | UNAUTHORIZED |
| Write forbidden | FR-014 | AC-004 | BR1 | AGENDA_WRITE_FORBIDDEN |
| Meeting not found | FR-015 | - | - | MEETING_NOT_FOUND |
| Item not found | FR-016 | AC-006, AC-007 | BR10 | AGENDA_ITEM_NOT_FOUND |
| Time invalid | FR-018 | - | - | MEETING_TIME_INVALID_FOR_AGENDA |
| Title/description/duration validation | FR-019-022 | - | - | AGENDA_TITLE_REQUIRED / AGENDA_TITLE_TOO_LONG / AGENDA_DESCRIPTION_TOO_LONG / AGENDA_INVALID_DURATION |
| Order validation | FR-025 | - | - | AGENDA_INVALID_ORDER |
| Field whitelist | FR-026 | AC-012 | BR4 | AGENDA_INVALID_PAYLOAD |
| Empty payload | FR-027 | AC-011 | BR11 | AGENDA_UPDATE_PAYLOAD_EMPTY |
| Rollback | FR-028 | AC-015 | - | INTERNAL_ERROR |
| Validation priority | FR-029 | - | - | - |
