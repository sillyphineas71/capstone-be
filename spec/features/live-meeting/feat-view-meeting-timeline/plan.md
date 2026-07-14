# Implementation Plan: Xem timeline cuộc họp (View meeting timeline)

> Feature ID: UC-99
> Module: live-meeting (In-Meeting Management)
> Created: 2026-07-13
> Status: Draft
> Spec nguồn: [spec.md](./spec.md) (đã duyệt, áp 7 quyết định chốt)

## 📝 CHANGELOG & REVISION HISTORY
| Ngày cập nhật | Tóm tắt thay đổi | Vị trí thay đổi |
| :--- | :--- | :--- |
| 2026-07-13 | Tạo mới plan.md cho UC-99 (endpoint timeline gộp 3 nguồn, READ-only, tái dùng visibility + relationship check). | Toàn bộ file |

---

## 0. Quyết định đã chốt (ràng buộc — không mở lại)

| # | Quyết định | Ảnh hưởng plan |
| :--- | :--- | :--- |
| 1 | Endpoint MỚI `GET /api/v1/meetings/:meetingId/timeline` (READ-only), response `{ success, message, data: TimelineItem[], meta{page,limit,total,totalPages} }` | Controller + DTO + service method mới |
| 2 | **Note-visibility BẮT BUỘC** đúng như endpoint notes (tái dùng logic, không chế lại lỏng hơn) | Tái dùng `buildVisibilityPredicate` |
| 3 | Gộp 3 nguồn: `meeting_events` (event_type ∈ [meeting_started, meeting_ended, warning_sent, extension_requested, extension_approved, extension_rejected]) + `attendance_events` (event_type ∈ [check_in, check_out]) + `meeting_notes` (theo visibility). Item: `{ time, category, type, actorUserId, actorName, detail, refId }` | Service gộp |
| 4 | Permission MỚI `meeting.timeline.read` gán **cùng role-set `meeting.note.read`** = `[INTERNAL_USER, MANAGER, BUSINESS_ADMIN, SYSTEM_ADMIN]`; seed KHÔNG execute | Seed file |
| 5 | Quyền theo QUAN HỆ: host (`meetings.host_id`) HOẶC participant (`meeting_participants.user_id`) → nếu không: 403 `NOT_A_MEETING_PARTICIPANT` (tái dùng `resolveMeetingRole`) | Service check |
| 6 | Sort `time` asc (default)/desc; phân trang page/limit (1/20, max 100), total+totalPages | DTO + service |
| 7 | KHÔNG mutation/migration/index (index `meeting_id,event_time` là đề xuất tương lai) | READ-only |

---

## 1. Feature Summary

Thêm **endpoint READ-only** `GET /api/v1/meetings/:meetingId/timeline` gộp sự kiện từ 3 bảng nguồn (`meeting_events`, `attendance_events`, `meeting_notes`) thành một danh sách `TimelineItem[]` sắp theo thời gian, phân trang. Quyền xem theo **quan hệ** (host/participant của chính cuộc họp) — tái dùng `resolveMeetingRole`. Note trong timeline **tôn trọng đúng note-visibility** — tái dùng `buildVisibilityPredicate`. Chỉ **thêm code mới**; không sửa endpoint/logic ghi sự kiện hiện có.

---

## 2. Technical Context (đã xác minh)

