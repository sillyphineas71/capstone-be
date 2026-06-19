# Data Model: Thêm ghi chú trong cuộc họp (UC-IMM-09 / UC-102/103/104)

## CHANGELOG

| Ngày | Tóm tắt |
|------|---------|
| 2026-06-18 | Tạo data-model cho In-Meeting Notes |

> **KHÔNG thêm bảng mới. KHÔNG thêm cột mới.** Toàn bộ dùng bảng có sẵn trong DB v3.2 Compact. Chỉ thêm **1 GIN index** phục vụ full-text search (index-only, không đổi schema cột).

---

## Entities Involved

### `meeting_notes` (INSERT khi UC-102 / SELECT khi UC-103/104)

Entity: `MeetingNoteEntity` (`src/modules/meetings/entities/meeting-note.entity.ts`).

| Field | Type | Operation UC-102 | Ghi chú |
|-------|------|------------------|---------|
| `id` | uuid PK | INSERT (auto) | `@PrimaryGeneratedColumn('uuid')` |
| `meeting_id` | uuid FK → `meetings.id` | INSERT (từ path param) | — |
| `author_id` | uuid FK → `users.id` | INSERT (từ JWT, **không** từ body) | FR-003 |
| `note_type` | varchar(30) | INSERT — allowlist `in_meeting`/`private`/`host_note` | BR-003; cấm `system_note` (FR-005) |
| `content` | text NOT NULL | INSERT (đã sanitize) | NFR-005, FR-009 |
| `pinned` | boolean DEFAULT false | INSERT — `true` chỉ Host, non-host ép `false` | BR-009 |
| `visibility_level` | varchar(30) DEFAULT 'participants' | INSERT — default theo `note_type` nếu client không gửi | BR-005/006/007, FR-007/008 |
| `source_event_id` | uuid FK → `meeting_events.id` (nullable) | INSERT = `NULL` (manual note) | spec §5.1 |
| `created_at` | timestamptz DEFAULT now() | server-generated (`@CreateDateColumn`) | BR-002, FR-004 |
| `updated_at` | timestamptz | auto (`@UpdateDateColumn`) | — |
| `deleted_at` | timestamptz (nullable) | NULL khi tạo; điều kiện lọc khi GET | BR-010, FR-016 |

### Bảng chỉ đọc (validate / join)

| Bảng | Mục đích | Liên quan |
|------|----------|-----------|
| `meetings` | Check tồn tại + `status = in_progress` | BR-001, FR-002 |
| `meeting_participants` | Check `is_host = true`; xác định user là participant cho visibility `participants` | BR-004/009, FR-014 |
| `users` | Join `author` (id, full_name); lấy `department_id` cho visibility `department` | API contract, FR-014 |

---

## `note_type` → default `visibility_level` (khi client không gửi)

| `note_type` | Default `visibility_level` | Rule |
|-------------|----------------------------|------|
| `host_note` | `private` | BR-005 |
| `in_meeting` | `participants` | BR-006 |
| `private` | `private` | BR-007 |

`visibility_level` allowlist (nếu client gửi tường minh): `private`, `participants`, `department`, `public_internal` (FR-008).

---

## Visibility Filter (UC-103/104 — đọc)

User thấy note nếu thỏa **một** điều kiện (author luôn thấy note của mình):

| `visibility_level` | Điều kiện hiển thị |
|--------------------|--------------------|
| `private` | `author_id = currentUserId` |
| `participants` | currentUser ∈ `meeting_participants` của meeting |
| `department` | `currentUser.department_id = author.department_id` *(diễn giải — xác nhận team)* |
| `public_internal` | mọi internal user đã xác thực *(diễn giải — xác nhận team)* |

Luôn kèm điều kiện `deleted_at IS NULL` (BR-010, FR-016).

---

## Indexes

| Index | Định nghĩa | Mục đích |
|-------|------------|----------|
| (mới) `idx_meeting_notes_content_fts` | `GIN (to_tsvector('simple', content))` | Full-text search UC-104 (FR-017) |
| (kỳ vọng có sẵn) FK index `meeting_id` | — | Lọc theo meeting; xác nhận khi migration |

> Migration chỉ tạo index — **không** thêm/đổi cột ⇒ không vi phạm baseline. Có `down()` drop index.

---

## State / Lifecycle

```
Note: (none) -> created            (UC-102, không có draft phía server)
Read: lọc theo visibility + deleted_at IS NULL   (UC-103/104)
```

Không có state transition khác trong scope (PATCH/DELETE/pin/share đều Out of Scope).

---

## Transaction Boundary (UC-102)

```
1. (ngoài tx) Sanitize content; reject system_note (422); trim rỗng -> 400.
2. BEGIN transaction
   a. SELECT meeting ... setLock('pessimistic_read'); không có/deleted -> 404 MEETING_NOT_FOUND
   b. status != in_progress -> 409 MEETING_NOT_IN_PROGRESS  (EC-001 / AC-014)
   c. isHost = EXISTS(meeting_participants: meeting_id, user_id=current, is_host=true)
   d. note_type=host_note & !isHost -> 403 NOTE_HOST_ONLY
   e. resolve visibility_level (gửi tường minh: validate allowlist; else default theo note_type)
   f. resolve pinned (true & !isHost -> false)
   g. INSERT meeting_notes (author_id=current, content sanitized, source_event_id=NULL)
3. COMMIT
4. (ngoài tx) Load note + author -> NoteResponseDto (201)
```

UC-103/104 (đọc) **không** mở transaction ghi; chỉ query builder + pagination.

---

## Data Constraints

- `content` NOT NULL, không rỗng/whitespace sau sanitize (FR-009).
- `note_type` ∈ {`in_meeting`,`private`,`host_note`} với user actor; `system_note` bị cấm (BR-003).
- `created_at` immutable, do DB sinh (BR-002).
- Note `deleted_at IS NOT NULL` không bao giờ trả về GET (BR-010).
