# Implementation Plan: Xem ghi chú trong cuộc họp (View Meeting Notes)

- **Feature ID**: UC-IMM-10
- **Feature Name**: Xem ghi chú trong cuộc họp
- **Module / Domain**: `live-meeting`
- **Branch**: `tai-branch`
- **Date**: 2026-06-18
- **Spec**: [spec.md](spec.md)
- **Checklist nguồn**: [checklists/requirements.md](checklists/requirements.md) — toàn bộ requirements đã rõ; 3 Clarification Decisions (CD-001/CD-002/CD-003) đã được tích hợp vào spec.

---

## CHANGELOG & REVISION HISTORY

| Ngày cập nhật | Tóm tắt thay đổi | Các dòng thay đổi |
| :--- | :--- | :--- |
| 2026-06-18 | Tạo plan.md lần đầu cho UC-IMM-10 dựa trên spec đã chốt 3 Clarification Decisions | Toàn bộ file |

---

## 1. Feature Summary

Cho phép **Host** và **Participant hợp lệ** xem danh sách ghi chú của cuộc họp theo timeline, với visibility filter nghiêm ngặt phân theo vai trò.

- **GET danh sách ghi chú** (UC-IMM-10): read-only hoàn toàn — không INSERT/UPDATE/DELETE bất kỳ bảng nào.
- **Host** thấy **tất cả** ghi chú hợp lệ (`deleted_at IS NULL`) của meeting, bao gồm private notes và host_notes của mọi author.
- **Participant** (non-Host) chỉ thấy ghi chú shared/public và ghi chú của chính mình; tuyệt đối không thấy private notes của người khác.
- Hỗ trợ filter: `noteType`, `visibility`, `pinned`, `from`/`to` (độc lập, CD-003), `sort`, `includeSourceEvent` (opt-in enrichment từ `meeting_events`, CD-001).
- Response trả `noteTimestamp` (mapped từ `meeting_notes.created_at`, CD-001) thay vì `createdAt` để phân biệt rõ với UC-103.
- Hợp lệ với meeting ở `in_progress` **hoặc** `completed` — khác UC-102 (chỉ `in_progress`).
- **Không có admin/manager bypass**: phải là Host hoặc Participant hợp lệ (CD-002, BR-016).

**Phạm vi đo lường**: 21 Functional Requirements (FR-001→FR-021), 5 NFR, 24 Acceptance Criteria (AC-001→AC-024), 8 error code, 10 Edge Cases.

---

## 2. Technical Context

| Aspect | Detail |
|--------|--------|
| Language | TypeScript (strict) |
| Framework | NestJS 10+ |
| Database | PostgreSQL (TypeORM) |
| ORM | TypeORM — `DataSource` + `QueryBuilder` cho SELECT có điều kiện phức tạp |
| Auth | JWT (`JwtAuthGuard`) + RBAC (`PermissionsGuard` + `@RequirePermissions`) |
| Module | `live-meeting` (đã tồn tại) — cùng controller/service đã có từ UC-103 |
| Entity | `MeetingNoteEntity` đã tồn tại — không sửa entity |
| Transaction | **KHÔNG cần** — read-only operation (BR-011, FR-020) |
| Migration | **KHÔNG cần** — không thêm bảng/cột; GIN index đã tạo bởi UC-102 migration |
| Seed permission | **KHÔNG cần** — `meeting.note.read` đã seed bởi UC-102 plan |
| Validation | `class-validator` + global `ValidationPipe({ whitelist, forbidNonWhitelisted, transform })` |
| Testing | Jest (unit test service + controller + DTO) |
| Codebase reference | `feat-in-meeting-notes/plan.md` (UC-103 đã tạo `listNotes()`) — UC-IMM-10 là **refinement/extension** của UC-103 GET |

**Quan hệ với UC-103**: Cùng endpoint `GET /api/v1/meetings/{meetingId}/notes`. UC-IMM-10 là spec đầy đủ hơn: mở rộng `status` (`completed` cho phép), bổ sung filter `from`/`to`/`sort`/`includeSourceEvent`, thêm Host vs Participant visibility matrix đầy đủ, đổi tên field `createdAt` → `noteTimestamp`, thêm error code `NOT_A_MEETING_PARTICIPANT` và `INVALID_DATE_RANGE`. Plan này **treat UC-IMM-10 là spec canonical** cho GET endpoint; `listNotes()` từ UC-103 cần được update theo.

**Phụ thuộc upstream**:
- UC-IMM-01 (meeting đã tồn tại).
- UC-IMM-09 / UC-102 (ghi chú được tạo — meeting cần có note thì mới có gì mà xem).

---

## 2b. Constitution Check

*GATE: phải PASS trước Phase 0. Re-check sau Phase 2 design.*

| Gate | Điều kiện | Kết quả |
|------|-----------|---------|
| **DB Gate** (I) | Không thêm bảng/cột ngoài baseline | ✅ PASS — chỉ SELECT trên schema hiện có; không migration |
| **Security Gate** (II) | Không plain credential/log nhạy cảm | ✅ PASS — không log `content` ghi chú đầy đủ; không credential |
| **Scope Gate** (III) | Không vượt use case; không AI/embedding | ✅ PASS — PATCH/DELETE/share/pin/tag/FTS/WebSocket/AI đều Out of Scope |
| **Module Gate** (IV) | Không import chéo bừa bãi | ✅ PASS — route trong `live-meeting`; join `users`/`meeting_events` qua DataSource (tiền lệ sẵn có) |
| **API Gate** (V) | Format `{success,message,data,meta}`, HTTP codes, pagination | ✅ PASS — theo convention; meta đầy đủ `page/limit/total/totalPages` |
| **Auth Gate** (VI) | `JwtAuthGuard` + `PermissionsGuard` + membership check | ✅ PASS — guard + service-level Host/Participant check; no admin bypass (CD-002) |
| **Test Gate** | Unit test service + DTO | ✅ PASS — §10 phủ 24 AC |
| **Typescript Strict** (VII) | strict typing, DTO validation, tránh `any` | ✅ PASS |

