# Task List: Manual Minutes Parallel to AI

## 📝 CHANGELOG & REVISION HISTORY
| Ngày cập nhật | Tóm tắt thay đổi | Các dòng thay đổi |
| :--- | :--- | :--- |
| 2026-08-19 | Khởi tạo tasks cho feat-manual-minutes-parallel-to-ai (MKM-MANUAL-01) | Toàn bộ file |

## Checklist
- [ ] T001 [US1] Migration thêm cột `source` + partial unique index → `src/database/migrations/`
- [ ] T002 [US1] Cập nhật `MeetingMinutesEntity` → `src/modules/minutes/entities/meeting-minutes.entity.ts`
- [ ] T003 [US1] Sửa `createDraft` (lock + filter theo source + insert `source='manual'`) → `src/modules/minutes/services/minutes.service.ts`
- [ ] T004 [US1] Sửa dedup check khi enqueue AI job (filter theo `source='ai'`) → `src/modules/minutes/services/minutes-ai-draft.service.ts`
- [ ] T005 [US1] Sửa `persistDraft` (filter + điều kiện overwrite theo `source`) → `src/modules/minutes/processors/minutes-ai-draft.processor.ts`
- [ ] T006 [US2] Helper `resolveOfficialMinutes(meetingId)` → `src/modules/minutes/services/minutes.service.ts`
- [ ] T007 [US2] Endpoint `GET /meeting-minutes/compare` + response DTO → `src/modules/minutes/controllers/minutes-list.controller.ts`, `src/modules/minutes/dto/`
- [ ] T008 [US2] Audit chỗ gọi minutes theo meetingId cũ + cập nhật renderer export dùng `resolveOfficialMinutes` → `src/modules/minutes/renderers/meeting-minutes-{docx,pdf}-renderer.ts`
- [ ] T009 [US1] Unit test `minutes.service.spec.ts` (mở rộng)
- [ ] T010 [US1] Unit test `minutes-ai-draft.service.spec.ts` (mở rộng)
- [ ] T011 [US1] Unit test `minutes-ai-draft.processor.spec.ts` (mở rộng)
- [ ] T012 [US2] Unit test endpoint compare (controller + service)
- [ ] T013 Lint/build/test toàn repo

## Phase 1: Schema

### Task T001 [US1] — Migration thêm cột `source` + partial unique index
**File**: `src/database/migrations/20260819000001-AddSourceColumnToMeetingMinutes.ts`
**Action**:
```ts
// up():
// 1. ALTER TABLE meeting_minutes ADD COLUMN source varchar(10) NULL;
// 2. UPDATE meeting_minutes SET source = CASE WHEN ai_summary_json IS NULL THEN 'manual' ELSE 'ai' END;
// 3. ALTER TABLE meeting_minutes ALTER COLUMN source SET NOT NULL;
// 4. CREATE UNIQUE INDEX ux_meeting_minutes_meeting_source_active
//      ON meeting_minutes (meeting_id, source) WHERE deleted_at IS NULL;
// down(): DROP INDEX ux_meeting_minutes_meeting_source_active; ALTER TABLE meeting_minutes DROP COLUMN source;
```
Bắt buộc đặt trong `src/database/migrations/`, KHÔNG phải `seeds/` ([[project_capstone_be_seeds_folder_no_runner]]).
**Outcome**: Cột `source` tồn tại, backfill đúng dữ liệu cũ, ràng buộc unique thực thi ở DB.
**Verification**: Chạy `migration:run` trên DB dev, kiểm tra `SELECT source, count(*) FROM meeting_minutes GROUP BY source` khớp số dòng có/không có `ai_summary_json`; thử insert trùng `(meeting_id, source)` khi `deleted_at IS NULL` → phải bị DB từ chối (unique violation).

### Task T002 [US1] — Cập nhật `MeetingMinutesEntity`
**File**: `src/modules/minutes/entities/meeting-minutes.entity.ts`
**Action**: Thêm enum `MeetingMinutesSource { AI = 'ai', MANUAL = 'manual' }` cạnh `MeetingMinutesStatus` hiện có; thêm field:
```ts
@Column({ type: 'varchar', length: 10 })
source: MeetingMinutesSource;
```
**Outcome**: Entity khớp schema sau T001.
**Verification**: Compile OK, `npm run build` pass.

## Phase 2: Sửa 3 call site chống trùng

