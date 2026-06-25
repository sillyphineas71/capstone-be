# Implementation Plan: Thêm ghi chú trong cuộc họp (In-Meeting Notes)

- **Feature ID**: UC-IMM-09 / UC-102 (+ UC-103, UC-104)
- **Module / Domain**: `live-meeting`
- **Branch**: `tai-branch`
- **Date**: 2026-06-18
- **Spec**: [spec.md](spec.md)
- **Checklist nguồn**: [checklists/requirements.md](checklists/requirements.md) — toàn bộ 5 NEEDS CLARIFICATION đã được giải quyết trong spec (revision 2026-06-17).

---

## CHANGELOG & REVISION HISTORY

| Ngày cập nhật | Tóm tắt thay đổi | Các dòng thay đổi |
| :--- | :--- | :--- |
| 2026-06-18 | Bổ sung mục Constitution Check, Project Structure (tham chiếu research/data-model/contracts/quickstart), Complexity Tracking theo plan-template | Sau §2, cuối file |
| 2026-06-18 | Tạo plan.md lần đầu cho UC-IMM-09 / UC-102/103/104 dựa trên spec đã chốt clarifications | Toàn bộ file |

---

## 1. Feature Summary

Cho phép **Host** và **Internal Participant có permission** tạo ghi chú văn bản trong khi cuộc họp đang ở trạng thái `in_progress`, đồng thời xem và tìm kiếm danh sách ghi chú với bộ lọc visibility nghiêm ngặt.

- **POST tạo note** (UC-102): persist synchronous, `created_at` server-generated, `author_id` lấy từ JWT, áp default `visibility_level` theo loại note, sanitize XSS cho `content`.
- **GET danh sách note** (UC-103): lọc theo `visibility_level` dựa trên identity user hiện tại, hỗ trợ filter `noteType`/`pinned`, pagination.
- **GET tìm kiếm note** (UC-104): full-text search trên `content` (GIN index), kết hợp visibility filter.

**Phạm vi đo lường**: 17 Functional Requirements (FR-001→FR-018, không có FR-012), 5 NFR, 13 Acceptance Criteria (AC-001→AC-014, không có AC-006), 8 error code, 1 edge case (EC-001).

Auto-save draft là chức năng phía **client** (LocalStorage). Backend chỉ nhận 1 POST dứt điểm — **không** có trạng thái draft phía server, **không** dùng WebSocket broadcast (BR-011, Out of Scope).

---

## 2. Technical Context

| Aspect | Detail |
|--------|--------|
| Language | TypeScript (strict) |
| Framework | NestJS 10+ |
| Database | PostgreSQL (TypeORM) |
| ORM | TypeORM — inject `DataSource`, dùng `dataSource.transaction()` cho ghi |
| Auth | JWT (`JwtAuthGuard`) + RBAC (`PermissionsGuard` + `@RequirePermissions`) |
| Module | `live-meeting` (đã tồn tại) — thêm route notes vào `LiveMeetingController`/`LiveMeetingService` |
| Entity | `MeetingNoteEntity` **đã tồn tại** tại `src/modules/meetings/entities/meeting-note.entity.ts` (enum `MeetingNoteType` đã có) |
| Realtime | **KHÔNG dùng WebSocket** (spec §1.1, Out of Scope) — lấy dữ liệu qua polling/fetch GET |
| Validation | `class-validator` + global `ValidationPipe({ whitelist, forbidNonWhitelisted, transform })` |
| Sanitization | NFR-005 — util sanitize HTML cho `content` (xem §8, §12) |
| Testing | Jest (unit test service + controller + DTO) |
| Codebase reference | UC-IMM-05 End Meeting (`feat-end-meeting-session/plan.md`) làm pattern chính cho controller/service/seed |

**Phụ thuộc upstream**: UC-IMM-01 (meeting đã `in_progress`). Không động đến logic start/end meeting.

---

## 2b. Constitution Check

*GATE: phải PASS trước Phase 0. Re-check sau Phase 1 design.* Tham chiếu `.specify/memory/constitution.md`.