**Kết luận**: Không có vi phạm constitution ⇒ Complexity Tracking để trống (§14).

---

## 2c. Project Structure

### Documentation (feature này — output bước `/speckit-plan`)

```text
spec/features/live-meeting/feat-view-meeting-notes/
├── spec.md                                  # Input (đã có, đã tích hợp CD-001/002/003)
├── plan.md                                  # File này
├── research.md                              # Technical decisions, codebase analysis
├── data-model.md                            # Schema analysis, visibility matrix, query logic
├── quickstart.md                            # Test scenarios & verification checklist
├── contracts/
│   └── view-meeting-notes-api.md            # API contract đầy đủ UC-IMM-10
├── checklists/
│   └── requirements.md                      # Đã có (cập nhật CD notes)
└── tasks.md                                 # Output của /speckit-tasks (KHÔNG tạo ở plan)
```

### Source Code (repository) — NestJS modular monolith

```text
src/
├── modules/
│   └── live-meeting/
│       ├── controllers/
│       │   └── live-meeting.controller.ts          # MODIFY — update listNotes() theo UC-IMM-10
│       ├── services/
│       │   └── live-meeting.service.ts             # MODIFY — update/thêm viewMeetingNotes()
│       ├── constants/
│       │   └── meeting-note-error.constant.ts      # MODIFY — thêm INVALID_DATE_RANGE, NOT_A_MEETING_PARTICIPANT, MEETING_STATUS_NOT_VIEWABLE
│       ├── dto/
│       │   ├── view-notes-query.dto.ts             # MỚI — extend ListNotesQueryDto với from/to/sort/includeSourceEvent
│       │   ├── view-note-response.dto.ts           # MỚI hoặc MODIFY — noteTimestamp thay createdAt; enriched fields
│       │   └── index.ts                            # MODIFY — export DTO mới
│       └── tests/
│           └── live-meeting.service.spec.ts        # MODIFY — thêm suite cho UC-IMM-10
└── (không có migration, không có seed mới)
```

**Decision — Tách DTO hay reuse**:
- `ViewNotesQueryDto`: tạo mới, extend query params từ UC-103 (`noteType`, `pinned`, `page`, `limit`) và bổ sung `from`, `to`, `sort`, `includeSourceEvent`. Nếu UC-103 `ListNotesQueryDto` chưa implement, merge luôn vào một DTO. Quyết định cụ thể khi Phase 0 kiểm tra code hiện tại.
- `ViewNoteResponseDto`: nếu UC-103 `NoteResponseDto` đã có `createdAt`, cần sửa thành `noteTimestamp` (breaking change có kiểm soát vì cùng branch). Nếu UC-103 chưa implement, tạo mới luôn.

---

## 3. Scope Confirmation

### ✅ IN SCOPE

- `GET /api/v1/meetings/{meetingId}/notes` — xem danh sách ghi chú với đầy đủ visibility rules.
- Meeting status hợp lệ: `in_progress` **và** `completed` (cả hai, khác UC-102 chỉ `in_progress`).
- Host xem tất cả ghi chú hợp lệ (`deleted_at IS NULL`) kể cả private/host_note của mọi author.
- Participant chỉ xem ghi chú của chính mình + shared notes (`participants`/`public_internal`/`department`).
- Filter: `noteType`, `visibility`, `pinned`, `from`/`to` (độc lập), `sort` (`timeline_asc`/`timeline_desc`).
- Pagination: `page`, `limit` (default 20, max 100).
- Opt-in enrichment: `?includeSourceEvent=true` → LEFT JOIN `meeting_events`, thêm `sourceEventTime`/`sourceEventType` (CD-001).
- Empty state: HTTP 200, `data = []`, `total = 0`, message rõ ràng (BR-012).
- Response field `noteTimestamp` (mapped từ `created_at`, CD-001).
- Error codes mới: `INVALID_DATE_RANGE` (from > to), `NOT_A_MEETING_PARTICIPANT`, `MEETING_STATUS_NOT_VIEWABLE`.
- Membership check: reject admin/manager không có trong meeting (BR-016, CD-002).

### ❌ OUT OF SCOPE (không đưa vào plan)

- POST tạo ghi chú — thuộc UC-102.
- PATCH/DELETE ghi chú — UC riêng.
- Share/pin/unpin ghi chú — PATCH operation, UC riêng.
- Full-text search (`?q`) — UC-104; có thể coexist trong cùng controller method (decision Phase 0).
- Tag phân loại (Quyết định/Hành động/Ý tưởng) — không có cột `note_tag`; dùng `noteType` làm proxy v1.
- WebSocket realtime cho ghi chú.
- Export PDF/DOCX ghi chú.
- AI summary ghi chú.
- Admin/manager bypass membership — cần permission riêng `meeting.notes.audit.read` (ngoài scope).
- External Participant.
- Note pre-meeting (meeting `scheduled`).
- **Không thêm bảng/cột/migration/seed** mới — toàn bộ dùng schema và permission hiện có.

---

## 4. Data Model Impact

**KHÔNG thêm bảng mới. KHÔNG thêm cột mới. KHÔNG tạo migration.**

Schema sử dụng hoàn toàn DB v3.2 Compact. GIN index và permission `meeting.note.read` đã được tạo bởi UC-102 plan.

### 4.1 Bảng chính: `meeting_notes` (chỉ SELECT)

