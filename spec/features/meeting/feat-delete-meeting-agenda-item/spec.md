# Feature Specification: Xóa agenda item (Delete Single Meeting Agenda Item)

- **Feature ID**: UC-MM-11
- **Feature Name**: Xóa agenda item (tương ứng UC-29 trong Feature Table / API Contract v1.0)
- **Module / Domain**: meetings
- **Created Date**: 2026-07-17
- **Status**: Draft
- **Source Documents**:
  - `docs/API_CONTRACT_v1.0_with_system_roles.md` — UC-29 (Xóa agenda)
  - `spec/features/meeting/feat-create-meeting-agenda/spec.md` — UC-MM-09 (Tạo chương trình họp, atomic replace)
  - `spec/features/meeting/feat-update-meeting-agenda-item/spec.md` — UC-MM-10 (Chỉnh sửa agenda item, feature song song)
  - Database v3.2 Compact (39 tables)
  - CLAUDE.md — Backend Agent Guide

---

## 📝 CHANGELOG & REVISION HISTORY
| Ngày cập nhật | Tóm tắt thay đổi | Các dòng thay đổi |
| :--- | :--- | :--- |
| 2026-07-17 | Tạo spec lần đầu cho UC-MM-11 (UC-29 Xóa agenda). Hybrid: giữ PUT atomic-replace (UC-MM-09) và bổ sung DELETE single-item | Toàn bộ file |
| 2026-07-26 | Đính chính hiện trạng (BE-06): code controller từng khai route thiếu prefix `meetings/` (chạy nhầm ở root path), đã sửa lại `meetings.controller.ts` ngày 2026-07-26 cho khớp đúng path `DELETE /meetings/{meetingId}/agendas/{agendaId}` đã đặc tả ở FR-001 (mục 6.1) của spec này. Spec không thay đổi nội dung, chỉ code được sửa. | Ghi chú, không đổi nội dung đặc tả |

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

Tương tự UC-MM-10, `PUT /meetings/{id}/agendas` (UC-MM-09) hiện đã đủ khả năng "xóa" một agenda item về mặt hành vi — FE chỉ cần gửi lại toàn bộ danh sách item **trừ** item muốn xóa. Tuy nhiên, Feature Table gốc (UC-29 — Xóa agenda) và `docs/API_CONTRACT_v1.0_with_system_roles.md` đặc tả riêng một endpoint `DELETE /meetings/{meetingId}/agendas/{agendaId}` để xóa nhanh **một** item mà không cần gửi lại toàn bộ payload.

Theo quyết định Hybrid (đã áp dụng thống nhất với UC-MM-10): giữ `PUT /agendas` cho bulk save, bổ sung `DELETE /agendas/{agendaId}` cho thao tác xóa nhanh 1 dòng (ví dụ nút "Xóa" trên từng dòng trong bảng agenda ở FE).

### 1.2 Mục tiêu

Cho phép Host/Organizer/Admin (có quyền) xóa **một** agenda item cụ thể khỏi meeting đang `scheduled`, tự động renormalize thứ tự các item còn lại, mà không ảnh hưởng tới field khác của các item đó.

### 1.3 Giá trị mang lại

- Xóa nhanh 1 dòng agenda mà không cần gửi lại toàn bộ danh sách (giảm payload, giảm rủi ro submit nhầm state cũ đè lên state mới).
- Phù hợp thao tác UX phổ biến: nút "Xóa" (icon thùng rác) trên từng dòng trong bảng.

### 1.4 Giả định

- `meeting_agendas` đã tồn tại (không tạo bảng mới), dùng chung entity `MeetingAgendaEntity` với UC-MM-09/UC-MM-10.
- Xóa là **hard delete** (giống cơ chế DELETE trong atomic replace của UC-MM-09 — bảng `meeting_agendas` không có `deleted_at`).
- `PUT /meetings/{id}/agendas` (UC-MM-09) và `PATCH /meetings/{id}/agendas/{agendaId}` (UC-MM-10) tiếp tục hoạt động song song.

### 1.5 Cần làm rõ

Xem mục 18 (Clarifications Needed).

---

## 2. Actors & Permissions

### 2.1 Danh sách actor

