# Tasks: Tìm kiếm ghi chú trong cuộc họp (Search Meeting Notes)

**Feature**: UC-IMM-11 / UC-104
**Module**: live-meeting
**Date**: 2026-06-18
**Spec**: [spec.md](spec.md)
**Plan**: [plan.md](plan.md)
**Research**: [research.md](research.md)
**Data Model**: [data-model.md](data-model.md)
**Contract**: [contracts/search-meeting-notes-api.md](contracts/search-meeting-notes-api.md)
**Quickstart**: [quickstart.md](quickstart.md)

---

## CHANGELOG & REVISION HISTORY

| Ngày cập nhật | Tóm tắt thay đổi | Các dòng thay đổi |
| :--- | :--- | :--- |
| 2026-06-18 | Tạo tasks.md lần đầu cho UC-IMM-11 Tìm kiếm ghi chú trong cuộc họp | Toàn bộ file |

---

## Phase 1 — Setup & Codebase Analysis

> Xác nhận trạng thái hiện tại của codebase trước khi implement.

- [x] T001 Kiểm tra `ViewNotesQueryDto` có dùng `forbidNonWhitelisted` trong global ValidationPipe không. Nếu có → ảnh hưởng extend DTO, cân nhắc tạo `SearchNotesQueryDto` riêng.
  Outcome: Ghi nhận quyết định — Extend vs New DTO (ghi trong `research.md` §DTO Decision).
  File: `src/modules/live-meeting/dto/view-notes-query.dto.ts`, `src/main.ts` (global pipe config)

- [x] T002 [P] Kiểm tra GIN index `ix_meeting_notes_content_fts` trên `meeting_notes.content` đã tồn tại trong database chưa.
  Outcome: Xác nhận có/không → quyết định Phase 5 có cần migration không.
  File: `src/database/migrations/`

- [x] T003 [P] Kiểm tra `meeting-note-error.constant.ts` có đủ error codes: `VALIDATION_ERROR`, `INVALID_DATE_RANGE`, `NOT_A_MEETING_PARTICIPANT`, `MEETING_STATUS_NOT_VIEWABLE`, `MEETING_NOT_FOUND`.
  Outcome: Xác nhận đủ (từ UC-IMM-10) → không cần thêm.
  File: `src/modules/live-meeting/constants/meeting-note-error.constant.ts`

- [x] T004 [P] Kiểm tra permission `meeting.note.read` đã được seed trong database seeds.
  Outcome: Xác nhận đã seed (từ UC-102) → không cần seed mới.
  File: `src/database/seeds/`

- [x] T005 [P] Kiểm tra live-meeting module imports: xác nhận `MeetingNoteEntity` đã được đăng ký trong `TypeOrmModule.forFeature()`.
  Outcome: Xác nhận đủ → không cần sửa module.
  File: `src/modules/live-meeting/live-meeting.module.ts`

---

## Phase 2 — DTO

> Mở rộng DTO với search-specific query params.

- [x] T006 Thêm 4 fields vào `ViewNotesQueryDto`: `q` (string, optional, max 255), `authorId` (UUID, optional), `createdFrom` (ISO datetime, optional), `createdTo` (ISO datetime, optional).
  Dùng decorators: `@IsOptional()`, `@MaxLength(255)`, `@IsUUID()`, `@IsDateString()`.
  Nếu quyết định New DTO (từ T001 outcome): tạo `SearchNotesQueryDto extends ViewNotesQueryDto` với các field trên.
  Outcome: DTO có search params với validation decorators.
  File: `src/modules/live-meeting/dto/view-notes-query.dto.ts` hoặc `src/modules/live-meeting/dto/search-notes-query.dto.ts`

- [x] T007 [P] Cập nhật `dto/index.ts` export DTO mới (nếu tạo `SearchNotesQueryDto` riêng).
  Outcome: Export sẵn sàng cho controller import.
  File: `src/modules/live-meeting/dto/index.ts`

---

## Phase 3 — Search Logic (Service)

> Implement full-text search / ILIKE fallback + search-specific filters trong service layer.