| Column | Operation | Vai trò |
|--------|-----------|---------|
| `id` | SELECT | Trả về trong response |
| `meeting_id` | WHERE | Filter theo meeting |
| `author_id` | WHERE + JOIN | Visibility check: `author_id = currentUserId`; JOIN `users` lấy author info |
| `note_type` | WHERE (optional filter) | Filter `?noteType=...`; visibility matrix (BR-004, BR-005) |
| `content` | SELECT | Nội dung trả về (đã sanitize từ UC-102) |
| `pinned` | WHERE (optional filter) | Filter `?pinned=true/false` |
| `visibility_level` | WHERE (visibility predicate) | Core của visibility matrix Participant path |
| `source_event_id` | SELECT + LEFT JOIN (opt-in) | `includeSourceEvent=true` → JOIN `meeting_events` |
| `created_at` | SELECT + WHERE | Trả là `noteTimestamp`; filter `from`/`to`; sort |
| `updated_at` | SELECT | Trả trong response |
| `deleted_at` | WHERE IS NULL | Luôn filter (BR-003, FR-009) |

### 4.2 Bảng validate/join (chỉ SELECT)

| Bảng | Cột | Mục đích |
|------|-----|----------|
| `meetings` | `id`, `status`, `host_id`, `deleted_at` | Validate tồn tại (FR-004), status `in_progress`/`completed` (FR-005), xác định host_id (FR-006) |
| `meeting_participants` | `meeting_id`, `user_id`, `participant_role` | Validate là Participant hợp lệ (FR-006); xác định Host nếu `participant_role = 'host'` |
| `users` | `id`, `full_name`, `department_id` | JOIN author info; department check cho visibility `department` |
| `meeting_events` | `id`, `event_time`, `event_type` | **Opt-in**: LEFT JOIN khi `includeSourceEvent=true` (CD-001, FR-017) |

### 4.3 Index sử dụng (không thay đổi)

| Index | Định nghĩa | Có sẵn từ |
|-------|------------|-----------|
| `ix_meeting_notes_meeting` | `(meeting_id)` | UC-102 migration hoặc baseline |
| `ix_meeting_notes_type` | `(note_type)` | Baseline |
| `idx_meeting_notes_content_fts` | GIN `(to_tsvector('simple', content))` | UC-102 migration |

> Không thêm index mới. Query `from`/`to` dùng index trên `created_at` nếu có, hoặc tạo composite index — **đánh giá ở Phase 0** khi xem schema thực tế.

### 4.4 State / Lifecycle (Read-Only)

```
meeting_notes: (existing) → SELECT với visibility filter → response
```

Không có INSERT/UPDATE/DELETE trong UC-IMM-10.

---

## 5. API / Contract Plan

### Endpoint

`GET /api/v1/meetings/{meetingId}/notes`
**Permission**: `meeting.note.read` (đã seed)
**Auth**: `JwtAuthGuard` + `PermissionsGuard`

### 5.1 Path Parameters

| Field | Type | Validation |
|-------|------|------------|
| `meetingId` | UUID | `ParseUUIDPipe` → 400 nếu sai format |

### 5.2 Query Parameters (`ViewNotesQueryDto`)

| Field | Type | Default | Validation |
|-------|------|---------|------------|
| `noteType` | string | — | `@IsOptional @IsIn(['in_meeting','private','host_note','system_note'])` |
| `visibility` | string | — | `@IsOptional @IsIn(['private','participants','public_internal','department'])` |
| `pinned` | boolean | — | `@IsOptional @IsBoolean @Transform` |
| `from` | string (ISO 8601) | — | `@IsOptional @IsDateString` |
| `to` | string (ISO 8601) | — | `@IsOptional @IsDateString` |
| `includeSourceEvent` | boolean | `false` | `@IsOptional @IsBoolean @Transform` |
| `page` | number | `1` | `@IsOptional @Min(1) @Type(Number)` |
| `limit` | number | `20` | `@IsOptional @Min(1) @Max(100) @Type(Number)` |
| `sort` | string | `timeline_asc` | `@IsOptional @IsIn(['timeline_asc','timeline_desc'])` |

> Validate `from > to` **trong service** (sau DTO validation), không trong DTO — vì đây là cross-field validation cần service-level logic.

### 5.3 Response (`ViewNoteResponseDto`)

**Default response (không `includeSourceEvent`)**:
```json
{
  "id": "uuid",
  "meetingId": "uuid",
  "noteType": "in_meeting",
  "content": "…",
  "pinned": false,
  "visibilityLevel": "participants",
  "author": { "id": "uuid", "fullName": "Nguyễn Văn A" },
  "sourceEventId": "uuid | null",
  "noteTimestamp": "2026-06-18T09:45:00+07:00",
  "updatedAt": "2026-06-18T09:45:00+07:00"
}
```

**Enriched response (`?includeSourceEvent=true`)**:
```json
{
  "id": "uuid",
  "meetingId": "uuid",
  "noteType": "in_meeting",
  "content": "…",
  "pinned": false,
  "visibilityLevel": "participants",
  "author": { "id": "uuid", "fullName": "Nguyễn Văn A" },
  "sourceEventId": "uuid",
  "sourceEventTime": "2026-06-18T09:43:00+07:00",
  "sourceEventType": "meeting_started",
  "noteTimestamp": "2026-06-18T09:45:00+07:00",
  "updatedAt": "2026-06-18T09:45:00+07:00"
}
```

**Response envelope list**:
```json
{
  "success": true,
  "message": "Lấy danh sách ghi chú thành công",
  "data": [ /* ViewNoteResponseDto[] */ ],
  "meta": { "page": 1, "limit": 20, "total": 5, "totalPages": 1 }
}
```

