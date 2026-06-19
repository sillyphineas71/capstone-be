---
description: "Task list cho feature In-Meeting Notes (UC-IMM-09 / UC-102/103/104)"
---

# Tasks: Thêm ghi chú trong cuộc họp (In-Meeting Notes)

**Feature**: Thêm ghi chú trong cuộc họp (UC-IMM-09 / UC-102/103/104)
**Module**: `live-meeting`
**Plan**: [plan.md](plan.md) · **Spec**: [spec.md](spec.md) · **Data Model**: [data-model.md](data-model.md) · **Contract**: [contracts/in-meeting-notes-api.md](contracts/in-meeting-notes-api.md) · **Quickstart**: [quickstart.md](quickstart.md)
**Branch**: `tai-branch`
**Created**: 2026-06-18

---

## CHANGELOG & REVISION HISTORY

| Ngày cập nhật | Tóm tắt thay đổi | Các dòng thay đổi |
| :--- | :--- | :--- |
| 2026-06-18 | Tạo tasks.md lần đầu\n| 2026-06-18 | Cập nhật tasks sau khi implement toàn bộ Phase 1-4: constants, DTOs, util sanitize, migration, seed, service, controller, tests | Toàn bộ file | cho UC-IMM-09 (Setup/Foundational + US1 Tạo ghi chú + US2 Xem/Tìm kiếm + Polish) | Toàn bộ file |

---

## Format: `[ID] [P?] [Story] Mô tả`

- **[P]**: chạy song song được (khác file, không phụ thuộc nhau).
- **[US1]** / **[US2]**: task thuộc User Story tương ứng.
- Mỗi task ghi rõ **đường dẫn file** và **outcome cụ thể**.

### User Stories

- **US1 — Tạo ghi chú (UC-102)** 🎯 MVP: Host / Internal Participant tạo note khi meeting `in_progress`.
- **US2 — Xem & Tìm kiếm ghi chú (UC-103/104)**: liệt kê + filter + full-text search, lọc theo visibility.

> ⚠️ **Lưu ý file dùng chung**: US1 và US2 cùng sửa `live-meeting.service.ts` và `live-meeting.controller.ts` ⇒ các task chạm 2 file này **KHÔNG** đánh [P] chéo story; thực thi tuần tự (US1 trước, US2 sau) để tránh xung đột merge.

---

## Phase 1: Setup & Foundational (Shared — BLOCKS US1 & US2)

**Mục tiêu**: hạ tầng dùng chung (error codes, DTO, sanitize util, migration, seed). Phải xong trước khi vào US1/US2.

- [x] **T001 [P]** Tạo `src/modules/live-meeting/constants/meeting-note-error.constant.ts`
    - Export object `MEETING_NOTE_ERRORS` + type `MeetingNoteErrorCode` (pattern `MEETING_END_ERRORS`).
    - Codes: `VALIDATION_ERROR` (400), `PERMISSION_DENIED` (403), `NOTE_HOST_ONLY` (403), `MEETING_NOT_FOUND` (404), `MEETING_NOT_IN_PROGRESS` (409), `NOTE_SYSTEM_TYPE_FORBIDDEN` (422).
    - Outcome: import dùng được trong service.

- [x] **T002 [P]** Tạo DTO `src/modules/live-meeting/dto/create-note.dto.ts` (`CreateNoteDto`)
    - `noteType`: `@IsIn(['in_meeting','private','host_note','system_note'])` + required. Cho phép `system_note` vượt qua DTO validate (không bị 400) để lọt xuống Service, nơi T013 bắt và ném 422 đúng API Contract (FR-005, BR-003).
    - `content`: `@IsString` `@IsNotEmpty` `@MaxLength(10000)` (FR-009).
    - `pinned?`: `@IsOptional` `@IsBoolean` (BR-009).
    - `visibilityLevel?`: `@IsOptional` `@IsIn(['private','participants','department','public_internal'])` (FR-008).
    - Outcome: DTO validate input ở boundary; global pipe `forbidNonWhitelisted` reject field cấm (`createdAt`,`authorId`).