- [x] T008 Thêm method `escapeIlikeWildcard(keyword: string): string` — escape `%`, `_`, `\` trong keyword bằng `\` prefix.
  Dùng `keyword.replace(/[\\%_]/g, '\\$&')`.
  Outcome: Utility function cho ILIKE fallback.
  File: `src/modules/live-meeting/services/live-meeting.service.ts`

- [x] T009 [P] Thêm method `normalizeVietnamese(text: string): string` để loại bỏ dấu tiếng Việt ở application layer (fallback khi DB không có unaccent).
  Dùng mapping table: `à→a, á→a, ả→a, ã→a, ạ→a, ă→a, ằ→a, ắ→a,...` hoặc thư viện như `remove-accents` nếu dự án đã có.
  Outcome: Utility function cho fallback search.
  File: `src/modules/live-meeting/services/live-meeting.service.ts`

- [x] T010 [P] Thêm method `validateSearchKeyword(q: string): string | null` — trim whitespace, check length ≤ 255, return null nếu empty (view mode).
  Throw `BadRequestException` với `VALIDATION_ERROR` nếu q > 255.
  Outcome: Keyword validation trước khi search.
  File: `src/modules/live-meeting/services/live-meeting.service.ts`

- [x] T011 Mở rộng method `viewMeetingNotes()` (hoặc thêm `searchMeetingNotes()`) với search logic:
  1. Gọi `validateSearchKeyword()` — nếu null → skip search predicate (view mode).
  2. Apply search predicate SAU visibility filter (FR-011, BR-016).
  3. Preferred: `to_tsvector('simple', mn.content) @@ plainto_tsquery('simple', :q)`.
  4. Fallback: `mn.content ILIKE :escapedKeyword ESCAPE '\'` với `escapeIlikeWildcard()`.
  5. Nếu có unaccent: wrap content và keyword với unaccent().
  6. Xử lý visibility cho Co-host: Co-host thấy tất cả notes NGOẠI TRỪ private notes của user khác (isibility_level = 'private' AND uthor_id != currentUserId). Dùng chung visibility predicate từ UC-IMM-10 iewMeetingNotes(), đảm bảo Co-host path loại trừ private notes của người khác. (BR-020, CR-002)
  7. Thêm optional filters: uthorId, createdFrom, createdTo AND logic (FR-013→FR-015, BR-017).
  8. Cross-field validation: nếu createdFrom > createdTo → throw INVALID_DATE_RANGE (FR-016).
  Outcome: Service method hỗ trợ search đầy đủ filters.
  File: `src/modules/live-meeting/services/live-meeting.service.ts`

- [x] T012 Cập nhật response message: nếu là search mode (có q non-empty) và total=0 → `"Không tìm thấy ghi chú nào khớp với điều kiện tìm kiếm của bạn."` (FR-025, BR-012).
  Nếu không có q → giữ message cũ từ UC-IMM-10.
  Outcome: Empty state message phân biệt search vs view.
  File: `src/modules/live-meeting/services/live-meeting.service.ts`

---

## Phase 4 — Controller

> Cập nhật controller để nhận search params từ DTO.

- [x] T013 Cập nhật method `listNotes()` trong `LiveMeetingController`:
  - Import `SearchNotesQueryDto` (nếu tạo mới) hoặc update type từ `ViewNotesQueryDto` (nếu extend).
  - `@Query()` nhận search params.
  - ParseUUIDPipe cho `authorId` (nếu được gửi từ client).
  - Gọi service method với search params.
  Outcome: Controller nhận và forward search params.
  File: `src/modules/live-meeting/controllers/live-meeting.controller.ts`

---

## Phase 5 — Index Migration

> Tạo GIN index cho full-text search nếu chưa tồn tại.

- [x] T014 [P] Nếu GIN index chưa tồn tại (từ T002): tạo TypeORM migration file `TIMESTAMP-AddMeetingNotesFtsIndex.ts`.
  Migration `up`: `CREATE INDEX IF NOT EXISTS ix_meeting_notes_content_fts ON meeting_notes USING GIN (to_tsvector('simple', content));`.
  Migration `down`: `DROP INDEX IF EXISTS ix_meeting_notes_content_fts;`.
  Outcome: GIN index cho full-text search performance.
  File: `src/database/migrations/TIMESTAMP-AddMeetingNotesFtsIndex.ts`

