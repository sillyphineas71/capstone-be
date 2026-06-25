---
description: "Task list cho feature View Meeting Notes (UC-IMM-10)"
---

# Tasks: Xem ghi chú trong cuộc họp (View Meeting Notes)

**Feature**: Xem ghi chú trong cuộc họp (UC-IMM-10)
**Module**: `live-meeting`
**Plan**: [plan.md](plan.md) · **Spec**: [spec.md](spec.md) · **Data Model**: [data-model.md](data-model.md) · **Contract**: [contracts/view-meeting-notes-api.md](contracts/view-meeting-notes-api.md) · **Quickstart**: [quickstart.md](quickstart.md)
**Branch**: `tai-branch`
**Created**: 2026-06-18

---

## CHANGELOG & REVISION HISTORY

| Ngày cập nhật | Tóm tắt thay đổi | Các dòng thay đổi |
| :--- | :--- | :--- |
| 2026-06-18 | Tạo tasks.md lần đầu cho UC-IMM-10 (View Meeting Notes — read-only, Host/Participant visibility, from/to filter, opt-in enrichment) | Toàn bộ file |

---

## Format: `[ID] [P?] [Story] Mô tả`

- **[P]**: chạy song song được (khác file, không phụ thuộc nhau).
- **[US1]** / **[US2]**: task thuộc User Story tương ứng.
- Mỗi task ghi rõ **đường dẫn file** và **outcome cụ thể**.

### User Stories

- **US1 — Xem ghi chú theo vai trò (Visibility Rules)** 🎯: Host xem tất cả notes hợp lệ; Participant chỉ thấy shared + own notes. Phủ AC-001 → AC-007, AC-014, AC-017 → AC-021.
- **US2 — Filter, Sort, Pagination & Opt-in Enrichment**: filter `noteType`/`visibility`/`pinned`/`from`/`to`, sort `timeline_asc`/`timeline_desc`, pagination, `includeSourceEvent`. Phủ AC-008 → AC-013, AC-015, AC-016, AC-022 → AC-024.

> ⚠️ **Lưu ý file dùng chung**: US1 và US2 cùng sửa `live-meeting.service.ts` và `live-meeting.controller.ts` ⇒ các task chạm 2 file này **KHÔNG** đánh [P] chéo story. Thực thi tuần tự: US1 trước (visibility logic), US2 sau (filters/sort/pagination). Helpers (`buildParticipantVisibilityPredicate`, `applyOptionalFilters`) tách file riêng ⇒ có thể viết song song.

> ⚠️ **UC-103 coexist**: endpoint `GET /api/v1/meetings/{meetingId}/notes` đã được khai báo trong `feat-in-meeting-notes` (UC-103). UC-IMM-10 là **spec canonical** cho endpoint này. Kết quả Phase 0 xác định level thay đổi (`listNotes()` cần update hay thêm method mới).

---

## Phase 0: Kiểm tra codebase (BLOCKS Phase 1+)

**Mục tiêu**: Không bắt đầu viết code trước khi biết trạng thái UC-103 implementation. Sai sót ở bước này gây conflict merge và duplicate logic.

- [x] **T000** Phân tích codebase UC-103 — đọc và ghi nhận kết quả vào comment/note

    Kiểm tra các mục sau trong `src/modules/live-meeting/`:

    | Mục | Câu hỏi | Tác động |
    |-----|---------|----------|
    | `controllers/live-meeting.controller.ts` | Có method `listNotes()` chưa? Route path? | Modify hay thêm mới |
    | `services/live-meeting.service.ts` | Có method `listMeetingNotes()` chưa? Signature? | Modify hay thêm `viewMeetingNotes()` |
    | `dto/` | Tồn tại `ListNotesQueryDto`, `NoteResponseDto` với các field gì? | Merge vào hay tạo `ViewNotesQueryDto`, `ViewNoteResponseDto` mới |
    | `constants/meeting-note-error.constant.ts` | Tồn tại? Có code `MEETING_STATUS_NOT_VIEWABLE`, `NOT_A_MEETING_PARTICIPANT`, `INVALID_DATE_RANGE` chưa? | Add codes nếu thiếu |
    | `src/database/seeds/` | Permission `meeting.note.read` đã seed chưa? | Tạo seed nếu chưa có |
    | `meeting_notes` entity / `meeting_events` entity | `event_type` column tồn tại trong `MeetingEventEntity`? | Ảnh hưởng opt-in enrichment (FR-017) |
    | Index `meeting_notes(created_at)` | Tồn tại không? | Ảnh hưởng `from`/`to` filter performance |

    **Output bắt buộc**: Ghi vào comment T000:
    - Approach quyết định: MODIFY `listNotes()` hay ADD `viewNotes()`
    - DTOs: MODIFY `NoteResponseDto` (thay `createdAt` → `noteTimestamp`) hay tạo `ViewNoteResponseDto` mới
    - Permission seed: đã có (skip) hay cần tạo (thêm task T001b)
    - `MeetingEventEntity.event_type`: tồn tại (enable) hay không (disable `sourceEventType` trong enrichment)

    Phụ thuộc: không có.