### Task T003 [US1] — Sửa `createDraft`
**File**: `src/modules/minutes/services/minutes.service.ts` (~dòng 190-231)
**Action**:
1. Thêm bước lock: `manager.getRepository(MeetingEntity).createQueryBuilder('meeting').setLock('pessimistic_write').where('meeting.id = :meetingId', { meetingId }).getOne()` thay cho `findOne` thường ở bước lấy `meeting` (đối xứng với `minutes-ai-draft.processor.ts:224-229`).
2. Đổi query chống trùng (dòng ~216-220) từ `{ meetingId, deletedAt: IsNull() }` sang `{ meetingId, source: MeetingMinutesSource.MANUAL, deletedAt: IsNull() }`.
3. Đổi message lỗi 409 thành nêu rõ "đã có bản thủ công", thêm `source: 'manual'` vào `details`.
4. Thêm `source: MeetingMinutesSource.MANUAL` vào payload insert `meeting_minutes` (dòng ~238+).
5. Bổ sung `source: 'manual'` vào `metadataJson` của audit log.
**Outcome**: Tạo bản thủ công không còn bị chặn bởi bản `source='ai'` đã tồn tại (AC-002); vẫn chặn đúng khi đã có bản `manual` khác (AC-005); race condition được khóa bằng lock (AC-013).
**Verification**: Test T009 pass.

### Task T004 [US1] — Sửa dedup check khi enqueue AI job
**File**: `src/modules/minutes/services/minutes-ai-draft.service.ts` (~dòng 222-238)
**Action**: Đổi `existingMinutes` query từ `{ meetingId, deletedAt: IsNull() }` sang `{ meetingId, source: MeetingMinutesSource.AI, deletedAt: IsNull() }`. Giữ nguyên hành vi `forceRerun` (chỉ áp dụng khi đã có bản `source='ai'` khác, không còn xét bản `manual`).
**Outcome**: Enqueue AI job không còn bị chặn bởi bản thủ công đã có (AC-003); vẫn giữ đúng behavior cũ cho trường hợp đã có bản AI khác.
**Verification**: Test T010 pass.

### Task T005 [US1] — Sửa `persistDraft`
**File**: `src/modules/minutes/processors/minutes-ai-draft.processor.ts` (~dòng 213-310)
**Action**:
1. Đổi query `existing` (dòng ~238-240) từ `{ meetingId, deletedAt: IsNull() }` sang `{ meetingId, source: MeetingMinutesSource.AI, deletedAt: IsNull() }`.
2. Đổi điều kiện `overwritable` (dòng ~260-263) từ `existing.aiSummaryJson !== null` sang `existing.source === MeetingMinutesSource.AI` — rõ ràng hơn, không còn suy luận ngầm qua null-check (FR-017).
3. Thêm `source: MeetingMinutesSource.AI` vào payload `minutesRepo.create(...)` ở nhánh insert mới (dòng ~286+).
**Outcome**: Job AI chỉ bao giờ đọc/ghi đúng bản `source='ai'`, không bao giờ chạm vào bản `manual` của cùng meeting (FR-006).
**Verification**: Test T011 pass.

## Phase 3: Helper + endpoint mới

### Task T006 [US2] — Helper `resolveOfficialMinutes(meetingId)`
**File**: `src/modules/minutes/services/minutes.service.ts`
**Action**: Thêm method public:
```ts
async resolveOfficialMinutes(meetingId: string): Promise<MeetingMinutesEntity | null> {
  const manual = await this.minutesRepo.findOne({
    where: { meetingId, source: MeetingMinutesSource.MANUAL, deletedAt: IsNull() },
  });
  if (manual) return manual;
  return this.minutesRepo.findOne({
    where: { meetingId, source: MeetingMinutesSource.AI, deletedAt: IsNull() },
  });
}
```
**Outcome**: 1 điểm truy cập duy nhất cho "biên bản chính thức" của meeting, dùng ở T008.
**Verification**: Unit test riêng: có cả 2 bản → trả `manual`; chỉ có `ai` → trả `ai`; không có bản nào → trả `null` (AC-009/AC-010).