**Empty state**:
```json
{
  "success": true,
  "message": "Cuộc họp này không có ghi chú nào được lưu lại.",
  "data": [],
  "meta": { "page": 1, "limit": 20, "total": 0, "totalPages": 0 }
}
```

### 5.4 HTTP Status Codes

| Status | Trường hợp |
|--------|-----------|
| 200 | Thành công (kể cả empty state) |
| 400 | Validation lỗi (format, allowlist, limit > 100), `from > to` → `INVALID_DATE_RANGE` |
| 401 | Chưa xác thực |
| 403 | Thiếu permission hoặc không phải Host/Participant |
| 404 | Meeting không tồn tại |
| 422 | Meeting sai trạng thái (`draft`/`pending_approval`/`scheduled`/`cancelled`) |
| 500 | Lỗi server |

### 5.5 Controller / Service Mapping

- **Controller** (`live-meeting.controller.ts`): method `listNotes()` (MODIFY) — thêm `ViewNotesQueryDto`, update `@RequirePermissions`, update response type.
- **Service** (`live-meeting.service.ts`): method `viewMeetingNotes(meetingId, query, authUser)` (MỚI hoặc UPDATE `listMeetingNotes`) — chứa toàn bộ business logic visibility + filter + enrichment.

---

## 6. Authorization Plan

| Level | Mechanism | Detail |
|-------|-----------|--------|
| Guard JWT | `JwtAuthGuard` | FR-001 — reject 401 nếu không có token hợp lệ |
| Guard Permission | `PermissionsGuard` + `@RequirePermissions('meeting.note.read')` | FR-002 — reject 403 `PERMISSION_DENIED` nếu thiếu permission |
| Service — meeting membership | Check `meeting_participants WHERE meeting_id = :meetingId AND user_id = :currentUserId` hoặc `meetings.host_id = currentUserId` | FR-006, BR-002 — reject 403 `NOT_A_MEETING_PARTICIPANT` nếu không trong meeting |
| Service — Host identification | `isHost = (meeting.host_id === currentUserId) OR (participant.participant_role === 'host')` | FR-007, spec §13.1 |
| Service — visibility filter | Áp dụng theo role; Host: không filter; Participant: xem §6.1 | FR-007, FR-008, BR-004, BR-005 |

> **CD-002**: User có System Admin / Business Admin / Manager role nhưng không phải Host/Participant → nhận `403 NOT_A_MEETING_PARTICIPANT`. Không có bypass. Không kiểm tra system role ở bước này — chỉ check meeting membership.

### 6.1 Visibility Filter Semantics (Participant path)

Participant thấy note khi thỏa **ít nhất một** điều kiện:

| Điều kiện | SQL predicate |
|-----------|---------------|
| Ghi chú của chính mình | `mn.author_id = :currentUserId` |
| Shared với participants | `mn.visibility_level = 'participants'` |
| Shared với mọi internal user | `mn.visibility_level = 'public_internal'` |
| Cùng phòng ban với author | `mn.visibility_level = 'department' AND author.department_id = :currentUserDeptId` |

**[INVARIANT enforcement trong SQL]**:
```sql
AND (
  mn.author_id = :currentUserId
  OR mn.visibility_level = 'participants'
  OR mn.visibility_level = 'public_internal'
  OR (mn.visibility_level = 'department'
      AND EXISTS (
        SELECT 1 FROM users u2
        WHERE u2.id = mn.author_id
          AND u2.department_id = :currentUserDeptId
      ))
)
```

Filter `?visibility=...` từ query param áp **SAU** predicate trên (BR-015). Participant gửi `?visibility=private` chỉ nhận note `private` của chính mình — không nhận note private của người khác.

### 6.2 Permission Seed

`meeting.note.read` đã được seed bởi UC-102 plan. **Không cần seed mới.**

Xác nhận trong Phase 0: kiểm tra `src/database/seeds/` có file seed permission `meeting.note.read` chưa; nếu chưa → ghi chú Risk (§12).

---

## 7. Business Logic Plan

### 7.1 `viewMeetingNotes(meetingId, query, authUser)` → `{ data, meta }`

```
1. Resolve currentUserId từ JWT (authUser.userId).

2. Validate cross-field: nếu query.from và query.to đều có giá trị
   → parse ISO datetime
   → nếu from > to → throw BadRequestException(INVALID_DATE_RANGE)
   (Nếu chỉ có from: hợp lệ → filter created_at >= from)
   (Nếu chỉ có to: hợp lệ → filter created_at <= to)

3. SELECT meeting (id, status, host_id, deleted_at).
   → Không tồn tại hoặc deleted_at IS NOT NULL → throw NotFoundException(MEETING_NOT_FOUND).
   → status ∉ ['in_progress', 'completed'] → throw UnprocessableEntityException(MEETING_STATUS_NOT_VIEWABLE).

4. SELECT meeting_participants WHERE meeting_id = :meetingId AND user_id = :currentUserId.
   → isHost = (meeting.host_id === currentUserId) OR (participant?.participant_role === 'host')
   → isParticipant = participant record tồn tại
   → !isHost && !isParticipant → throw ForbiddenException(NOT_A_MEETING_PARTICIPANT)
   (CD-002: không bypass dù là admin/manager)

5. Build QueryBuilder trên meeting_notes (mn):
   a. BASE WHERE:
      mn.meeting_id = :meetingId
      AND mn.deleted_at IS NULL

   b. VISIBILITY PREDICATE:
      NẾUHOST: không thêm điều kiện (xem tất cả)
      NẾU PARTICIPANT: áp predicate §6.1

   c. OPTIONAL FILTERS (áp SAU visibility predicate):
      - noteType: AND mn.note_type = :noteType (nếu có)
      - visibility: AND mn.visibility_level = :visibility (nếu có)
      - pinned: AND mn.pinned = :pinned (nếu có)
      - from: AND mn.created_at >= :from (nếu có)
      - to: AND mn.created_at <= :to (nếu có)

   d. SORT:
      - timeline_asc (default): ORDER BY mn.created_at ASC
      - timeline_desc: ORDER BY mn.created_at DESC

   e. JOIN luôn có:
      JOIN users u ON mn.author_id = u.id (lấy full_name, department_id cho §6.1)

   f. OPT-IN ENRICHMENT (chỉ khi query.includeSourceEvent === true):
      LEFT JOIN meeting_events me ON mn.source_event_id = me.id

   g. PAGINATION:
      LIMIT :limit OFFSET (:page - 1) * :limit
      Chạy thêm COUNT(*) query để lấy total.

6. Map kết quả sang ViewNoteResponseDto[]:
   - noteTimestamp ← mn.created_at
   - Nếu includeSourceEvent=true: thêm sourceEventTime ← me.event_time (null nếu LEFT JOIN không match), sourceEventType ← me.event_type
   - Nếu includeSourceEvent=false: không có sourceEventTime / sourceEventType trong response

7. Build meta: { page, limit, total, totalPages: Math.ceil(total/limit) }.

8. Empty state (total = 0): trả 200 với message "Cuộc họp này không có ghi chú nào được lưu lại."

9. Return { success, message, data, meta } (HTTP 200).
```

