# Data Model: Xem ghi chú trong cuộc họp (UC-IMM-10)

## CHANGELOG

| Ngày | Tóm tắt |
|------|---------|
| 2026-06-18 | Tạo data-model cho View Meeting Notes |

> **KHÔNG thêm bảng mới. KHÔNG thêm cột mới. KHÔNG tạo migration.** Toàn bộ dùng schema DB v3.2 Compact hiện có. Operation là **read-only** hoàn toàn.

---

## Entities Involved

### `meeting_notes` (chỉ SELECT)

Entity: `MeetingNoteEntity` (`src/modules/meetings/entities/meeting-note.entity.ts`).

| Column | Type | Operation | Ghi chú |
|--------|------|-----------|---------|
| `id` | uuid PK | SELECT → response `id` | — |
| `meeting_id` | uuid FK → `meetings.id` | WHERE `= :meetingId` (required) | — |
| `author_id` | uuid FK → `users.id` | WHERE (visibility predicate) + JOIN users | Visibility: `author_id = currentUserId` |
| `note_type` | varchar(30) | WHERE (optional filter) + SELECT → response `noteType` | `in_meeting` / `private` / `host_note` / `system_note` |
| `content` | text | SELECT → response `content` | Đã sanitize từ UC-102 |
| `pinned` | boolean | WHERE (optional filter) + SELECT → response `pinned` | — |
| `visibility_level` | varchar(30) | WHERE (visibility predicate) + SELECT → response `visibilityLevel` | Core của Participant visibility |
| `source_event_id` | uuid (nullable) | SELECT → response `sourceEventId`; LEFT JOIN (opt-in) | `meeting_events.id` FK |
| `created_at` | timestamptz | ORDER BY; WHERE `>= from` / `<= to`; SELECT → response `noteTimestamp` | CD-001: field name là `noteTimestamp` |
| `updated_at` | timestamptz | SELECT → response `updatedAt` | — |
| `deleted_at` | timestamptz (nullable) | WHERE IS NULL (luôn, BR-003) | Soft delete filter bắt buộc |

### Bảng validate/join (chỉ SELECT)

| Bảng | Cột dùng | Mục đích |
|------|----------|----------|
| `meetings` | `id`, `status`, `host_id`, `deleted_at` | Validate tồn tại (FR-004); status `in_progress`/`completed` (FR-005); xác định `isHost` (FR-006) |
| `meeting_participants` | `meeting_id`, `user_id`, `participant_role` | Check membership (FR-006); `participant_role = 'host'` để xác định Host role |
| `users` | `id`, `full_name`, `department_id` | JOIN author info cho response (FR-019); `department_id` cho visibility `department` (BR-005) |
| `meeting_events` | `id`, `event_time`, `event_type` | **Opt-in only** — LEFT JOIN khi `includeSourceEvent=true` (FR-017, CD-001) |

---

## Host vs Participant Visibility Matrix

| Actor | Ghi chú được thấy | Ghi chú không thấy |
|-------|-------------------|---------------------|
| **Host** | TẤT CẢ `deleted_at IS NULL` của meeting | `deleted_at IS NOT NULL` |
| **Participant** | Ghi chú của chính mình (`author_id = currentUserId`) | Private notes của người khác |
| **Participant** | `visibility_level = 'participants'` | `host_note` với `visibility_level = 'private'` |
| **Participant** | `visibility_level = 'public_internal'` | Bất kỳ note nào `visibility_level = 'private'` + `author != self` |
| **Participant** | `visibility_level = 'department'` khi cùng phòng ban | — |

### SQL Predicate — Host Path

```sql
WHERE mn.meeting_id = :meetingId
  AND mn.deleted_at IS NULL
  /* Không có thêm điều kiện visibility */
```

### SQL Predicate — Participant Path

```sql
WHERE mn.meeting_id = :meetingId
  AND mn.deleted_at IS NULL
  AND (
    mn.author_id = :currentUserId
    OR mn.visibility_level = 'participants'
    OR mn.visibility_level = 'public_internal'
    OR (
      mn.visibility_level = 'department'
      AND EXISTS (
        SELECT 1 FROM users u2
        WHERE u2.id = mn.author_id
          AND u2.department_id IS NOT NULL
          AND u2.department_id = :currentUserDeptId
      )
    )
  )
```

> **`department_id IS NOT NULL` guard**: tránh case NULL = NULL trong SQL trả TRUE sai khi cả author và currentUser đều NULL department.

---

## Optional Filters (áp SAU visibility predicate)

| Filter | SQL Clause |
|--------|-----------|
| `?noteType=X` | `AND mn.note_type = :noteType` |
| `?visibility=X` | `AND mn.visibility_level = :visibility` |
| `?pinned=true` | `AND mn.pinned = true` |
| `?from=ISO` | `AND mn.created_at >= :from` |
| `?to=ISO` | `AND mn.created_at <= :to` |
| `?from=ISO&to=ISO` | Validate `from <= to` (service) → cả hai filter |

---

## Opt-in Enrichment (`includeSourceEvent=true`)

```sql
LEFT JOIN meeting_events me ON mn.source_event_id = me.id
```

| Khi `me.id` match | `sourceEventTime` = `me.event_time`, `sourceEventType` = `me.event_type` |
|---|---|
| Khi `me.id` NULL (LEFT JOIN miss) | `sourceEventTime = null`, `sourceEventType = null` |
| Khi `includeSourceEvent=false` (mặc định) | Không LEFT JOIN; không có field trong response |

---

## Sort & Pagination

```sql
ORDER BY mn.created_at ASC   -- timeline_asc (default)
-- hoặc
ORDER BY mn.created_at DESC  -- timeline_desc

LIMIT :limit OFFSET (:page - 1) * :limit
```

COUNT query riêng:
```sql
SELECT COUNT(*) FROM meeting_notes mn
[same JOIN và WHERE conditions, không LIMIT/OFFSET]
```

---

## Indexes Dùng (không tạo mới)

| Index | Bảng.Cột | Loại | Có sẵn từ |
|-------|----------|------|-----------|
| `ix_meeting_notes_meeting` | `meeting_notes(meeting_id)` | B-tree | UC-102 migration hoặc baseline |
| `ix_meeting_notes_type` | `meeting_notes(note_type)` | B-tree | Baseline |
| `idx_meeting_notes_content_fts` | `meeting_notes(content)` GIN | GIN | UC-102 migration |
| *(cần xác nhận Phase 0)* | `meeting_notes(created_at)` | B-tree | Ảnh hưởng `from`/`to` filter performance |

---

## Transaction Boundary

UC-IMM-10 là read-only — **KHÔNG có transaction ghi**. Chỉ dùng query builder + SELECT.

```
1. [ngoài tx] validate from/to cross-field
2. SELECT meetings WHERE id = :meetingId AND deleted_at IS NULL
3. SELECT meeting_participants WHERE meeting_id = :meetingId AND user_id = :currentUserId
4. Build + execute QueryBuilder (SELECT meeting_notes + JOINs + filters + pagination)
5. [ngoài tx] map → ViewNoteResponseDto[]
6. [ngoài tx] build meta + return
```

---

## Data Constraints (Read Context)

- `deleted_at IS NULL` luôn được enforce (BR-003, FR-009).
- `visibility_level` filter từ query param áp **SAU** role-based predicate (BR-015, spec §13).
- `noteTimestamp` là `created_at` immutable — không cho client sửa (đã đảm bảo từ UC-102 lúc tạo).
- Content đã sanitize từ UC-102 — không cần sanitize lại khi đọc (spec §9).