### Task T007 [US2] — Endpoint `GET /meeting-minutes/compare`
**File**: `src/modules/minutes/controllers/minutes-list.controller.ts`, DTO mới `src/modules/minutes/dto/compare-minutes-response.dto.ts`
**Action**: Thêm route:
```ts
@Get('compare')
@UseGuards(JwtAuthGuard, PermissionsGuard)
@RequirePermissions('meeting.minutes.read')
async compare(
  @Query('meetingId', ParseUUIDPipe) meetingId: string,
  @CurrentUser() user: { userId: string },
) {
  const result = await this.minutesService.compareMinutes(meetingId, { userId: user.userId });
  return { success: true, message: 'So sanh bien ban thu cong va AI', data: result };
}
```
Đặt route `compare` **trước** `@Get(':id')` trong file (Nest match theo thứ tự khai báo — route tĩnh phải đứng trước route có param để tránh `compare` bị nuốt bởi `:id`). Service method `compareMinutes` implement theo pseudo-code plan.md mục 7.5, tái dùng đúng logic lọc hiển thị hiện có của `findOne`/`findMinutesList` (không viết rule hiển thị mới).
**Outcome**: Endpoint hoạt động end-to-end, đúng response shape spec.md mục 5.3.
**Verification**: Test T012 pass.

## Phase 4: Renderer + Tests

### Task T008 [US2] — Audit call site cũ + cập nhật renderer export
**File**: `src/modules/minutes/renderers/meeting-minutes-docx-renderer.ts`, `meeting-minutes-pdf-renderer.ts`, và mọi nơi khác trong `src/modules/minutes/` đang query `MeetingMinutesEntity` theo `meetingId` mà giả định 1 dòng duy nhất (grep `meetingId` trong toàn bộ `src/modules/minutes/services/`, `controllers/` trước khi sửa)
**Action**: Đổi mọi chỗ đang lấy "biên bản của meeting X" theo kiểu query trực tiếp cũ sang gọi `minutesService.resolveOfficialMinutes(meetingId)` (T006). Ghi rõ trong PR description danh sách file đã audit + file nào KHÔNG cần đổi (vd: các API thao tác theo `minutesId` cụ thể như update/issue/delete/share/attachment — không liên quan, vì chúng nhận thẳng `id` của 1 bản ghi, không suy luận theo `meetingId`).
**Outcome**: Export/notification/trang chi tiết meeting luôn lấy đúng bản chính thức theo đúng rule ưu tiên (FR-008/FR-009), không còn nơi nào lấy nhầm bản `ai` khi đã có bản `manual`.
**Verification**: Test thủ công export 1 meeting có cả 2 bản → file xuất ra đúng nội dung bản `manual`.

### Task T009 [US1] — Unit test `minutes.service.spec.ts` (mở rộng)
**File**: `src/modules/minutes/services/minutes.service.spec.ts`
**Action**: Thêm case: tạo `manual` thành công khi đã có `ai` active (AC-002); tạo `manual` bị chặn 409 khi đã có `manual` active (AC-005); `resolveOfficialMinutes` 3 nhánh (có cả 2/chỉ ai/không có gì, AC-009/AC-010); `compareMinutes` 3 nhánh (đủ 2 bản/thiếu 1 bản/404, AC-006/007/008); race condition 2 request tạo `manual` đồng thời chỉ 1 thành công (AC-013, mock lock hoặc mock unique violation).
**Outcome**: Coverage đầy đủ nhánh mới/sửa.
**Verification**: `npm run test` pass.

### Task T010 [US1] — Unit test `minutes-ai-draft.service.spec.ts` (mở rộng)
**File**: `src/modules/minutes/services/minutes-ai-draft.service.spec.ts`
**Action**: Thêm case: enqueue AI job thành công dù đã có bản `manual` active (AC-003, KHÔNG cần `forceRerun`); vẫn chặn đúng khi đã có bản `ai` khác và `!forceRerun` (giữ hành vi cũ, chỉ đổi phạm vi query).
**Outcome**: Xác nhận FR-004 không bị vi phạm ở tầng enqueue.
**Verification**: `npm run test` pass.

### Task T011 [US1] — Unit test `minutes-ai-draft.processor.spec.ts` (mở rộng)
**File**: `src/modules/minutes/processors/minutes-ai-draft.processor.spec.ts`
**Action**: Thêm case: `persistDraft` chạy khi đã có bản `manual` active cho cùng meeting → tạo bản `source='ai'` MỚI, KHÔNG đụng vào bản `manual` (đọc lại DB sau khi chạy, assert bản `manual` không đổi) — AC-014; điều kiện overwrite dùng đúng `source==='ai'` thay vì `aiSummaryJson!==null` (test 1 bản AI có `aiSummaryJson` bị null do lỗi dữ liệu cũ vẫn overwrite đúng miễn `source==='ai'`, chứng minh logic mới bền hơn logic cũ).
**Outcome**: Xác nhận FR-006 (ranh giới cứng giữa 2 nguồn) và FR-017 (thay suy luận ngầm bằng cột tường minh).
**Verification**: `npm run test` pass.