### 7.2 Helper Methods

| Helper | Signature | Mục đích |
|--------|-----------|---------|
| `resolveMeetingRole(meeting, participant, userId)` | `→ { isHost, isParticipant }` | Xác định role trong meeting; dùng lại ở cả viewMeetingNotes và các UC khác nếu cần |
| `buildParticipantVisibilityPredicate(qb, alias, userId, deptId)` | `→ void` | Áp dụng OR predicate visibility cho Participant path; cô lập để test độc lập |
| `applyOptionalFilters(qb, alias, query)` | `→ void` | Áp `noteType`, `visibility`, `pinned`, `from`, `to` (independent, CD-003) |

---

## 8. Validation Plan

| Validation | Layer | Mechanism | Error Code | HTTP |
|------------|-------|-----------|------------|------|
| `meetingId` đúng UUID | Controller | `ParseUUIDPipe` | `VALIDATION_ERROR` | 400 |
| `noteType` ∈ allowlist | DTO | `@IsIn([...])` | `VALIDATION_ERROR` | 400 |
| `visibility` ∈ allowlist | DTO | `@IsIn([...])` | `VALIDATION_ERROR` | 400 |
| `sort` ∈ `['timeline_asc','timeline_desc']` | DTO | `@IsIn([...])` | `VALIDATION_ERROR` | 400 |
| `pinned` boolean | DTO | `@IsBoolean @Transform` | `VALIDATION_ERROR` | 400 |
| `from` đúng ISO datetime | DTO | `@IsDateString` | `VALIDATION_ERROR` | 400 |
| `to` đúng ISO datetime | DTO | `@IsDateString` | `VALIDATION_ERROR` | 400 |
| `from > to` (khi cả hai có giá trị) | Service | Cross-field check | `INVALID_DATE_RANGE` | 400 |
| `limit` ∈ [1, 100] | DTO | `@Min(1) @Max(100)` | `VALIDATION_ERROR` | 400 |
| `page` ≥ 1 | DTO | `@Min(1)` | `VALIDATION_ERROR` | 400 |
| `includeSourceEvent` boolean | DTO | `@IsBoolean @Transform` | `VALIDATION_ERROR` | 400 |
| Meeting tồn tại | Service | SELECT + null check | `MEETING_NOT_FOUND` | 404 |
| Meeting status hợp lệ | Service | Enum check | `MEETING_STATUS_NOT_VIEWABLE` | 422 |
| Actor là Host hoặc Participant | Service | membership check | `NOT_A_MEETING_PARTICIPANT` | 403 |
| Đã xác thực | Guard | `JwtAuthGuard` | `UNAUTHORIZED` | 401 |
| Có permission | Guard | `PermissionsGuard` | `PERMISSION_DENIED` | 403 |

**Lưu ý `from`/`to` độc lập**: DTO validate format riêng lẻ. Service validate cross-field `from > to` chỉ khi cả hai được cung cấp. `from` đơn lẻ = hợp lệ; `to` đơn lẻ = hợp lệ.

---

## 9. Error Handling Plan

### 9.1 Error Code Constant

File: `src/modules/live-meeting/constants/meeting-note-error.constant.ts` (MODIFY — thêm 3 code mới).

**Codes mới cần thêm**:
```typescript
INVALID_DATE_RANGE: 'INVALID_DATE_RANGE',
NOT_A_MEETING_PARTICIPANT: 'NOT_A_MEETING_PARTICIPANT',
MEETING_STATUS_NOT_VIEWABLE: 'MEETING_STATUS_NOT_VIEWABLE',
```

### 9.2 Exception Mapping

| HTTP | Error Code | Exception NestJS | Ngữ cảnh |
|------|------------|-----------------|---------|
| 400 | `VALIDATION_ERROR` | `BadRequestException` | DTO validation, sai format, sai allowlist, `limit > 100` |
| 400 | `INVALID_DATE_RANGE` | `BadRequestException` | `from > to` (CD-003) |
| 401 | `UNAUTHORIZED` | (JwtAuthGuard tự throw) | Token không hợp lệ/hết hạn |
| 403 | `PERMISSION_DENIED` | (PermissionsGuard tự throw) | Thiếu `meeting.note.read` |
| 403 | `NOT_A_MEETING_PARTICIPANT` | `ForbiddenException` | Có permission nhưng không phải Host/Participant (CD-002) |
| 404 | `MEETING_NOT_FOUND` | `NotFoundException` | Meeting không tồn tại hoặc soft-deleted |
| 422 | `MEETING_STATUS_NOT_VIEWABLE` | `UnprocessableEntityException` | Status không phải `in_progress` hoặc `completed` |
| 500 | `INTERNAL_ERROR` | (global exception filter) | Lỗi không xác định |