| Gate | Điều kiện | Kết quả |
|------|-----------|---------|
| **DB Gate** (I) | Không thêm bảng/cột ngoài baseline | ✅ PASS — tái dùng `meeting_notes`; chỉ thêm GIN index (index-only) |
| **Security Gate** (II) | Không plain credential/log nhạy cảm | ✅ PASS — không log đầy đủ `content`; không credential |
| **Scope Gate** (III) | Không vượt use case; không AI/embedding | ✅ PASS — PATCH/DELETE/share/pin/tag/WebSocket/AI giữ Out of Scope |
| **Module Gate** (IV) | Không import chéo bừa bãi | ✅ PASS — route trong `live-meeting`; đọc entity `meetings` qua DataSource (tiền lệ sẵn có) |
| **API Gate** (V) | Format `{success,message,data,meta}`, HTTP codes, pagination | ✅ PASS — theo convention + bảng error spec §6 |
| **Auth Gate** (VI) | `JwtAuthGuard` + user_id từ JWT | ✅ PASS — guard + `author_id` từ JWT (FR-003) |
| **Test Gate** | Unit test service + DTO | ✅ PASS — §10 phủ service/controller/DTO |
| **Typescript Strict** (VII) | strict typing, DTO validation, tránh `any` | ✅ PASS |

**Kết luận**: Không có vi phạm constitution ⇒ Complexity Tracking để trống (xem §14).

---

## 2c. Project Structure

### Documentation (feature này — output bước `/speckit.plan`)

```text
spec/features/live-meeting/feat-in-meeting-notes/
├── spec.md                          # Input (đã có)
├── plan.md                          # File này
├── research.md                      # Phase 0 — quyết định kỹ thuật
├── data-model.md                    # Phase 1 — bảng/cột/index/transaction
├── quickstart.md                    # Phase 1 — kịch bản test & checklist
├── contracts/
│   └── in-meeting-notes-api.md      # Phase 1 — API contract UC-102/103/104
├── checklists/
│   └── requirements.md              # Đã có
└── tasks.md                         # Phase 2 — output /speckit.tasks (KHÔNG tạo ở plan)
```

### Source Code (repository) — single project NestJS modular monolith

```text
src/
├── common/
│   └── utils/
│       ├── sanitize-note-content.util.ts        # MỚI (NFR-005)
│       └── sanitize-note-content.util.spec.ts    # MỚI
├── modules/
│   ├── live-meeting/
│   │   ├── controllers/live-meeting.controller.ts # MODIFY (+createNote, +listNotes)
│   │   ├── services/live-meeting.service.ts        # MODIFY (+createMeetingNote, +listMeetingNotes)
│   │   ├── constants/meeting-note-error.constant.ts # MỚI
│   │   ├── dto/
│   │   │   ├── create-note.dto.ts                  # MỚI
│   │   │   ├── note-response.dto.ts                # MỚI
│   │   │   ├── list-notes-query.dto.ts             # MỚI
│   │   │   └── index.ts                            # MODIFY (export DTO mới)
│   │   └── tests/                                  # MODIFY (thêm suite)
│   └── meetings/entities/meeting-note.entity.ts    # KHÔNG đổi (đã đủ)
└── database/
    ├── migrations/<ts>-AddMeetingNotesContentGinIndex.ts # MỚI (index-only)
    └── seeds/<ts>-SeedMeetingNotePermissions.ts          # MỚI
```

**Structure Decision**: Single project (modular monolith) — feature thuộc module `live-meeting` đã tồn tại; không tạo module/controller mới (tránh trùng route ownership, theo tiền lệ `extension-requests`). Chi tiết file tại Appendix.

---

## 3. Scope Confirmation

### ✅ IN SCOPE

- `POST /api/v1/meetings/{meetingId}/notes` — tạo note (UC-102).
- `GET /api/v1/meetings/{meetingId}/notes` — danh sách + filter + full-text search (UC-103 & UC-104, gộp 1 route, phân nhánh theo query `?q`).
- Default `visibility_level` theo `note_type` (BR-005/006/007).
- Guard `host_note` chỉ cho Host (BR-004, FR-006).
- Cấm `system_note` từ user actor (BR-003, FR-005).
- Visibility filter nghiêm ngặt khi GET (BR-008, FR-014, FR-018).
- Loại trừ note `deleted_at IS NOT NULL` (BR-010, FR-016).
- Sanitize XSS cho `content` (NFR-005).
- Migration thêm **GIN index** cho full-text search trên `meeting_notes.content` (phục vụ FR-017) — **chỉ thêm index, không đổi cột/bảng**.
- Seed permission `meeting.note.create`, `meeting.note.read`.