- [ ] T015 [P] Nếu B-tree index `ix_meeting_notes_author_id` chưa tồn tại: tạo migration thêm index trên `meeting_notes(author_id)`.
  Migration `up`: `CREATE INDEX IF NOT EXISTS ix_meeting_notes_author_id ON meeting_notes(author_id);`.
  Outcome: Index cho `?authorId=` filter.
  File: `src/database/migrations/TIMESTAMP-AddMeetingNotesAuthorIdIndex.ts`

- [ ] T016 Chạy migration: `npx typeorm migration:run -d src/database/data-source.ts`.
  Outcome: Indexes được tạo trong database.
  File: `src/database/data-source.ts`

---

## Phase 6 — Tests

> Unit test cho service, controller, DTO.

### 6.1 Service Tests

- [ ] T017 Viết test: Host search keyword → tất cả notes hợp lệ chứa keyword, sorted ASC. (AC-001, FR-007, BR-004)
  File: `src/modules/live-meeting/tests/live-meeting.service.spec.ts`

- [ ] T018 [P] Viết test: Participant search → chỉ shared + own notes; private notes của người khác không xuất hiện. (AC-002, FR-007, BR-005, BR-016)
  File: `src/modules/live-meeting/tests/live-meeting.service.spec.ts`

- [ ] T019 [P] Viết test: Search không bypass visibility filter — private notes blocked dù keyword khớp. (AC-003, FR-011, BR-016)
  File: `src/modules/live-meeting/tests/live-meeting.service.spec.ts`

- [ ] T020 [P] Viết test: Co-host search → thấy tất cả notes NGOẠI TRỪ private notes của user khác. (AC-024, CR-002)
  File: `src/modules/live-meeting/tests/live-meeting.service.spec.ts`

- [ ] T021 [P] Viết test: Case-insensitive search — "Triển Khai" và "triển khai" cùng trả kết quả. (AC-006, FR-007, BR-014)
  File: `src/modules/live-meeting/tests/live-meeting.service.spec.ts`

- [ ] T022 [P] Viết test: Vietnamese unaccent search (nếu DB support). (AC-007, FR-008, CD-003)
  File: `src/modules/live-meeting/tests/live-meeting.service.spec.ts`

- [ ] T023 [P] Viết test: Empty keyword `?q=` → behavior view mode (trả all notes like UC-103). (AC-004, FR-010, BR-013)
  File: `src/modules/live-meeting/tests/live-meeting.service.spec.ts`

- [ ] T024 [P] Viết test: No results → 200 data=[], total=0, search message. (AC-005, FR-025, BR-012)
  File: `src/modules/live-meeting/tests/live-meeting.service.spec.ts`

- [ ] T025 [P] Viết test: q > 255 → 400 VALIDATION_ERROR. (AC-022, FR-007, BR-021, CR-003)
  File: `src/modules/live-meeting/tests/live-meeting.service.spec.ts`

- [ ] T026 [P] Viết test: ILIKE wildcard escape — `%meeting_` tìm literal, không pattern match. (AC-023, FR-028, BR-022, CR-004)
  File: `src/modules/live-meeting/tests/live-meeting.service.spec.ts`

- [ ] T027 [P] Viết test: Search + authorId filter → AND logic. (AC-008, FR-012, FR-013, BR-017)
  File: `src/modules/live-meeting/tests/live-meeting.service.spec.ts`

- [ ] T028 [P] Viết test: Search + time range (createdFrom/createdTo) → AND logic; từng filter độc lập. (AC-008, FR-014, FR-015, BR-019)
  File: `src/modules/live-meeting/tests/live-meeting.service.spec.ts`

- [ ] T029 [P] Viết test: Search + noteType AND. (AC-009, FR-012, FR-017)
  File: `src/modules/live-meeting/tests/live-meeting.service.spec.ts`

- [ ] T030 [P] Viết test: Search + pinned AND. (AC-010, FR-012, FR-019)
  File: `src/modules/live-meeting/tests/live-meeting.service.spec.ts`