---

## Phase 1: Setup & Foundational (Shared — BLOCKS US1 & US2)

**Mục tiêu**: Hạ tầng dùng chung (error codes, DTOs). Phải xong trước khi bắt đầu US1/US2.

- [x] **T001 [P]** Thêm 3 error code mới vào `src/modules/live-meeting/constants/meeting-note-error.constant.ts`

    ```typescript
    INVALID_DATE_RANGE: 'INVALID_DATE_RANGE',          // 400 — from > to (CD-003)
    NOT_A_MEETING_PARTICIPANT: 'NOT_A_MEETING_PARTICIPANT',  // 403 — no membership (CD-002)
    MEETING_STATUS_NOT_VIEWABLE: 'MEETING_STATUS_NOT_VIEWABLE', // 422 — wrong status
    ```

    - Nếu file chưa tồn tại (kết quả T000): tạo mới với đầy đủ codes từ UC-102 + 3 codes mới.
    - Cập nhật type `MeetingNoteErrorCode` nếu có.
    - Outcome: import dùng được trong service UC-IMM-10.
    - Phụ thuộc: T000.

- [x] **T001b [P]** *(Skipped - permission seed da ton tai)* *(Conditional — chỉ tạo nếu T000 xác nhận chưa có seed)* Tạo seed permission `meeting.note.read`

    File: `src/database/seeds/<timestamp>-SeedMeetingNoteReadPermission.ts`
    - INSERT `meeting.note.read` (`module_code='live-meeting'`, `action_code='note.read'`), `ON CONFLICT DO NOTHING`.
    - Gán `role_permissions` cho `INTERNAL_USER`, `MANAGER`, `BUSINESS_ADMIN`, `SYSTEM_ADMIN`.
    - Pattern: file seed hiện có trong `src/database/seeds/`.
    - Đăng ký vào seed runner tổng hợp nếu có.
    - Outcome: `meeting.note.read` tồn tại trong DB sau khi chạy seed.
    - Phụ thuộc: T000.

- [x] **T002 [P]** Tạo `src/modules/live-meeting/dto/view-notes-query.dto.ts` (`ViewNotesQueryDto`)

    Fields + decorators:
    ```typescript
    noteType?:          @IsOptional @IsIn(['in_meeting','private','host_note','system_note'])
    visibility?:        @IsOptional @IsIn(['private','participants','public_internal','department'])
    pinned?:            @IsOptional @IsBoolean @Transform(() => Boolean)
    from?:              @IsOptional @IsDateString   // ISO 8601; format check only — cross-field trong service
    to?:                @IsOptional @IsDateString
    includeSourceEvent?:@IsOptional @IsBoolean @Transform(() => Boolean) // default: false (CD-001)
    page?:              @IsOptional @IsInt @Min(1) @Type(() => Number)  // default: 1
    limit?:             @IsOptional @IsInt @Min(1) @Max(100) @Type(() => Number) // default: 20 (FR-015, BR-014)
    sort?:              @IsOptional @IsIn(['timeline_asc','timeline_desc']) // default: 'timeline_asc'
    ```
    - Global pipe `forbidNonWhitelisted` reject field lạ.
    - Outcome: DTO validate + transform query params; `limit > 100` → 400 `VALIDATION_ERROR` (AC-024).
    - Phụ thuộc: T000.

- [x] **T003 [P]** Tạo `src/modules/live-meeting/dto/view-note-response.dto.ts` (`ViewNoteResponseDto`)

    Fields:
    ```typescript
    id:              string  // uuid
    meetingId:       string
    noteType:        string
    content:         string
    pinned:          boolean
    visibilityLevel: string
    author:          { id: string; fullName: string }
    sourceEventId:   string | null
    noteTimestamp:   string  // ISO 8601 — mapped từ created_at (CD-001, FR-021)
    updatedAt:       string
    // Chỉ xuất hiện khi includeSourceEvent=true:
    sourceEventTime?: string | null
    sourceEventType?: string | null
    ```
    - Constructor `Object.assign(this, data)` (pattern hiện có).
    - **Không dùng `createdAt`** — field tên là `noteTimestamp` (CD-001).
    - Outcome: response khớp contract `contracts/view-meeting-notes-api.md`.
    - Phụ thuộc: T000.

- [x] **T004** Cập nhật `src/modules/live-meeting/dto/index.ts`
    - Export `ViewNotesQueryDto`, `ViewNoteResponseDto`.
    - Phụ thuộc: T002, T003.

