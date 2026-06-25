# Implementation Plan: Tìm kiếm ghi chú trong cuộc họp (Search Meeting Notes)

- **Feature ID**: UC-IMM-11 / UC-104
- **Feature Name**: Tìm kiếm ghi chú trong cuộc họp
- **Module / Domain**: `live-meeting`
- **Date**: 2026-06-18
- **Spec**: [spec.md](spec.md)
- **Design artifacts**:
  - [research.md](research.md)
  - [data-model.md](data-model.md)
  - [contracts/search-meeting-notes-api.md](contracts/search-meeting-notes-api.md)
  - [quickstart.md](quickstart.md)
  - [checklists/requirements.md](checklists/requirements.md)

---

## CHANGELOG & REVISION HISTORY

| Ngày cập nhật | Tóm tắt thay đổi | Các dòng thay đổi |
| :--- | :--- | :--- |
| 2026-06-18 | Tạo plan.md lần đầu cho UC-IMM-11 dựa trên spec đã chốt 4 CR | Toàn bộ file |

---

## 1. Feature Summary

Cho phép **Host, Co-host và Participant hợp lệ** tìm kiếm ghi chú của cuộc họp theo từ khóa, người tạo, khoảng thời gian. Feature này mở rộng endpoint `GET /api/v1/meetings/{meetingId}/notes` (đã có từ UC-IMM-10) với query param `?q=` để kích hoạt search mode.

- **Search** trên `meeting_notes.content` với case-insensitive matching.
- **Full-text search** preferred (PostgreSQL GIN index), fallback `ILIKE` với wildcard escape.
- **Vietnamese accent-insensitive** nếu DB có unaccent; fallback application-layer normalization (CR-001).
- **Visibility rules** kế thừa từ UC-IMM-10: Host thấy tất cả, Co-host thấy tất cả trừ private notes người khác, Participant chỉ thấy shared + own.
- **Filters mới**: `?authorId=`, `?createdFrom=`, `?createdTo=` (AND với search keyword).
- **Read-only hoàn toàn**: không INSERT/UPDATE/DELETE, không audit log, không notification, không side effect.
- **Keyword validation**: max 255 ký tự, trim whitespace, ILIKE wildcard escape bắt buộc (CR-003, CR-004).
- **Same response format** như UC-IMM-10: pagination, meta, empty state message riêng cho search.

**Phạm vi đo lường**: 28 Functional Requirements (FR-001→FR-028), 8 NFR, 24 Acceptance Criteria (AC-001→AC-024), 22 Business Rules (BR-001→BR-022), 8 error codes.

---

## 2. Technical Context

| Aspect | Detail |
|--------|--------|
| Language | TypeScript (strict) |
| Framework | NestJS 10+ |
| Database | PostgreSQL (TypeORM) |
| ORM | TypeORM — `DataSource` + `QueryBuilder` (extend existing `viewMeetingNotes()`) |
| Auth | JWT (`JwtAuthGuard`) + RBAC (`PermissionsGuard`) |
| Module | `live-meeting` — already exists with controller/service from UC-IMM-10 |
| DTO existing | `ViewNotesQueryDto`, `ViewNoteResponseDto` (từ UC-IMM-10) |
| Entity | `MeetingNoteEntity` — không sửa |
| Transaction | **KHÔNG cần** — read-only operation (BR-009) |
| Migration | **Có thể cần**: add GIN index `ix_meeting_notes_content_fts` nếu chưa tồn tại |
| Seed permission | `meeting.note.read` đã seed bởi UC-102 |
| Validation | `class-validator` + global `ValidationPipe({ whitelist, forbidNonWhitelisted, transform })` |
| Testing | Jest (unit test service + controller + DTO) |
| Key dependencies | `src/modules/meetings/entities/meeting-note.entity.ts`, `MeetingNoteType` enum |

### Existing Codebase Context