| Thành phần | Chi tiết | Nguồn |
| :--- | :--- | :--- |
| Kiểm quan hệ meeting | `private resolveMeetingRole(meeting, participant, currentUserId): { isHost, isCoHost, isParticipant }` | [live-meeting.service.ts:3190-3201](../../../../src/modules/live-meeting/services/live-meeting.service.ts#L3190) |
| Visibility predicate note | `private async buildVisibilityPredicate(qb, meetingId, currentUserId)` — author/public_internal/participants/department/private + `deletedAt IS NULL` | [live-meeting.service.ts:3032-3087](../../../../src/modules/live-meeting/services/live-meeting.service.ts#L3032) |
| Luồng list notes (mẫu mirror) | `listMeetingNotes` load meeting (404) → qb `mn` + visibility + filter + pagination | [live-meeting.service.ts:3092-3170](../../../../src/modules/live-meeting/services/live-meeting.service.ts#L3092) |
| `meeting_events` | `MeetingEventEntity` (`meetingId`, `eventType`, `eventTime`, `actorUserId`, `description`, `sourceType`, `metadataJson`) | [meeting-event.entity.ts](../../../../src/modules/meetings/entities/meeting-event.entity.ts) — **chưa có endpoint đọc** |
| `attendance_events` | (`meeting_id`, `user_id`, `event_type` ∈ check_in/check_out/face_detected, `event_time`) | ghi bởi [face-attendance.service.ts](../../../../src/modules/face-access/services/face-attendance.service.ts) |
| `meeting_notes` | `MeetingNoteEntity` (`authorId`, `noteType`, `visibilityLevel`, `content`, `createdAt`, `pinned`, `deletedAt`; relation `author`) | note enum: visibilityLevel ∈ {private, participants, public_internal, department}; noteType ∈ {in_meeting, private, host_note, system_note} |
| Role-set `meeting.note.read` | `[INTERNAL_USER, MANAGER, BUSINESS_ADMIN, SYSTEM_ADMIN]` | [SeedMeetingNotePermissions.ts:73-78](../../../../src/database/seeds/20260618000001-SeedMeetingNotePermissions.ts#L73) |

> **Then chốt (bảo vệ code người khác)**: `resolveMeetingRole` và `buildVisibilityPredicate` là **method private trong CHÍNH class `LiveMeetingService`**. ⇒ Đặt `getMeetingTimeline` **cùng class** thì gọi trực tiếp 2 private này — **KHÔNG cần trích helper, KHÔNG sửa method/caller cũ** (thỏa ràng buộc "ưu tiên không sửa method đang chạy").

### 2.1 Constitution / Rule gate
| Gate | Status | Ghi chú |
| :--- | :--- | :--- |
| SEC-02 (auth) | ✅ | Jwt + Permissions guard |
| SEC-03 (no raw SQL nối chuỗi) | ✅ | Query builder / parameter binding (tái dùng predicate hiện có) |
| ENG-03 (error format) | ✅ | inline `{success,message,error}` |
| DATA-01 | ✅ (N/A) | READ; `deletedAt IS NULL` |
| Scope Gate | ✅ | Chỉ UC-99; không mutation |

---

## 3. Kiến trúc & luồng

```
GET /api/v1/meetings/:meetingId/timeline?from&to&types&sort&page&limit
  │  JwtAuthGuard → 401 ; PermissionsGuard @RequirePermissions('meeting.timeline.read') → 403
  ▼
LiveMeetingController.getMeetingTimeline(meetingId, query, authUser)   [endpoint MỚI]
  │  ParseUUIDPipe(meetingId) · ValidationPipe(TimelineQueryDto)
  ▼
LiveMeetingService.getMeetingTimeline(meetingId, query, currentUserId)   [method MỚI cùng class]
  │  A. load meeting (404 MEETING_NOT_FOUND) + load participant record
  │  B. resolveMeetingRole → nếu !isHost && !isParticipant → 403 NOT_A_MEETING_PARTICIPANT
  │  C. Query 3 nguồn (áp from/to + types):
  │     - meeting_events: eventType IN [...]  (qb)
  │     - attendance_events: event_type IN [check_in, check_out]  (qb)
  │     - meeting_notes: qb 'mn' + buildVisibilityPredicate(qb, meetingId, currentUserId)  ◄── tái dùng
  │  D. Chuẩn hóa mỗi row → TimelineItem { time, category, type, actorUserId, detail, refId }
  │  E. Gộp (app-merge), sort theo time, total = tổng, slice trang; resolve actorName
  ▼
Controller: { success, message, data, meta{page,limit,total,totalPages} }
```

> Method mới trong `LiveMeetingService` — **không** sửa `listMeetingNotes`/method ghi event; chỉ **gọi** private helpers.

---

## 4. Cách gộp 3 nguồn (điểm kỹ thuật khó nhất — phân tích & quyết định)

### 4.1 Hai phương án
- **Phương án A — SQL `UNION ALL`**: 3 subquery chuẩn hóa (time/category/type/actor/detail/refId) → `ORDER BY time` + `LIMIT/OFFSET`; total qua `COUNT` của union. Pagination/perf tối ưu ở DB.
  - ❌ **Nhược chí mạng**: subquery note phải **nhúng lại** toàn bộ điều kiện visibility (author dept `EXISTS`, participant array…). `buildVisibilityPredicate` gắn với QueryBuilder `mn`, **không** dùng lại được trong raw UNION ⇒ **phải chép lại logic visibility** → vi phạm quyết định #2 (dễ drift/lỏng hơn). Rủi ro cao.
- **Phương án B — App-merge (KHUYẾN NGHỊ)**: query từng nguồn bằng QueryBuilder (note dùng **đúng** `buildVisibilityPredicate` tái dùng), rồi gộp + sort + slice ở tầng app.
  - ✅ Visibility **chính xác tuyệt đối** (tái dùng method canonical, không chép SQL).
  - ✅ `total` xác định = tổng số row hợp lệ của 3 nguồn (mỗi nguồn độc lập, không join → không nhân dòng).
  - ✅ Phạm vi **một cuộc họp** → số event bị chặn tự nhiên (vài chục–vài trăm), app-merge chấp nhận được.
  - ⚠️ Nhược: để trả đúng trang N của danh sách trộn-sắp-xếp, cần **lấy đủ rows đã lọc của 3 nguồn (trong `from/to`) rồi merge-sort-slice** — tải nhiều hơn so với LIMIT ở DB, nhưng bị chặn theo 1 meeting.

### 4.2 Quyết định
**Chọn Phương án B (app-merge)** vì: (1) **tái dùng đúng** visibility (quyết định #2 bắt buộc); (2) phạm vi 1 meeting nên bounded; (3) tránh chép SQL visibility phức tạp.
- **Total**: `total = events.length + attendance.length + notesVisible.length` (sau khi áp `from/to`+`types`+visibility). `totalPages = ceil(total/limit)`.
- **Slice**: merged sorted array → `slice((page-1)*limit, page*limit)`.
- *(Ghi chú tương lai, KHÔNG làm ở UC-99)*: nếu perf cần, tối ưu bằng UNION + view visibility — nhưng phải chuẩn hóa lại visibility thành SQL dùng chung trước, ngoài phạm vi.

---

## 5. DTO Plan

### 5.1 `TimelineQueryDto` (TẠO MỚI) — `src/modules/live-meeting/dto/timeline-query.dto.ts`
```
class TimelineQueryDto {
  @IsOptional() @IsISO8601() from?: string;
  @IsOptional() @IsISO8601() to?: string;
  @IsOptional() @IsString() types?: string;          // csv category/type (optional filter)
  @IsOptional() @IsIn(['asc','desc']) sort?: 'asc'|'desc' = 'asc';
  @IsOptional() @Type(()=>Number) @IsInt() @Min(1) page?: number = 1;
  @IsOptional() @Type(()=>Number) @IsInt() @Min(1) @Max(100) limit?: number = 20;
}
```
- `from ≤ to` validate ở service → `400 INVALID_DATE_RANGE` (mirror notes).
- `types`: chờ chốt cú pháp (csv category `meeting_event,attendance,note` hoặc theo `type`); mặc định không truyền → gồm tất cả (đúng tập §0#3).

### 5.2 `TimelineItemDto` (TẠO MỚI) — `src/modules/live-meeting/dto/timeline-item.dto.ts`
```
class TimelineItemDto {
  time: string;          // ISO
  category: 'meeting_event' | 'attendance' | 'note';
  type: string;          // meeting_started | check_in | note | warning_sent | ...
  actorUserId: string | null;
  actorName: string | null;
  detail: string | null;
  refId: string;         // id bản ghi nguồn
}
```

---

## 6. Service Design — `getMeetingTimeline` (method MỚI, cùng class)

```
async getMeetingTimeline(
  meetingId: string,
  query: TimelineQueryDto,
  currentUserId: string,
): Promise<{ data: TimelineItemDto[]; total: number; page: number; limit: number }>
```

- **A. Load meeting** (mirror listMeetingNotes): repo `MeetingEntity` findOne; nếu không có / `deletedAt` → `NotFoundException` `MEETING_NOT_FOUND`.
- **A2. Load participant record** của `currentUserId` trong meeting (repo `MeetingParticipantEntity`).
- **B. Quyền quan hệ**: `const role = this.resolveMeetingRole(meeting, participant, currentUserId)`; nếu `!role.isHost && !role.isParticipant` → `ForbiddenException` `NOT_A_MEETING_PARTICIPANT`.
- **C. Query 3 nguồn** (mỗi nguồn áp `from/to` theo cột thời gian tương ứng, và `types` nếu truyền):
  - `meeting_events`: qb `me` where `meeting_id=:id AND event_type IN (:...types3)` (#3a) `[from/to on event_time]`.
  - `attendance_events`: qb `ae` where `meeting_id=:id AND event_type IN ('check_in','check_out')` `[from/to on event_time]`.
  - `meeting_notes`: qb `mn` leftJoin author, where `mn.meetingId=:id`; **`await this.buildVisibilityPredicate(qb, meetingId, currentUserId)`** (#2) `[from/to on created_at]`.
- **D. Chuẩn hóa** từng row → `TimelineItem` (map time/category/type/actor/detail/refId). `detail` cho note = `content` (cân nhắc cắt độ dài); cho meeting_event = `description`; cho attendance = null/loại.
- **E. Merge + sort + paginate**: gộp 3 mảng → sort theo `time` (`asc`/`desc`) → `total=length` → slice trang. Resolve `actorName` bằng 1 batch query `users` theo tập `actorUserId` (tránh N+1) — hoặc leftJoin sẵn ở từng nguồn.

> **N+1 note**: resolve `actorName` gom 1 lần theo danh sách actorUserId của trang (giống UC-14), không query từng item.

---

## 7. Business rules & Error handling

| Rule / lỗi | HTTP | code |
| :--- | :--- | :--- |
| Note-visibility đúng (không lộ private/host_note người khác) | — | tái dùng `buildVisibilityPredicate` |
| Người gọi không host/participant | 403 | NOT_A_MEETING_PARTICIPANT |
| Thiếu permission gate | 403 | PERMISSION_DENIED |
| Thiếu/sai JWT | 401 | UNAUTHORIZED |
| `meetingId` sai UUID | 400 | VALIDATION_ERROR |
| `from > to` | 400 | INVALID_DATE_RANGE |
| Meeting không tồn tại/đã xóa | 404 | MEETING_NOT_FOUND |
| Không có sự kiện | 200 | data:[] |

---

## 8. RBAC & Seed

- Guard: `@UseGuards(JwtAuthGuard, PermissionsGuard)` + `@RequirePermissions('meeting.timeline.read')`.
- Seed (MÔ TẢ, KHÔNG chạy): `src/database/seeds/<ts>-SeedMeetingTimelinePermission.ts` — permission `meeting.timeline.read` (module_code như note seed, action_code `timeline.read`), gán role-set **y hệt `meeting.note.read`** = `['INTERNAL_USER','MANAGER','BUSINESS_ADMIN','SYSTEM_ADMIN']`, `ON CONFLICT DO NOTHING`. Mirror [SeedMeetingNotePermissions.ts](../../../../src/database/seeds/20260618000001-SeedMeetingNotePermissions.ts). Grep xác nhận code chưa tồn tại. KHÔNG runner/KHÔNG execute.

> Lưu ý 2 lớp quyền: permission gate (role toàn cục) + relationship check (host/participant của chính meeting). Đúng mô hình notes.

---

## 9. Controller (route)

- Thêm `@Get('meetings/:meetingId/timeline')` vào `LiveMeetingController` (cùng style `meetings/:meetingId/notes`).
- **Route collision — không có vấn đề**: `timeline` là leaf tĩnh riêng, khác `notes`/`attendance`; controller này **không** có `@Get('meetings/:meetingId')` trần để nuốt. (Vẫn kiểm nhanh khi implement.)
- Lấy `authUser`/`currentUserId` theo pattern controller hiện có (`req.user` / `@CurrentUser`).

---

## 10. Test Plan (liệt kê — không code)

Đặt ở `src/modules/live-meeting/tests/` (mirror test hiện có).

### 10.1 Service — `getMeetingTimeline`
| # | Test | Kỳ vọng |
| :--- | :--- | :--- |
| T1 | Gộp đủ 3 nguồn, sort theo time | items từ meeting_events + attendance + notes, đúng thứ tự thời gian |
| T2 | **Note-visibility (BẮT BUỘC)** — participant thường KHÔNG thấy `private`/`host_note` của người khác | note bị lọc đúng theo `buildVisibilityPredicate` |
| T3 | Host xem OK | không 403; thấy note theo visibility của host |
| T4 | Participant xem OK | không 403 |
| T5 | Người ngoài (không host/participant) | 403 NOT_A_MEETING_PARTICIPANT, không query timeline |
| T6 | Meeting không tồn tại | 404 MEETING_NOT_FOUND |
| T7 | filter `from/to` | chỉ item trong khoảng; `from>to` → 400 |
| T8 | filter `types` | chỉ category/type được chọn |
| T9 | sort asc/desc | đúng hướng |
| T10 | Phân trang + total đúng khi trộn nguồn | `total=events+attendance+notesVisible`, slice trang đúng |
| T11 | Rỗng | data:[], total:0 |
| T12 | actorName resolve (không N+1) | gom 1 batch theo actorUserId |

### 10.2 Controller
| # | Test | Kỳ vọng |
| :--- | :--- | :--- |
| C1 | Success | gọi `getMeetingTimeline`, trả `{success,message,data,meta}` |
| C2 | Guard metadata | `[JwtAuthGuard, PermissionsGuard]` |
| C3 | Permission metadata | `['meeting.timeline.read']` |
| C4 | meetingId sai UUID | 400 |

---

## 11. Rủi ro & điểm cần xác minh

| # | Rủi ro | Hành động |
| :--- | :--- | :--- |
| R1 | **Note-visibility** trộn sai (lộ note riêng tư) | BẮT BUỘC tái dùng `buildVisibilityPredicate` (không chép SQL); T2 verify |
| R2 | Merge + pagination + total sai khi trộn 3 nguồn | App-merge: total=length, slice; T10 verify |
| R3 | Sửa nhầm method đang chạy (`listMeetingNotes`/private helpers) | Chỉ **gọi** private từ method mới cùng class; KHÔNG sửa chúng |
| R4 | N+1 khi resolve actorName | batch 1 query theo actorUserId trang |
| R5 | Style service (dynamic `import()` entity + `dataSource.getRepository`) | Mirror pattern hiện có của `LiveMeetingService` để nhất quán |
| R6 | attendance_events tên cột/entity | Xác minh `AttendanceEventEntity` (event_type/event_time/user_id/meeting_id) khi code |

---

## 12. Tác động lên code người khác (bảo vệ)

- **CHỈ ĐỌC bảng**: `meeting_events`, `attendance_events`, `meeting_notes`, `meetings`, `meeting_participants`, `users`.
- **Tái dùng (gọi, KHÔNG sửa)**: `resolveMeetingRole` + `buildVisibilityPredicate` — là private trong **cùng class** `LiveMeetingService`, gọi trực tiếp từ method mới `getMeetingTimeline`. **KHÔNG** trích helper, **KHÔNG** sửa 2 method này hay `listMeetingNotes`.
- **KHÔNG** sửa endpoint notes/attendance/start/end hiện có; **KHÔNG** đụng logic ghi `meeting_events`/`attendance_events`/`meeting_notes`.
- **Chỉ THÊM (additive)**: `TimelineQueryDto` + `TimelineItemDto` + `getMeetingTimeline` + `@Get('meetings/:meetingId/timeline')` + seed + test.
- **Không mutation/migration/index**; không đụng UC khác (không làm lại notes UC-IMM-10).

---

## 13. Checklist file cần TẠO / SỬA

### 🆕 TẠO MỚI
- [ ] `src/modules/live-meeting/dto/timeline-query.dto.ts` — `TimelineQueryDto`
- [ ] `src/modules/live-meeting/dto/timeline-item.dto.ts` — `TimelineItemDto`
- [ ] `src/database/seeds/<timestamp>-SeedMeetingTimelinePermission.ts` — `meeting.timeline.read` → role-set y hệt `meeting.note.read` (**KHÔNG execute**)

### ✏️ SỬA (additive)
- [ ] `src/modules/live-meeting/controllers/live-meeting.controller.ts` — thêm `@Get('meetings/:meetingId/timeline')` + guard + `@RequirePermissions('meeting.timeline.read')`. KHÔNG đổi endpoint khác.
- [ ] `src/modules/live-meeting/services/live-meeting.service.ts` — thêm `getMeetingTimeline(...)` (gọi private `resolveMeetingRole`/`buildVisibilityPredicate`). **KHÔNG** sửa method khác.
- [ ] `src/modules/live-meeting/tests/*` — test T1–T12 + C1–C4 (thêm file/khối, không phá test cũ).

### ⛔ KHÔNG đổi
- `listMeetingNotes`, `resolveMeetingRole`, `buildVisibilityPredicate` (chỉ gọi), endpoint notes/attendance/start/end, logic ghi event; không migration/index/seed-execute.

---

> Kết thúc plan. Bước tiếp theo (khi duyệt): tách `tasks.md` theo checklist §13. Chưa code, chưa chạy seed/migration.