**Checkpoint Phase 1**: constants + DTOs ready → có thể bắt đầu US1 và DTO tests song song.

---

## Phase 2: User Story 1 — Visibility Rules (Host vs Participant) 🎯

**Goal**: Phân quyền đọc đúng theo vai trò: Host xem tất cả; Participant chỉ xem shared + own notes; membership check block admin/manager không trong meeting.
**Independent Test**: GET notes với Host → tất cả; Participant → filtered. Kịch bản A, B, G, H (một phần) trong quickstart.

### Tests trước (TDD) — US1

- [x] **T005 [P] [US1]** Tạo test `src/modules/live-meeting/dto/view-notes-query.dto.spec.ts`
    - Validate allowlist `noteType`, `visibility`, `sort` → reject ngoài allowlist.
    - `from`/`to` IsDateString → reject `"not-a-date"`.
    - `includeSourceEvent` boolean transform.
    - `limit > 100` → fail (AC-024).
    - `page < 1` → fail.
    - Reject field lạ (global pipe).
    - Phụ thuộc: T002.

- [x] **T006 [P] [US1]** Tạo test `src/modules/live-meeting/dto/view-note-response.dto.spec.ts`
    - Verify constructor nhận `noteTimestamp`, **không** có `createdAt`.
    - `sourceEventTime`/`sourceEventType` là optional (present khi enriched, absent khi not).
    - Nested `author.id`, `author.fullName` present.
    - Phụ thuộc: T003.

### Implementation — US1

- [x] **T007 [US1]** Thêm private helper `resolveMeetingRole(meeting, participant, currentUserId)` trong `src/modules/live-meeting/services/live-meeting.service.ts`

    ```typescript
    // Returns { isHost: boolean, isParticipant: boolean }
    // isHost = meeting.host_id === currentUserId OR participant?.participant_role === 'host'
    // isParticipant = participant record tồn tại
    ```
    - Source: spec §13.1, §13.2.
    - Outcome: helper pure, test được độc lập.
    - Phụ thuộc: T001 (error codes available).

- [x] **T008 [US1]** Thêm private helper `buildParticipantVisibilityPredicate(qb: SelectQueryBuilder, alias: string, currentUserId: string, currentUserDeptId: string | null)` trong `live-meeting.service.ts`

    Áp SQL OR predicate lên QueryBuilder theo spec §13.3, data-model §Visibility Filter:
    ```sql
    AND (
      mn.author_id = :currentUserId
      OR mn.visibility_level = 'participants'
      OR mn.visibility_level = 'public_internal'
      OR (mn.visibility_level = 'department'
          AND EXISTS (
            SELECT 1 FROM users u2
            WHERE u2.id = mn.author_id
              AND u2.department_id IS NOT NULL         -- guard NULL = NULL (plan §12 Risk)
              AND u2.department_id = :currentUserDeptId
          ))
    )
    ```
    - `currentUserDeptId` nullable — nếu NULL: skip `department` predicate.
    - **Không** thêm điều kiện này với Host path.
    - Outcome: helper cô lập, test được độc lập với mock QueryBuilder.
    - Phụ thuộc: T007 (cùng file service).

- [x] **T009 [US1]** Implement core `viewMeetingNotes(meetingId, query, authUser)` trong `live-meeting.service.ts` — **Bước 1: Validate & Membership Check**

    ```
    1. Validate cross-field from/to: xử lý ở US2 (T011) — placeholder check ở đây nếu cần.
    2. SELECT meeting (id, status, host_id, deleted_at).
       → không tồn tại / deleted_at IS NOT NULL → throw NotFoundException(MEETING_NOT_FOUND) (FR-004, AC-020).
       → status ∉ ['in_progress','completed'] → throw UnprocessableEntityException(MEETING_STATUS_NOT_VIEWABLE) (FR-005, AC-021).
    3. Lấy currentUserDeptId: SELECT users.department_id WHERE id = currentUserId (cần cho Participant visibility 'department').
    4. SELECT meeting_participants WHERE meeting_id = :meetingId AND user_id = :currentUserId.
       → { isHost, isParticipant } = resolveMeetingRole(meeting, participant, currentUserId) (T007).
       → !isHost && !isParticipant → throw ForbiddenException(NOT_A_MEETING_PARTICIPANT) (FR-006, AC-019, CD-002).
    5. Build QueryBuilder trên meeting_notes:
       - BASE: meeting_id = :meetingId AND deleted_at IS NULL (FR-009, BR-003).
       - JOIN users u ON author_id = u.id (FR-019 author info).
       - Host path: không thêm visibility predicate (FR-007, BR-004).
       - Participant path: gọi buildParticipantVisibilityPredicate(...) (T008) (FR-008, BR-005).
    6. [Filters, sort, pagination, enrichment ở T011–T014]
    7. Trả { data: ViewNoteResponseDto[], meta }.
    ```
    - **Không có transaction** (read-only, BR-011, spec §15).
    - Empty state (FR-018, BR-012, AC-014): khi total = 0 → message = "Cuộc họp này không có ghi chú nào được lưu lại.".
    - Phụ thuộc: T001, T003, T007, T008.

