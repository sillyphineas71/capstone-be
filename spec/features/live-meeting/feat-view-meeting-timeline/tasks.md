# Tasks: Xem timeline cuộc họp (View meeting timeline)

**Feature**: UC-99
**Module**: live-meeting (In-Meeting Management)
**Priority**: P2
**Input**: [spec.md](./spec.md), [plan.md](./plan.md)

## 📝 CHANGELOG & REVISION HISTORY
| Ngày cập nhật | Tóm tắt thay đổi | Vị trí thay đổi |
| :--- | :--- | :--- |
| 2026-07-13 | Tạo mới tasks.md cho UC-99 (endpoint timeline gộp 3 nguồn, app-merge, tái dùng visibility + relationship check). | Toàn bộ file |

---

## 0. Ràng buộc chốt (áp cho mọi task — không mở lại)

1. Endpoint **MỚI** `GET /api/v1/meetings/:meetingId/timeline` (READ-only), response `{ success, message, data: TimelineItem[], meta{page,limit,total,totalPages} }`.
2. **Note-visibility BẮT BUỘC**: trộn `meeting_notes` qua `buildVisibilityPredicate` (tái dùng, **KHÔNG chép SQL**, **KHÔNG lỏng hơn**).
3. Gộp 3 nguồn: `meeting_events` eventType ∈ [`meeting_started`,`meeting_ended`,`warning_sent`,`extension_requested`,`extension_approved`,`extension_rejected`]; `attendance_events` event_type ∈ [`check_in`,`check_out`]; `meeting_notes` theo visibility. Item `{ time, category, type, actorUserId, actorName, detail, refId }`.
4. Permission **MỚI** `meeting.timeline.read` gán role-set **y hệt `meeting.note.read`** = `[INTERNAL_USER, MANAGER, BUSINESS_ADMIN, SYSTEM_ADMIN]`; seed **KHÔNG execute / KHÔNG runner**.
5. Quyền quan hệ: host (`meetings.hostId`) HOẶC participant → nếu không → **403 NOT_A_MEETING_PARTICIPANT** (dùng `resolveMeetingRole`). Load meeting **404** TRƯỚC.
6. Sort `time` asc (default)/desc; phân trang page/limit (1/20, max 100), total+totalPages. **App-merge** (query 3 nguồn → gộp → sort → slice); `total = tổng row hợp lệ 3 nguồn`.
7. `actorName` resolve **BATCH 1 query** theo actorUserId (**KHÔNG N+1**). KHÔNG mutation/migration/index.

### ⛔ KHÔNG được làm (áp toàn feature)
- KHÔNG execute seed, KHÔNG chạy migration/index, KHÔNG commit.
- KHÔNG sửa `resolveMeetingRole` (dòng 3190), `buildVisibilityPredicate` (dòng 3032), `listMeetingNotes` — chỉ **GỌI**.
- KHÔNG trích helper từ 2 private đó (tránh làm hỏng caller cũ). Đặt `getMeetingTimeline` **cùng class** `LiveMeetingService` để gọi trực tiếp.
- KHÔNG sửa endpoint notes/attendance/start/end; KHÔNG đụng logic **ghi** `meeting_events`/`attendance_events`/`meeting_notes`.
- Chỉ THÊM (additive): 2 DTO + `getMeetingTimeline` + 1 endpoint + seed + test.

### Format
- `[Txxx]` Task ID tuần tự · `[CREATE]`/`[MODIFY]` + đường dẫn · **DoD** = definition of done.

---

## Phase 1 — DTO

| Dependency | Task |
|---|---|
| — | T001, T002 |

- [ ] **T001** `[CREATE]` `src/modules/live-meeting/dto/timeline-query.dto.ts` — `TimelineQueryDto`.
  - Fields: `from?` `@IsOptional() @IsISO8601()`; `to?` `@IsOptional() @IsISO8601()`; `types?` `@IsOptional() @IsString()`; `sort?` `@IsOptional() @IsIn(['asc','desc'])` (default `'asc'`); `page?` `@IsOptional() @Type(()=>Number) @IsInt() @Min(1)` (default 1); `limit?` `@IsOptional() @Type(()=>Number) @IsInt() @Min(1) @Max(100)` (default 20).
  - `from ≤ to` validate ở **service** (không ở DTO) → 400 INVALID_DATE_RANGE.
  - **DoD**: file compile; validator đúng; không field thừa.

