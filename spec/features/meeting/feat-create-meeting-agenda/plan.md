# Implementation Plan: Tạo chương trình họp (Agenda)

- **Feature ID**: UC-MM-09
- **Created**: 2026-06-15
- **Status**: Draft

---

## 📝 CHANGELOG & REVISION HISTORY
| Ngày cập nhật | Tóm tắt thay đổi | Các dòng thay đổi |
| :--- | :--- | :--- |
| 2026-06-15 | Khởi tạo plan cho tính năng tạo chương trình họp | Toàn bộ file |

---

## 1. Feature Summary

Cho phép Host/Organizer tạo, cập nhật, xóa và sắp xếp agenda item cho một meeting đang ở trạng thái scheduled. Feature gồm:

- **GET** /api/v1/meetings/{meetingId}/agendas — Xem danh sách agenda (Host, Organizer, Internal Participant)
- **PUT** /api/v1/meetings/{meetingId}/agendas — Atomic replace toàn bộ agenda list (chỉ Host/Organizer/Admin)

Dùng bảng meeting_agendas có sẵn trong database v3.2 Compact. Không thêm bảng mới, không thay đổi schema.

---

## 2. Technical Context

- **Module**: meetings (src/modules/meetings/)
- **Framework**: NestJS, TypeORM, PostgreSQL v3.2 Compact (39 tables)
- **Auth**: JwtAuthGuard + PermissionsGuard
- **Entity hiện có**: MeetingAgendaEntity (đã có đầy đủ cột: id, meetingId, agendaOrder, title, description, ownerId, plannedDurationMinutes, actualDurationMinutes, resultNote, status, created_by, updated_by)
- **Service hiện có**: MeetingsService (cần thêm method: getAgendas, replaceAgendas)
- **Controller hiện có**: MeetingsController (cần thêm 2 endpoint)
- **DTO**: Cần tạo mới: AgendaItemDto, ReplaceAgendaDto, AgendaListResponseDto, ReplaceAgendaResponseDto
- **Audit**: Dùng AuditLogService hiện có (đã có trong codebase qua module administration)
- **Validator**: Dùng class-validator + ValidationPipe (đã có sẵn)
- **No external service**: Không dùng Redis, không dùng queue, không dùng notification trong feature này
- **Convention**: API prefix /api/v1, response format { success, message, data, meta }, HTTP codes theo AGENTS.md mục 8.3

---

## 3. Constitution Check

| Gate | Status | Ghi chú |
|---|---|---|
| DB Gate | PASS | Không thêm/xóa bảng, không đổi schema, entity đã có |
| Security Gate | PASS | JWT auth, user_id từ token, không log secret |
| Scope Gate | PASS | Đúng spec UC-MM-09, không mở rộng sang realtime/minutes/notification |
| Module Gate | PASS | Logic trong meetings module, audit qua AuditLogService import |
| API Gate | PASS | Response format chuẩn, HTTP codes đúng |
| Auth Gate | PASS | JwtAuthGuard + PermissionsGuard, user_id từ JWT |
| Test Gate | TBD | Unit test cho DTO validation + service methods + controller |

**Complexity Tracking**: Không có vi phạm principle nào. Đây là feature CRUD đơn giản, reuse toàn bộ entity/setup hiện có.



## 4. Scope Confirmation

### In scope

- Xem agenda của một meeting (Host, Organizer, Internal Participant)
- Host/Organizer tạo agenda cho meeting scheduled
- Host/Organizer cập nhật danh sách agenda item (atomic replace)
- Host/Organizer xóa item (thông qua atomic replace — item không trong request sẽ bị xóa)
- Host/Organizer reorder item (backend normalize genda_order theo thứ tự array)
- Validate tổng plannedDurationMinutes không vượt meeting duration
- Validate owner phải là internal participant của meeting
- Internal Participant được xem agenda read-only
- Ghi audit log cho thao tác create/update/delete/reorder
- No-op detection: nếu payload giống DB, trả 200 không ghi dữ liệu thừa
- Validation priority chain: 14 bước theo thứ tự ưu tiên

### Out of scope (không triển khai)

