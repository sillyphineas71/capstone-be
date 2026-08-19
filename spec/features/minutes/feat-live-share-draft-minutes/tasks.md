# Task List: Live-Share Draft Minutes

## 📝 CHANGELOG & REVISION HISTORY
| Ngày cập nhật | Tóm tắt thay đổi | Các dòng thay đổi |
| :--- | :--- | :--- |
| 2026-08-19 | Khởi tạo tasks cho feat-live-share-draft-minutes (MKM-LIVE-01) | Toàn bộ file |

## Checklist
- [ ] T001 [US1] Migration thêm cột `is_live_shared` → `src/database/migrations/`
- [ ] T002 [US1] Cập nhật `MeetingMinutesEntity` → `src/modules/minutes/entities/meeting-minutes.entity.ts`
- [ ] T003 [US1] DTO toggle → `src/modules/minutes/dto/toggle-live-share-minutes.dto.ts`
- [ ] T004 [US1] Service method `toggleLiveShare` → `src/modules/minutes/services/minutes.service.ts`
- [ ] T005 [US1] Endpoint `PATCH :id/live-share` → `src/modules/minutes/controllers/minutes-list.controller.ts`
- [ ] T006 [US2] Sửa `canAccessMinutes()` — mở nhánh đọc cho participant → `src/modules/minutes/services/minutes.service.ts`
- [ ] T007 [US2] Hook emit `minutes.draft.updated` tại lưu nội dung (UC-MKM-04) → `src/modules/minutes/services/minutes.service.ts`
- [ ] T008 [US1] Hook auto tắt cờ + emit `minutes.draft.live_stopped` tại issue → `src/modules/minutes/services/minutes.service.ts`
- [ ] T009 [US2] Expose `isLiveShared` trong `MinutesDetailResponseDto` → `src/modules/minutes/dto/minutes-detail-response.dto.ts`, `src/modules/minutes/services/minutes.service.ts`
- [ ] T010 [US1] Unit test toggle
- [ ] T011 [US2] Unit test `canAccessMinutes`/`findMinutesDetail`
- [ ] T012 [US1] Unit test hooks (updateDraft emit, issue auto-reset)
- [ ] T013 [US1] Unit test controller
- [ ] T014 Lint/build/test toàn repo

## Phase 1: Schema

### Task T001 [US1] — Migration thêm cột `is_live_shared`
**File**: `src/database/migrations/20260819000002-AddIsLiveSharedColumnToMeetingMinutes.ts`
**Action**:
```ts
// up(): ALTER TABLE meeting_minutes ADD COLUMN is_live_shared boolean NOT NULL DEFAULT false;
// down(): ALTER TABLE meeting_minutes DROP COLUMN is_live_shared;
```
Không cần backfill (default `false` áp đúng ngay cho dữ liệu cũ). Đặt đúng `src/database/migrations/`, không phải `seeds/`.
**Outcome**: Cột tồn tại, mọi dòng cũ có giá trị `false`.
**Verification**: `migration:run` trên DB dev, `SELECT is_live_shared, count(*) FROM meeting_minutes GROUP BY is_live_shared` → toàn bộ `false`.

### Task T002 [US1] — Cập nhật `MeetingMinutesEntity`
**File**: `src/modules/minutes/entities/meeting-minutes.entity.ts`
**Action**: Thêm field `@Column({ name: 'is_live_shared', type: 'boolean', default: false }) isLiveShared: boolean;` cạnh `visibilityLevel`.
**Outcome**: Entity khớp schema sau T001.
**Verification**: `npm run build` pass.

## Phase 2: Toggle Endpoint

### Task T003 [US1] — DTO toggle
**File**: `src/modules/minutes/dto/toggle-live-share-minutes.dto.ts`
**Action**: `export class ToggleLiveShareMinutesDto { @IsBoolean() enabled: boolean; }`.
**Outcome**: DTO validate input, bắt buộc truyền `enabled`.
**Verification**: Compile OK, reject payload thiếu field/kiểu sai.

