# Data Model: Tìm kiếm ghi chú trong cuộc họp (Search Meeting Notes)

**Feature**: UC-IMM-11 / UC-104
**Module**: live-meeting
**Date**: 2026-06-18

## Database Impact

**KHÔNG thêm bảng mới. KHÔNG thêm cột mới.** Feature hoàn toàn SELECT trên schema hiện có.

## Entity: `meeting_notes` (chính)

| Column | Type | Search Role | Filter |
|--------|------|-------------|--------|
| `id` | `uuid PK` | Trả về | — |
| `meeting_id` | `uuid FK → meetings` | WHERE clause | Required (path param) |
| `author_id` | `uuid FK → users` | Filter + visibility | `?authorId=` |
| `note_type` | `varchar(30)` | Filter | `?noteType=` |
| `content` | `text NOT NULL` | **Search target** | `?q=` (FTS/ILIKE) |
| `pinned` | `boolean DEFAULT false` | Filter | `?pinned=` |
| `visibility_level` | `varchar(30)` | Visibility predicate | `?visibility=` |
| `source_event_id` | `uuid FK → meeting_events` | Trả về | — |
| `created_at` | `timestamptz` | Sort + time filter | `?createdFrom=` / `?createdTo=` / sort |
| `updated_at` | `timestamptz` | Trả về | — |
| `deleted_at` | `timestamptz` | **Luôn filter IS NULL** | — |

## Support Entities (SELECT only)

- `meetings`: validate tồn tại, status, host_id
- `meeting_participants`: validate membership, role (host/co_host/participant)
- `users`: JOIN author full_name, department_id

## Search Strategies

### Preferred: PostgreSQL Full-Text Search
```sql
WHERE to_tsvector('simple', mn.content) @@ plainto_tsquery('simple', :q)
  -- + unaccent nếu extension available:
  -- AND to_tsvector('simple', unaccent(mn.content)) @@ plainto_tsquery('simple', unaccent(:q))
```

### Fallback: ILIKE với wildcard escape
```sql
WHERE mn.content ILIKE :escapedKeyword ESCAPE '\'
-- escapedKeyword = '%' + escapeWildcards(q) + '%'
```

## Query Logic

```sql
-- Core search + visibility query (simplified)
SELECT mn.*, u.full_name, u.department_id
FROM meeting_notes mn
JOIN users u ON mn.author_id = u.id
WHERE mn.meeting_id = :meetingId
  AND mn.deleted_at IS NULL
  -- Visibility (role-dependent):
  AND (
    :isHost = true  -- Host: no filter
    OR :isCoHost = true AND NOT (mn.visibility_level = 'private' AND mn.author_id != :userId)  -- Co-host: tr? private
    OR mn.author_id = :userId  -- Participant: own notes
    OR mn.visibility_level IN ('participants', 'public_internal')
    OR (mn.visibility_level = 'department'
        AND EXISTS (SELECT 1 FROM users u2 WHERE u2.id = mn.author_id AND u2.department_id = :deptId))
  )
  -- Search (optional, when ?q= provided):
  AND to_tsvector('simple', mn.content) @@ plainto_tsquery('simple', :q)
  -- OR ILIKE fallback:
  -- AND mn.content ILIKE :escapedKeyword ESCAPE '\'
  
  -- Filters (all optional, AND logic):
  AND (:authorId IS NULL OR mn.author_id = :authorId)
  AND (:noteType IS NULL OR mn.note_type = :noteType)
  AND (:visibility IS NULL OR mn.visibility_level = :visibility)
  AND (:pinned IS NULL OR mn.pinned = :pinned)
  AND (:createdFrom IS NULL OR mn.created_at >= :createdFrom)
  AND (:createdTo IS NULL OR mn.created_at <= :createdTo)
ORDER BY mn.created_at ASC  -- or DESC for timeline_desc
LIMIT :limit OFFSET (:page - 1) * :limit;
```

## Indexes (cần xác nhận)

| Index | Purpose | Có sẵn? |
|-------|---------|---------|
| `ix_meeting_notes_meeting_id` | Filter by meeting | Cần kiểm tra |
| `ix_meeting_notes_author_id` | Filter by authorId | Cần kiểm tra |
| `ix_meeting_notes_content_fts` (GIN) | Full-text search | Cần kiểm tra (nên tạo nếu chưa có) |
| `ix_meeting_notes_created_at` | Time range filter + sort | Cần kiểm tra |