- [x] **T003 [P]** Tạo DTO `src/modules/live-meeting/dto/list-notes-query.dto.ts` (`ListNotesQueryDto`)
    - `noteType?` `@IsIn(...)`; `pinned?` `@Type(()=>Boolean)` `@IsBoolean`; `q?` `@IsString` `@MaxLength(200)`.
    - `page?` default 1 (`@IsInt @Min(1)`); `limit?` default 20 (`@IsInt @Min(1) @Max(100)`); `@Type(() => Number)`.
    - Outcome: query UC-103/104 được validate + transform (FR-015, FR-017).

- [x] **T004 [P]** Tạo DTO `src/modules/live-meeting/dto/note-response.dto.ts` (`NoteResponseDto`)
    - Fields: `id`, `meetingId`, `noteType`, `content`, `pinned`, `visibilityLevel`, `author: { id, fullName }`, `createdAt` (ISO string).
    - Constructor `Object.assign(this, data)` (pattern `StartMeetingResponseDto`).
    - Outcome: response khớp contract §1/§2.

- [x] **T005** Cập nhật `src/modules/live-meeting/dto/index.ts`
    - Export `CreateNoteDto`, `ListNotesQueryDto`, `NoteResponseDto`.
    - Phụ thuộc: T002, T003, T004.

- [x] **T006 [P]** Tạo util sanitize `src/common/utils/sanitize-note-content.util.ts` (`sanitizeNoteContent()`)
    - Strip/escape tag HTML nguy hiểm (`<script>`, `<iframe>`, `on*=`, `javascript:`…), giữ plain text/Markdown an toàn (NFR-005).
    - Không thêm dependency nặng (xem plan §12); nếu team chốt dùng `sanitize-html` ⇒ cập nhật task này.
    - Outcome: hàm pure, deterministic, test được.

- [x] **T007 [P]** Tạo migration GIN index `src/database/migrations/<timestamp>-AddMeetingNotesContentGinIndex.ts`
    - `up()`: `CREATE INDEX idx_meeting_notes_content_fts ON meeting_notes USING GIN (to_tsvector('simple', content));`
    - `down()`: `DROP INDEX idx_meeting_notes_content_fts;`
    - Index-only, **không** đổi cột/bảng (Constitution DB Gate). Phục vụ FR-017.

- [x] **T008 [P]** Tạo seed permission `src/database/seeds/<timestamp>-SeedMeetingNotePermissions.ts`
    - INSERT `meeting.note.create` (`module_code='live-meeting'`, `action_code='note.create'`) + `meeting.note.read` (`action_code='note.read'`), `ON CONFLICT DO NOTHING`.
    - Gán `role_permissions` cho `INTERNAL_USER`, `MANAGER`, `BUSINESS_ADMIN`, `SYSTEM_ADMIN` (spec §2).
    - Đăng ký vào seed runner tổng hợp nếu có. Pattern: `SeedMeetingEndPermission.ts`.

**Checkpoint**: hạ tầng sẵn sàng → có thể bắt đầu US1.

---

## Phase 2: User Story 1 — Tạo ghi chú (UC-102) 🎯 MVP

**Goal**: Host/Internal Participant tạo note khi meeting `in_progress`, server gán `created_at`/`author_id`, áp default visibility, sanitize content.
**Independent Test**: POST `/api/v1/meetings/{meetingId}/notes` → 201 với data đầy đủ; chạy các kịch bản A/B/C/D trong quickstart.

### Tests trước (TDD) — US1

- [x] **T009 [P] [US1]** DTO test `src/modules/live-meeting/dto/create-note.dto.spec.ts`
    - Validate allowlist `noteType`, `content` rỗng → fail, `visibilityLevel` ngoài allowlist → fail, reject field cấm. (AC-010, FR-008)