| Component | Status | Action |
|-----------|--------|--------|
| `LiveMeetingController.listNotes()` | ✅ Đã implement bởi UC-IMM-10 | MODIFY — add `?q=`, `?authorId=`, `?createdFrom=`, `?createdTo=` support |
| `LiveMeetingService.viewMeetingNotes()` | ✅ Đã implement visibility + pagination | MODIFY — add search logic, new filters |
| `ViewNotesQueryDto` | ✅ Đã exist | EXTEND — add `q`, `authorId`, `createdFrom`, `createdTo` fields |
| `ViewNoteResponseDto` | ✅ Đã exist | REUSE — không cần sửa (search trả cùng format) |
| `meeting-note-error.constant.ts` | ✅ Đã exist (từ UC-IMM-10) | REUSE — error codes đã đủ |
| `live-meeting.module.ts` | ✅ Đã exist | Không cần sửa |

### Phụ thuộc upstream

- UC-IMM-09 / UC-102 (notes đã được tạo — cần có data để search)
- UC-IMM-10 (endpoint + visibility logic đã implement — search là mở rộng của view)

---

## 2b. Constitution Check

*GATE: phải PASS trước Phase 0. Re-check sau Phase 2 design.*

| Gate | Điều kiện | Kết quả |
|------|-----------|---------|
| **DB Gate** (I) | Không thêm bảng/cột ngoài baseline | ✅ PASS — chỉ SELECT; có thể tạo GIN index (migration scope nhỏ, không phải bảng mới) |
| **Security Gate** (II) | Không plain credential/log nhạy cảm | ✅ PASS — search không log content; keyword sanitize bằng parameterized query |
| **Scope Gate** (III) | Không vượt use case; không AI/embedding | ✅ PASS — cross-entity search, AI summary, tag filter đều Out of Scope |
| **Module Gate** (IV) | Không import chéo bừa bãi | ✅ PASS — trong live-meeting; join users qua DataSource (tiền lệ) |
| **API Gate** (V) | Format `{success,message,data,meta}`, HTTP codes | ✅ PASS — theo convention; reuse UC-IMM-10 format |
| **Auth Gate** (VI) | `JwtAuthGuard` + membership check | ✅ PASS — reuse guard + role check từ UC-IMM-10 |
| **Test Gate** | Unit test service + DTO | ✅ PASS — §10 phủ 24 AC |
| **Typescript Strict** (VII) | strict typing, DTO validation | ✅ PASS |

**Kết luận**: Không có vi phạm constitution.

---

## 2c. Project Structure

### Documentation (feature này)

```text
spec/features/live-meeting/feat-search-meeting-notes/
├── spec.md                                    # Input spec (đã chốt 4 CR)
├── plan.md                                    # File này
├── research.md                                # Technical decisions, codebase analysis
├── data-model.md                              # Schema analysis, search strategies
├── quickstart.md                              # Test scenarios & verification
├── contracts/
│   └── search-meeting-notes-api.md            # API contract UC-IMM-11
├── checklists/
│   └── requirements.md                        # Quality checklist (đã có)
└── tasks.md                                   # Output của /speckit-tasks
```

### Source Code (NestJS modular monolith)

```text
src/modules/live-meeting/
├── controllers/
│   └── live-meeting.controller.ts          # MODIFY — add search params to listNotes()
├── services/
│   └── live-meeting.service.ts             # MODIFY — thêm searchMeetingNotes() logic
├── dto/
│   ├── view-notes-query.dto.ts             # MODIFY/FIX — add q, authorId, createdFrom, createdTo
│   ├── search-notes-query.dto.ts           # ALT — extend ViewNotesQueryDto với search fields
│   ├── view-notes-query.dto.spec.ts        # MODIFY — add test cho search fields
│   └── index.ts                            # MODIFY — export DTO mới
├── constants/
│   └── meeting-note-error.constant.ts      # REUSE — không cần thêm code mới
└── tests/
    ├── live-meeting.service.spec.ts        # MODIFY — thêm suite cho search
    └── live-meeting.controller.spec.ts     # MODIFY — thêm suite cho search

src/modules/meetings/entities/
└── meeting-note.entity.ts                  # REUSE — không sửa
```