- UI drag-and-drop agenda reorder (backend support sẵn)
- Cập nhật ctual_duration_minutes, 
esult_note, status runtime (in_progress/done/skipped)
- Real-time timeline tracking trong in-meeting
- Tạo meeting mới / sửa thời gian meeting / thêm participant
- External participant làm owner / gọi API GET agenda
- Gửi email/notification khi lưu agenda
- Tạo bảng database mới
- AI đề xuất / import template
- Ghi meeting_events bắt buộc (audit dùng udit_logs)
- Tự động invalidate agenda khi meeting time thay đổi
- Notification/background job skeleton

---

## 5. Data Model Impact

### Entity hiện có: MeetingAgendaEntity (src/modules/meetings/entities/meeting-agenda.entity.ts)

**Không thay đổi schema.** Entity đã có đầy đủ các cột cần thiết.

| Column | Type | Ghi chú cho implement |
|---|---|---|
| id | UUID PK | Tự sinh |
| meeting_id | UUID FK | Liên kết meeting |
| genda_order | integer | Normalize từ array index + 1 |
| 	itle | varchar(255) | Required, trim trước khi lưu |
| description | text | Optional, max 2000 ký tự |
| owner_id | UUID FK nullable | Phải thuộc meeting_participants nếu có |
| planned_duration_minutes | integer | > 0 |
| status | varchar(30) NOT NULL DEFAULT 'planned' | DB dùng varchar, không dùng PostgreSQL enum. TypeORM dùng string column. TypeScript enum AgendaStatus đã có |
| created_by | UUID FK | Insert: currentUser.id |
| updated_by | UUID FK | Insert: currentUser.id; Update: giữ created_by, set updated_by = currentUser.id |

### Các bảng khác (chỉ đọc):

| Entity | Mục đích |
|---|---|
| meetings | Check status, duration, host_id, organizer_id |
| meeting_participants | Validate ownerId là internal participant |
| udit_logs | Ghi log sau mỗi PUT thành công |



## 6. API / Contract Plan

### Endpoint 1: GET /api/v1/meetings/{meetingId}/agendas

| Aspect | Detail |
|---|---|
| Method | GET |
| Path | /api/v1/meetings/{meetingId}/agendas |
| Auth | JwtAuthGuard + Permission meeting.agenda.read OR là participant/host/organizer của meeting |
| Permission | Host/Organizer/Internal Participant |
| Response 200 | { meetingId, meetingStatus, meetingDurationMinutes, totalPlannedDurationMinutes, remainingDurationMinutes, durationStatus (valid|overflow), isLockedForEditing, lockReason, items: [...] } |
| Response 403 | AGENDA_READ_FORBIDDEN |
| Response 404 | MEETING_NOT_FOUND |
| Sort | genda_order ASC |

### Endpoint 2: PUT /api/v1/meetings/{meetingId}/agendas

| Aspect | Detail |
|---|---|
| Method | PUT |
| Path | /api/v1/meetings/{meetingId}/agendas |
| Auth | JwtAuthGuard + Permission meeting.agenda.write OR là host/organizer |
| Permission | meetings.host_id hoặc meetings.organizer_id là nguồn chính thức |
| Request | { items: [{ id?, title, description?, ownerId?, plannedDurationMinutes }] } |
| Response 200 | { meetingId, totalPlannedDurationMinutes, remainingDurationMinutes, items: [...] } |
| Atomicity | Replace toàn bộ trong 1 transaction: delete items không trong request, update items có id, insert items không có id |
| No-op | Nếu payload giống DB: trả 200, không ghi dữ liệu thừa |

### DTO cần tạo

| DTO | File | Mục đích |
|---|---|---|
| AgendaItemDto | dto/agenda-item.dto.ts | Input: id?, title, description?, ownerId?, plannedDurationMinutes |
| ReplaceAgendaDto | dto/replace-agenda.dto.ts | Input: { items: AgendaItemDto[] } |
| AgendaListResponseDto | dto/agenda-list-response.dto.ts | Output cho GET |
| ReplaceAgendaResponseDto | dto/replace-agenda-response.dto.ts | Output cho PUT |
| AgendaItemResponseDto | dto/agenda-item-response.dto.ts | Output item (có thêm agendaOrder, status, ownerName) |