### 9.3 Quy tắc Error Handling

- Payload chuẩn: `{ success: false, message: "...", error: { code: "...", details: {} }, timestamp: "...", path: "..." }`.
- Error 403 `NOT_A_MEETING_PARTICIPANT` dùng message: `"Bạn không có quyền xem ghi chú của cuộc họp này."` — không tiết lộ nội dung meeting.
- Không log `content` ghi chú trong error log; chỉ log meta (`meetingId`, `noteType`, `authorId`).
- Không expose stack trace ở production.

---

## 10. Testing Strategy

### 10.1 Unit Test — Service (`tests/live-meeting.service.spec.ts`, thêm suite UC-IMM-10)

Bám spec NFR-004 + 24 AC:

**Host visibility (AC-001 → AC-004)**:
1. Host GET meeting `in_progress` → 200, tất cả notes hợp lệ sorted `created_at ASC`. (AC-001, FR-007, BR-004, BR-007)
2. Host GET meeting `completed` → 200, tất cả notes hợp lệ. (AC-002, BR-001)
3. Notes `deleted_at IS NOT NULL` không xuất hiện — dù Host hay Participant. (AC-003, BR-003, FR-009)
4. Mỗi note item có `author.id` và `author.fullName`. (AC-004, FR-019)

**Participant visibility (AC-005 → AC-007)**:
5. Participant GET → chỉ thấy ghi chú của chính mình + `visibility_level ∈ ['participants','public_internal']`. (AC-005, FR-008, BR-005)
6. Private note (`visibility_level = 'private'`, `author_id != participantId`) KHÔNG xuất hiện trong response của Participant. (AC-006, BR-006, INVARIANT-1)
7. `note_type = 'host_note'` với `visibility_level = 'private'` KHÔNG xuất hiện trong response Participant. (AC-007, BR-006, INVARIANT-2)

**Filter (AC-008 → AC-011)**:
8. `?noteType=in_meeting` → chỉ trả `in_meeting` notes sau visibility filter. (AC-008, FR-011)
9. `?pinned=true` → chỉ trả pinned notes. (AC-009, FR-013)
10. `?from=T1&to=T2` → chỉ trả notes trong khoảng. Chỉ `?from=T1` → `created_at >= T1`. Chỉ `?to=T2` → `created_at <= T2`. (AC-010, FR-014, CD-003)
11. `?visibility=participants` áp SAU role filter — Participant không thấy private notes người khác dù có filter này. (AC-011, FR-012, BR-015)

**Sort (AC-012 → AC-013)**:
12. Mặc định (không `sort`) → `created_at ASC`. (AC-012, FR-010, BR-007)
13. `?sort=timeline_desc` → `created_at DESC`. (AC-013, FR-010, BR-008)

**Empty state (AC-014)**:
14. Không có notes hợp lệ → 200, `data=[]`, `total=0`, message rõ ràng. (AC-014, BR-012, FR-018)

**Pagination (AC-015 → AC-016)**:
15. `?page=2&limit=5` → 5 items trang 2, `meta` đúng. (AC-015, FR-015, BR-014)
16. `meta.totalPages = ceil(total / limit)`. (AC-016, FR-016)

**Error cases (AC-017 → AC-024)**:
17. Chưa đăng nhập → 401. (AC-017, FR-001)
18. Thiếu permission `meeting.note.read` → 403 `PERMISSION_DENIED`. (AC-018, FR-002)
19. User không phải Host hay Participant → 403 `NOT_A_MEETING_PARTICIPANT`. (AC-019, FR-006, CD-002)
20. `meetingId` không tồn tại → 404 `MEETING_NOT_FOUND`. (AC-020, FR-004)
21. Meeting `scheduled` → 422 `MEETING_STATUS_NOT_VIEWABLE`. (AC-021, FR-005, BR-001)
22. `from` sai format ISO datetime → 400 `VALIDATION_ERROR`. (AC-022, FR-014)
23. `from > to` (cả hai cung cấp) → 400 `INVALID_DATE_RANGE`. (AC-023, FR-014, CD-003)
24. `limit > 100` → 400 `VALIDATION_ERROR`. (AC-024, FR-015, BR-014)

**Opt-in enrichment (spec EC-006)**:
25. `?includeSourceEvent=true` + note có `source_event_id` + `meeting_events` tồn tại → response có `sourceEventTime` và `sourceEventType`. (FR-017, CD-001)
26. `?includeSourceEvent=true` + `meeting_events` không tìm thấy → `sourceEventTime = null`, `sourceEventType = null`. (EC-006, BR-010)
27. Không truyền `includeSourceEvent` → response **không** có field `sourceEventTime`/`sourceEventType`. (CD-001)

**Admin bypass (CD-002)**:
28. System Admin không phải Participant → 403 `NOT_A_MEETING_PARTICIPANT`. (BR-016, CD-002)

### 10.2 Unit Test — Controller (`tests/live-meeting.controller.spec.ts`, thêm suite)

1. GET happy path (Host): route đúng, query params parse, response format `{ success, message, data, meta }`.
2. Invalid `meetingId` UUID → 400/422.
3. Thiếu token → 401 (guard).
4. Thiếu permission → 403 (guard).
5. Truyền `from`, `to`, `sort`, `includeSourceEvent` → query dto nhận đúng giá trị.

### 10.3 DTO Test