- [x] **T010 [US1]** Thêm test suite **US1 — Visibility Rules** vào `src/modules/live-meeting/tests/live-meeting.service.spec.ts`

    Cases (map quickstart A, B, G, H một phần):

    | # | Scenario | AC/EC |
    |---|----------|-------|
    | 1 | Host GET `in_progress` → tất cả notes hợp lệ, sorted ASC | AC-001 |
    | 2 | Host GET `completed` → tất cả notes hợp lệ | AC-002 |
    | 3 | Notes `deleted_at IS NOT NULL` không trả về dù Host hay Participant | AC-003 |
    | 4 | Mỗi note có `author.id` và `author.fullName` | AC-004 |
    | 5 | Participant chỉ thấy own + shared notes (`participants`,`public_internal`) | AC-005 |
    | 6 | Private note (`author != participant`) bị loại khỏi Participant response | AC-006 |
    | 7 | `host_note` + `visibility_level='private'` bị loại khỏi Participant response | AC-007 |
    | 8 | Empty state: không có notes → 200, `data=[]`, `total=0`, message | AC-014 |
    | 9 | `meetingId` meeting không tồn tại → 404 `MEETING_NOT_FOUND` | AC-020 |
    | 10 | Meeting `scheduled` → 422 `MEETING_STATUS_NOT_VIEWABLE` | AC-021 |
    | 11 | Meeting `cancelled` → 422 `MEETING_STATUS_NOT_VIEWABLE` | AC-021 |
    | 12 | Không phải Host hay Participant → 403 `NOT_A_MEETING_PARTICIPANT` | AC-019 |
    | 13 | System Admin không phải Participant → 403 `NOT_A_MEETING_PARTICIPANT` (CD-002) | BR-016 |
    | 14 | Participant GET `?visibility=private` → chỉ thấy private notes của **chính mình** (INVARIANT-4) | EC-010 |
    | 15 | Note `department` visibility + cùng phòng ban → Participant thấy | BR-005 |
    | 16 | `department_id = NULL` cho cả user và author → không match (NULL guard) | plan §12 |

    Phụ thuộc: T009.

**Checkpoint US1**: Visibility logic done & test → Host/Participant path verified.

---

## Phase 3: User Story 2 — Filter, Sort, Pagination & Opt-in Enrichment

**Goal**: Mở rộng `viewMeetingNotes()` với toàn bộ filter params, sort, pagination, và opt-in timeline enrichment từ `meeting_events`.
**Independent Test**: GET với các query params đa dạng. Kịch bản C, D, E, F trong quickstart.

### Tests trước (TDD) — US2

- [x] **T011 [P] [US2]** Thêm test suite **US2 — Filter/Sort/Pagination** vào `live-meeting.service.spec.ts`

    Viết trước khi implement (TDD). Cases:

    | # | Scenario | AC/CD |
    |---|----------|-------|
    | 17 | `?noteType=in_meeting` → chỉ trả `in_meeting` notes (sau visibility filter) | AC-008 |
    | 18 | `?pinned=true` → chỉ trả pinned notes | AC-009 |
    | 19 | `?from=T1&to=T2` → trả note trong khoảng | AC-010 |
    | 20 | Chỉ `?from=T1` (không `to`) → trả `created_at >= T1` (CD-003) | AC-010, CD-003 |
    | 21 | Chỉ `?to=T2` (không `from`) → trả `created_at <= T2` (CD-003) | AC-010, CD-003 |
    | 22 | `?from > to` (cả hai) → 400 `INVALID_DATE_RANGE` (CD-003) | AC-023 |
    | 23 | `?visibility=participants` áp SAU role filter | AC-011 |
    | 24 | `?sort=timeline_asc` (default) → `created_at ASC` | AC-012 |
    | 25 | `?sort=timeline_desc` → `created_at DESC` | AC-013 |
    | 26 | `?page=2&limit=5` → trang 2, meta đúng | AC-015 |
    | 27 | `meta.totalPages = ceil(total/limit)` | AC-016 |
    | 28 | `?includeSourceEvent=true` + note có `source_event_id` → `sourceEventTime`/`sourceEventType` present | FR-017, CD-001 |
    | 29 | `?includeSourceEvent=true` + `meeting_events` không tìm thấy → `sourceEventTime=null`, `sourceEventType=null` | EC-006 |
    | 30 | Không truyền `includeSourceEvent` → response **không có** `sourceEventTime`/`sourceEventType` | CD-001 |
    | 31 | `from` sai format ISO → 400 `VALIDATION_ERROR` (validate ở DTO layer) | AC-022 |
    | 32 | `limit > 100` → 400 `VALIDATION_ERROR` (validate ở DTO layer) | AC-024 |

    Phụ thuộc: T009 (service method cơ sở).