| Actor | Vai trò | Quyền / Trách nhiệm chính |
|---|---|---|
| Internal Employee | Organizer hoặc Host của meeting | Được DELETE agenda item nếu `currentUser.id === meetings.organizer_id` hoặc `=== meetings.host_id` |
| Senior Admin / System Admin | Quản trị viên | Được DELETE thay host nếu có permission `meeting.agenda.write` |
| Participant (internal) | Người tham gia nội bộ | Chỉ đọc qua `GET /agendas` (UC-MM-09). Không được DELETE |
| External Participant | Khách mời ngoài tổ chức | Không có JWT, không gọi API này |

### 2.2 Role & Permission Rules

- Dùng chung permission `meeting.agenda.write` với UC-MM-09/UC-MM-10 (không tách riêng `meeting.agenda.delete` như API Contract gốc — đồng nhất lý do đã nêu ở UC-MM-10 mục 18 CL-01).
- Host resolution: `meetings.host_id` là nguồn chính thức.

### 2.3 Actor Constraints

- Phải đăng nhập hợp lệ.
- Write: `meetings.organizer_id` hoặc `meetings.host_id`, hoặc admin có permission `meeting.agenda.write`.
- Meeting phải tồn tại, không bị xóa mềm.
- Meeting phải ở trạng thái `scheduled`.
- `agendaId` trong path phải thuộc đúng `meetingId` trong path.

---

## 3. Preconditions

| ID | Mô tả |
|---|---|
| PRE1 | Người dùng đã đăng nhập hợp lệ, JWT còn hiệu lực. |
| PRE2 | Người dùng có quyền write (organizer/host/admin có permission `meeting.agenda.write`). |
| PRE3 | Meeting tồn tại, không bị xóa mềm. |
| PRE4 | Meeting đang ở trạng thái `scheduled`. |
| PRE5 | Agenda item với `agendaId` tồn tại và thuộc `meetingId`. |

---

## 4. Postconditions

| ID | Mô tả |
|---|---|
| POST1 | Agenda item bị xóa vĩnh viễn (hard delete) khỏi `meeting_agendas`. |
| POST2 | `agenda_order` của các item còn lại trong meeting được renormalize để tiếp tục sequential 1..N, không gap. |
| POST3 | `audit_logs` được ghi với `action_type = 'agenda_item_deleted'`. |
| POST4 | Response trả về `{ deleted: true, agendaId, meetingId }` cùng tổng hợp thời lượng còn lại (`totalPlannedDurationMinutes`, `remainingDurationMinutes`) sau khi xóa. |
| POST5 | Không có item nào khác bị đổi field nghiệp vụ (title/description/owner/duration), chỉ `agenda_order` bị renormalize nếu cần. |

---

## 5. User Stories

- **US-01**: Với vai trò Host, tôi muốn xóa nhanh một agenda item không còn cần thiết mà không phải soạn lại toàn bộ danh sách.
- **US-02**: Với vai trò Host, tôi muốn sau khi xóa, thứ tự các item còn lại tự động được đánh số lại liên tục (không có khoảng trống).
- **US-03**: Với vai trò Organizer, tôi muốn hệ thống từ chối xóa nếu meeting không còn ở trạng thái có thể chỉnh sửa (vd đã hủy, đã diễn ra).

---

## 6. Functional Requirements

### 6.1 Core Requirements

```text
FR-001: THE system SHALL cho phép Host/Organizer/Admin (có permission meeting.agenda.write) xóa một agenda item cụ thể qua DELETE /meetings/{meetingId}/agendas/{agendaId}.

FR-002: THE system SHALL thực hiện hard delete (xóa vĩnh viễn record khỏi meeting_agendas), đồng nhất với cơ chế xóa item trong atomic replace của UC-MM-09 (không có deleted_at trên bảng này).

FR-003: THE system SHALL renormalize agenda_order của các item còn lại trong cùng meeting sau khi xóa, đảm bảo thứ tự sequential 1..N liên tục, không gap.
```

### 6.2 Event-driven Requirements

```text
FR-004: WHEN agenda item được xóa thành công, THE system SHALL ghi audit_logs với action_type = 'agenda_item_deleted', entity_type = 'meeting_agenda', entity_id = agendaId, old_value_json chứa snapshot đầy đủ của item bị xóa, new_value_json = null, kèm danh sách agendaId khác bị renormalize order (nếu có).

FN-005: WHEN DELETE và PUT /agendas (UC-MM-09) hoặc PATCH /agendas/{agendaId} (UC-MM-10) được gọi đồng thời trên cùng meeting, THE system SHALL dùng chung cơ chế lock ở mức meeting row (pessimistic_write trong transaction) để đảm bảo các luồng ghi không lost-update lẫn nhau.

FR-006: WHEN item bị xóa là item cuối cùng của agenda (agenda trở thành rỗng), THE system SHALL cho phép, trả danh sách rỗng tương đương với PUT items = [] (đồng nhất FR-005/BR11 của UC-MM-09).
```