### ❌ OUT OF SCOPE (không đưa vào plan)

- PATCH cập nhật nội dung note; DELETE (soft delete) note — UC riêng.
- "Share" `host_note` (đổi `visibility_level` sang `participants`) — thao tác PATCH, UC riêng.
- Pin/unpin sau khi đã tạo — thao tác PATCH, UC riêng.
- Tag phân loại (Quyết định/Hành động/Ý tưởng) — không đổi schema, future enhancement.
- Tạo `system_note` (do internal system tạo, có `source_event_id`).
- Đính kèm note vào email minutes — module `minutes`/`notifications`.
- AI transcript/summary, export PDF/DOCX, note pre/post-meeting.
- Realtime WebSocket cho note.
- **Không** thêm bảng/cột mới (Data Model giữ nguyên DB v3.2 Compact).

---

## 4. Data Model Impact

**KHÔNG thêm bảng mới. KHÔNG thêm cột mới.** Sử dụng `MeetingNoteEntity` đã tồn tại.

### 4.1 Bảng `meeting_notes` (đọc/ghi)

| Column | Operation UC-102 | Ghi chú |
|---|---|---|
| `id` | INSERT (auto uuid) | PK |
| `meeting_id` | INSERT (từ param) | FK → `meetings.id` |
| `author_id` | INSERT (từ JWT, **không** từ body) | FR-003 |
| `note_type` | INSERT (allowlist: `in_meeting`/`private`/`host_note`) | BR-003 |
| `content` | INSERT (sau khi sanitize) | NFR-005 |
| `pinned` | INSERT (default `false`; `true` chỉ Host) | BR-009 |
| `visibility_level` | INSERT (default theo `note_type` nếu client không gửi) | BR-005/006/007 |
| `source_event_id` | NULL với manual note | spec §5.1 |
| `created_at` | server `DEFAULT now()` (`@CreateDateColumn`) | BR-002 |
| `updated_at` | auto | — |
| `deleted_at` | NULL khi tạo; là điều kiện lọc khi GET | BR-010 |

### 4.2 Bảng chỉ đọc (validate/join)

| Bảng | Mục đích |
|---|---|
| `meetings` | Check tồn tại + `status = in_progress` (BR-001, FR-002) |
| `meeting_participants` | Check `is_host = true` (BR-004/009); xác định user có là participant (visibility `participants`) |
| `users` | Join `author` cho response (`id`, `full_name`); xác định `department_id` (visibility `department`) |

### 4.3 Index thay đổi (Index-only, KHÔNG đổi schema cột)

- **MỚI**: GIN index hỗ trợ full-text search `content` cho UC-104 (FR-017). Migration tạo index biểu thức trên `to_tsvector('simple', content)` (dùng cấu hình `simple` để an toàn với tiếng Việt không dấu/có dấu; xác nhận lại với team — xem §12 Risks).
  - Lý do dùng `simple`: PostgreSQL không có text search config tiếng Việt mặc định; `simple` tránh stemming sai và vẫn cho phép match keyword.

> Index là thay đổi an toàn, không vi phạm "không đổi schema baseline". Vẫn tạo migration rõ ràng (RULE TypeORM).

---

## 5. API / Contract Plan

### 5.1 `POST /api/v1/meetings/{meetingId}/notes` (UC-102)

- **Permission**: `meeting.note.create` (controller-level).
- **Request body** (`CreateNoteDto`):
  ```json
  { "noteType": "in_meeting", "content": "…", "pinned": false, "visibilityLevel": "participants" }
  ```
  - `noteType` required; `content` required; `pinned` optional (default false); `visibilityLevel` optional (default theo `noteType`).
  - `whitelist + forbidNonWhitelisted` ⇒ `createdAt`/`authorId`/`author_id` client gửi sẽ bị **reject** (forbidNonWhitelisted) hoặc strip — bảo đảm BR-002/FR-003. (Quyết định: dùng `forbidNonWhitelisted` để 400 nếu gửi field cấm; nhất quán global pipe.)
- **Response 201** (`NoteResponseDto`):
  ```json
  { "success": true, "message": "…", "data": {
      "id", "meetingId", "noteType", "content", "pinned",
      "visibilityLevel", "author": { "id", "fullName" }, "createdAt" } }
  ```