---


## 7. Authorization Plan

| Endpoint | Write Access | Read Access | Source of Truth | Error Code |
|---|---|---|---|---|
| GET /meetings/{id}/agendas | - | Internal Participant, Host, Organizer | meeting_participants.user_id, meetings.organizer_id, meetings.host_id | AGENDA_READ_FORBIDDEN (403) |
| PUT /meetings/{id}/agendas | meetings.host_id hoặc meetings.organizer_id, Admin có permission meeting.agenda.write | - | meetings.host_id (không dùng participant_role), meetings.organizer_id | AGENDA_WRITE_FORBIDDEN (403) |

**Rules:**
- Host resolution: Dùng meetings.host_id là nguồn chính thức, không dùng meeting_participants.participant_role
- Nếu host_id null, chỉ organizer được write
- Admin (Senior/System) có permission meeting.agenda.write được write
- External participant không có JWT nên không gọi API
- Anonymous: 401 UNAUTHORIZED

---

## 8. Business Logic Plan

### Core logic: MeetingsService.replaceAgendas(meetingId, dto, currentUser)

1. **Load meeting** (có SELECT FOR UPDATE hoặc optimistic lock)
2. **Validate preconditions**: meeting tồn tại, không deleted, status = scheduled
3. **Validate permission**: user là host_id, organizer_id, hoặc admin có permission
4. **Validate meeting time**: start_time và end_time không null, end_time > start_time
5. **No-op detection**: So sánh payload với DB theo các field: id, agendaOrder, title (sau trim), description, ownerId, plannedDurationMinutes, status = 'planned'
6. **DTO-level field validation**: title không empty, title <= 255, description <= 2000, plannedDurationMinutes > 0
7. **Business validation theo priority**:
   - items.length > 50 → AGENDA_ITEM_LIMIT_EXCEEDED
   - duplicate id trong request → AGENDA_DUPLICATE_ITEM_ID
   - item id không thuộc meeting → AGENDA_ITEM_NOT_IN_MEETING
   - ownerId không thuộc internal participants → AGENDA_OWNER_NOT_PARTICIPANT
   - tổng plannedDurationMinutes > meeting duration → AGENDA_DURATION_OVERFLOW
8. **Transaction**: Atomic replace — delete items không trong list, update items có id, insert items mới
9. **Normalize**: genda_order = index + 1
10. **Populate**: created_by, updated_by = currentUser.id (insert), giữ created_by cũ (update)
11. **Audit log**: Ghi udit_logs với action_type='agenda_saved', old_value_json, new_value_json

### Core logic: MeetingsService.getAgendas(meetingId, currentUser)

1. Load meeting + check existence
2. Check read permission
3. Query items sorted by genda_order ASC
4. Resolve ownerName từ users table (JOIN hoặc separate query)
5. Calculate metadata: totalPlannedDurationMinutes, remaining, durationStatus, isLockedForEditing

### No-op detection chi tiết

Một PUT được xem là no-op nếu sau khi normalize, danh sách request giống DB hiện tại theo các field: id, agendaOrder, title (sau trim), description, ownerId, plannedDurationMinutes, status ('planned'). Không so sánh field hệ thống (created_at, updated_at, created_by, updated_by, actual_duration_minutes, result_note).

---


## 9. Validation Plan

### 9.1 Validation Priority Chain (thứ tự kiểm tra)