- [ ] T031 [P] Viết test: Pagination với search — page/limit đúng, meta.total correct. (AC-011, FR-021, FR-022)
  File: `src/modules/live-meeting/tests/live-meeting.service.spec.ts`

- [ ] T032 [P] Viết test: limit > 100 → 400 VALIDATION_ERROR. (AC-012, FR-021)
  File: `src/modules/live-meeting/tests/live-meeting.service.spec.ts`

- [ ] T033 [P] Viết test: authorId invalid UUID → 400 VALIDATION_ERROR. (AC-013, FR-013)
  File: `src/modules/live-meeting/tests/live-meeting.service.spec.ts`

- [ ] T034 [P] Viết test: createdFrom wrong format → 400 VALIDATION_ERROR. (AC-014, FR-014)
  File: `src/modules/live-meeting/tests/live-meeting.service.spec.ts`

- [ ] T035 [P] Viết test: createdFrom > createdTo → 400 INVALID_DATE_RANGE. (AC-015, FR-016)
  File: `src/modules/live-meeting/tests/live-meeting.service.spec.ts`

- [ ] T036 [P] Viết test: User không phải Host/Co-host/Participant → 403 NOT_A_MEETING_PARTICIPANT. (AC-018, FR-006)
  File: `src/modules/live-meeting/tests/live-meeting.service.spec.ts`

- [ ] T037 [P] Viết test: Meeting không tồn tại → 404 MEETING_NOT_FOUND. (AC-019, FR-004)
  File: `src/modules/live-meeting/tests/live-meeting.service.spec.ts`

- [ ] T038 [P] Viết test: Meeting sai status (scheduled) → 422 MEETING_STATUS_NOT_VIEWABLE. (AC-020, FR-005)
  File: `src/modules/live-meeting/tests/live-meeting.service.spec.ts`

- [ ] T039 [P] Viết test: Read-only — verify không có INSERT/UPDATE/DELETE nào được gọi. (AC-021, FR-026)
  File: `src/modules/live-meeting/tests/live-meeting.service.spec.ts`

### 6.2 Controller Tests

- [ ] T040 [P] Viết test controller: Search query params (q, authorId, createdFrom, createdTo) parse correctly → forward đúng xuống service.
  File: `src/modules/live-meeting/tests/live-meeting.controller.spec.ts`

- [ ] T041 [P] Viết test controller: Invalid meetingId UUID → 400.
  File: `src/modules/live-meeting/tests/live-meeting.controller.spec.ts`

- [ ] T042 [P] Viết test controller: Thiếu JWT → 401 (guard).
  File: `src/modules/live-meeting/tests/live-meeting.controller.spec.ts`

- [ ] T043 [P] Viết test controller: Thiếu permission → 403 PERMISSION_DENIED (guard).
  File: `src/modules/live-meeting/tests/live-meeting.controller.spec.ts`

### 6.3 DTO Tests

- [ ] T044 [P] Viết test DTO: `q` max 255 — pass khi ≤ 255, fail khi > 255.
  File: `src/modules/live-meeting/dto/view-notes-query.dto.spec.ts`

- [ ] T045 [P] Viết test DTO: `authorId` valid UUID — pass valid, fail invalid.
  File: `src/modules/live-meeting/dto/view-notes-query.dto.spec.ts`

- [ ] T046 [P] Viết test DTO: `createdFrom`/`createdTo` ISO datetime — pass valid, fail invalid.
  File: `src/modules/live-meeting/dto/view-notes-query.dto.spec.ts`

---

## Phase 7 — Documentation & Cleanup

- [ ] T047 Cập nhật CHANGELOG trong spec.md: thêm dòng log cho implementation phase.
  File: `spec/features/live-meeting/feat-search-meeting-notes/spec.md`

- [ ] T048 Chạy `npm run lint` — fix tất cả lint errors.
  File: `src/` (toàn bộ)

- [ ] T049 Chạy `npm run test` — xác nhận tất cả tests pass, kể cả existing tests từ module khác không bị broken.
  File: `src/` (toàn bộ)

- [ ] T050 Chạy `npm run build` — xác nhận build thành công không lỗi.
  File: `src/` (toàn bộ)

---

## Requirements Coverage

### Functional Requirements