- `dto/view-notes-query.dto.spec.ts`: validate `noteType`/`visibility`/`sort` allowlist; `from`/`to` IsDateString; `includeSourceEvent` boolean; `limit ≤ 100`; reject extra field.
- `dto/view-note-response.dto.spec.ts`: constructor + field types, `noteTimestamp` present, `sourceEventTime` conditional.

### 10.4 Test Convention

- Mock `DataSource` + `EntityManager` + `QueryBuilder` (pattern UC-103 và UC-05 trong `tests/`).
- Không phụ thuộc DB thật trong unit test.
- Test service visibility helper `buildParticipantVisibilityPredicate` riêng nếu cần.

---

## 11. Implementation Phases

### Phase 0 — Kiểm tra codebase & quyết định approach

**Mục tiêu**: Tránh xung đột với UC-103 đã implement (nếu có).

Kiểm tra:
1. `listNotes()` trong `LiveMeetingController` và `listMeetingNotes()` trong `LiveMeetingService` đã implement chưa, format response dùng `createdAt` hay gì khác.
2. `ListNotesQueryDto` có các field gì; có thể extend hay cần tạo mới `ViewNotesQueryDto`.
3. `NoteResponseDto` đã có `createdAt` chưa; nếu có → đổi thành `noteTimestamp` (breaking change có kiểm soát, cùng branch).
4. `meeting-note-error.constant.ts` có các code nào, thiếu gì.
5. Permission `meeting.note.read` đã seed chưa.
6. Index `ix_meeting_notes_meeting` và `created_at` index có tồn tại không (ảnh hưởng query plan).

**Output Phase 0**: Ghi nhận kết quả kiểm tra → xác nhận approach (MODIFY UC-103 method vs thêm method mới).

### Phase 1 — Constants

- Thêm `INVALID_DATE_RANGE`, `NOT_A_MEETING_PARTICIPANT`, `MEETING_STATUS_NOT_VIEWABLE` vào `constants/meeting-note-error.constant.ts`.

### Phase 2 — DTO

- Tạo `dto/view-notes-query.dto.ts` với tất cả query params của UC-IMM-10 (`noteType`, `visibility`, `pinned`, `from`, `to`, `includeSourceEvent`, `page`, `limit`, `sort`).
- Tạo/cập nhật `dto/view-note-response.dto.ts` với `noteTimestamp` (không `createdAt`), `sourceEventId`, và optional `sourceEventTime`/`sourceEventType`.
- Cập nhật `dto/index.ts` export DTO mới.
- Tạo spec test DTO (Phase 2 kèm test).

### Phase 3 — Service

- Implement `viewMeetingNotes(meetingId, query, authUser)` theo logic §7.1.
- Implement helpers: `resolveMeetingRole()`, `buildParticipantVisibilityPredicate()`, `applyOptionalFilters()`.
- Cross-field validation `from > to` → `INVALID_DATE_RANGE`.
- Opt-in enrichment: conditional LEFT JOIN `meeting_events` khi `includeSourceEvent=true`.
- Phân nhánh Host vs Participant visibility rõ ràng.
- Mapping `created_at` → `noteTimestamp` trong response.

### Phase 4 — Controller

- Cập nhật `listNotes()` (hoặc thêm `viewNotes()`) trong `LiveMeetingController`:
  - `@Get('meetings/:meetingId/notes')`.
  - `@RequirePermissions('meeting.note.read')`.
  - `@UseGuards(JwtAuthGuard, PermissionsGuard)`.
  - `ParseUUIDPipe` cho `meetingId`.
  - `ViewNotesQueryDto` cho query params.
  - Response status 200, format `{ success, message, data, meta }`.
- Swagger decorators theo pattern hiện có.

### Phase 5 — Tests

- Unit test service (suite 28 cases theo §10.1).
- Unit test controller (5 cases theo §10.2).
- DTO test (§10.3).
- Chạy `npm run lint` + `npm run test` + `npm run build`.
- Đảm bảo không phá test module khác.

---

## 12. Risks & Mitigations

| Risk | Impact | Mitigation |
|------|--------|------------|
| UC-103 `listNotes()` đã implement với `createdAt` field | Breaking change khi đổi → `noteTimestamp` | Phase 0 kiểm tra; đổi trên cùng branch (chưa deployed); update response DTO và test theo |
| Route `GET meetings/:meetingId/notes` trùng với UC-103/UC-104 | Conflict route hoặc duplicate logic | Confirm UC-IMM-10 là spec canonical; UC-103 method bị superseded; quyết định ở Phase 0 |
| Permission `meeting.note.read` chưa được seed | 403 khi test | Phase 0 kiểm tra seed file; nếu chưa có → tạo seed file (thêm Phase 1.5) |
| `department` visibility: `department_id = NULL` cho cả user và author | Filter có thể match sai (NULL = NULL trong SQL là FALSE) | Thêm `AND u2.department_id IS NOT NULL` trong EXISTS subquery; test case riêng |
| `includeSourceEvent=true` + nhiều notes có `source_event_id` | N+1 query hoặc slow JOIN | Dùng LEFT JOIN một lần trong query builder; không thực hiện N+1 individual queries |
| Index trên `created_at` trong `meeting_notes` chưa có | `from`/`to` filter chậm khi nhiều note | Phase 0 kiểm tra; nếu không có → cân nhắc thêm `created_at` vào composite index trong migration riêng (scope nhỏ) |
| `meeting_events.event_type` có thể không phải column tồn tại | Enrichment bị lỗi | Phase 0 xác nhận `meeting_events` schema; nếu không có `event_type` → chỉ trả `sourceEventTime`, bỏ `sourceEventType` |
| Admin/Manager test case: user có role cao nhưng không trong meeting | Test phải rõ ràng verify 403 NOT_A_MEETING_PARTICIPANT | Test case #28 (§10.1) bắt buộc; không để slip |
| `from`/`to` timezone handling: client gửi local time vs UTC | Sai filter range | Validate ISO 8601 với timezone offset; dùng `timestamptz` PostgreSQL xử lý đúng; document trong API contract |