### 6.3 State-driven Requirements

```text
FR-007: WHILE meeting đang ở trạng thái scheduled, THE system SHALL cho phép DELETE agenda item.

FR-008: WHILE meeting đang ở trạng thái pending_approval, in_progress, completed, cancelled, THE system SHALL chặn DELETE agenda item (đồng nhất BR2/BR7 của UC-MM-09).
```

### 6.4 Optional Feature Requirements

```text
FR-009: WHERE feature notification cần thông báo khi agenda item bị xóa, feature đó có thể đọc audit_logs action = 'agenda_item_deleted' (deferred, không implement trong UC-MM-11).
```

### 6.5 Unwanted Behavior Requirements

```text
FR-010: IF người dùng chưa đăng nhập, THEN THE system SHALL trả 401 UNAUTHORIZED.

FR-011: IF người dùng không có quyền write, THEN THE system SHALL trả 403 AGENDA_WRITE_FORBIDDEN, không xóa dữ liệu.

FR-012: IF meeting không tồn tại hoặc đã bị xóa mềm, THEN THE system SHALL trả 404 MEETING_NOT_FOUND.

FR-013: IF agendaId không tồn tại hoặc không thuộc meetingId trong path, THEN THE system SHALL trả 404 AGENDA_ITEM_NOT_FOUND. Áp dụng cho cả trường hợp gọi DELETE lần thứ hai trên cùng agendaId đã bị xóa trước đó (idempotency: lần đầu 200, lần sau 404 — không coi là thành công ngầm).

FR-014: IF meeting không ở trạng thái scheduled, THEN THE system SHALL trả 409 AGENDA_MEETING_STATUS_BLOCKED.

FR-015: IF transaction thất bại trong quá trình xóa/renormalize, THEN THE system SHALL rollback toàn bộ, item và agenda_order của các item khác giữ nguyên như trước khi xóa.

FR-016: IF một điều kiện validation thất bại, THEN THE system SHALL trả lỗi đầu tiên theo thứ tự ưu tiên: Authentication (401) -> Route param (meetingId/agendaId) invalid UUID (400) -> Meeting not found (404) -> Agenda item not found (404) -> Write permission (403) -> Meeting status blocked (409).
```

### 6.6 Traceability

| Requirement ID | EARS Pattern | Ghi chú |
|---|---|---|
| FR-001..003 | Ubiquitous | Hard delete + renormalize |
| FR-004..006 | Event-driven | Audit, shared lock, empty agenda |
| FR-007..008 | State-driven | Chỉ scheduled |
| FR-009 | Optional | Notification deferred |
| FR-010..016 | Unwanted Behavior | Error handling đầy đủ |

---

## 7. Business Rules

| ID | Mô tả |
|---|---|
| BR1 | Chỉ Host/Organizer (`meetings.host_id`/`meetings.organizer_id`) hoặc Admin có permission `meeting.agenda.write` được DELETE. Dùng chung permission với UC-MM-09/UC-MM-10. |
| BR2 | Chỉ cho phép DELETE khi `meeting.status = scheduled`. |
| BR3 | Xóa là hard delete, không có soft-delete/`deleted_at` trên `meeting_agendas`. |
| BR4 | Sau khi xóa, `agenda_order` của các item còn lại được renormalize liên tục 1..N (không gap). |
| BR5 | Mọi thao tác xóa phải ghi audit log riêng biệt (`action_type = 'agenda_item_deleted'`), khác với `'agenda_saved'` của PUT và `'agenda_item_updated'` của PATCH. |
| BR6 | DELETE, PATCH (UC-MM-10), PUT (UC-MM-09) dùng chung lock ở mức meeting row (`pessimistic_write`) trong transaction để tránh race condition. |
| BR7 | `agendaId` phải thuộc đúng `meetingId` trong path — nếu không tồn tại hoặc thuộc meeting khác, hoặc đã bị xóa trước đó, trả 404 `AGENDA_ITEM_NOT_FOUND`. |
| BR8 | DELETE không kiểm tra duration overflow (xóa item chỉ làm giảm tổng thời lượng, không bao giờ gây overflow). |
| BR9 | Cho phép xóa hết toàn bộ agenda item của meeting (agenda trở thành rỗng), tương đương hành vi `PUT items = []` của UC-MM-09. |
| BR10 | DELETE **không** kiểm tra item có đang được owner nào tham chiếu ở nơi khác ngoài `meeting_agendas` (không có bảng con phụ thuộc `agendaId` trong DB v3.2 Compact) — không cần cascade check. |