### Task T004 [US1] — Service method `toggleLiveShare`
**File**: `src/modules/minutes/services/minutes.service.ts`
**Action**: Implement theo pseudo-code plan.md mục 7.1:
```text
async toggleLiveShare(minutesId, dto, authUser):
  return this.dataSource.transaction(async (manager) => {
    minutes = manager.getRepository(MeetingMinutesEntity).createQueryBuilder('m')
      .setLock('pessimistic_write').where('m.id = :id', { id: minutesId }).getOne()
    if (!minutes || minutes.deletedAt) throw NotFoundException(MEETING_MINUTES_NOT_FOUND)
    if (minutes.preparedBy !== authUser.userId) throw ForbiddenException(NOT_MINUTES_OWNER)
    if (minutes.status !== DRAFT) throw ConflictException(MINUTES_NOT_DRAFT)

    if (dto.enabled) {
      meeting = manager.getRepository(MeetingEntity).findOne({ where: { id: minutes.meetingId } })
      if (meeting.status !== IN_PROGRESS) throw ConflictException(MEETING_NOT_IN_PROGRESS)
    }

    if (minutes.isLiveShared === dto.enabled) {
      return { minutes, changed: false } // idempotent, AC-010 — không emit
    }

    minutes.isLiveShared = dto.enabled
    saved = manager.getRepository(MeetingMinutesEntity).save(minutes)
    return { minutes: saved, changed: true }
  }).then(async (result) => {
    if (result.changed) {
      await this.auditLogsService.logAction({ actionType: 'meeting_minutes_live_share_toggled', ... })
      this.emitLiveShareEvent(result.minutes, result.changed) // best-effort, try/catch nội bộ
    }
    return result.minutes
  })
```
Thêm helper private `emitLiveShareEvent(minutes, enabled)` gọi `EventsGateway` — kiểm tra method public sẵn có của `EventsGateway` để emit vào room `meeting:${meetingId}` (nếu chưa có method phù hợp, thêm 1 method public nhỏ `emitToMeetingRoom(meetingId, event, payload)` vào `EventsGateway`, KHÔNG sửa logic auth/connection hiện có của gateway).
**Outcome**: Method hoàn chỉnh, đúng nhánh lỗi spec.md mục 6, đúng idempotency AC-010.
**Verification**: Unit test T010 pass toàn bộ.

### Task T005 [US1] — Endpoint `PATCH :id/live-share`
**File**: `src/modules/minutes/controllers/minutes-list.controller.ts`
**Action**: Thêm route ngay sau `PATCH :id` hiện có:
```ts
@Patch(':id/live-share')
@HttpCode(HttpStatus.OK)
@UseGuards(JwtAuthGuard, PermissionsGuard)
@RequirePermissions('meeting.minutes.update')
async toggleLiveShare(
  @Param('id', ParseUUIDPipe) id: string,
  @Body() dto: ToggleLiveShareMinutesDto,
  @CurrentUser() user: { userId: string },
) {
  const result = await this.minutesService.toggleLiveShare(id, dto, { userId: user.userId });
  return {
    success: true,
    message: result.isLiveShared ? 'Da bat che do chia se truc tiep' : 'Da tat che do chia se truc tiep',
    data: { id: result.id, isLiveShared: result.isLiveShared, versionNo: result.versionNo },
  };
}
```
Route tĩnh `:id/live-share` không xung đột thứ tự với route khác (đã có tiền lệ `:id/issue`, `:id/shares` cùng pattern).
**Outcome**: Endpoint hoạt động end-to-end.
**Verification**: Test T013.

## Phase 3: Read-gate + Hooks