**Decision — Extend vs New DTO**: Tạo `SearchNotesQueryDto` extend `ViewNotesQueryDto` để tách biệt search-specific validation (q maxLength, authorId format) khỏi view-only fields. Controller dùng discriminated union hoặc một DTO duy nhất vì cùng endpoint.

---

## 3. Scope Confirmation

### ✅ IN SCOPE

- `GET /api/v1/meetings/{meetingId}/notes?q=keyword` — search ghi chú với keyword
- Search trên `meeting_notes.content` — case-insensitive, GIN full-text preferred, ILIKE fallback
- Vietnamese accent-insensitive — application-layer normalization, không bắt buộc PG unaccent
- Keyword validation: trim whitespace, max 255 ký tự
- ILIKE wildcard escape bắt buộc (%, _, \) cho fallback path
- Filter `?authorId=` — validate UUID; kết hợp visibility (Host/Co-host/Participant)
- Filter `?createdFrom=` / `?createdTo=` — ISO datetime, inclusive, độc lập
- Filter `?noteType=`, `?visibility=`, `?pinned=` — kế thừa từ UC-IMM-10
- Pagination: `page`, `limit` (default 20, max 100)
- Visibility rules: Host (all), Co-host (trừ private người khác), Participant (shared + own)
- Empty state: HTTP 200, `data=[]`, message `"Không tìm thấy ghi chú nào khớp với điều kiện tìm kiếm của bạn."`
- Read-only: không side effect, không audit log
- GIN index migration nếu chưa tồn tại (implement decision)

### ❌ OUT OF SCOPE

- POST/PATCH/DELETE ghi chú — UC riêng
- Share/pin/unpin ghi chú — UC riêng
- Tag phân loại chi tiết — không cột tag trong DB; dùng noteType proxy
- Search cross-entity (meeting_notes + meeting_minutes + transcripts)
- AI summary / natural language search
- Search suggestions / auto-complete
- Highlight matched keyword trong response
- Export kết quả search
- Realtime WebSocket
- External Participant
- Audit log cho search (read-only)

---

## 4. Data Model Impact

**KHÔNG thêm bảng mới. KHÔNG thêm cột mới.** Chỉ SELECT.

### 4.1 Bảng chính: `meeting_notes`

Full-text search strategy:
- **Preferred**: `to_tsvector('simple', content)` với GIN index — case-insensitive, không stemming
- **If unaccent available**: `to_tsvector('simple', unaccent(content))` — accent-insensitive
- **Fallback ILIKE**: `content ILIKE escapedKeyword ESCAPE '\'` — với wildcard escape

### 4.2 Index — Cần tạo nếu chưa tồn tại

| Index | Định nghĩa | Priority |
|-------|------------|----------|
| `ix_meeting_notes_content_fts` | GIN `(to_tsvector('simple', content))` | **HIGH** — cần cho full-text search performance |
| `ix_meeting_notes_author_id` | B-tree `(author_id)` | **MEDIUM** — hỗ trợ `?authorId=` filter |
| `ix_meeting_notes_created_at` | B-tree `(created_at)` | **LOW** — hỗ trợ sort + time range (có thể dùng PK order) |

### 4.3 Entity mapping

- `MeetingNoteEntity` đã có, không sửa.
- `NoteType` enum (`IN_MEETING`, `PRIVATE`, `HOST_NOTE`, `SYSTEM_NOTE`) đã có.
- Search không cần entity mới.

---

## 5. API / Contract Plan

### Endpoint

`GET /api/v1/meetings/{meetingId}/notes`
**Permission**: `meeting.note.read` (đã seed)
**Auth**: `JwtAuthGuard` + `PermissionsGuard`

