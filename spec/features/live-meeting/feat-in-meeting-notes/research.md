# Research: Thêm ghi chú trong cuộc họp (In-Meeting Notes — UC-IMM-09 / UC-102/103/104)

## CHANGELOG

| Ngày | Tóm tắt |
|------|---------|
| 2026-06-18 | Tạo research cho UC-IMM-09 (In-Meeting Notes) |

---

## Codebase Analysis

### Existing Patterns (từ UC-IMM-01/03/05 trong `live-meeting`)

- **Transaction Pattern**: `LiveMeetingService` inject `DataSource`, dùng `dataSource.transaction(async (em) => …)`; lock row meeting bằng `pessimistic_write`/`pessimistic_read` trước khi đọc-ghi.
- **Service signature**: `(resourceId, dto?, authUser, clientContext?)` → validate → transaction → (optional) post-transaction side-effects → trả response DTO.
- **Controller Pattern**: route đặt trong `LiveMeetingController`, `@UseGuards(JwtAuthGuard, PermissionsGuard)` + `@RequirePermissions(...)`, `ParseUUIDPipe` cho `meetingId`, lấy user từ `request['user'] as { userId }`.
- **Error Handling**: NestJS `NotFoundException`/`ConflictException`/`ForbiddenException`/`BadRequestException`/`UnprocessableEntityException` với payload `{ success, message, error: { code, details } }`. Error code tập trung trong file constant (vd `MEETING_END_ERRORS`).
- **DTO Pattern**: class `class-validator`; response DTO dùng constructor `Object.assign`; format trả `{ success, message, data }` (+ `meta` cho list).
- **Seed permission Pattern**: file trong `src/database/seeds/...-Seed*.ts`, INSERT `permissions` `ON CONFLICT DO NOTHING` rồi gán `role_permissions` cho các role.

### Available Entities & Imports

| Entity | Module | Usage trong feature |
| --- | --- | --- |
| `MeetingNoteEntity` | `meetings` | **Đã tồn tại** — bảng `meeting_notes`, đọc/ghi note |
| `MeetingNoteType` (enum) | `meetings` | `in_meeting` / `private` / `host_note` / `system_note` (đã có) |
| `MeetingEntity` / `MeetingStatus` | `meetings` | Check `status = in_progress` (BR-001) |
| `MeetingParticipantEntity` | `meetings` | Check `is_host` (BR-004/009), xác định participant cho visibility |
| `UserEntity` | `accounts` | Join `author` (id, full_name); `department_id` cho visibility `department` |
| `DataSource` | typeorm | Transaction + query builder |

> **Không** dùng `WebsocketService`/`AuditLogEntity`/`NotificationEntity` cho feature này (spec không yêu cầu audit/notification/realtime cho note; tránh mở rộng scope).

### Dependencies / Integrations

- Module `live-meeting` hiện import `AuthModule`, `WebsocketModule`. Service dùng `DataSource` global ⇒ truy cập `meeting_notes` qua repository/query builder, **không cần** `TypeOrmModule.forFeature` (xác nhận lại ở Phase 3).
- `MeetingNoteEntity` đã được register trong `src/database/entities/index.ts` và `meetings.module.ts`.
- Permission `meeting.note.create`, `meeting.note.read` **chưa tồn tại** trong source ⇒ cần seed mới.
- **Không tồn tại** GIN index full-text trên `meeting_notes.content` ⇒ cần migration (index-only).
- **Không tồn tại** dependency sanitize HTML (`sanitize-html`/`dompurify`) trong `package.json`.

---

## Technology Decisions

| Decision | Choice | Rationale |
|----------|--------|-----------|
| ORM | TypeORM (DataSource + QueryBuilder) | Align codebase; RULE không dùng Prisma |
| Lock mechanism | `pessimistic_read` trên `meetings` trong transaction tạo note | Đóng chặt race với End Meeting (EC-001 / AC-014) |
| Entity | Tái dùng `MeetingNoteEntity` | DB v3.2 Compact đã có bảng/cột; không đổi schema |
| Full-text search | GIN index trên `to_tsvector('simple', content)` + `plainto_tsquery('simple', q)` | PostgreSQL không có config tiếng Việt mặc định; `simple` an toàn, tránh stemming sai |
| Default visibility | Map theo `note_type`: host_note→`private`, in_meeting→`participants`, private→`private` | BR-005/006/007 |
| `visibility_level` allowlist | `['private','participants','department','public_internal']` | FR-008 (clarification #3 đã chốt) |
| Sanitize XSS | Util `sanitizeNoteContent()` trong `common/utils` (strip/escape tag nguy hiểm), không thêm lib nặng | NFR-005 + RULE không thêm framework thừa |
| Permission check | `@RequirePermissions('meeting.note.create' \| 'meeting.note.read')` + service-level host check cho `host_note` | FR-001/006/013 |
| Error codes | `MEETING_NOTE_ERRORS` constant | Pattern `MEETING_END_ERRORS` |
| Response format | `{ success, message, data }` (POST), `{ success, message, data, meta }` (GET list) | Convention chung |

---

## Unknowns Resolved (từ clarifications đã chốt trong spec)

- **#1 Actor scope**: Internal Participant có `meeting.note.create` được tạo `in_meeting`/`private`; **không** được tạo `host_note` (spec §2).
- **#2 Tag phân loại**: **Out of Scope** — không thêm `note_type` mới, không thêm cột `note_tag` ⇒ không đổi schema. AC-006 không trace.
- **#3 visibility allowlist**: `['private','participants','department','public_internal']` (FR-008).
- **#4 PATCH chỉnh sửa note**: auto-save là draft client-side; backend chỉ POST dứt điểm ⇒ **không** PATCH trong UC-102 (Out of Scope).
- **#5 content format**: plain text / Markdown an toàn, loại bỏ HTML nguy hiểm ⇒ sanitize tại service trước khi lưu (NFR-005).

---

## Risks (chi tiết tại plan.md §12)

1. Ngữ nghĩa lọc `department` / `public_internal` chưa được spec định nghĩa rõ → triển khai diễn giải tối thiểu, cô lập trong helper, xác nhận team.
2. Full-text tiếng Việt với config `simple` (unaccent là future enhancement, ngoài scope).
3. Thiếu dependency sanitize → ưu tiên util tự viết; dùng `sanitize-html` cần duyệt thêm.
4. Permission `meeting.note.*` chưa seed → cần migration seed mới.
5. GIN index build trên bảng có data → cân nhắc `CONCURRENTLY` nếu production (demo bỏ qua).