### Task T006 [US2] — Sửa `canAccessMinutes()`
**File**: `src/modules/minutes/services/minutes.service.ts` (~dòng 1174-1198)
**Action**: Đổi nhánh DRAFT (dòng 1182-1184) từ:
```ts
if (minutes.status === MeetingMinutesStatus.DRAFT) {
  return minutes.preparedBy === userId;
}
```
sang:
```ts
if (minutes.status === MeetingMinutesStatus.DRAFT) {
  return minutes.preparedBy === userId || (minutes.isLiveShared && isParticipant);
}
```
Không sửa nhánh PUBLISHED/ARCHIVED.
**Outcome**: Participant đọc được draft đang live-share (AC-003), hành vi cũ giữ nguyên khi tắt (AC-006).
**Verification**: Test T011 — đặc biệt case AC-006 phải pass để chống regression bảo mật.

### Task T007 [US2] — Hook emit tại lưu nội dung (UC-MKM-04)
**File**: `src/modules/minutes/services/minutes.service.ts` (method `updateDraft`, `PATCH :id`)
**Action**: Ngay sau khi `save()` nội dung thành công trong `updateDraft`, thêm:
```ts
if (saved.isLiveShared) {
  this.emitLiveShareEvent(saved, 'updated'); // helper dùng chung với T004, best-effort try/catch
}
```
**Outcome**: FR-006/FR-007 — chỉ emit khi đang live-share, im lặng khi không.
**Verification**: Test T012.

### Task T008 [US1] — Hook auto tắt cờ tại issue
**File**: `src/modules/minutes/services/minutes.service.ts` (method issue, `POST :id/issue`)
**Action**: Trong transaction issue hiện có, trước khi set `status=PUBLISHED`, nếu `minutes.isLiveShared === true` thì set thêm `minutes.isLiveShared = false` trong cùng câu `save()`. Sau transaction, nếu đã tắt thì emit `minutes.draft.live_stopped` (best-effort).
**Outcome**: FR-014, AC-009.
**Verification**: Test T012.

### Task T009 [US2] — Expose `isLiveShared` trong response
**File**: `src/modules/minutes/dto/minutes-detail-response.dto.ts`, `src/modules/minutes/services/minutes.service.ts` (nơi build `MinutesDetailResponseDto`)
**Action**: Thêm field `isLiveShared: boolean;` vào `MinutesDetailResponseDto`; gán `isLiveShared: minutes.isLiveShared` tại chỗ construct DTO trong `findMinutesDetail`.
**Outcome**: FR-016 — FE (bước sau) có dữ liệu để hiển thị badge.
**Verification**: Test T011 assert field có mặt trong response.

## Phase 4: Tests

### Task T010 [US1] — Unit test toggle
**File**: `src/modules/minutes/services/minutes.service.spec.ts`
**Action**: Case: bật thành công + emit đúng (AC-001); tắt thành công + emit (AC-004); không phải preparedBy → 403 (AC-005); không phải draft → 409 (AC-007); bật khi meeting không in_progress → 409 (AC-008); toggle lặp giá trị cũ → không emit thêm (AC-010).
**Outcome**: Coverage đầy đủ nhánh service `toggleLiveShare`.
**Verification**: `npm run test` pass.

### Task T011 [US2] — Unit test `canAccessMinutes`/`findMinutesDetail`
**File**: `src/modules/minutes/services/minutes.service.spec.ts`
**Action**: Case: participant đọc được khi `isLiveShared=true` (AC-003); participant bị chặn khi `isLiveShared=false` (AC-006, ưu tiên cao nhất — chống regression bảo mật cho toàn bộ nhánh DRAFT cũ); preparedBy luôn đọc được bất kể cờ; response chứa `isLiveShared` đúng giá trị (T009).
**Outcome**: Xác nhận không có lỗ hổng đọc ngoài ý muốn.
**Verification**: `npm run test` pass.