### 5.1 DTO Design

**Option A (Recommended) — Extend `ViewNotesQueryDto`**:
Thêm 4 fields vào `ViewNotesQueryDto` hiện tại:

| Field | Type | Validation | Note |
|-------|------|------------|------|
| `q` | string | `@IsOptional @MaxLength(255) @Trim` | Thêm mới; trim trong service |
| `authorId` | UUID | `@IsOptional @IsUUID` | Thêm mới |
| `createdFrom` | ISO datetime | `@IsOptional @IsDateString` | Alias c?a `from` (có thể map) |
| `createdTo` | ISO datetime | `@IsOptional @IsDateString` | Alias c?a `to` (có thể map) |

> Nếu `q` empty hoặc whitespace-only: behavior fallback v? UC-103 view mode.

**Option B — New `SearchNotesQueryDto` extend `ViewNotesQueryDto`**:
Tạo class riêng extend với search-specific validation. Clean hơn nhưng cần merge logic ? controller.

**Decision (Phase 0)**: Ki?m tra xem `ViewNotesQueryDto` có dùng `forbidNonWhitelisted` global pipe không. N?u có, Option B d? hơn; n?u không, Option A d? h?n.

### 5.2 Response

Dùng lại `ViewNoteResponseDto` (t? UC-IMM-10) — không thay d?i response format.

### 5.3 Controller Mapping

- **Controller method**: `listNotes()` (MODIFY) — thêm search params vào method signature.
- **Service method**: `viewMeetingNotes()` (MODIFY) — thêm search logic (BR-013→BR-019, FR-007→FR-012, FR-028).
  - N?u có `q` và non-empty: apply search predicate.
  - N?u không có `q`: behavior gi?ng UC-IMM-10 view (tr? all notes theo visibility).
  - Search + filter k?t h?p AND logic.

---

## 6. Authorization Plan

| Level | Mechanism | Detail |
|-------|-----------|--------|
| Guard JWT | `JwtAuthGuard` | FR-001 — reject 401 |
| Guard Permission | `PermissionsGuard` + `@RequirePermissions('meeting.note.read')` | FR-002 — reject 403 |
| Service — membership | Check `meeting_participants` ho?c `meetings.host_id` | FR-006, BR-002 — reject 403 `NOT_A_MEETING_PARTICIPANT` |
| Service — role identification | `isHost`, `isCoHost`, `isParticipant` | FR-011 — quy?t d?nh visibility filter |
| Service — visibility sau search | Search ch? áp d?ng SAU visibility filter | FR-011, BR-016 — search không bypass visibility |

### Role-based Visibility Matrix

| Role | Search visibility |
|------|-------------------|
| **Host** | T?t c? notes h?p l?, bao g?m private notes c?a b?t k? ai |
| **Co-host** | T?t c? notes h?p l? NGO?I TR? private notes c?a user khác (`visibility_level='private'` AND `author_id != currentUserId`) |
| **Participant** | Ch? shared (`participants`, `public_internal`) + own notes (`author_id = currentUserId`) + cùng department |
| **Non-member** | 403 NOT_A_MEETING_PARTICIPANT (không bypass cho admin/manager) |

### Permission Seed

`meeting.note.read` dã seed b?i UC-102. Không c?n seed m?i.

---

## 7. Business Logic Plan

### 7.1 `searchMeetingNotes(searchQuery, ...)` — logic m?i trong service