---

## 8. Validation Rules

### 8.1 DTO-level Validation (trả 400)

| Field | Điều kiện | Error code |
|---|---|---|
| `meetingId` (path) | Invalid UUID | `AGENDA_INVALID_PAYLOAD` |
| `agendaId` (path) | Invalid UUID | `AGENDA_INVALID_PAYLOAD` |

Endpoint DELETE không có request body — không cần DTO body validation.

### 8.2 Service-level Validation (trả 403/404/409)

| Rule | Error code | HTTP status | Thứ tự ưu tiên |
|---|---|---|---|
| Unauthenticated | `UNAUTHORIZED` | 401 | 1 |
| Meeting không tồn tại/deleted | `MEETING_NOT_FOUND` | 404 | 2 |
| Agenda item không tồn tại/không thuộc meeting/đã bị xóa trước đó | `AGENDA_ITEM_NOT_FOUND` | 404 | 3 |
| User không có quyền write | `AGENDA_WRITE_FORBIDDEN` | 403 | 4 |
| Meeting không ở `scheduled` | `AGENDA_MEETING_STATUS_BLOCKED` | 409 | 5 |

### 8.3 Normalization

- Sau khi xóa, các item có `agenda_order` lớn hơn item vừa xóa được giảm đi 1 (shift-left), giữ nguyên thứ tự tương đối.

---

## 9. API Contract Draft

### 9.1 DELETE /api/v1/meetings/{meetingId}/agendas/{agendaId}

Không có request body.

**Success Response (200):**