- **HTTP statuses**: 201, 400, 401, 403 (`PERMISSION_DENIED`/`NOTE_HOST_ONLY`), 404, 409, 422.

### 5.2 `GET /api/v1/meetings/{meetingId}/notes` (UC-103 + UC-104)

- **Permission**: `meeting.note.read`.
- **Query** (`ListNotesQueryDto`): `noteType?`, `pinned?` (boolean), `q?` (full-text keyword), `page?` (default 1), `limit?` (default 20, max 100).
  - Khi có `q` ⇒ nhánh full-text search (UC-104); không có `q` ⇒ list/filter (UC-103). Cả hai đều áp visibility filter.
- **Response 200**: `{ success, message, data: NoteResponseDto[], meta: { page, limit, total, totalPages } }`.
- **HTTP statuses**: 200, 400/422 (query sai), 401, 403, 404.

### 5.3 Controller / Service mapping

- File controller (MODIFY): `src/modules/live-meeting/controllers/live-meeting.controller.ts` — thêm `createNote()` và `listNotes()` theo pattern hiện có (`@Post`, `@Get`, `@UseGuards(JwtAuthGuard, PermissionsGuard)`, `@RequirePermissions(...)`, `ParseUUIDPipe` cho `meetingId`, lấy `user` từ `request['user']`).
- File service (MODIFY): `src/modules/live-meeting/services/live-meeting.service.ts` — thêm `createMeetingNote(...)`, `listMeetingNotes(...)`. Dùng `this.dataSource` đã inject.

> Route nằm dưới prefix `meetings/...` (đúng API contract §8) nhưng được phục vụ bởi `LiveMeetingController` (giống `requestExtension` đã đặt `@Post('meetings/:meetingId/extension-requests')` trong controller này). Không tạo controller mới để tránh trùng route ownership.

---

## 6. Authorization Plan

| Level | Mechanism | Detail |
|-------|-----------|--------|
| Controller (create) | `@RequirePermissions('meeting.note.create')` | FR-001 |
| Controller (read) | `@RequirePermissions('meeting.note.read')` | FR-013 |
| Service (host_note) | Ownership check | Nếu `noteType = host_note` ⇒ verify `meeting_participants.is_host = true` cho currentUser; nếu không ⇒ `403 NOTE_HOST_ONLY` (FR-006, BR-004) |
| Service (pinned) | Ownership check | `pinned = true` chỉ Host được set (BR-009); non-host gửi `pinned=true` ⇒ ép `false` hoặc 403 — **quyết định**: ép về `false` (an toàn, không chặn flow) và ghi log; xem §12 |
| Service (visibility filter) | Identity-based filter | Khi GET, áp filter theo currentUser (BR-008, FR-014) |

### Visibility filter semantics (FR-014, FR-018)

User chỉ thấy note nếu thỏa **một** trong các điều kiện:
- `private` ⇒ `author_id = currentUserId`.
- `participants` ⇒ currentUser là participant của meeting (tồn tại trong `meeting_participants`).
- `department` ⇒ currentUser cùng `department_id` với `author` (diễn giải; spec chỉ liệt kê allowlist, ngữ nghĩa lọc cần xác nhận — §12).
- `public_internal` ⇒ mọi internal user đã xác thực (diễn giải; §12).

Author luôn thấy note của chính mình bất kể `visibility_level`.

### Seed permission (mới)

- `meeting.note.create` → gán `INTERNAL_USER`, `MANAGER`, `BUSINESS_ADMIN`, `SYSTEM_ADMIN` (Host & Internal Participant đều có — spec §2).
- `meeting.note.read` → gán cùng nhóm role.
- Theo pattern `seeds/...-SeedMeetingEndPermission.ts` (INSERT permissions ON CONFLICT DO NOTHING + gán role_permissions).

---

## 7. Business Logic Plan

### 7.1 `createMeetingNote(meetingId, dto, authUser)` → `NoteResponseDto`