```
1. Resolve currentUserId t? JWT.
2. Validate search keyword:
   - Trim whitespace
   - N?u empty/whitespace-only → fallback v? view mode (không search)
   - Length check > 255 → throw VALIDATION_ERROR
3. Reuse UC-IMM-10 meeting validation + membership check.
4. Reuse UC-IMM-10 visibility role identification (Host/Co-host/Participant).
5. Build base query (FROM meeting_notes WHERE meeting_id + deleted_at IS NULL).
6. Apply visibility predicate (Host: none; Co-host: tr? private ng??i khác; Participant: shared + own).
7. IF ?q non-empty: apply search predicate:
   - Preferred: to_tsvector('simple', content) @@ plainto_tsquery('simple', :q)
   - Fallback: content ILIKE :escapedKeyword ESCAPE '\'
   - Escape wildcard characters (%, _, \) cho fallback path.
8. Apply optional filters (AND logic):
   - authorId, noteType, visibility, pinned, createdFrom, createdTo
9. Validate cross-field: createdFrom > createdTo → INVALID_DATE_RANGE
10. Apply sort, pagination, JOIN users, map response.
11. N?u total = 0: tr? 200 v?i message search empty.
12. Tr? { success, message, data, meta } (HTTP 200).
```

### 7.2 Key helpers

| Helper | Signature | M?c ích |
|--------|-----------|---------|
| `validateSearchKeyword(q)` | `→ string \| null` | Trim, length check, tr? v? null n?u empty (view mode) |
| `buildSearchPredicate(qb, alias, q, strategy)` | `→ void` | Apply FTS ho?c ILIKE predicate; escape wildcard |
| `escapeIlikeWildcard(keyword)` | `→ string` | Escape `%`, `_`, `\` cho ILIKE fallback |
| `normalizeVietnamese(text)` | `→ string` | Lo?i b? d?u ti?ng Vi?t (application-layer) n?u không có unaccent |

### 7.3 Search strategy detection

```
IF GIN index EXISTS AND DB has_unaccent:
  USE FTS + unaccent           -- best quality
ELIF GIN index EXISTS:
  USE FTS (simple config)      -- case-insensitive, accent-sensitive
ELSE:
  USE ILIKE + escape wildcard  -- fallback, kém performance