```json
{
  "success": true,
  "message": "Xoa muc agenda thanh cong",
  "data": {
    "deleted": true,
    "agendaId": "c3d4e5f6-a7b8-9012-cdef-123456789012",
    "meetingId": "a1b2c3d4-e5f6-7890-abcd-ef1234567890",
    "totalPlannedDurationMinutes": 35,
    "remainingDurationMinutes": 25,
    "remainingItemCount": 2
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

**Meeting Status Blocked (409):**
```json
{
  "code": "AGENDA_MEETING_STATUS_BLOCKED",
  "message": "Chỉ có thể chỉnh sửa chương trình họp khi cuộc họp đang ở trạng thái Đã lên lịch.",
  "details": { "meetingId": "uuid", "currentStatus": "cancelled", "allowedStatus": "scheduled" }
}
```

---

## 10. Data Model Impact

### 10.1 Entity liên quan

| Entity / Table | Vai trò | Ghi chú |
|---|---|---|
| `meetings` | Kiểm tra trạng thái, quyền | Chỉ đọc |
| `meeting_agendas` | Bảng chính: xóa 1 item + renormalize order các item còn lại | Ghi: delete + update |
| `audit_logs` | Ghi audit cho DELETE | Ghi: insert |

### 10.2 Kết luận

- Dùng lại `MeetingAgendaEntity` đã có từ UC-MM-09. **Không thêm bảng, không thêm cột.**
- Không có bảng nào khác trong DB v3.2 Compact có FK trực tiếp tới `meeting_agendas.id`, nên không cần cascade delete/check ngoài phạm vi bảng này.

---

## 11. Authorization Rules

| Endpoint | Minimum Role | Permission | Ghi chú |
|---|---|---|---|
| DELETE /meetings/{id}/agendas/{agendaId} | Host/Organizer | `meeting.agenda.write` | Cùng permission với PUT (UC-MM-09) và PATCH (UC-MM-10) |

---

## 12. Transaction Boundary

DELETE phải thực hiện trong một database transaction, **dùng chung lock resource với PUT/PATCH**:

1. **BEGIN TRANSACTION**
2. Load meeting với `pessimistic_write` lock (cùng cơ chế PUT/PATCH dùng)
3. Validate: meeting tồn tại, không deleted, status = `scheduled`
4. Validate: user có quyền write
5. Load agenda item theo `id = agendaId AND meeting_id = meetingId`; nếu không có → 404 `AGENDA_ITEM_NOT_FOUND`
6. Snapshot dữ liệu item (cho audit `old_value_json`)
7. `DELETE FROM meeting_agendas WHERE id = agendaId`
8. Load các item còn lại có `agenda_order > item.agendaOrder`, `UPDATE agenda_order = agenda_order - 1` cho từng item (renormalize shift-left)
9. Tính lại tổng `plannedDurationMinutes` còn lại so với meeting duration (chỉ để trả về response, không cần validate vì xóa luôn làm giảm tổng)
10. Ghi `audit_logs` (`action_type = 'agenda_item_deleted'`, `old_value_json` = snapshot, `new_value_json` = null)
11. **COMMIT TRANSACTION**
12. Nếu bất kỳ bước nào fail → **ROLLBACK**, trả lỗi tương ứng

---

## 13. Error Handling

### 13.1 Error Code Table

| HTTP Status | Error Code | Ý nghĩa |
|---|---|---|
| 401 | `UNAUTHORIZED` | Chưa đăng nhập |
| 400 | `AGENDA_INVALID_PAYLOAD` | `meetingId`/`agendaId` không phải UUID hợp lệ |
| 404 | `MEETING_NOT_FOUND` | meetingId sai/deleted |
| 404 | `AGENDA_ITEM_NOT_FOUND` | agendaId sai, không thuộc meeting, hoặc đã bị xóa trước đó |
| 403 | `AGENDA_WRITE_FORBIDDEN` | Không có quyền write |
| 409 | `AGENDA_MEETING_STATUS_BLOCKED` | Meeting không ở `scheduled` |
| 500 | `INTERNAL_ERROR` | Lỗi server |

---

## 14. Audit / Notification Considerations

### 14.1 Audit Log

| Field | Giá trị |
|---|---|
| `actionType` | `agenda_item_deleted` |
| `userId` | Người thực hiện |
| `entityType` | `meeting_agenda` |
| `entityId` | `agendaId` (đã bị xóa — vẫn ghi lại id để tra cứu lịch sử) |
| `oldValueJson` | Snapshot đầy đủ item trước khi xóa (`title`, `description`, `ownerId`, `plannedDurationMinutes`, `agendaOrder`, `status`) |
| `newValueJson` | `null` |
| `severity` | `info` |

### 14.2 Notification

Không implement notification trong UC-MM-11 (đồng nhất OOS-003/OOS-006 của UC-MM-09, deferred).

---

## 15. Acceptance Criteria

### 15.1 Happy Path

```text
AC-001:
Given một meeting scheduled có 3 agenda item (order 1, 2, 3), Host của meeting gửi DELETE cho item order = 2,
When request được xử lý,
Then hệ thống xóa item đó, item order = 3 được renormalize thành order = 2, danh sách còn lại 2 item (order 1, 2), ghi audit log 'agenda_item_deleted'.

AC-002:
Given một meeting chỉ có 1 agenda item,
When Host gửi DELETE cho item đó,
Then hệ thống xóa thành công, agenda của meeting trở thành rỗng (tương đương PUT items = []).

AC-003:
Given một meeting có 5 agenda item, Organizer gửi DELETE cho item cuối cùng (order = 5),
When request được xử lý,
Then hệ thống xóa thành công, 4 item còn lại giữ nguyên order 1-4 (không cần renormalize vì không có item nào sau nó).
```

### 15.2 Authorization Cases

```text
AC-004:
Given người dùng là participant thường,
When gửi DELETE agenda item,
Then hệ thống trả 403 AGENDA_WRITE_FORBIDDEN, item không bị xóa.

AC-005:
Given người dùng chưa đăng nhập,
When gửi DELETE agenda item,
Then hệ thống trả 401 UNAUTHORIZED.
```

### 15.3 Not Found / Idempotency Cases

```text
AC-006:
Given agendaId không tồn tại trong DB,
When Host gửi DELETE,
Then hệ thống trả 404 AGENDA_ITEM_NOT_FOUND.

AC-007:
Given agendaId tồn tại nhưng thuộc meeting khác,
When Host gửi DELETE qua path của meeting hiện tại,
Then hệ thống trả 404 AGENDA_ITEM_NOT_FOUND, không xóa item của meeting khác.