### Implementation — US2

- [x] **T012 [US2]** Thêm private helper `applyOptionalFilters(qb, alias, query)` trong `live-meeting.service.ts`

    Áp các optional filter SAU visibility predicate (BR-015):
    ```typescript
    if (query.noteType)   qb.andWhere(`${alias}.note_type = :noteType`, { noteType: query.noteType })
    if (query.visibility) qb.andWhere(`${alias}.visibility_level = :visibility`, { visibility: query.visibility })
    if (query.pinned !== undefined) qb.andWhere(`${alias}.pinned = :pinned`, { pinned: query.pinned })
    if (query.from)       qb.andWhere(`${alias}.created_at >= :from`, { from: new Date(query.from) })
    if (query.to)         qb.andWhere(`${alias}.created_at <= :to`, { to: new Date(query.to) })
    ```
    - `from`/`to` **độc lập** (CD-003): `if (query.from)` và `if (query.to)` là các điều kiện riêng biệt, không phụ thuộc nhau.
    - Outcome: helper cô lập, test được mock.
    - Phụ thuộc: T009 (cùng file service).

- [x] **T013 [US2]** Implement cross-field validation `from > to` trong `viewMeetingNotes()` (bổ sung vào T009)

    - Vị trí: **đầu method**, trước query meeting, sau khi parse DTO (CD-003).
    - Logic:
      ```typescript
      if (query.from && query.to) {
        const fromDate = new Date(query.from);
        const toDate = new Date(query.to);
        if (fromDate > toDate) {
          throw new BadRequestException({
            message: "Giá trị 'from' phải nhỏ hơn hoặc bằng 'to'",
            error: { code: MEETING_NOTE_ERRORS.INVALID_DATE_RANGE, details: { from: query.from, to: query.to } }
          });
        }
      }
      ```
    - Error code `INVALID_DATE_RANGE` (**không phải** `VALIDATION_ERROR`) (spec §14, AC-023).
    - Outcome: `from > to` → 400 `INVALID_DATE_RANGE`; `from` đơn lẻ hoặc `to` đơn lẻ → không validate cross-field.
    - Phụ thuộc: T001, T009.

- [x] **T014 [US2]** Implement sort logic trong `viewMeetingNotes()` QueryBuilder

    ```typescript
    const sortDir = query.sort === 'timeline_desc' ? 'DESC' : 'ASC'; // default: ASC (BR-007)
    qb.orderBy('mn.created_at', sortDir);
    ```
    - Outcome: mặc định `created_at ASC` (AC-012); `?sort=timeline_desc` → `created_at DESC` (AC-013).
    - Phụ thuộc: T009.

- [x] **T015 [US2]** Implement pagination logic trong `viewMeetingNotes()`

    ```typescript
    const page = query.page ?? 1;
    const limit = query.limit ?? 20;
    qb.skip((page - 1) * limit).take(limit);
    // COUNT query riêng — clone QBuilder trước khi thêm pagination
    const total = await cloneQb.getCount();
    const data = await qb.getMany();
    const totalPages = Math.ceil(total / limit);
    // Empty state check: total === 0 → message đặc biệt (BR-012)
    const message = total === 0
      ? 'Cuộc họp này không có ghi chú nào được lưu lại.'
      : 'Lấy danh sách ghi chú thành công';
    ```
    - Outcome: `meta = { page, limit, total, totalPages }` (FR-015, FR-016, AC-015, AC-016).
    - Phụ thuộc: T009.

- [x] **T016 [US2]** Implement opt-in enrichment `includeSourceEvent` trong `viewMeetingNotes()`

    ```typescript
    if (query.includeSourceEvent === true) {
      qb.leftJoin('meeting_events', 'me', 'mn.source_event_id = me.id');
      qb.addSelect(['me.event_time AS source_event_time', 'me.event_type AS source_event_type']);
      // Nếu MeetingEventEntity không có event_type (kết quả T000) → chỉ lấy event_time, skip event_type
    }
    // Map kết quả:
    // noteTimestamp ← mn.created_at (luôn có, CD-001, FR-021)
    // sourceEventTime ← me.event_time (chỉ khi includeSourceEvent=true; null nếu LEFT JOIN miss)
    // sourceEventType ← me.event_type (idem; bỏ nếu column không tồn tại per T000)
    ```
    - Khi `includeSourceEvent=false` (default): **không có** `LEFT JOIN`; **không có** field `sourceEventTime`/`sourceEventType` trong response (CD-001).
    - Khi `includeSourceEvent=true` và `source_event_id IS NULL`: `sourceEventTime = null`, `sourceEventType = null` (EC-006).
    - Outcome: conditional enrichment, no performance overhead by default.
    - Phụ thuộc: T009, T003 (ViewNoteResponseDto có optional fields).