---

## 13. Acceptance Criteria Traceability

| AC ID | Nội dung tóm tắt | FR / BR / CD liên quan | Test (Phase) |
|-------|-----------------|------------------------|--------------|
| AC-001 | Host GET `in_progress` → tất cả notes hợp lệ, sorted ASC | FR-007, BR-004, BR-007 | Service #1 (P3) |
| AC-002 | Host GET `completed` → tất cả notes hợp lệ | FR-007, BR-001 | Service #2 (P3) |
| AC-003 | `deleted_at IS NOT NULL` không trả về | FR-009, BR-003 | Service #3 (P3) |
| AC-004 | Mỗi note có `author.id` và `author.fullName` | FR-019 | Service #4 (P3) |
| AC-005 | Participant chỉ thấy shared + own notes | FR-008, BR-005 | Service #5 (P3) |
| AC-006 | Private note (`author != participant`) không trả về Participant | FR-008, BR-006, INVARIANT-1 | Service #6 (P3) |
| AC-007 | `host_note` private không trả về Participant | BR-006, INVARIANT-2 | Service #7 (P3) |
| AC-008 | Filter `?noteType=in_meeting` | FR-011 | Service #8 (P3) |
| AC-009 | Filter `?pinned=true` | FR-013 | Service #9 (P3) |
| AC-010 | Filter `from`/`to` độc lập và kết hợp | FR-014, BR-013, CD-003 | Service #10 (P3) |
| AC-011 | `?visibility=participants` áp SAU role filter | FR-012, BR-015 | Service #11 (P3) |
| AC-012 | Sort mặc định → ASC | FR-010, BR-007 | Service #12 (P3) |
| AC-013 | `?sort=timeline_desc` → DESC | FR-010, BR-008 | Service #13 (P3) |
| AC-014 | Empty state → 200, `data=[]`, `total=0`, message | FR-018, BR-012 | Service #14 (P3) |
| AC-015 | Pagination `?page=2&limit=5` | FR-015, BR-014 | Service #15 (P3) |
| AC-016 | `meta.totalPages` chính xác | FR-016 | Service #16 (P3) |
| AC-017 | Chưa đăng nhập → 401 | FR-001 | Controller #3 (P4) |
| AC-018 | Thiếu permission → 403 `PERMISSION_DENIED` | FR-002 | Controller #4 (P4) |
| AC-019 | Không phải Host/Participant → 403 `NOT_A_MEETING_PARTICIPANT` | FR-006, BR-002, CD-002 | Service #19 (P3) |
| AC-020 | `meetingId` không tồn tại → 404 | FR-004 | Service #20 (P3) |
| AC-021 | Meeting `scheduled` → 422 `MEETING_STATUS_NOT_VIEWABLE` | FR-005, BR-001 | Service #21 (P3) |
| AC-022 | `from` sai format → 400 `VALIDATION_ERROR` | FR-014 | DTO test (P2) |
| AC-023 | `from > to` → 400 `INVALID_DATE_RANGE` | FR-014, CD-003 | Service #23 (P3) |
| AC-024 | `limit > 100` → 400 `VALIDATION_ERROR` | FR-015, BR-014 | DTO test (P2) |

---

## 14. Complexity Tracking

> Chỉ điền nếu Constitution Check có vi phạm cần justify.

**Không có vi phạm constitution.** Feature hoàn toàn read-only, tái dùng schema baseline, không thêm bảng/cột/migration, không thêm dependency mới. ⇒ Bảng trống.

| Violation | Why Needed | Simpler Alternative Rejected Because |
|-----------|------------|-------------------------------------|
| — | — | — |

---

## Appendix: File Inventory

### Files to CREATE

```text
spec/features/live-meeting/feat-view-meeting-notes/plan.md              ← file này
spec/features/live-meeting/feat-view-meeting-notes/research.md
spec/features/live-meeting/feat-view-meeting-notes/data-model.md
spec/features/live-meeting/feat-view-meeting-notes/quickstart.md
spec/features/live-meeting/feat-view-meeting-notes/contracts/view-meeting-notes-api.md

src/modules/live-meeting/dto/view-notes-query.dto.ts
src/modules/live-meeting/dto/view-note-response.dto.ts
src/modules/live-meeting/dto/view-notes-query.dto.spec.ts
src/modules/live-meeting/dto/view-note-response.dto.spec.ts
```

### Files to MODIFY

```text
src/modules/live-meeting/constants/meeting-note-error.constant.ts     (+3 error codes)
src/modules/live-meeting/dto/index.ts                                  (export DTO mới)
src/modules/live-meeting/controllers/live-meeting.controller.ts        (update listNotes)
src/modules/live-meeting/services/live-meeting.service.ts              (thêm viewMeetingNotes + helpers)
src/modules/live-meeting/tests/live-meeting.service.spec.ts            (thêm suite UC-IMM-10)
src/modules/live-meeting/tests/live-meeting.controller.spec.ts         (thêm suite UC-IMM-10)
spec/features/live-meeting/feat-view-meeting-notes/checklists/requirements.md  (CD notes đã thêm)
```

### Files KHÔNG đổi

```text
src/modules/meetings/entities/meeting-note.entity.ts     (entity đã đủ — không sửa)
src/modules/live-meeting/live-meeting.module.ts           (không cần forFeature mới — xác nhận Phase 0)
src/database/migrations/*                                 (không tạo migration mới)
src/database/seeds/*                                      (không tạo seed mới nếu permission đã có)
```