```

> Detection th?c hi?n ? migration time (t?o index), không ? runtime.

---

## 8. Validation Plan

| Validation | Layer | Mechanism | Error | HTTP |
|------------|-------|-----------|-------|------|
| `q` max length 255 | DTO/Service | `@MaxLength(255)` ho?c service check | VALIDATION_ERROR | 400 |
| `q` trim whitespace | Service | Manual trim | — | — |
| `authorId` UUID format | DTO | `@IsUUID()` | VALIDATION_ERROR | 400 |
| `createdFrom` ISO datetime | DTO | `@IsDateString()` | VALIDATION_ERROR | 400 |
| `createdTo` ISO datetime | DTO | `@IsDateString()` | VALIDATION_ERROR | 400 |
| `createdFrom > createdTo` | Service | Cross-field check | INVALID_DATE_RANGE | 400 |
| `noteType` allowlist | DTO | `@IsIn([...])` | VALIDATION_ERROR | 400 |
| `visibility` allowlist | DTO | `@IsIn([...])` | VALIDATION_ERROR | 400 |
| `sort` allowlist | DTO | `@IsIn([...])` | VALIDATION_ERROR | 400 |
| `pinned` boolean | DTO | `@IsBoolean()` | VALIDATION_ERROR | 400 |
| `limit` 1..100 | DTO | `@Min(1) @Max(100)` | VALIDATION_ERROR | 400 |
| `page` >= 1 | DTO | `@Min(1)` | VALIDATION_ERROR | 400 |
| ILIKE wildcard escape | Service | Escape `%` `_` `\` | — | — |
| SQL injection | Service | Parameterized query | — | — |
| Meeting validation | Service | SELECT + check | NOT_FOUND / STATUS_INVALID | 404/422 |
| Membership validation | Service | SELECT + check | NOT_A_MEETING_PARTICIPANT | 403 |
| Auth | Guard | JwtAuthGuard | UNAUTHORIZED | 401 |
| Permission | Guard | PermissionsGuard | PERMISSION_DENIED | 403 |

---

## 9. Error Handling Plan

### 9.1 Error Codes (Reuse từ UC-IMM-10)

T?t c? error codes dã có trong `meeting-note-error.constant.ts` — không c?n thêm m?i.

### 9.2 Exception Mapping

| HTTP | Error Code | Exception | Context |
|------|------------|-----------|---------|
| 400 | `VALIDATION_ERROR` | `BadRequestException` | q > 255, authorId invalid UUID, from/to wrong format, limit > 100, allowlist violation |
| 400 | `INVALID_DATE_RANGE` | `BadRequestException` | createdFrom > createdTo |
| 401 | `UNAUTHORIZED` | JwtAuthGuard | Invalid/expired token |
| 403 | `PERMISSION_DENIED` | PermissionsGuard | Missing meeting.note.read |
| 403 | `NOT_A_MEETING_PARTICIPANT` | `ForbiddenException` | Not a meeting member |
| 404 | `MEETING_NOT_FOUND` | `NotFoundException` | Meeting not exists / soft-deleted |
| 422 | `MEETING_STATUS_NOT_VIEWABLE` | `UnprocessableEntityException` | Wrong meeting status |
| 500 | `INTERNAL_ERROR` | Global filter | Unexpected server error |

### 9.3 Quy t?c

- Keyword sanitize b?ng parameterized query — không n?i chu?i raw SQL.
- ILIKE fallback: escape `%`, `_`, `\` tru?c khi bind.
- Error message không ti?t l? n?i dung note.
- Không log `content` ghi chú trong error log.

---

## 10. Testing Strategy

### 10.1 Service Unit Tests (thêm suite cho search)

**Search happy path**:
1. Host search keyword → t?t c? notes h?p l? ch?a keyword. (AC-001, FR-007)
2. Participant search → ch? shared + own notes. (AC-002, FR-007)
3. Search không bypass visibility — private notes blocked. (AC-003, FR-011)
4. Co-host search → th?y t?t c? NGO?I TR? private notes ng??i khác. (AC-024)
5. Case-insensitive search. (AC-006, FR-007)
6. Vietnamese unaccent (n?u DB support). (AC-007, FR-008)

**Search edge cases**:
7. Empty keyword → behavior view mode. (AC-004, FR-010)
8. No results → 200, data=[], search message. (AC-005, FR-025)
9. q > 255 → 400 VALIDATION_ERROR. (AC-022, BR-021)
10. ILIKE wildcard escape — literal search. (AC-023, FR-028)

**Filter + search**:
11. Search + authorId AND. (AC-008, FR-012, FR-013)
12. Search + time range AND. (AC-008, FR-014, FR-015)
13. Search + noteType AND. (AC-009, FR-017)
14. Search + pinned AND. (AC-010, FR-019)

**Pagination + search**:
15. page/limit v?i search results. (AC-011, FR-021)
16. limit > 100. (AC-012, FR-021)

**Validation errors**:
17. authorId invalid UUID. (AC-013, FR-013)
18. createdFrom wrong format. (AC-014, FR-014)
19. createdFrom > createdTo. (AC-015, FR-016)

**Authorization**:
20-24. Auth guard, permission, membership, not found, wrong status. (AC-016→AC-020)

**Read-only**:
25. Không INSERT/UPDATE/DELETE. (AC-021, FR-026)

### 10.2 Controller Unit Tests

1. Search query params parse correctly (q, authorId, createdFrom, createdTo).
2. Invalid UUID → 400.
3. Auth/permission guards.

### 10.3 DTO Tests

- `q` @MaxLength(255) validation.
- `authorId` @IsUUID validation.
- `createdFrom`/`createdTo` @IsDateString validation.
- Combined with existing UC-IMM-10 fields.

### 10.4 Test Convention

- Mock `DataSource` + `QueryBuilder` (pattern t? UC-102/UC-103 tests).
- Không ph? thu?c DB th?t.
- Test ILIKE escape function riêng.

---

## 11. Implementation Phases

### Phase 0 — Codebase Analysis

**M?c tiêu**: Xác nh?n tr?ng thái code hi?n t?i, quy?t d?nh approach.

Ki?m tra:
1. `ViewNotesQueryDto` hi?n t?i có dùng `forbidNonWhitelisted` không → ?nh h??ng vi?c extend
2. GIN index `ix_meeting_notes_content_fts` dã t?n t?i ch?a
3. `meeting-note-error.constant.ts` có d? các error code UC-IMM-11 c?n không
4. Seed permission `meeting.note.read` có r?i ch?a
5. `live-meeting.module.ts` có c?n import gì thêm không

**Output**: Ghi nh?n k?t qu?; quy?t d?nh extend DTO hay t?o m?i.

### Phase 1 — DTO

- Thêm `q`, `authorId`, `createdFrom`, `createdTo` vào `ViewNotesQueryDto` (ho?c t?o `SearchNotesQueryDto`).
- C?p nh?t `index.ts` export.
- Test DTO validation.

### Phase 2 — Search Logic

- Implement `searchMeetingNotes()` trong service (ho?c m? r?ng `viewMeetingNotes()`).
- Search predicate: FTS preferred, ILIKE fallback.
- Wildcard escape utility function.
- Vietnamese normalization utility.
- AuthorId filter v?i visibility check (Co-host không ?u?c xem private ng??i khác qua filter).
- Cross-field validation `createdFrom > createdTo`.
- Merge v?i visibility/pagination logic hi?n t?i.

### Phase 3 — Controller

- C?p nh?t `listNotes()` — search params t? DTO m?i.
- ?m b?o route v?n là `GET meetings/:meetingId/notes`.

### Phase 4 — Index Migration

- T?o migration t?o GIN index `ix_meeting_notes_content_fts` n?u ch?a có.
- T?o B-tree index `ix_meeting_notes_author_id` n?u ch?a có.

### Phase 5 — Tests

- Unit test service (25+ cases theo §10.1).
- Unit test controller (3+ cases theo §10.2).
- DTO test (3+ cases theo §10.3).
- Run `npm run lint` + `npm run test` + `npm run build`.

---

## 12. Risks & Mitigations

| Risk | Impact | Mitigation |
|------|--------|------------|
| ViewNotesQueryDto dùng forbidNonWhitelisted | Thêm field m?i s? b? reject | Phase 0 ki?m tra; n?u có, t?o SearchNotesQueryDto extend ho?c dùng class-validator groups |
| GIN index ch?a t?n t?i | FTS s? ch?m ho?c sai | Phase 4 t?o migration; n?u ch?a có, ILIKE fallback v?n work |
| `from`/`to` vs `createdFrom`/`createdTo` double field | Confusion cho API consumer | Map c? hai v? cùng column; ?u tiên `createdFrom`/`createdTo` cho search |
| Co-host + authorId filter ph?c t?p | Có th? leak private notes | Test Co-host path k?; dùng chung visibility predicate v?i view |
| ILIKE fallback performance v?i data l?n | Slow query | Dùng FTS preferred; ILIKE ch? fallback; pagination gi?i h?n scope |
| `q` empty behavior khác v?i frontend expectation | UX confusion | Spec rõ ràng: `?q=` → view mode. Test frontend integration |

---

## 13. Acceptance Criteria Traceability

| AC ID | N?i dung | FR / BR / CR | Test Phase |
|-------|----------|-------------|------------|
| AC-001 | Host search → t?t c? notes kh?p keyword | FR-007, BR-004, BR-007 | P5 (#1) |
| AC-002 | Participant search → ch? shared + own | FR-007, BR-005, BR-016 | P5 (#2) |
| AC-003 | Search không bypass visibility | FR-011, BR-016 | P5 (#3) |
| AC-004 | `?q=` r?ng → view mode | FR-010, BR-013 | P5 (#7) |
| AC-005 | No results → empty state | FR-025, BR-012 | P5 (#8) |
| AC-006 | Case-insensitive search | FR-007, BR-014 | P5 (#5) |
| AC-007 | Vietnamese unaccent | FR-008, CD-003 | P5 (#6) |
| AC-008 | Search + authorId + time range AND | FR-012, FR-013/014/015, BR-017 | P5 (#11,12) |
| AC-009 | Search + noteType | FR-012, FR-017 | P5 (#13) |
| AC-010 | Search + pinned | FR-012, FR-019 | P5 (#14) |
| AC-011 | Pagination v?i search | FR-021, FR-022 | P5 (#15) |
| AC-012 | limit > 100 | FR-021 | P5 (#16) |
| AC-013 | authorId invalid UUID | FR-013 | P1 (#17) |
| AC-014 | createdFrom sai format | FR-014 | P1 (#18) |
| AC-015 | createdFrom > createdTo | FR-016 | P2 (#19) |
| AC-016 | No auth → 401 | FR-001 | P3 |
| AC-017 | No permission → 403 | FR-002 | P3 |
| AC-018 | Not participant → 403 | FR-006 | P2 (#20) |
| AC-019 | Meeting not found → 404 | FR-004 | P2 (#20) |
| AC-020 | Wrong status → 422 | FR-005 | P2 (#20) |
| AC-021 | Read-only — no writes | FR-026 | P5 (#25) |
| AC-022 | q > 255 → 400 | FR-007, BR-021, CR-003 | P1 (#9) |
| AC-023 | ILIKE wildcard escape | FR-028, BR-022, CR-004 | P2 (#10) |
| AC-024 | Co-host visibility vs Host | FR-006, BR-004/006/020, CR-002 | P2 (#4) |

---

## Complexity Tracking

**Không có vi ph?m constitution.** Feature read-only, reuse schema hi?n t?i, extend DTO có s?n.

| Violation | Why Needed | Simpler Alternative Rejected Because |
|-----------|------------|-------------------------------------|
| — | — | — |

---

## Appendix: File Inventory

### Files to CREATE

```text
spec/features/live-meeting/feat-search-meeting-notes/plan.md
spec/features/live-meeting/feat-search-meeting-notes/research.md
spec/features/live-meeting/feat-search-meeting-notes/data-model.md
spec/features/live-meeting/feat-search-meeting-notes/quickstart.md
spec/features/live-meeting/feat-search-meeting-notes/contracts/search-meeting-notes-api.md