- [x] **T017 [US2]** Integrate T012–T016 vào `viewMeetingNotes()` theo đúng thứ tự

    Thứ tự thực thi cuối cùng trong method:
    ```
    1. [T013] Cross-field from/to validation → INVALID_DATE_RANGE nếu vi phạm
    2. [T009] Validate meeting tồn tại + status (MEETING_NOT_FOUND / MEETING_STATUS_NOT_VIEWABLE)
    3. [T009] Lấy currentUserDeptId từ users table
    4. [T009] Membership check (NOT_A_MEETING_PARTICIPANT)
    5. [T009] Build base QueryBuilder + JOIN users + deleted_at IS NULL
    6. [T009] Visibility predicate (Host skip / Participant: buildParticipantVisibilityPredicate)
    7. [T012] applyOptionalFilters() — noteType, visibility, pinned, from, to
    8. [T016] Opt-in LEFT JOIN meeting_events (nếu includeSourceEvent=true)
    9. [T014] Sort ORDER BY created_at ASC/DESC
    10. [T015] Pagination skip/take + COUNT + meta + message
    11. Map → ViewNoteResponseDto[] → { success, message, data, meta }
    ```
    - Outcome: `viewMeetingNotes()` hoàn chỉnh, sẵn sàng wired vào controller.
    - Phụ thuộc: T009, T012, T013, T014, T015, T016.

**Checkpoint US2**: Filter/sort/pagination/enrichment done & test → full service logic verified.

---

## Phase 4: Controller & Guards

**Goal**: Wire service vào HTTP endpoint với đúng guards, DTOs, ParseUUIDPipe, response format.

- [x] **T018** Update `listNotes()` (hoặc thêm `viewNotes()`) trong `src/modules/live-meeting/controllers/live-meeting.controller.ts`

    *(Approach xác nhận từ T000: MODIFY `listNotes()` hay thêm method mới)*

    ```typescript
    @Get('meetings/:meetingId/notes')
    @HttpCode(HttpStatus.OK)
    @UseGuards(JwtAuthGuard, PermissionsGuard)
    @RequirePermissions('meeting.note.read')
    @ApiOperation({ summary: 'Xem danh sách ghi chú cuộc họp (UC-IMM-10)' })
    async viewNotes(
      @Param('meetingId', ParseUUIDPipe) meetingId: string,
      @Query(new ValidationPipe({ transform: true, whitelist: true })) query: ViewNotesQueryDto,
      @Req() req: Request,
    ): Promise<{ success: boolean; message: string; data: ViewNoteResponseDto[]; meta: PaginationMeta }> {
      const authUser = req['user'] as { userId: string };
      const result = await this.liveMeetingService.viewMeetingNotes(meetingId, query, authUser);
      return { success: true, message: result.message, data: result.data, meta: result.meta };
    }
    ```
    - Swagger: `@ApiParam` cho `meetingId`; `@ApiQuery` cho tất cả query params (noteType, visibility, pinned, from, to, includeSourceEvent, page, limit, sort); `@ApiResponse` cho 200/400/401/403/404/422.
    - Trả format `{ success, message, data, meta }` (AGENTS.md §8.1).
    - Phụ thuộc: T004, T005, T017.

- [x] **T019** Thêm test suite **Controller — View Notes** vào `src/modules/live-meeting/tests/live-meeting.controller.spec.ts`

    | # | Case | AC |
    |---|------|-----|
    | 1 | Happy path: route đúng, query parse, response format `{ success, message, data, meta }` | AC-001 |
    | 2 | `meetingId` sai UUID → 400 (ParseUUIDPipe) | spec FR-003 |
    | 3 | Thiếu JWT token → 401 `UNAUTHORIZED` (guard) | AC-017 |
    | 4 | Thiếu permission `meeting.note.read` → 403 `PERMISSION_DENIED` (guard) | AC-018 |
    | 5 | `includeSourceEvent=true` truyền đúng vào service | CD-001 |
    | 6 | `sort=timeline_desc` truyền đúng vào service | AC-013 |
    | 7 | `from`/`to` ISO string truyền đúng vào service | AC-010 |

    Phụ thuộc: T018.

**Checkpoint Phase 4**: Controller wired → có thể chạy integration test thủ công qua quickstart.

---

## Phase 5: Polish & Cross-Cutting