```
1. Resolve currentUserId từ JWT (authUser.userId).
2. Sanitize dto.content (NFR-005); sau sanitize, trim → nếu rỗng/whitespace ⇒ 400 VALIDATION_ERROR (FR-009).
3. Reject noteType = system_note ⇒ 422 NOTE_SYSTEM_TYPE_FORBIDDEN (FR-005, BR-003).
4. dataSource.transaction(async (em) => {
     a. SELECT meeting (id, status). Nếu không có/deleted ⇒ 404 MEETING_NOT_FOUND (FR-002).
     b. Nếu status != in_progress ⇒ 409 MEETING_NOT_IN_PROGRESS (BR-001, EC-001/AC-014).
     c. Xác định isHost = EXISTS(meeting_participants WHERE meeting_id, user_id=current, is_host=true).
     d. Nếu noteType = host_note và !isHost ⇒ 403 NOTE_HOST_ONLY (FR-006, BR-004).
     e. Tính visibilityLevel:
        - nếu dto.visibilityLevel có giá trị ⇒ validate ∈ ['private','participants','department','public_internal'] (FR-008); sai ⇒ 400 VALIDATION_ERROR.
        - nếu không gửi ⇒ default theo noteType: host_note→private, in_meeting→participants, private→private (BR-005/006/007).
     f. Tính pinned: nếu dto.pinned=true và !isHost ⇒ ép false (BR-009).
     g. INSERT meeting_notes { meeting_id, author_id=current, note_type, content(sanitized),
        pinned, visibility_level, source_event_id=NULL }. created_at do DB sinh (BR-002, FR-004).
   })
5. Load lại note + author (id, full_name) để build response.
6. Return NoteResponseDto (201). (FR-010, FR-011, NFR-001)
```

> Transaction boundary: chỉ 1 INSERT + các SELECT validate. Dùng transaction để đảm bảo đọc trạng thái meeting nhất quán với việc ghi (tránh race với End Meeting — AC-014). Có thể dùng `SELECT ... FOR SHARE` trên `meetings` để khóa đọc trạng thái trong khi insert (cân nhắc; pessimistic read tránh end-meeting commit xen giữa). **Quyết định**: dùng `setLock('pessimistic_read')` trên meeting để đóng chặt EC-001.

### 7.2 `listMeetingNotes(meetingId, query, authUser)` → `{ data, meta }`

```
1. SELECT meeting; không có ⇒ 404 MEETING_NOT_FOUND. (Không yêu cầu in_progress khi đọc — spec không ràng buộc.)
2. Build query builder trên meeting_notes:
   - WHERE meeting_id = :meetingId
   - AND deleted_at IS NULL (BR-010, FR-016)
   - AND visibility predicate (xem §6) theo currentUser/isParticipant/isAuthor/department
   - filter optional: note_type = :noteType; pinned = :pinned (FR-015)
   - nếu query.q: AND to_tsvector('simple', content) @@ plainto_tsquery('simple', :q)  (FR-017, dùng GIN index)
3. Pagination: offset/limit, count total.
4. Join author (id, full_name). Map sang NoteResponseDto[].
5. Return { data, meta }.
```

---

## 8. Validation Plan

| Validation | Layer | Error Code | HTTP |
|------------|-------|------------|------|
| `meetingId` đúng UUID | `ParseUUIDPipe` | `VALIDATION_ERROR` | 400/422 |
| `noteType` ∈ {`in_meeting`,`private`,`host_note`} | DTO `@IsIn` | `VALIDATION_ERROR` | 400 |
| `noteType = system_note` | Service | `NOTE_SYSTEM_TYPE_FORBIDDEN` | 422 |
| `content` không rỗng/whitespace (sau sanitize) | DTO `@IsNotEmpty` + Service trim | `VALIDATION_ERROR` | 400 |
| `content` ≤ max length (đề xuất 10.000 ký tự) | DTO `@MaxLength` | `VALIDATION_ERROR` | 400 |
| `visibilityLevel` ∈ allowlist (nếu gửi) | DTO `@IsIn(['private','participants','department','public_internal'])` | `VALIDATION_ERROR` | 400 |
| `pinned` boolean | DTO `@IsBoolean` | `VALIDATION_ERROR` | 400 |
| Field cấm (`createdAt`,`authorId`,…) | Global pipe `forbidNonWhitelisted` | `VALIDATION_ERROR` | 400 |
| Query `page/limit` số, `limit` ≤ 100 | `ListNotesQueryDto` + transform | `VALIDATION_ERROR` | 400/422 |
| `q` length ≤ 200 | DTO `@MaxLength` | `VALIDATION_ERROR` | 400 |
| Sanitize XSS `content` | Service util (NFR-005) | — | — |
| Đã xác thực | `JwtAuthGuard` | `UNAUTHORIZED` | 401 |
| Có permission | `PermissionsGuard` | `PERMISSION_DENIED` | 403 |