### Task T012 [US1] — Unit test hooks
**File**: `src/modules/minutes/services/minutes.service.spec.ts`
**Action**: Case: `updateDraft` khi `isLiveShared=true` → có gọi emit `minutes.draft.updated` (AC-002); khi `isLiveShared=false` → không gọi emit gì (FR-007); `issue` khi đang live-share → sau đó `isLiveShared=false` + emit `live_stopped` (AC-009); `issue` khi không live-share → không emit gì thêm ngoài luồng issue hiện có.
**Outcome**: Xác nhận 2 hook nối đúng vào luồng cũ mà không phá hành vi hiện có của `updateDraft`/`issue`.
**Verification**: `npm run test` pass — đặc biệt các test hiện có của `updateDraft spec`/`issue spec` (nếu có sẵn) vẫn phải pass nguyên, không bị hook mới làm vỡ.

### Task T013 [US1] — Unit test controller
**File**: `src/modules/minutes/controllers/minutes-list.controller.spec.ts`
**Action**: Test controller gọi đúng `minutesService.toggleLiveShare` với đúng tham số, trả đúng response shape, route `:id/live-share` không bị nuốt bởi các route `:id/...` khác.
**Outcome**: Test pass.
**Verification**: `npm run test` pass.

### Task T014 — Lint/build/test toàn repo
**Action**: Chạy `npm run lint`, `npm run build`, `npm run test`.
**Outcome**: Build pass; `npx jest src/modules/minutes` pass toàn bộ (số test tăng so với baseline sau MKM-MANUAL-01: 244 + số test mới của feature này); đối chiếu không có regression mới ngoài `modules/minutes` theo đúng baseline đã biết ([[project_capstone_be_dev_test_baseline]]).
**Verification**: Ghi số liệu thật vào CHANGELOG file này sau khi chạy.

## Requirements Coverage

### FR Coverage
| FR ID | Task(s) |
| :--- | :--- |
| FR-001, FR-015 | T001, T002 |
| FR-002, FR-003, FR-011, FR-012 | T004, T010 |
| FR-004, FR-005 | T004, T010 |
| FR-006, FR-007 | T007, T012 |
| FR-008, FR-009, FR-013 | T006, T011 |
| FR-010 | T004, T010 |
| FR-014 | T008, T012 |
| FR-016 | T009, T011 |
| FR-017, FR-018 | T004, T010 |
| FR-019 | T007 (không throttle, ghi chú trong code) |

### AC Coverage
| AC ID | Task(s) |
| :--- | :--- |
| AC-001, AC-004 | T004, T005, T010 |
| AC-002 | T007, T012 |
| AC-003, AC-006 | T006, T011 |
| AC-005 | T004, T010 |
| AC-007, AC-008 | T004, T010 |
| AC-009 | T008, T012 |
| AC-010 | T004, T010 |
| AC-011, AC-012 | T004, T010 |

### Error Code Coverage
| Error Code | HTTP Status | Task(s) |
| :--- | :--- | :--- |
| VALIDATION_ERROR | 400 | T003 |
| FORBIDDEN | 403 | T005 (guard) |
| NOT_MINUTES_OWNER | 403 | T004, T010 |
| MEETING_MINUTES_NOT_FOUND | 404 | T004, T010 |
| MINUTES_NOT_DRAFT | 409 | T004, T010 |
| MEETING_NOT_IN_PROGRESS | 409 | T004, T010 |
| MEETING_MINUTES_ACCESS_DENIED | 403 | T006, T011 |

## Dependencies Graph
```text
T001 ──> T002 ──┬──> T003 ──> T004 ──> T005
                 ├──> T006
                 ├──> T007
                 ├──> T008
                 └──> T009
                          │
T004,T005,T006,T007,T008,T009 ──> T010,T011,T012,T013 ──> T014
```

## Implementation Order
| Step | Task(s) | Phase | Description |
| :--- | :--- | :--- | :--- |
| 1 | T001, T002 | 1 | Schema |
| 2 | T003, T004, T005 | 2 | Toggle endpoint |
| 3 | T006, T007, T008, T009 | 3 | Read-gate + hooks + DTO expose |
| 4 | T010, T011, T012, T013 | 4 | Tests |
| 5 | T014 | 4 | Lint/build/test toàn repo |