- [x] **T020 [P]** Validation thủ công theo `quickstart.md`
    - Chạy qua 39 test scenarios trong quickstart.md.
    - Đặc biệt verify: Verification Checklist (16 mục) — bao gồm `noteTimestamp` presence, INVARIANT-1 to 4, CD-002 admin bypass, opt-in enrichment, empty state message.
    - Ghi nhận bất kỳ deviation nào với spec và fix.
    - Phụ thuộc: T018.

- [x] **T021 [P]** Đồng bộ API contract
    - Nếu `contracts/view-meeting-notes-api.md` lệch so với implementation thực tế (field names, error codes, response shape) → update contract.
    - Kiểm tra `docs/API_CONTRACT_v1.0_with_system_roles.md` (nếu tồn tại) có cần sync UC-IMM-10 endpoint không.
    - Phụ thuộc: T018.

- [x] **T022** Chạy lint, test, build — **Definition of Done**
    - `npm run lint` — không có warning/error mới.
    - `npm run test` — tất cả test pass, bao gồm test suite US1 (T010) + US2 (T011) + Controller (T019) + DTO (T005, T006).
    - `npm run build` — compile TypeScript không lỗi.
    - Đảm bảo không phá test suite của module khác (`meetings`, `rooms`, `attendance`…).
    - Phụ thuộc: T019, T020.

---

## Dependencies & Execution Order

### Phase Dependencies

```
T000 (codebase check)
 └─► Phase 1: T001, T001b, T002, T003 (parallel) → T004
      └─► Phase 2 US1: T005, T006 (parallel tests) → T007 → T008 → T009 → T010
           └─► Phase 3 US2: T011 (test, parallel với T012-T016) → T012 → T013 → T014 → T015 → T016 → T017
                └─► Phase 4: T018 → T019
                     └─► Phase 5: T020, T021 (parallel) → T022
```

### Parallel Opportunities

| Slot | Tasks song song | Điều kiện |
|------|-----------------|-----------|
| Phase 1 | T001, T001b, T002, T003 | Khác file; không phụ thuộc nhau |
| Phase 1 → 2 boundary | T005, T006 (DTO tests) song song với T007, T008 (service helpers) | T005 chờ T002; T006 chờ T003; T007/T008 chờ T001 |
| Phase 3 start | T011 (write failing tests trước) có thể song song với T012 (implement filter helper) | T011 chờ T009; T012 chờ T009 |
| Phase 5 | T020, T021 | Không phụ thuộc nhau; cùng chờ T018 |

### Trong từng Story

- Tests viết trước (TDD) → FAIL trước khi implement → implement → tests PASS.
- Helper → Service method → Controller.
- Service test trước controller test.

### Parallel Example — Phase 1

```bash
# Chạy song song (khác file):
T001   constants/meeting-note-error.constant.ts       (+3 error codes)
T001b  seeds/<ts>-SeedMeetingNoteReadPermission.ts    (conditional)
T002   dto/view-notes-query.dto.ts
T003   dto/view-note-response.dto.ts
# Sau T002+T003 xong:
T004   dto/index.ts
```

---

## Implementation Strategy

### Phân tích trước (Phase 0)

1. T000 → xác nhận approach, tránh conflict với UC-103.

### Foundational First

2. Phase 1 (T001–T004) → infrastructure ready.

### Incremental by Story

3. Phase 2 US1 (T005–T010) → **STOP & VALIDATE**: Host/Participant visibility hoạt động đúng.
4. Phase 3 US2 (T011–T017) → **STOP & VALIDATE**: Filter/sort/pagination/enrichment đúng.
5. Phase 4 (T018–T019) → controller wired → quickstart manual test.
6. Phase 5 (T020–T022) → final polish & DoD.

---

## Requirements Coverage