**Sanitization (NFR-005)**: thêm util `sanitizeNoteContent()` trong `src/common/utils/` — strip/escape các tag HTML nguy hiểm (`<script>`, `<iframe>`, event handlers, `javascript:` …), giữ plain text/Markdown. **Không** thêm dependency nặng nếu tránh được; nếu team muốn dùng `sanitize-html` thì xác nhận trước khi thêm (§12). Sanitize tại service trước khi INSERT (defense-at-write); output trả về đã là chuỗi sạch.

---

## 9. Error Handling Plan

### Error code constant (mới)

- File: `src/modules/live-meeting/constants/meeting-note-error.constant.ts` (pattern `MEETING_END_ERRORS`).
- Codes: `MEETING_NOT_FOUND`, `MEETING_NOT_IN_PROGRESS`, `NOTE_HOST_ONLY`, `NOTE_SYSTEM_TYPE_FORBIDDEN`, `VALIDATION_ERROR`, `PERMISSION_DENIED`.

### Exception mapping (spec §6)

| HTTP | Code | Exception NestJS |
|---:|---|---|
| 400 | `VALIDATION_ERROR` | `BadRequestException` |
| 401 | `UNAUTHORIZED` | (JwtAuthGuard) |
| 403 | `PERMISSION_DENIED` | `ForbiddenException` / PermissionsGuard |
| 403 | `NOTE_HOST_ONLY` | `ForbiddenException` |
| 404 | `MEETING_NOT_FOUND` | `NotFoundException` |
| 409 | `MEETING_NOT_IN_PROGRESS` | `ConflictException` |
| 422 | `NOTE_SYSTEM_TYPE_FORBIDDEN` | `UnprocessableEntityException` |
| 500 | `INTERNAL_ERROR` | (global filter) |

- Payload chuẩn: `{ success: false, message, error: { code, details } }` (theo global exception filter + pattern các route khác).
- Transaction tự rollback nếu có exception trong block.
- **Không** log `content` nhạy cảm đầy đủ; chỉ log meta (meetingId, noteType, authorId) ở mức cần thiết.

---

## 10. Testing Strategy

### 10.1 Unit test — Service (`tests/live-meeting.service.spec.ts`, thêm suite)

Bám NFR-004 + AC:
1. Create `in_meeting` happy path (meeting `in_progress`) → persist, `createdAt` server-gen, `visibilityLevel='participants'` (AC-001, AC-004).
2. `createdAt` không trùng giá trị thời gian client gửi → field bị whitelist loại bỏ (AC-002).
3. Host tạo `host_note` không gửi visibility → `visibilityLevel='private'` (AC-003, BR-005).
4. `private` note → `visibilityLevel='private'`, chỉ author thấy (AC-005).
5. Non-host gửi `host_note` → `403 NOTE_HOST_ONLY` (AC-007, FR-006).
6. Bất kỳ actor gửi `system_note` → `422 NOTE_SYSTEM_TYPE_FORBIDDEN` (AC-008, FR-005).
7. Meeting `completed`/`cancelled` → `409 MEETING_NOT_IN_PROGRESS` (AC-009).
8. `content` rỗng/whitespace → `400 VALIDATION_ERROR` (AC-010).
9. Meeting không tồn tại → `404 MEETING_NOT_FOUND`.
10. EC-001/AC-014: meeting vừa chuyển `completed` lúc POST → `409` (mô phỏng lock/trạng thái).
11. Visibility filter GET: `private` của user khác không trả về (BR-008, NFR-002).
12. `deleted_at IS NOT NULL` không xuất hiện trong GET (AC-013, FR-016).
13. GET filter `noteType=in_meeting&pinned=true` chỉ trả note hợp visibility (AC-011).
14. GET `?q=…` full-text + visibility filter (AC-012).
15. Sanitize: `content` chứa `<script>` → lưu chuỗi đã làm sạch (NFR-005).

### 10.2 Unit test — Controller (`tests/live-meeting.controller.spec.ts`, thêm suite)

1. POST happy path: route, body parse, response format `{ success, message, data }`.
2. Invalid `meetingId` UUID → 400/422.
3. Thiếu token → 401 (guard).
4. Thiếu permission → 403 (guard).
5. GET trả `{ success, message, data, meta }` với pagination.