| Step | Validation | HTTP | Error Code |
|---|---|---|---|
| 1 | Authentication/token | 401 | UNAUTHORIZED |
| 2 | meetingId invalid UUID | 400 | AGENDA_INVALID_PAYLOAD |
| 3 | Payload malformed / JSON invalid | 400 | AGENDA_INVALID_PAYLOAD |
| 4 | items missing/null/not array | 400 | AGENDA_ITEMS_REQUIRED |
| 5 | Meeting not found/deleted | 404 | MEETING_NOT_FOUND |
| 6 | Read/write permission | 403 | AGENDA_READ_FORBIDDEN / AGENDA_WRITE_FORBIDDEN |
| 7 | Meeting time invalid (start_time/end_time null, end <= start) | 409 | MEETING_TIME_INVALID_FOR_AGENDA |
| 8 | Meeting status blocked (not scheduled for write) | 409 | AGENDA_MEETING_STATUS_BLOCKED |
| 9 | Item limit exceeded (items.length > 50) | 422 | AGENDA_ITEM_LIMIT_EXCEEDED |
| 10 | Duplicate item id trong request | 422 | AGENDA_DUPLICATE_ITEM_ID |
| 11 | Item id không thuộc meeting hiện tại | 422 | AGENDA_ITEM_NOT_IN_MEETING |
| 12 | Field validation: title empty / title > 255 / description > 2000 / duration invalid | 422 | AGENDA_TITLE_REQUIRED / AGENDA_TITLE_TOO_LONG / AGENDA_DESCRIPTION_TOO_LONG / AGENDA_INVALID_DURATION |
| 13 | Owner not participant | 422 | AGENDA_OWNER_NOT_PARTICIPANT |
| 14 | Duration overflow (tổng planned > meeting duration) | 422 | AGENDA_DURATION_OVERFLOW |

### 9.2 DTO-level vs Service-level

**DTO-level (class-validator, trả 400):**
- items missing/null/not array → AGENDA_ITEMS_REQUIRED
- item không phải object → AGENDA_INVALID_PAYLOAD
- title missing/không phải string → AGENDA_INVALID_PAYLOAD
- plannedDurationMinutes không phải number → AGENDA_INVALID_PAYLOAD
- meetingId invalid UUID → AGENDA_INVALID_PAYLOAD

**Service-level (trả 403/404/409/422):**
- Quyền read/write, meeting không tồn tại, status block, duration overflow, title empty/dài, description dài, duration invalid, owner invalid, max items, duplicate id, item id wrong meeting

### 9.3 Normalization (service layer)

- genda_order = index + 1 (bỏ qua client gửi)
- status = 'planned' (mọi item tạo mới)
- created_by / updated_by: insert cả hai = currentUser.id; update giữ created_by, set updated_by
- owner_id = null được chấp nhận

---


## 10. Error Handling Plan

### 10.1 Error Codes

| HTTP | Error Code | Ý nghĩa |
|---|---|---|
| 401 | UNAUTHORIZED | Chưa đăng nhập / token hết hạn |
| 400 | AGENDA_INVALID_PAYLOAD | Payload malformed / UUID invalid / field sai type |
| 400 | AGENDA_ITEMS_REQUIRED | items missing hoặc items = null |
| 404 | MEETING_NOT_FOUND | meetingId sai hoặc meeting đã deleted |
| 403 | AGENDA_READ_FORBIDDEN | User không có quyền read |
| 403 | AGENDA_WRITE_FORBIDDEN | User không có quyền write |
| 409 | AGENDA_MEETING_STATUS_BLOCKED | Meeting không ở scheduled (write) |
| 409 | MEETING_TIME_INVALID_FOR_AGENDA | start_time/end_time null hoặc end <= start |
| 422 | AGENDA_TITLE_REQUIRED | Title trống sau trim |
| 422 | AGENDA_TITLE_TOO_LONG | Title > 255 ký tự |
| 422 | AGENDA_INVALID_DURATION | plannedDurationMinutes <= 0 |
| 422 | AGENDA_DESCRIPTION_TOO_LONG | description > 2000 ký tự |
| 422 | AGENDA_DUPLICATE_ITEM_ID | Trùng id trong request |
| 422 | AGENDA_ITEM_NOT_IN_MEETING | Item id không thuộc meeting |
| 422 | AGENDA_OWNER_NOT_PARTICIPANT | ownerId không thuộc meeting_participants |
| 422 | AGENDA_ITEM_LIMIT_EXCEEDED | items.length > 50 |
| 422 | AGENDA_DURATION_OVERFLOW | Tổng planned > meeting duration |
| 500 | INTERNAL_ERROR | Lỗi server không xác định |

---

## 11. Testing Strategy

### Unit tests (bắt buộc)

**DTO validation tests:**
- Validate `AgendaItemDto`: title required, title max length 255, plannedDurationMinutes > 0, description max 2000, ownerId valid UUID
- Validate `ReplaceAgendaDto`: items required, items phải là array