- [x] **T010 [P] [US1]** Util test `src/common/utils/sanitize-note-content.util.spec.ts`
    - Input `<script>alert(1)</script>Hello` → output đã làm sạch; giữ text/Markdown an toàn. (NFR-005, quickstart #15)

- [x] **T011 [P] [US1]** Response DTO test `src/modules/live-meeting/dto/note-response.dto.spec.ts`
    - Verify constructor + field types + nested `author`.

### Implementation — US1

- [x] **T012 [US1]** Thêm private helper trong `src/modules/live-meeting/services/live-meeting.service.ts`
    - `resolveDefaultVisibility(noteType)`: host_note→`private`, in_meeting→`participants`, private→`private` (BR-005/006/007, FR-007).
    - `isMeetingHost(em, meetingId, userId)`: EXISTS trên `meeting_participants` (`is_host=true`) (BR-004).
    - Phụ thuộc: T001.

- [x] **T013 [US1]** Thêm `createMeetingNote(meetingId, dto, authUser)` trong `live-meeting.service.ts`
    - Sanitize `content` (T006) → trim rỗng ⇒ 400 `VALIDATION_ERROR` (FR-009).
    - `noteType=system_note` ⇒ 422 `NOTE_SYSTEM_TYPE_FORBIDDEN` (FR-005, BR-003).
    - `dataSource.transaction()` + `setLock('pessimistic_read')` trên `meetings`:
      - không có/deleted ⇒ 404 `MEETING_NOT_FOUND` (FR-002);
      - `status != in_progress` ⇒ 409 `MEETING_NOT_IN_PROGRESS` (BR-001, EC-001/AC-014);
      - `host_note` & !isHost ⇒ 403 `NOTE_HOST_ONLY` (FR-006, BR-004);
      - resolve `visibilityLevel` (gửi tường minh → validate allowlist; else default theo T012);
      - `pinned=true` & !isHost ⇒ ép `false` (BR-009);
      - INSERT `meeting_notes` (`author_id`=JWT, `source_event_id`=NULL, `created_at` DB sinh) (FR-003/004/010, BR-002).
    - Load lại note + `author` (id, full_name) → trả `NoteResponseDto`.
    - Phụ thuộc: T001, T004, T006, T012.

- [x] **T014 [US1]** Thêm endpoint `createNote()` trong `src/modules/live-meeting/controllers/live-meeting.controller.ts`
    - `@Post('meetings/:meetingId/notes')`, `@HttpCode(HttpStatus.CREATED)`.
    - `@UseGuards(JwtAuthGuard, PermissionsGuard)` + `@RequirePermissions('meeting.note.create')` (Auth Gate, FR-001).
    - `meetingId` qua `ParseUUIDPipe`; `@Body() dto: CreateNoteDto`; `user` từ `request['user']`.
    - Gọi `service.createMeetingNote(...)`; trả `{ success, message, data }`.
    - Swagger `@ApiOperation/@ApiParam/@ApiResponse` cho 201/400/401/403/404/409/422.
    - Phụ thuộc: T002, T005, T013.

- [x] **T015 [US1]** Thêm test suite `createMeetingNote` vào `src/modules/live-meeting/tests/live-meeting.service.spec.ts`
    - Cases (map quickstart A/B/C/D): happy `in_meeting` default `participants` (AC-001/004); `created_at` server-gen (AC-002); `host_note` default `private` (AC-003); `private` (AC-005); non-host `host_note`→403 (AC-007); `system_note`→422 (AC-008); meeting `completed`/`cancelled`→409 (AC-009); `content` rỗng→400 (AC-010); meeting not found→404; EC-001 race→409 (AC-014); non-host `pinned=true`→ép false (BR-009); sanitize content (NFR-005).
    - Transaction rollback: mô phỏng lỗi DB (ném exception) khi thực thi `INSERT meeting_notes` và verify `dataSource.transaction` đã gọi `rollback()` thành công để bảo toàn dữ liệu (NFR-003).
    - Phụ thuộc: T013.

- [x] **T016 [US1]** Thêm test suite `createNote` vào `src/modules/live-meeting/tests/live-meeting.controller.spec.ts`
    - Happy path (route/body/response format 201); invalid UUID→400/422; thiếu token→401; thiếu permission→403.
    - Phụ thuộc: T014.

**Checkpoint**: US1 hoạt động & test độc lập → có thể demo MVP tạo ghi chú.

---

## Phase 3: User Story 2 — Xem & Tìm kiếm ghi chú (UC-103/104)

**Goal**: GET danh sách note (filter + full-text search) với visibility filter nghiêm ngặt, loại note đã soft delete, pagination.
**Independent Test**: GET `/api/v1/meetings/{meetingId}/notes` (có/không `?q`) → 200 + `meta`; chạy kịch bản E trong quickstart.

### Tests trước (TDD) — US2

- [x] **T017 [P] [US2]** DTO test `src/modules/live-meeting/dto/list-notes-query.dto.spec.ts`
    - Validate `limit` max 100, `page` ≥ 1, transform number, `q` max 200, `noteType` allowlist. (FR-015/017)

### Implementation — US2

- [x] **T018 [US2]** Thêm private helper `buildVisibilityPredicate(qb, currentUser)` trong `live-meeting.service.ts`
    - Dựng điều kiện theo `visibility_level` (data-model §Visibility Filter): `private`→author; `participants`→is participant; `department`→cùng department với author; `public_internal`→mọi internal user. Author luôn thấy note của mình.
    - Trường hợp `visibility_level` là `department`, nếu payload `authUser` từ JWT không chứa sẵn `department_id`, cần truy vấn bảng `users` để lấy `department_id` của currentUser trước khi đưa vào Query Builder.
    - Luôn kèm `deleted_at IS NULL` (BR-010, FR-016).
    - Phụ thuộc: T013 (cùng file service).

- [x] **T019 [US2]** Thêm `listMeetingNotes(meetingId, query, authUser)` trong `live-meeting.service.ts`
    - SELECT meeting; không có ⇒ 404 `MEETING_NOT_FOUND`.
    - QueryBuilder: `meeting_id` + visibility predicate (T018) + filter `noteType`/`pinned` (FR-015) + nếu `q`: `to_tsvector('simple', content) @@ plainto_tsquery('simple', :q)` (FR-017/018, dùng GIN index T007).
    - Join `author`; pagination offset/limit + count → `{ data: NoteResponseDto[], meta }`.
    - Phụ thuộc: T004, T018, T007.

- [x] **T020 [US2]** Thêm endpoint `listNotes()` trong `live-meeting.controller.ts`
    - `@Get('meetings/:meetingId/notes')`, `@HttpCode(HttpStatus.OK)`.
    - `@UseGuards(JwtAuthGuard, PermissionsGuard)` + `@RequirePermissions('meeting.note.read')` (FR-013).
    - `meetingId` `ParseUUIDPipe`; `@Query(ValidationPipe) query: ListNotesQueryDto`; `user` từ `request['user']`.
    - Trả `{ success, message, data, meta }`; Swagger `@ApiQuery` cho `noteType/pinned/q/page/limit` + `@ApiResponse` 200/400/401/403/404.
    - Phụ thuộc: T003, T005, T019.

- [x] **T021 [US2]** Thêm test suite `listMeetingNotes` vào `live-meeting.service.spec.ts`
    - Cases (map quickstart E): filter `noteType+pinned` theo visibility (AC-011); full-text `?q` + visibility (AC-012); `private` của user khác bị ẩn (NFR-002, quickstart #19); note `deleted_at` bị loại (AC-013); pagination meta đúng.
    - Phụ thuộc: T019.

- [x] **T022 [US2]** Thêm test suite `listNotes` vào `live-meeting.controller.spec.ts`
    - Response `{ success, message, data, meta }`; thiếu permission→403; thiếu token→401; query sai→400/422.
    - Phụ thuộc: T020.

**Checkpoint**: US1 + US2 đều hoạt động độc lập.

---

## Phase 4: Polish & Cross-Cutting

- [x] **T023 [P]** Chạy `quickstart.md` validation — đối chiếu 21 scenario + verification checklist với hành vi thực tế.
- [x] **T024 [P]** Cập nhật docs nếu API/permission thay đổi: ghi chú `meeting.note.create`/`meeting.note.read` và 2 route vào tài liệu API contract nội bộ (`docs/API_CONTRACT_v1.0_with_system_roles.md` nếu cần đồng bộ).
- [x] **T025** Chạy `npm run lint`, `npm run test`, `npm run build` — đảm bảo pass, không phá module khác (Definition of Done).

---

## Dependencies & Execution Order

### Phase Dependencies
- **Phase 1 (Setup & Foundational)**: không phụ thuộc; BLOCKS US1 & US2.
- **Phase 2 (US1)**: cần Phase 1 xong.
- **Phase 3 (US2)**: cần Phase 1 xong; **sau US1** do dùng chung `live-meeting.service.ts` & `live-meeting.controller.ts`.
- **Phase 4 (Polish)**: cần US1 & US2 xong.

### Trong từng Story
- Tests viết trước (TDD) và FAIL trước khi implement.
- Helper/service trước controller; service trước test integration.

### Parallel Opportunities
- **Phase 1**: T001, T002, T003, T004, T006, T007, T008 chạy song song [P] (khác file). T005 chờ T002–T004.
- **US1 tests**: T009, T010, T011 song song [P].
- **US2 test**: T017 song song [P] với phần còn lại của US1 (khác file).
- **Phase 4**: T023, T024 song song [P]; T025 chạy cuối.

### Parallel Example — Phase 1
```bash
# Khởi động song song (khác file, không phụ thuộc):
T001  constants/meeting-note-error.constant.ts
T002  dto/create-note.dto.ts
T003  dto/list-notes-query.dto.ts
T004  dto/note-response.dto.ts
T006  common/utils/sanitize-note-content.util.ts
T007  migrations/...-AddMeetingNotesContentGinIndex.ts
T008  seeds/...-SeedMeetingNotePermissions.ts
```

---

## Implementation Strategy

### MVP First (US1)
1. Phase 1 (Setup & Foundational).
2. Phase 2 (US1) → **STOP & VALIDATE** POST tạo note độc lập → demo MVP.

### Incremental
3. Phase 3 (US2) → test xem/tìm kiếm độc lập.
4. Phase 4 (Polish) → lint/test/build + quickstart validation.

---

## Requirements Coverage

| Task | FR | BR / NFR | AC | Core Concern |
|------|-----|----------|------|--------------|
| T001 | FR-005/006 | BR-003 | — | Error constants |
| T002 | FR-005/008/009 | BR-003 | AC-010 | CreateNoteDto + validation |
| T003 | FR-015/017 | — | AC-011/012 | ListNotesQueryDto |
| T004 | FR-011 | — | AC-001 | NoteResponseDto |
| T005 | — | — | — | DTO exports |
| T006 | — | NFR-005 | — | Sanitize util |
| T007 | FR-017 | — | AC-012 | GIN index migration |
| T008 | FR-001/013 | — | — | Permission seed (`meeting.note.create/read`) |
| T009 | FR-008/009 | BR-003 | AC-010 | DTO validation test |
| T010 | — | NFR-005 | — | Sanitize test |
| T011 | FR-011 | — | AC-001 | Response DTO test |
| T012 | FR-007 | BR-004/005/006/007 | AC-003/004/005 | Default visibility + host check |
| T013 | FR-001/002/003/004/005/006/007/009/010 | BR-001/002/003/004/009 | AC-001/002/003/004/005/007/008/009/010/014 | Core create transaction |
| T014 | FR-001/011 | — | AC-001 | POST controller endpoint |
| T015 | FR-001→FR-011 | BR-001→009, NFR-005 | AC-001→005/007→010/014 | Service unit tests (create) |
| T016 | FR-001 | — | AC-010 | Controller tests (create) |
| T017 | FR-015/017 | — | AC-011/012 | Query DTO test |
| T018 | FR-014/016/018 | BR-008/010 | AC-005/013 | Visibility predicate |
| T019 | FR-013/014/015/016/017/018 | BR-008/010 | AC-011/012/013 | List + FTS service |
| T020 | FR-013 | — | AC-011/012 | GET controller endpoint |
| T021 | FR-014/016/017/018 | BR-008/010, NFR-002 | AC-011/012/013 | Service unit tests (list/search) |
| T022 | FR-013 | — | AC-011 | Controller tests (list) |
| T023 | — | — | AC-001→014 | Quickstart validation |
| T024 | — | — | — | Docs update |
| T025 | — | — | — | Lint/test/build (DoD) |

> **AC-006 (tag phân loại)**: Out of Scope (clarification #2) — **không** tạo task, **không** trace.
> **Out of Scope** (PATCH/DELETE/share/pin/email minutes/WebSocket/AI/export): không có task nào.

---

## Notes

- Tất cả ghi (INSERT note) trong **1 transaction** với `pessimistic_read` lock trên `meetings` (đóng EC-001).
- `author_id` & `created_at` luôn từ server, không nhận từ body (Constitution Auth Gate, BR-002, FR-003).
- **Không** dùng WebSocket cho note (Out of Scope) — khác với UC-IMM-05.
- Kiểm tra `MeetingNoteEntity` đã register trong `data-source` (đã có) — **không** sửa entity.
- Xác nhận với team 3 điểm mở: ngữ nghĩa `department`/`public_internal`, lib sanitize, FTS tiếng Việt (plan §12).
