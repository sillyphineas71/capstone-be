# Research: Tìm kiếm ghi chú trong cuộc họp (Search Meeting Notes)

**Feature**: UC-IMM-11 / UC-104
**Module**: live-meeting
**Date**: 2026-06-18

## Codebase Analysis

### Existing Implementation

1. **Endpoint**: `GET /api/v1/meetings/{meetingId}/notes` — đã được implement bởi UC-IMM-10 (View Meeting Notes). Controller method `listNotes()` trong `LiveMeetingController` gọi service method `viewMeetingNotes()`.

2. **DTO hiện có**:
   - `ViewNotesQueryDto` — có sẵn các filter: `noteType`, `visibility`, `pinned`, `from`, `to`, `includeSourceEvent`, `page`, `limit`, `sort`.
   - `ViewNoteResponseDto` — có sẵn response fields: `id`, `meetingId`, `noteType`, `content`, `pinned`, `visibilityLevel`, `author`, `sourceEventId`, `noteTimestamp`, `updatedAt`.

3. **Service method**: `viewMeetingNotes(meetingId, query, authUser)` đã implement với visibility logic (Host/Co-host/Participant), pagination, opt-in source event enrichment.

4. **Search code**: Phát hiện có code search trong service nhưng search trên `u.fullName` (participant name), không phải `meeting_notes.content`. Cần implement search trên content riêng.

5. **Error constants**: `meeting-note-error.constant.ts` có sẵn `INVALID_DATE_RANGE`, `NOT_A_MEETING_PARTICIPANT`, `MEETING_STATUS_NOT_VIEWABLE` (từ UC-IMM-10).

6. **Permission**: `meeting.note.read` đã được seed.

### Key Technical Decisions

| Decision | Choice | Rationale |
|----------|--------|-----------|
| Search on existing endpoint | Cùng `GET /meetings/{meetingId}/notes` | API Contract UC-104 chỉ định; frontend dùng chung endpoint; `?q=` kích hoạt search mode |
| DTO extension | Extend `ViewNotesQueryDto` thay vì tạo mới | Tránh duplicate; add `q`, `authorId`, `createdFrom`, `createdTo` |
| Search strategy | PostgreSQL Full-Text Search (GIN) preferred, ILIKE fallback | GIN index trên `to_tsvector('simple', content)` cho case-insensitive FTS; ILIKE fallback khi query đơn giản |
| Vietnamese unaccent | Application-layer normalization, không bắt buộc extension | CR-001; dùng `unaccent` PG extension nếu có, fallback về lower()+removeAccent utility |
| ILIKE wildcard | Escape `%`, `_`, `\` với `ESCAPE '\'` | CR-004; bắt buộc để tránh unintentional pattern matching |
| Keyword validation | Max 255 ký tự | CR-003; trim whitespace; empty = view mode (UC-103 behavior) |
| Visibility | Reuse UC-IMM-10 logic (Host/Co-host/Participant) | Giữ consistency; search không bypass visibility |

### Risks

| Risk | Mitigation |
|------|------------|
| GIN index chưa tồn tại | Phase 0 kiểm tra; nếu chưa có → tạo migration index (scope nhỏ) |
| `authorId` filter với Co-host visibility phức tạp | Service layer kiểm tra Co-host rule trước khi filter |
| `createdFrom`/`createdTo` khác `from`/`to` từ UC-IMM-10 | DTO có thể map cả hai hoặc dùng alias; consistency cần check |
| Search performance với data nhiều | Index + FTS preferred; ILIKE fallback có pagination giới hạn |