**Service tests** (`MeetingsService`):
- `getAgendas()`: trả danh sách sorted, trả empty [] nếu không có agenda
- `getAgendas()`: trả metadata (durationStatus valid/overflow, isLockedForEditing)
- `replaceAgendas()`: create/update/delete atomic replace
- `replaceAgendas()`: clear toàn bộ khi items = []
- `replaceAgendas()`: 409 khi meeting không ở scheduled
- `replaceAgendas()`: 409 khi meeting time invalid
- `replaceAgendas()`: 422 khi owner không phải participant
- `replaceAgendas()`: 422 khi duration overflow
- `replaceAgendas()`: 422 khi items > 50
- `replaceAgendas()`: 422 khi description > 2000
- `replaceAgendas()`: 422 khi title empty hoặc > 255
- `replaceAgendas()`: 200 no-op khi payload giống DB
- `replaceAgendas()`: transaction rollback khi lỗi

**Controller tests:**
- GET trả 200 với dữ liệu đúng format
- PUT trả 200 khi thành công
- PUT trả 403 khi không có quyền
- PUT trả 422 khi validation fail

### Integration tests (nếu có thời gian)
- Happy path: tạo meeting scheduled -> PUT agenda -> GET agenda -> verify items
- Permission: participant không thể PUT -> 403
- Audit: verify audit_logs có bản ghi sau PUT thành công

---

## 12. Implementation Phases

### Phase 1: DTO và Validation (T001-T003)
| Task | File | Mô tả |
|---|---|---|
| T001 | `src/modules/meetings/dto/agenda-item.dto.ts` | Tạo `AgendaItemDto` với class-validator decorators |
| T002 | `src/modules/meetings/dto/replace-agenda.dto.ts` | Tạo `ReplaceAgendaDto` |
| T003 | `src/modules/meetings/dto/agenda-response.dto.ts` | Tạo `AgendaListResponseDto`, `ReplaceAgendaResponseDto`, `AgendaItemResponseDto` |

### Phase 2: Service Logic (T004-T007)
| Task | File | Mô tả |
|---|---|---|
| T004 | `src/modules/meetings/services/meetings.service.ts` | Thêm `getAgendas()` method |
| T005 | `src/modules/meetings/services/meetings.service.ts` | Thêm `replaceAgendas()` method với atomic replace transaction |
| T006 | `src/modules/meetings/services/meetings.service.ts` | Thêm no-op detection + validation priority chain |
| T007 | `src/modules/meetings/services/meetings.service.ts` | Thêm audit log integration |

### Phase 3: Controller + Guards (T008-T011)
| Task | File | Mô tả |
|---|---|---|
| T008 | `src/modules/meetings/controllers/meetings.controller.ts` | Thêm GET /meetings/{id}/agendas endpoint |
| T009 | `src/modules/meetings/controllers/meetings.controller.ts` | Thêm PUT /meetings/{id}/agendas endpoint |
| T010 | - | Đảm bảo JwtAuthGuard + PermissionsGuard trên endpoint |
| T011 | - | Verify agenda write permission (host_id/organizer_id check) |

### Phase 4: Tests (T012-T015)
| Task | File | Mô tả |
|---|---|---|
| T012 | `src/modules/meetings/tests/meetings.service.spec.ts` | Unit test cho getAgendas + replaceAgendas |
| T013 | `src/modules/meetings/tests/meetings.controller.spec.ts` | Unit test cho 2 endpoint mới |
| T014 | - | DTO validation tests |
| T015 | - | Edge case tests (no-op, overflow, max items, empty items) |

---

## 13. Risks & Mitigations

| Risk | Impact | Mitigation |
|---|---|---|
| Race condition: cùng lúc 2 user PUT agenda | Ghi đè dữ liệu | Dùng SELECT FOR UPDATE hoặc optimistic lock khi load meeting trong transaction |
| Meeting time thay đổi giữa lúc user soạn agenda và submit | Duration overflow bị miss | Validate tại submit (không cache). GET trả durationStatus để FE cảnh báo |
| Double-click submit | Trùng dữ liệu | No-op detection: so sánh payload với DB, trả 200 không ghi thêm |
| Owner bị xóa khỏi meeting trước submit | Invalid owner | Validate ownerId tại submit, không cache |
| Meeting bị cancel trong lúc user soạn agenda | Ghi vào meeting cancelled | Kiểm tra lại meeting status tại submit |
| Payload quá lớn (100+ items) | Performance | Chặn > 50 items với AGENDA_ITEM_LIMIT_EXCEEDED |