AC-008:
Given Host gửi DELETE thành công cho một agendaId (lần 1: 200),
When Host gửi lại DELETE với cùng agendaId (lần 2),
Then hệ thống trả 404 AGENDA_ITEM_NOT_FOUND ở lần 2 (không coi là thành công ngầm).
```

### 15.4 Business Rule / State Cases

```text
AC-009:
Given meeting ở trạng thái completed,
When Host gửi DELETE agenda item,
Then hệ thống trả 409 AGENDA_MEETING_STATUS_BLOCKED, item không bị xóa.

AC-010:
Given meeting ở trạng thái cancelled,
When Host gửi DELETE agenda item,
Then hệ thống trả 409 AGENDA_MEETING_STATUS_BLOCKED.

AC-011:
Given meeting ở trạng thái in_progress,
When Host gửi DELETE agenda item,
Then hệ thống trả 409 AGENDA_MEETING_STATUS_BLOCKED (đồng nhất FR-013 của UC-MM-09 — không cho chỉnh sửa agenda khi đang họp).
```

### 15.5 Concurrency Cases

```text
AC-012:
Given một DELETE request đang xử lý và một PUT request (UC-MM-09) trên cùng meeting xảy ra gần như đồng thời,
When cả hai transaction cùng cố gắng lock meeting row,
Then một transaction chạy trước sẽ hoàn tất, transaction sau chờ lock rồi áp dụng thay đổi của mình lên state mới nhất.

AC-013:
Given hai DELETE request gửi đồng thời cho cùng agendaId,
When cả hai transaction cùng cố gắng lock meeting row,
Then request đầu tiên xóa thành công (200), request thứ hai nhận 404 AGENDA_ITEM_NOT_FOUND (item đã không còn tồn tại khi transaction thứ hai load lại).

AC-014:
Given transaction DELETE thất bại giữa chừng (ví dụ lỗi DB khi renormalize order các item còn lại),
When hệ thống rollback,
Then item bị xóa được khôi phục (rollback DELETE) và agenda_order của các item khác giữ nguyên như trước.
```

### 15.6 Acceptance Criteria Traceability

| AC ID | Requirement ID liên quan | Business Rule |
|---|---|---|
| AC-001 | FR-001, FR-003, FR-004 | BR3, BR4, BR5 |
| AC-002 | FR-006 | BR9 |
| AC-003 | FR-003 | BR4 |
| AC-004 | FR-011 | BR1 |
| AC-005 | FR-010 | - |
| AC-006 | FR-013 | BR7 |
| AC-007 | FR-013 | BR7 |
| AC-008 | FR-013 | BR7 |
| AC-009 | FR-008, FR-014 | BR2 |
| AC-010 | FR-008, FR-014 | BR2 |
| AC-011 | FR-008, FR-014 | BR2 |
| AC-012 | FR-005 | BR6 |
| AC-013 | FR-005, FR-013 | BR6, BR7 |
| AC-014 | FR-015 | - |

---

## 16. Edge Cases

| Edge Case | Mô tả | Xử lý |
|---|---|---|
| Xóa item ở giữa danh sách | Các item sau item bị xóa cần dịch order xuống 1 | Renormalize shift-left trong cùng transaction |
| Xóa item cuối cùng của danh sách (order = N) | Không có item nào sau nó | Không cần renormalize, chỉ xóa |
| Xóa hết toàn bộ item (xóa lần lượt từng item) | Agenda trở thành rỗng | Cho phép, response `remainingItemCount = 0` |
| Xóa đồng thời 2 item khác nhau bởi 2 user khác nhau | Cả hai đều hợp lệ tại thời điểm gửi | Transaction thứ 2 chờ lock, áp dụng renormalize trên state đã cập nhật bởi transaction 1 — kết quả cuối cùng vẫn đúng 1..N liên tục |
| DELETE cùng agendaId gọi 2 lần liên tiếp (double-click) | Lần 2 item đã không còn | 404 `AGENDA_ITEM_NOT_FOUND` ở lần 2 — không phải lỗi 500, không phải 200 giả |
| DELETE khi meeting bị hủy bởi request khác ngay trước đó | State đổi giữa lúc user bấm nút xóa | Lock + re-check status trong transaction → 409 nếu đã đổi |
| DELETE item đang là owner của chính agenda đó (item tự tham chiếu) | Không áp dụng — `owner_id` trỏ tới `users.id`, không trỏ tới `meeting_agendas.id` | Không có edge case này |

---

## 17. Out of Scope

- Soft delete / khôi phục item đã xóa (không có `deleted_at` trên bảng, không có "thùng rác" cho agenda item).
- Bulk DELETE nhiều item cùng lúc (dùng `PUT /agendas` — UC-MM-09 — với danh sách đã loại bỏ các item cần xóa).
- Gửi notification/email ngay sau khi xóa thành công (deferred).
- Ghi `meeting_events` bắt buộc (audit chính dùng `audit_logs`, đồng nhất UC-MM-09 OOS-010).
- Kiểm tra/cascade xóa dữ liệu liên quan ở bảng khác (không tồn tại FK nào trỏ tới `meeting_agendas.id` trong DB v3.2 Compact).

### 17.1 EARS Guardrails

```text
OOS-001: THE system SHALL NOT thực hiện soft delete cho meeting_agendas (bảng không có deleted_at).

