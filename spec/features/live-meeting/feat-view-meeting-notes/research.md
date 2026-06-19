# Research: Xem ghi chú trong cuộc họp (View Meeting Notes — UC-IMM-10)

## CHANGELOG

| Ngày | Tóm tắt |
|------|---------|
| 2026-06-18 | Tạo research cho UC-IMM-10 (View Meeting Notes) |

---

## Codebase Analysis

### Existing Patterns (từ UC-IMM-03/05/09 trong `live-meeting`)

- **Read Query Pattern**: `LiveMeetingService` inject `DataSource`; dùng `dataSource.createQueryBuilder()` để SELECT với JOIN và filter động; pagination qua `offset/limit` + `COUNT(*)` riêng.
- **Service signature**: `(resourceId, query?, authUser)` → validate → build query → map DTO → trả response.
- **Controller Pattern**: route trong `LiveMeetingController`, `@UseGuards(JwtAuthGuard, PermissionsGuard)` + `@RequirePermissions(...)`, `ParseUUIDPipe` cho `meetingId`, lấy user từ `request['user'] as { userId }`.
- **Error Handling**: `NotFoundException`/`ForbiddenException`/`BadRequestException`/`UnprocessableEntityException` với payload `{ success, message, error: { code, details } }`. Error codes tập trung trong constant file.
- **DTO Pattern (GET list)**: query DTO với `@IsOptional` + `@Transform` cho boolean/number; response DTO với constructor `Object.assign`; envelope `{ success, message, data, meta }`.

### Relationship với UC-103 (feat-in-meeting-notes)

UC-103 (`GET /api/v1/meetings/{meetingId}/notes`) đã được đặc tả trong `feat-in-meeting-notes` với:
- Status filter: chỉ `in_progress`.
- Visibility: filter cơ bản theo `author_id` và `visibility_level`.
- Response: `createdAt` field.
- Query params: `noteType`, `pinned`, `q` (FTS), `page`, `limit`.

UC-IMM-10 là **canonical spec đầy đủ** cho cùng endpoint:
- Mở rộng status: `in_progress` **và** `completed`.
- Visibility: Host/Participant matrix đầy đủ với 4 INVARIANTS.
- Response: `noteTimestamp` (thay `createdAt`), opt-in `sourceEventTime`/`sourceEventType`.
- Query params bổ sung: `from`, `to`, `sort`, `includeSourceEvent`, `visibility`.
- Error code mới: `INVALID_DATE_RANGE`, `NOT_A_MEETING_PARTICIPANT`, `MEETING_STATUS_NOT_VIEWABLE`.

**Action**: `listNotes()` / `listMeetingNotes()` từ UC-103 sẽ bị thay thế/update theo UC-IMM-10. Kiểm tra Phase 0 để xác định level của thay đổi.

### Available Entities & Imports

| Entity | Module | Sử dụng trong UC-IMM-10 |
|--------|--------|------------------------|
| `MeetingNoteEntity` | `meetings` | SELECT chính — bảng `meeting_notes` |
| `MeetingNoteType` (enum) | `meetings` | Filter `noteType` allowlist |
| `MeetingEntity` / `MeetingStatus` | `meetings` | Validate tồn tại + status `in_progress`/`completed` |
| `MeetingParticipantEntity` | `meetings` | Membership check: is Host hoặc Participant |
| `UserEntity` | `accounts` | JOIN author (`id`, `full_name`, `department_id`) |
| `MeetingEventEntity` | `meetings` | **Opt-in** LEFT JOIN khi `includeSourceEvent=true` |
| `DataSource` | typeorm | Query builder + không cần transaction |

> **Không dùng**: `WebsocketService`, `AuditLogEntity`, `NotificationEntity` — feature read-only, không trigger event/notification/audit (spec §15).

### Dependencies / Integrations

- Module `live-meeting` import `AuthModule`, `WebsocketModule`. Service dùng `DataSource` global — không cần `TypeOrmModule.forFeature` mới.
- `MeetingNoteEntity`, `MeetingEventEntity` đã register trong `src/database/entities/index.ts`.
- Permission `meeting.note.read` — **kiểm tra Phase 0** xem đã seed chưa (UC-102 plan đã đề cập seed).
- GIN index `idx_meeting_notes_content_fts` — đã tạo bởi UC-102 migration (nếu đã chạy).
- Index `ix_meeting_notes_meeting ON meeting_notes(meeting_id)` — cần xác nhận tồn tại.

---

## Technology Decisions

| Decision | Choice | Rationale |
|----------|--------|-----------|
| ORM | TypeORM `QueryBuilder` | Align codebase; RULE không dùng Prisma; query phức tạp với conditional JOIN và OR predicate |
| Transaction | **KHÔNG cần** | Read-only operation; không có write side effect (BR-011, spec §15) |
| Visibility filter | SQL OR predicate trong QueryBuilder | Tránh N+1; filter tại DB level cho performance; cô lập trong helper `buildParticipantVisibilityPredicate` |
| Opt-in enrichment | Conditional `leftJoinAndSelect` khi `includeSourceEvent=true` | Tránh JOIN thừa mặc định; CD-001 |
| `from`/`to` cross-field validation | Service level (sau DTO format validation) | DTO chỉ validate format riêng lẻ; cross-field cần service; error code `INVALID_DATE_RANGE` khác `VALIDATION_ERROR` |
| `from`/`to` independence | Xử lý riêng trong query builder | CD-003: chỉ `from` hoặc chỉ `to` đều hợp lệ; không yêu cầu cặp |
| Response field name | `noteTimestamp` (không phải `createdAt`) | CD-001; phân biệt rõ với UC-103 response; tránh client nhầm lẫn với `updatedAt` |
| Default sort | `created_at ASC` (timeline tăng dần) | BR-007; spec §6 timeline context |
| Department visibility | EXISTS subquery với `users.department_id` | Không cần load `departments` table; join `users` đã có sẵn cho author info |
| Empty state | 200 với message custom (không 404) | BR-012; đây là kết quả hợp lệ, không phải lỗi |
| Permission check | `@RequirePermissions('meeting.note.read')` + service membership check | Hai tầng: guard (có permission) + service (là member); CD-002 không bypass |

---

## Unknowns Resolved (từ Clarification Decisions đã chốt trong spec §1.4)

- **CD-001 — Source Event Enrichment**: Opt-in via `includeSourceEvent=true`. Field tên `noteTimestamp` (mapped `created_at`). Không JOIN `meeting_events` mặc định.
- **CD-002 — Admin/Manager Bypass**: Không có bypass. Phải là Host hoặc Participant. Audit UC cần `meeting.notes.audit.read` (ngoài scope).
- **CD-003 — Time Range Filter**: `from`/`to` độc lập. Cả hai → validate `from <= to`. Error code `INVALID_DATE_RANGE` (không phải `VALIDATION_ERROR`).

---

## Risks (chi tiết tại plan.md §12)

1. UC-103 đã implement `createdAt` trong response DTO → cần sửa sang `noteTimestamp` (breaking change kiểm soát được trên cùng branch).
2. `department` visibility với `department_id = NULL` — cần guard NULL trong EXISTS subquery.
3. `meeting_events.event_type` column cần xác nhận tồn tại trong entity/schema (Phase 0).
4. Permission `meeting.note.read` chưa chắc đã seed — Phase 0 kiểm tra.
5. Index `created_at` trong `meeting_notes` chưa chắc có — ảnh hưởng performance `from`/`to` filter với data lớn.