### 10.3 DTO test

- `dto/create-note.dto.spec.ts`: validate `noteType` allowlist, `content` not empty, `visibilityLevel` allowlist, reject extra field.
- `dto/note-response.dto.spec.ts`: constructor + field types.

### 10.4 Test convention

- Mock `DataSource`/`EntityManager` + query builder (pattern các spec hiện có trong `tests/`).
- Không phụ thuộc DB thật trong unit test.

---

## 11. Implementation Phases

### Phase 1 — Constants & DTO
- Tạo `constants/meeting-note-error.constant.ts`.
- Tạo `dto/create-note.dto.ts`, `dto/note-response.dto.ts`, `dto/list-notes-query.dto.ts`.
- Cập nhật `dto/index.ts` export DTO mới.
- Tạo spec test DTO.

### Phase 2 — Sanitization util
- Tạo `src/common/utils/sanitize-note-content.util.ts` (+ unit test).
- (Quyết định dependency vs simple-strip — §12.)

### Phase 3 — Service
- Thêm `createMeetingNote()` (transaction + lock + validate + default visibility + sanitize + INSERT).
- Thêm `listMeetingNotes()` (visibility filter + filter + FTS + pagination).
- Thêm private helper: `resolveDefaultVisibility(noteType)`, `isMeetingHost(em, meetingId, userId)`, `buildVisibilityPredicate(...)`.

### Phase 4 — Controller
- Thêm `createNote()` (`@Post('meetings/:meetingId/notes')`, `@RequirePermissions('meeting.note.create')`, 201).
- Thêm `listNotes()` (`@Get('meetings/:meetingId/notes')`, `@RequirePermissions('meeting.note.read')`, 200 + meta).
- Swagger decorators theo pattern hiện có.

### Phase 5 — Migration & Seed
- Migration: `src/database/migrations/<ts>-AddMeetingNotesContentGinIndex.ts` (GIN index expression `to_tsvector('simple', content)`), kèm `down()` drop index.
- Seed: `src/database/seeds/<ts>-SeedMeetingNotePermissions.ts` (`meeting.note.create`, `meeting.note.read`) theo pattern seed hiện có; đăng ký vào runner seed nếu có file tổng hợp.
- Kiểm tra entity `MeetingNoteEntity` đã được register trong data-source/index (đã có) — **không** sửa entity.

### Phase 6 — Tests & verify
- Thêm test suite service + controller; chạy `npm run lint`, `npm run test`, `npm run build`.
- Đảm bảo không phá test module khác.

---

## 12. Risks & Mitigations

| Risk | Impact | Mitigation |
|------|--------|------------|
| Ngữ nghĩa `department` / `public_internal` chưa được spec định nghĩa rõ phần lọc | Visibility filter có thể sai kỳ vọng | Triển khai theo diễn giải tối thiểu (cùng department / mọi internal user); **xác nhận với team** trước khi finalize; cô lập trong `buildVisibilityPredicate` dễ sửa |
| PostgreSQL không có text search config tiếng Việt | FTS match kém với dấu | Dùng config `simple` + `plainto_tsquery('simple', q)`; xác nhận đủ cho v1; unaccent là future enhancement (ngoài scope) |
| Thiếu dependency sanitize HTML | NFR-005 chưa thỏa | Mặc định viết util strip/escape thủ công (deterministic, test được). Nếu team muốn `sanitize-html` → cần duyệt thêm dependency (CLAUDE.md §26.4) |
| `pinned=true` từ non-host | Vi phạm BR-009 | Ép `false` thay vì 403 (không chặn flow chính); ghi nhận quyết định trong code comment |
| Race với End Meeting (EC-001) | Note tạo sau khi meeting `completed` | `pessimistic_read` lock trên `meetings` trong transaction; check status trong cùng transaction |
| Permission `meeting.note.*` chưa seed | 403 khi test | Seed migration Phase 5; kiểm tra seed runner hiện có trước khi tạo |
| Route `meetings/:meetingId/notes` trùng ownership với MeetingsController | Trùng route | Đặt trong `LiveMeetingController` (đã có tiền lệ `meetings/:meetingId/extension-requests`); xác nhận không có route notes khác |
| GIN index migration trên bảng đã có data | Lock nhẹ khi build index | Dùng index thường (data demo nhỏ); cân nhắc `CONCURRENTLY` nếu production (ngoài scope demo) |