OOS-002: THE system SHALL NOT hỗ trợ bulk DELETE nhiều item trong một request (dùng PUT cho bulk save/xóa nhiều item).

OOS-003: THE system SHALL NOT gửi notification/email ngay sau khi DELETE thành công.

OOS-004: THE system SHALL NOT cho phép agendaId thuộc meeting khác bị xóa qua path của meeting hiện tại.

OOS-005: THE system SHALL NOT khôi phục lại item đã xóa (không có API "undo").
```

---

## 18. Clarifications Needed

| # | Vấn đề | Trạng thái | Ghi chú |
|---|---|---|---|
| CL-01 | Dùng permission tách riêng `meeting.agenda.delete` như API Contract gốc, hay dùng chung `meeting.agenda.write`? | Resolved: Dùng chung `meeting.agenda.write`, đồng nhất với UC-MM-09/UC-MM-10 — xem lý do chi tiết ở `feat-update-meeting-agenda-item/spec.md` mục 18 CL-01. | BR1 |
| CL-02 | Gọi DELETE 2 lần liên tiếp trên cùng `agendaId` (double-click) nên trả gì ở lần 2? | Resolved: 404 `AGENDA_ITEM_NOT_FOUND` — không coi là thành công ngầm (idempotent nhưng không "giả vờ thành công"), giúp FE phát hiện race condition/double-submit rõ ràng. | BR7, AC-008 |
| CL-03 | Xóa item có cần kiểm tra duration overflow không? | Resolved: Không — xóa item luôn làm giảm tổng thời lượng, không bao giờ gây overflow, nên bỏ qua bước validate này (khác với PUT/PATCH). | BR8 |
| CL-04 | Xóa toàn bộ agenda (xóa lần lượt hết item) có được phép không? | Resolved: Có, tương đương hành vi `PUT items = []` đã được UC-MM-09 chấp nhận (BR11 của UC-MM-09). | BR9, AC-002 |
| CL-05 | DELETE có cần dùng chung lock với PUT/PATCH không? | Resolved: Có — bắt buộc dùng chung `pessimistic_write` lock ở mức `meetings` row để 3 luồng ghi (PUT/PATCH/DELETE) không xung đột trên cùng bảng `meeting_agendas`. | BR6 |

---

## 19. Traceability Matrix

| UC-MM-11 Requirement | FR ID | AC ID | Business Rule | Error Code |
|---|---|---|---|---|
| Hard delete | FR-001, FR-002 | AC-001 | BR1, BR3 | - |
| Renormalize order | FR-003 | AC-001, AC-003 | BR4 | - |
| Audit | FR-004 | AC-001 | BR5 | - |
| Shared lock | FR-005 | AC-012, AC-013 | BR6 | - |
| Empty agenda cho phép | FR-006 | AC-002 | BR9 | - |
| Scheduled only | FR-007, FR-008, FR-014 | AC-009, AC-010, AC-011 | BR2 | AGENDA_MEETING_STATUS_BLOCKED |
| Notification deferred | FR-009 | - | - | - |
| Unauthenticated | FR-010 | AC-005 | - | UNAUTHORIZED |
| Write forbidden | FR-011 | AC-004 | BR1 | AGENDA_WRITE_FORBIDDEN |
| Meeting not found | FR-012 | - | - | MEETING_NOT_FOUND |
| Item not found / idempotency | FR-013 | AC-006, AC-007, AC-008, AC-013 | BR7 | AGENDA_ITEM_NOT_FOUND |
| Rollback | FR-015 | AC-014 | - | INTERNAL_ERROR |
| Validation priority | FR-016 | - | - | - |