| Task | FR | BR / NFR | AC | Core Concern |
|------|----|----------|----|--------------|
| T000 | — | — | — | Codebase analysis, approach decision |
| T001 | FR-014 | — | AC-019, AC-021, AC-023 | Error codes: `INVALID_DATE_RANGE`, `NOT_A_MEETING_PARTICIPANT`, `MEETING_STATUS_NOT_VIEWABLE` |
| T001b | FR-001, FR-002 | — | AC-017, AC-018 | Seed `meeting.note.read` (conditional) |
| T002 | FR-011/012/013/014/015/017 | BR-013/014 | AC-008→013, AC-022→024 | `ViewNotesQueryDto` — tất cả query params |
| T003 | FR-019, FR-021 | — | AC-001→007 | `ViewNoteResponseDto` — `noteTimestamp`, optional enrichment fields |
| T004 | — | — | — | DTO exports |
| T005 | FR-011/012/015 | BR-014 | AC-022, AC-024 | DTO test — allowlist, date format, limit max |
| T006 | FR-019, FR-021 | — | AC-004 | Response DTO test — `noteTimestamp` present, no `createdAt` |
| T007 | FR-006 | BR-002 | AC-019 | `resolveMeetingRole()` — Host/Participant xác định |
| T008 | FR-008 | BR-005, BR-006, INVARIANT-1/2/4 | AC-005, AC-006, AC-007 | `buildParticipantVisibilityPredicate()` — visibility matrix |
| T009 | FR-001/002/004/005/006/007/008/009/018/019 | BR-001/002/003/004 | AC-001→007, AC-014, AC-019→021 | Core service — validate, membership, Host/Participant path, empty state |
| T010 | FR-007/008/009/018/019 | BR-003/004/005/006, INVARIANT-1/2/3/4 | AC-001→007, AC-014, AC-019→021 | Test suite US1 — visibility rules |
| T011 | FR-010/011/012/013/014/015/016/017 | BR-013/014 | AC-008→013, AC-015, AC-016, AC-022→024 | Test suite US2 — filter/sort/pagination/enrichment (TDD) |
| T012 | FR-011/012/013/014 | BR-013/015 | AC-008→011 | `applyOptionalFilters()` — noteType/visibility/pinned/from/to |
| T013 | FR-014 | BR-013 | AC-023 | Cross-field `from > to` → `INVALID_DATE_RANGE` (CD-003) |
| T014 | FR-010 | BR-007/008 | AC-012, AC-013 | Sort `timeline_asc`/`timeline_desc` |
| T015 | FR-015, FR-016, FR-018 | BR-012/014 | AC-014, AC-015, AC-016 | Pagination + `meta` + empty state message |
| T016 | FR-017 | BR-010 | EC-006 | Opt-in enrichment `includeSourceEvent` — conditional LEFT JOIN (CD-001) |
| T017 | FR-001→FR-021 | BR-001→016 | AC-001→AC-024 | Integration toàn bộ logic trong `viewMeetingNotes()` |
| T018 | FR-001/002/003 | — | AC-017, AC-018 | Controller endpoint, guards, ParseUUIDPipe, Swagger |
| T019 | FR-001/002/003 | — | AC-017, AC-018 | Controller test suite |
| T020 | — | — | AC-001→AC-024 | Quickstart 39 scenarios + verification checklist |
| T021 | — | — | — | API contract sync |
| T022 | — | NFR-001→NFR-005 | AC-001→AC-024 | Lint/test/build (Definition of Done) |

### Traceability — Acceptance Criteria

| AC | Task chính | Task test |
|----|-----------|-----------|
| AC-001 | T009 | T010 #1 |
| AC-002 | T009 | T010 #2 |
| AC-003 | T009 | T010 #3 |
| AC-004 | T009 (JOIN users) | T010 #4 |
| AC-005 | T008, T009 | T010 #5 |
| AC-006 | T008 (INVARIANT-1) | T010 #6 |
| AC-007 | T008 (INVARIANT-2) | T010 #7 |
| AC-008 | T012 | T011 #17 |
| AC-009 | T012 | T011 #18 |
| AC-010 | T012, T013 | T011 #19, #20, #21, #22 |
| AC-011 | T012 (after visibility) | T011 #23 |
| AC-012 | T014 | T011 #24 |
| AC-013 | T014 | T011 #25 |
| AC-014 | T015 (empty state) | T010 #8 |
| AC-015 | T015 | T011 #26 |
| AC-016 | T015 | T011 #27 |
| AC-017 | T018 (JwtAuthGuard) | T019 #3 |
| AC-018 | T018 (PermissionsGuard) | T019 #4 |
| AC-019 | T009 (membership check) | T010 #12, #13 |
| AC-020 | T009 (meeting not found) | T010 #9 |
| AC-021 | T009 (status check) | T010 #10, #11 |
| AC-022 | T002 (@IsDateString) | T005, T011 #31 |
| AC-023 | T013 (INVALID_DATE_RANGE) | T011 #22 |
| AC-024 | T002 (@Max(100)) | T005, T011 #32 |

> **Out of Scope** (PATCH/DELETE/share/pin/FTS `?q`/WebSocket/AI/export/admin bypass/external participant): không có task nào.

---

## Notes

- Feature là **read-only hoàn toàn** — không có transaction ghi, không có migration mới, không cần seed mới (trừ T001b conditional).
- `noteTimestamp` (không phải `createdAt`) — đây là constraint **không thương lượng** từ CD-001. Bất kỳ code nào trả `createdAt` là sai spec.
- Admin/Manager không phải Participant **luôn** nhận 403 `NOT_A_MEETING_PARTICIPANT` (CD-002) — không có exception nào.
- `from` và `to` **độc lập** (CD-003) — không validate cross-field khi chỉ có một trong hai.
- `includeSourceEvent=false` (default) — **không JOIN `meeting_events`**, không có field `sourceEventTime`/`sourceEventType` trong response.
- Kiểm tra T000 kết quả trước khi mở task bất kỳ để tránh conflict với UC-103 implementation.