---


## 14. Acceptance Criteria Traceability

| AC ID | FR ID | Mô tả | Loại |
|---|---|---|---|
| AC-001 | FR-001, FR-004, FR-008 | Host tạo agenda thành công | Happy path |
| AC-002 | FR-004 | Atomic replace agenda | Happy path |
| AC-003 | FR-005 | Clear agenda (empty items) | Happy path |
| AC-004 | FR-003 | Participant xem agenda | Read permission |
| AC-005 | FR-001, FR-002 | Host write agenda | Write permission |
| AC-006 | FR-018 | Participant bị chặn write (403) | Authorization |
| AC-007 | FR-017 | Unauthenticated bị chặn (401) | Authorization |
| AC-008 | FR-012, FR-020 | Meeting completed chặn write | Business rule |
| AC-009 | FR-012, FR-020 | Meeting cancelled chặn write | Business rule |
| AC-010 | FR-007, FR-027 | Duration overflow (422) | Validation |
| AC-011 | FR-006, FR-024 | Owner invalid (422) | Validation |
| AC-012 | FR-022 | Title empty (422) | Validation |
| AC-013 | FR-014, FR-023 | Duration <= 0 (422) | Validation |
| AC-014 | FR-010, FR-026 | Item thuộc meeting khác (422) | Data integrity |
| AC-015 | FR-004 | Item không id = create | Data integrity |
| AC-016 | FR-028 | Transaction rollback | Data integrity |
| AC-017 | FR-020 (extended) | Pending approval chặn write | Business rule |
| AC-018 | FR-032 | No-op PUT (200, không ghi thêm) | Idempotency |
| AC-019 | FR-021 | Items missing/null (400) | Validation |
| AC-020 | FR-029 | Items > 50 (422) | Validation |
| AC-021 | FR-031 | Meeting time invalid (409) | Validation |
| AC-022 | FR-030 | Description > 2000 (422) | Validation |
| AC-023 | FR-011, FR-013 | in_progress GET lock | State handling |
| AC-024 | FR-008 | Audit content correct | Data integrity |
| AC-025 | FR-010 | Item not in meeting (422) | Validation |
| AC-026 | FR-023a | Title > 255 (422) | Validation |

---

## 15. Implementation Notes

### File structure bổ sung cho module meetings

```
src/modules/meetings/
  dto/
    agenda-item.dto.ts            # NEW
    replace-agenda.dto.ts          # NEW
    agenda-response.dto.ts         # NEW (gộp cả list + reponse + item response)
  services/
    meetings.service.ts            # THÊM method getAgendas, replaceAgendas
  controllers/
    meetings.controller.ts         # THÊM 2 endpoint
  tests/
    meetings.service.spec.ts       # THÊM test cases
    meetings.controller.spec.ts    # THÊM test cases
```

### Reuse existing

- `MeetingAgendaEntity` — đã có, không cần sửa
- `MeetingEntity`, `MeetingStatus` — đã có
- `MeetingParticipantEntity` — đã có, để validate owner
- `UserEntity` — đã có, để resolve ownerName
- `AuditLogService` — đã có trong module administration
- JwtAuthGuard, PermissionsGuard — đã có trong common
- class-validator decorators — đã có sẵn

### Lưu ý quan trọng

1. **Không tạo module mới** — mọi thứ trong meetings module
2. **Không thay đổi entity** — meeting_agendas đã có đầy đủ cột
3. **Không dùng Redis** cho idempotency — chỉ so sánh payload với DB
4. **Không dùng notification/queue** — deferred
5. **Dùng `DataSource` transaction** — pattern đã có trong MeetingsService hiện tại
6. **Host resolution**: So sánh `currentUser.id` với `meeting.hostId` (từ entity), không dùng participant_role
7. **Validation mỗi lần submit**: Không cache kết quả kiểm tra, validate lại tại thời điểm submit