- [ ] **T002** `[CREATE]` `src/modules/live-meeting/dto/timeline-item.dto.ts` — `TimelineItemDto`.
  - Fields: `time: string`, `category: 'meeting_event'|'attendance'|'note'`, `type: string`, `actorUserId: string|null`, `actorName: string|null`, `detail: string|null`, `refId: string` (+ `@ApiProperty`).
  - **DoD**: file compile; đúng 7 field.

---

## Phase 2 — Service `getMeetingTimeline` (cùng class LiveMeetingService)

> Thêm method vào `LiveMeetingService`. **GỌI** private `resolveMeetingRole` + `buildVisibilityPredicate` (không sửa). Mirror style hiện có (dynamic `import()` entity + `this.dataSource.getRepository`). KHÔNG sửa method khác.

| Dependency | Task |
|---|---|
| T001, T002 → | T003 |
| T003 → | T004 |
| T004 → | T005 |

- [ ] **T003** `[MODIFY]` `src/modules/live-meeting/services/live-meeting.service.ts` — khung method + **load meeting (404) + quyền quan hệ (403)**.
  - Chữ ký: `async getMeetingTimeline(meetingId: string, query: TimelineQueryDto, currentUserId: string): Promise<{ data: TimelineItemDto[]; total: number; page: number; limit: number }>`.
  - A. Load `MeetingEntity` (findOne); nếu không có / `deletedAt` → `NotFoundException` **MEETING_NOT_FOUND** (mirror `listMeetingNotes`).
  - A2. Load participant record của `currentUserId` (`MeetingParticipantEntity`).
  - B. **`const role = this.resolveMeetingRole(meeting, participant, currentUserId)`** (GỌI, không sửa); nếu `!role.isHost && !role.isParticipant` → `ForbiddenException` **NOT_A_MEETING_PARTICIPANT**.
  - C. Validate `from ≤ to` (nếu cả hai) → `BadRequestException` **INVALID_DATE_RANGE**.
  - **DoD**: method tồn tại, tsc pass; 404 khi meeting không có; 403 khi không host/participant; 400 khi from>to; chưa query timeline.