---

## 13. Acceptance Criteria Traceability

| AC ID | Nội dung | FR/BR liên quan | Test (Phase) |
|-------|----------|-----------------|--------------|
| AC-001 | Host tạo `in_meeting` khi `in_progress` → 201, `createdAt` server-gen | FR-001/002/004/010/011 | Service #1 (P3) |
| AC-002 | `createdAt` ≠ giá trị client gửi | FR-004, BR-002 | Service #2 (P3) |
| AC-003 | `host_note` không gửi visibility → `private`, ẩn với participant thường | BR-005, FR-007, FR-014 | Service #3, #11 (P3) |
| AC-004 | `in_meeting` không gửi visibility → `participants` | BR-006, FR-007 | Service #1 (P3) |
| AC-005 | `private` note → chỉ author thấy | BR-007, BR-008 | Service #4, #11 (P3) |
| AC-007 | Non-host gửi `host_note` → 403 `NOTE_HOST_ONLY` | FR-006, BR-004 | Service #5 (P3) |
| AC-008 | Bất kỳ actor gửi `system_note` → 422 | FR-005, BR-003 | Service #6 (P3) |
| AC-009 | Meeting `completed`/`cancelled` → 409 | BR-001, FR-002 | Service #7 (P3) |
| AC-010 | `content` rỗng/whitespace → 400 | FR-009 | Service #8 + DTO (P1/P3) |
| AC-011 | GET filter `noteType`+`pinned` theo visibility | FR-015, FR-014 | Service #13 (P3) |
| AC-012 | GET `?q=` full-text + visibility filter | FR-017, FR-018 | Service #14 (P3) |
| AC-013 | Note `deleted_at` không xuất hiện | BR-010, FR-016 | Service #12 (P3) |
| AC-014 | POST khi meeting vừa `completed` → 409 (EC-001) | BR-001 | Service #10 (P3) |

> **AC-006 (tag phân loại)**: PENDING trong checklist do Clarification #2 — đã chốt **Out of Scope** (không đổi schema). Không trace, không implement.

---

## 14. Complexity Tracking

> Chỉ điền nếu Constitution Check có vi phạm cần justify.

**Không có vi phạm constitution.** Feature tái dùng schema baseline, không thêm bảng/cột, không mở rộng scope, không thêm dependency nặng (sanitize dùng util tự viết). ⇒ Bảng trống.

| Violation | Why Needed | Simpler Alternative Rejected Because |
|-----------|------------|-------------------------------------|
| — | — | — |

---

## Appendix: File Inventory

### Files to CREATE
- `src/modules/live-meeting/constants/meeting-note-error.constant.ts`
- `src/modules/live-meeting/dto/create-note.dto.ts`
- `src/modules/live-meeting/dto/note-response.dto.ts`
- `src/modules/live-meeting/dto/list-notes-query.dto.ts`
- `src/modules/live-meeting/dto/create-note.dto.spec.ts`
- `src/modules/live-meeting/dto/note-response.dto.spec.ts`
- `src/common/utils/sanitize-note-content.util.ts`
- `src/common/utils/sanitize-note-content.util.spec.ts`
- `src/database/migrations/<ts>-AddMeetingNotesContentGinIndex.ts`
- `src/database/seeds/<ts>-SeedMeetingNotePermissions.ts`

### Files to MODIFY
- `src/modules/live-meeting/dto/index.ts` (export DTO mới)
- `src/modules/live-meeting/controllers/live-meeting.controller.ts` (thêm `createNote`, `listNotes`)
- `src/modules/live-meeting/services/live-meeting.service.ts` (thêm `createMeetingNote`, `listMeetingNotes` + helpers)
- `src/modules/live-meeting/tests/live-meeting.service.spec.ts` (thêm suite)
- `src/modules/live-meeting/tests/live-meeting.controller.spec.ts` (thêm suite)
- (Seed runner tổng hợp nếu có — đăng ký seed mới)

### Files KHÔNG đổi
- `src/modules/meetings/entities/meeting-note.entity.ts` (entity đã đủ — không sửa)
- `src/modules/live-meeting/live-meeting.module.ts` (service dùng `DataSource` global; không cần `forFeature` — xác nhận lại ở Phase 3)