| FR ID | Task(s) kiểm tra | Mô tả |
|-------|-----------------|-------|
| FR-001 | T042 | JWT authentication required |
| FR-002 | T043 | Permission `meeting.note.read` check |
| FR-003 | T041 | meetingId UUID validation |
| FR-004 | T037 | Meeting exists + not deleted |
| FR-005 | T038 | Meeting status in_progress/completed |
| FR-006 | T036 | Host, Co-host, Participant membership check |
| FR-007 | T011, T017, T018, T021 | Full-text search case-insensitive |
| FR-008 | T011, T022 | Unaccent search (if available) |
| FR-009 | T011, T026 | ILIKE fallback + wildcard escape |
| FR-010 | T011, T023 | Empty keyword → view mode |
| FR-011 | T011, T019 | Visibility filter BEFORE search |
| FR-012 | T011, T027 | AND logic search + filters |
| FR-013 | T006, T027, T033 | authorId UUID filter |
| FR-014 | T006, T028, T034 | createdFrom ISO datetime |
| FR-015 | T006, T028 | createdTo ISO datetime |
| FR-016 | T011, T035 | createdFrom > createdTo → INVALID_DATE_RANGE |
| FR-017 | T011, T029 | noteType filter |
| FR-018 | T011, T011 | visibility filter |
| FR-019 | T011, T030 | pinned filter |
| FR-020 | T011 | Sort timeline_asc/timeline_desc |
| FR-021 | T031, T032 | Pagination page/limit |
| FR-022 | T031 | Pagination meta |
| FR-023 | T011 | noteTimestamp in response |
| FR-024 | T011 | Author info (id, fullName) in response |
| FR-025 | T012, T024 | Empty state message |
| FR-026 | T039 | Read-only — no writes |
| FR-027 | T011 | deleted_at IS NULL filter |
| FR-028 | T011, T026 | ILIKE wildcard escape `%` `_` `\` |

### Business Rules

| BR ID | Task(s) | Mô tả |
|-------|---------|-------|
| BR-001→BR-012 | T036→T038 | Kế thừa visibility ruls từ UC-IMM-10 |
| BR-013 | T010, T023 | Search keyword trim + empty check |
| BR-014 | T011, T021 | Case-insensitive search |
| BR-015 | T011, T022 | Unaccent fallback |
| BR-016 | T011, T019 | Visibility filter before search |
| BR-017 | T011, T027 | AND logic |
| BR-018 | T011, T027, T033 | authorId + visibility combine |
| BR-019 | T011, T028 | createdFrom/createdTo independent |
| BR-020 | T011, T020 | Co-host private note restriction |
| BR-021 | T010, T025 | q max 255 |
| BR-022 | T008, T026 | ILIKE wildcard escape |

### Acceptance Criteria

| AC ID | Task kiểm tra | Mô tả |
|-------|--------------|-------|
| AC-001 | T017 | Host search → all notes |
| AC-002 | T018 | Participant search → shared + own |
| AC-003 | T019 | Search không bypass visibility |
| AC-004 | T023 | `?q=` rỗng → view mode |
| AC-005 | T024 | No results → empty state |
| AC-006 | T021 | Case-insensitive |
| AC-007 | T022 | Vietnamese unaccent |
| AC-008 | T027, T028 | Search + authorId + time range AND |
| AC-009 | T029 | Search + noteType |
| AC-010 | T030 | Search + pinned |
| AC-011 | T031 | Pagination with search |
| AC-012 | T032 | limit > 100 |
| AC-013 | T033 | authorId invalid UUID |
| AC-014 | T034 | createdFrom wrong format |
| AC-015 | T035 | createdFrom > createdTo |
| AC-016 | T042 | No auth → 401 |
| AC-017 | T043 | No permission → 403 |
| AC-018 | T036 | Not participant → 403 |
| AC-019 | T037 | Meeting not found → 404 |
| AC-020 | T038 | Wrong status → 422 |
| AC-021 | T039 | Read-only — no writes |
| AC-022 | T025 | q > 255 → 400 |
| AC-023 | T026 | ILIKE wildcard escape |
| AC-024 | T020 | Co-host vs Host visibility |