### Task T012 [US2] — Unit test endpoint compare
**File**: `src/modules/minutes/controllers/minutes-list.controller.spec.ts`
**Action**: Test controller gọi đúng `minutesService.compareMinutes` với đúng tham số, trả đúng response shape, route `compare` không bị `:id` nuốt mất (test riêng `GET /meeting-minutes/compare?meetingId=...` phải vào đúng handler `compare`, không rơi vào handler `findOne(':id')`).
**Outcome**: Test pass, xác nhận thứ tự route đúng (rủi ro nêu ở T007).
**Verification**: `npm run test` pass.

### Task T013 — Lint/build/test toàn repo
**Action**: Chạy `npm run lint`, `npm run build`, `npm run test` cho toàn repo.
**Outcome**: Build pass. `npx jest src/modules/minutes` pass toàn bộ (số lượng test tăng so với baseline trước feature). Đối chiếu với baseline test đã biết của repo ([[project_capstone_be_dev_test_baseline]] — ~96 test fail pre-existing không liên quan) để xác nhận không có regression MỚI ngoài phạm vi `modules/minutes`.
**Verification**: Ghi lại số liệu pass/fail cụ thể vào CHANGELOG của file này sau khi chạy thật.

## Requirements Coverage

### FR Coverage
| FR ID | Task(s) |
| :--- | :--- |
| FR-001, FR-011, FR-016 | T001, T003, T009 |
| FR-002, FR-017 | T002, T003, T005 |
| FR-003, FR-010 | T003 (kế thừa hành vi status/visibility hiện có, không code mới) |
| FR-004, FR-020 | T003, T004, T005, T009, T010, T011 |
| FR-005 | T003, T009 |
| FR-006 | T005, T011 |
| FR-007, FR-013 | T007, T012 |
| FR-008, FR-009 | T006, T008, T009 |
| FR-012 | T003 (không đổi, kế thừa UC-MKM-01) |
| FR-014 | T003 |
| FR-015, FR-016 | T001 |
| FR-018, FR-019 | T003 (không đổi, kế thừa UC-MKM-01) |

### AC Coverage
| AC ID | Task(s) |
| :--- | :--- |
| AC-001 | T003, T009 |
| AC-002, AC-003 | T003, T004, T009, T010 |
| AC-004 | T003 (không đổi) |
| AC-005 | T003, T009 |
| AC-006, AC-007, AC-008 | T007, T012 |
| AC-009, AC-010 | T006, T009 |
| AC-011, AC-012 | T003 (không đổi) |
| AC-013 | T001, T003, T009 |
| AC-014 | T005, T011 |

### Error Code Coverage
| Error Code | HTTP Status | Task(s) |
| :--- | :--- | :--- |
| VALIDATION_ERROR | 400 | T007 (ParseUUIDPipe cho meetingId) |
| FORBIDDEN | 403 | T003, T007 (guard, không đổi) |
| NOT_MEETING_HOST | 403 | T003 (không đổi) |
| MEETING_NOT_FOUND | 404 | T007, T012 |
| MEETING_HOST_NOT_ASSIGNED / MEETING_NOT_STARTED / MEETING_CANCELLED | 409 | T003 (không đổi) |
| MINUTES_ALREADY_EXISTS | 409 | T001, T003, T004, T005, T009, T010, T011 |

## Dependencies Graph
```text
T001 ──> T002 ──┬──> T003 ──┐
                 ├──> T004 ──┼──> T006 ──> T007 ──> T008
                 └──> T005 ──┘
                                              │
T003,T004,T005 ──> T009,T010,T011 ────────────┤
T007 ──> T012 ─────────────────────────────────┴──> T013
```

## Implementation Order
| Step | Task(s) | Phase | Description |
| :--- | :--- | :--- | :--- |
| 1 | T001, T002 | 1 | Schema (migration + entity) |
| 2 | T003, T004, T005 | 2 | Sửa 3 call site chống trùng (có thể làm song song, độc lập file) |
| 3 | T006, T007 | 3 | Helper + endpoint compare |
| 4 | T008 | 4 | Audit + cập nhật renderer export |
| 5 | T009, T010, T011, T012 | 4 | Tests (có thể làm song song với T008) |
| 6 | T013 | 4 | Lint/build/test toàn repo |