src/database/migrations/TIMESTAMP-add-meeting-notes-fts-index.ts   (n?u GIN index ch?a t?n t?i)
```

### Files to MODIFY

```text
src/modules/live-meeting/dto/view-notes-query.dto.ts              (extend v?i q, authorId, createdFrom, createdTo)
src/modules/live-meeting/dto/view-notes-query.dto.spec.ts          (thêm test search fields)
src/modules/live-meeting/dto/index.ts                               (export m?i n?u t?o DTO riêng)
src/modules/live-meeting/controllers/live-meeting.controller.ts    (update listNotes signature)
src/modules/live-meeting/services/live-meeting.service.ts          (thêm search logic)
src/modules/live-meeting/tests/live-meeting.service.spec.ts        (thêm suite search)
src/modules/live-meeting/tests/live-meeting.controller.spec.ts     (thêm suite search)
```

### Files REUSE (không s?a)

```text
src/modules/meetings/entities/meeting-note.entity.ts
src/modules/live-meeting/constants/meeting-note-error.constant.ts
src/modules/live-meeting/dto/view-note-response.dto.ts
src/modules/live-meeting/live-meeting.module.ts
spec/features/live-meeting/feat-search-meeting-notes/spec.md
spec/features/live-meeting/feat-search-meeting-notes/checklists/requirements.md
```