- [ ] **T004** `[MODIFY]` `src/modules/live-meeting/services/live-meeting.service.ts` — **query 3 nguồn + normalize** (#2/#3).
  - `meeting_events` (qb `me`): `meeting_id=:meetingId AND event_type IN (:...MEETING_EVENT_TYPES)` với `MEETING_EVENT_TYPES=[meeting_started,meeting_ended,warning_sent,extension_requested,extension_approved,extension_rejected]`; áp `from/to` trên `event_time`.
  - `attendance_events` (qb `ae`): `meeting_id=:meetingId AND event_type IN ('check_in','check_out')`; áp `from/to` trên `event_time`.
  - `meeting_notes` (qb `mn`, leftJoin author): `mn.meetingId=:meetingId` → **`await this.buildVisibilityPredicate(qb, meetingId, currentUserId)`** (GỌI — #2, không chép SQL); áp `from/to` trên `created_at`.
  - Nếu `query.types` truyền → lọc theo category/type tương ứng (bỏ nguồn không thuộc types).
  - Normalize mỗi row → `TimelineItem`: `time`(event_time/created_at ISO), `category`('meeting_event'|'attendance'|'note'), `type`(eventType/event_type/'note'), `actorUserId`(actor_user_id/user_id/authorId), `detail`(description | null | content — cân nhắc cắt độ dài), `refId`(id row nguồn). `actorName` để trống ở bước này (T005 batch).
  - **DoD**: 3 nguồn query đúng filter (event types cố định, note qua buildVisibilityPredicate); normalize đúng shape; tsc pass.

- [ ] **T005** `[MODIFY]` `src/modules/live-meeting/services/live-meeting.service.ts` — **merge/sort/slice + batch actorName** (#6/#7).
  - Gộp 3 mảng → sort theo `time` (`asc`/`desc` theo `query.sort`, default asc).
  - `total = events.length + attendance.length + notesVisible.length`. `page/limit` từ query (default 1/20). Slice `((page-1)*limit, page*limit)`.
  - **Batch actorName (#7)**: gom tập `actorUserId` (khác null) của **trang** → **1 query** `users` (`id IN (:...ids)`) → `Map<id, fullName>` → gán `actorName`. Trang không có actorId → bỏ query.
  - Return `{ data, total, page, limit }`.
  - **DoD**: merge/sort đúng; total=tổng 3 nguồn; slice đúng trang; actorName resolve **1 batch** (không N+1); tsc pass.

---

## Phase 3 — Controller

| Dependency | Task |
|---|---|
| T005 → | T006 |

- [ ] **T006** `[MODIFY]` `src/modules/live-meeting/controllers/live-meeting.controller.ts` — thêm `@Get('meetings/:meetingId/timeline')`.
  - Decorators: `@Get('meetings/:meetingId/timeline')`, `@HttpCode(HttpStatus.OK)`, `@UseGuards(JwtAuthGuard, PermissionsGuard)`, `@RequirePermissions('meeting.timeline.read')`, `@ApiBearerAuth()`, Swagger (`@ApiOperation`/`@ApiParam`/`@ApiQuery`/`@ApiResponse`).
  - Param `meetingId` `ParseUUIDPipe`. `@Query() query: TimelineQueryDto`. Lấy `currentUserId` từ `authUser` theo pattern controller hiện có.
  - Gọi `const { data, total, page, limit } = await this.liveMeetingService.getMeetingTimeline(meetingId, query, currentUserId)`.
  - Trả `{ success: true, message: 'Lay timeline cuoc hop thanh cong', data, meta: { page, limit, total, totalPages: Math.ceil(total/limit) } }`.
  - Route: `timeline` là leaf tĩnh — xác minh không collision với `notes`/`attendance`; controller không có `@Get('meetings/:meetingId')` trần.
  - **DoD**: endpoint mount `GET /api/v1/meetings/:meetingId/timeline`; guards + permission đúng; KHÔNG đổi endpoint khác; tsc pass.

---

## Phase 4 — Seed permission (TẠO FILE, KHÔNG CHẠY)

| Dependency | Task |
|---|---|
| — (song song được) | T007 |

- [ ] **T007** `[CREATE]` `src/database/seeds/<timestamp>-SeedMeetingTimelinePermission.ts` — permission `meeting.timeline.read`.
  - Mirror [SeedMeetingNotePermissions.ts](../../../../src/database/seeds/20260618000001-SeedMeetingNotePermissions.ts): INSERT permission `permission_code='meeting.timeline.read'`, `module_code` (như note seed), `action_code='timeline.read'`, `is_active=true`, `ON CONFLICT DO NOTHING RETURNING id`.
  - Gán role-set **y hệt `meeting.note.read`** = `['INTERNAL_USER','MANAGER','BUSINESS_ADMIN','SYSTEM_ADMIN']` → INSERT `role_permissions ... ON CONFLICT DO NOTHING`.
  - Idempotent. Grep xác nhận code chưa tồn tại.
  - ⚠️ KHÔNG thêm runner; KHÔNG execute.
  - **DoD**: file tồn tại, tsc pass; role-set đúng 4 role; không lệnh chạy seed nào thực thi.

---

## Phase 5 — Unit test Service (T1–T12)

| Dependency | Task |
|---|---|
| T005 → | T008 |

- [ ] **T008** `[MODIFY]/[CREATE]` `src/modules/live-meeting/tests/` — suite `getMeetingTimeline` phủ T1–T12 (plan §10.1). Mock repository/query builder + `dataSource`; **KHÔNG** mock/stub `resolveMeetingRole`/`buildVisibilityPredicate` bằng cách sửa chúng (giữ nguyên; test qua dữ liệu mock).
  - T1 Gộp đủ 3 nguồn, sort theo time → items từ meeting_events + attendance + notes đúng thứ tự.
  - **T2 Note-visibility (BẮT BUỘC)** — participant thường KHÔNG thấy `private`/`host_note` của người khác → note bị lọc đúng theo `buildVisibilityPredicate`.
  - T3 Host xem OK (không 403).
  - T4 Participant xem OK (không 403).
  - T5 Người ngoài (không host/participant) → **403 NOT_A_MEETING_PARTICIPANT**, không query timeline.
  - T6 Meeting không tồn tại → **404 MEETING_NOT_FOUND**.
  - T7 filter `from/to` → chỉ item trong khoảng; `from>to` → 400 INVALID_DATE_RANGE.
  - T8 filter `types` → chỉ category/type được chọn.
  - T9 sort asc/desc → đúng hướng.
  - T10 Phân trang + total đúng khi trộn nguồn → `total=events+attendance+notesVisible`, slice trang đúng.
  - T11 Rỗng → data:[], total:0.
  - T12 actorName resolve **1 batch** theo actorUserId (không N+1).
  - **DoD**: T1–T12 pass; đặc biệt T2 (visibility) + T5 (403) + T10 (total trộn) + T12 (batch); không phá test cũ của live-meeting.

---

## Phase 6 — Controller test (C1–C4)

| Dependency | Task |
|---|---|
| T006 → | T009 |

- [ ] **T009** `[MODIFY]/[CREATE]` `src/modules/live-meeting/tests/` — test controller `getMeetingTimeline` phủ C1–C4 (plan §10.2). Mock `LiveMeetingService.getMeetingTimeline`; đọc metadata guard/permission.
  - C1 Success: gọi service đúng, trả `{ success, message, data, meta{page,limit,total,totalPages} }`.
  - C2 Guard metadata = `[JwtAuthGuard, PermissionsGuard]`.
  - C3 Permission metadata = `['meeting.timeline.read']`.
  - C4 `meetingId` sai UUID → 400.
  - **DoD**: 4 test pass; permission đúng; không phá test hiện có.

---

## Phase 7 — Cổng chất lượng

| Dependency | Task |
|---|---|
| T001–T009 → | T010 |

- [ ] **T010** Chạy cổng chất lượng trên file đã đụng (KHÔNG commit).
  1. **tsc**: `npx tsc --noEmit`. Kỳ vọng: 0 lỗi **mới** ở file production (2 DTO / service / controller / seed).
  2. **eslint** file đã tạo/sửa (chạy `--fix` cho prettier): `timeline-query.dto.ts`, `timeline-item.dto.ts`, `live-meeting.service.ts`, `live-meeting.controller.ts`, seed, test file(s).
  3. **jest**: `npx jest src/modules/live-meeting src/modules/auth/guards`.
  4. **Baseline vs mới**: nếu nghi lỗi có sẵn → `git stash` chạy lại lấy baseline, `git stash pop`; chỉ xử lý lỗi **mới** do UC-99. Ghi rõ lỗi baseline vs mới kèm bằng chứng `git stash`.
  - **DoD**: production files **tsc & eslint sạch** (hoặc chỉ lỗi trùng pattern seed/mock baseline đã chứng minh); jest phạm vi trên **pass** (gồm test live-meeting cũ — không hồi quy `listMeetingNotes` v.v.); lỗi còn lại chứng minh baseline; **KHÔNG commit**, **KHÔNG chạy seed/migration**.

---

## Bảng truy vết Task ↔ file ↔ ràng buộc

| Task | Loại | File | Ràng buộc/DoD chính |
|---|---|---|---|
| T001 | CREATE | `dto/timeline-query.dto.ts` | #1/#6 query + sort + pagination |
| T002 | CREATE | `dto/timeline-item.dto.ts` | #3 item 7 field |
| T003 | MODIFY | `services/live-meeting.service.ts` | #5 load meeting 404 + resolveMeetingRole 403 + from>to 400 |
| T004 | MODIFY | `services/live-meeting.service.ts` | #2/#3 query 3 nguồn (note qua buildVisibilityPredicate) + normalize |
| T005 | MODIFY | `services/live-meeting.service.ts` | #6 merge/sort/slice total=length; #7 batch actorName |
| T006 | MODIFY | `controllers/live-meeting.controller.ts` | #1 endpoint; #4 permission; route leaf không collision |
| T007 | CREATE | `database/seeds/<ts>-SeedMeetingTimelinePermission.ts` | #4 role-set y hệt note.read, KHÔNG execute |
| T008 | MODIFY | `live-meeting/tests/*` | T1–T12 |
| T009 | MODIFY | `live-meeting/tests/*` | C1–C4 |
| T010 | — | (các file trên) | tsc + eslint + jest, baseline vs mới |

---

> **Chưa code ở bước này** — tasks.md chờ duyệt trước khi implement. Thực thi tuần tự T001 → T010, tuân thủ "⛔ KHÔNG được làm" (đặc biệt: chỉ GỌI `resolveMeetingRole`/`buildVisibilityPredicate` — không sửa; note qua `buildVisibilityPredicate`; app-merge total=length; batch actorName; không đụng endpoint/logic ghi event).
