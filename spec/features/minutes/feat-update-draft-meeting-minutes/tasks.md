# Task List: Update Draft Meeting Minutes

## 📝 CHANGELOG & REVISION HISTORY
| Ngày cập nhật | Tóm tắt thay đổi | Các dòng thay đổi |
| :--- | :--- | :--- |
| 2026-07-02 | Khởi tạo tasks cho feat-update-draft-meeting-minutes | Toàn bộ file |

## Checklist
- [ ] T001 [US1] Đọc lại `src/modules/minutes/services/minutes.service.ts` thật kỹ, xác nhận cấu trúc method (đặc biệt vùng quanh `findMinutesList` — xem research.md mục 5) trước khi chèn code mới
- [ ] T002 [US1] Request DTO → `src/modules/minutes/dto/update-draft-minutes.dto.ts` (`UpdateDraftMinutesDto`, `DecisionItemDto`, `ActionItemDto`)
- [ ] T003 [US1] Response DTO → `src/modules/minutes/dto/update-draft-minutes-response.dto.ts`
- [ ] T004 [US1] Service logic → `MinutesService.updateDraft` trong `src/modules/minutes/services/minutes.service.ts`
- [ ] T005 [US1] Controller endpoint `PATCH meeting-minutes/:id` → `src/modules/minutes/controllers/minutes-list.controller.ts` (hoặc controller mới cùng prefix, xem plan.md mục 2.2)
- [ ] T006 [US1] Migration seed permission `meeting.minutes.update` → `src/database/migrations/<timestamp>-SeedMeetingMinutesUpdatePermission.ts`
- [ ] T007 [US1] Unit test service → `src/modules/minutes/services/minutes.service.spec.ts` (bổ sung case `updateDraft`)
- [ ] T008 [US1] Unit test controller → route mới trong controller test tương ứng
- [ ] T009 [US1] Lint/build/test toàn repo, xác nhận không phá vỡ module khác

## Phase 0: Xác minh code hiện tại

### Task T001 [US1] — Đọc lại `minutes.service.ts` trước khi sửa
**File**: `src/modules/minutes/services/minutes.service.ts`
**Action**: Đọc toàn bộ file thật (không dựa vào bản trích trong research.md), xác nhận ranh giới chính xác của method `findMinutesList` và các method attachment (`addAttachment`/`listAttachments`/`removeAttachment`) để biết chính xác vị trí chèn method `updateDraft` mới, tránh việc chèn nhầm giữa 2 method nếu file thật sự có lỗi cú pháp thiếu dấu đóng.
**Outcome**: Xác nhận rõ file compile được ở trạng thái hiện tại (`npm run build` trước khi sửa) trước khi bắt đầu code feature này.
**Verification**: `npm run build` pass trước khi thêm bất kỳ dòng nào của feature này.

## Phase 1: Preparation

### Task T002 [US1] — Tạo request DTO
**File**: `src/modules/minutes/dto/update-draft-minutes.dto.ts`
**Action**: Tạo `UpdateDraftMinutesDto` (`versionNo` bắt buộc, `title`/`minutesContent`/`decisionsJson`/`actionItemsJson` optional), `DecisionItemDto`, `ActionItemDto` theo đúng field/validator ở `data-model.md` mục 3.
**Outcome**: DTO dùng cho `@Body()`, validate qua ValidationPipe global (`whitelist`, `forbidNonWhitelisted`, `transform`).
**Verification**: Compile OK, DTO reject field lạ (`visibilityLevel`, `status`, `preparedBy`,...), reject payload thiếu `versionNo`.

### Task T003 [US1] — Tạo response DTO
**File**: `src/modules/minutes/dto/update-draft-minutes-response.dto.ts`
**Action**: Định nghĩa class/type theo spec.md mục 5.3 (`id, meetingId, title, status, versionNo, minutesContent, decisionsJson, actionItemsJson, attendeesSnapshotJson, preparedBy, updatedAt`).
**Outcome**: Type dùng làm kiểu trả về của `MinutesService.updateDraft` và response controller.
**Verification**: Type-check pass.

## Phase 2: Service Logic

### Task T004 [US1] — Viết `MinutesService.updateDraft`
**File**: `src/modules/minutes/services/minutes.service.ts`
**Action**: Implement theo pseudo-code plan.md mục 7.1:
```text
async updateDraft(minutesId, dto, authUser):
  updatableFields = ['title', 'minutesContent', 'decisionsJson', 'actionItemsJson']
  if (updatableFields.every(f => dto[f] === undefined))
    throw BadRequestException(VALIDATION_ERROR, NO_UPDATE_FIELD)

  return this.dataSource.transaction(async (manager) => {
    minutes = manager.getRepository(MeetingMinutesEntity)
      .createQueryBuilder('minutes').setLock('pessimistic_write')
      .where('minutes.id = :minutesId', { minutesId }).getOne()
    if (!minutes || minutes.deletedAt) throw NotFoundException(MINUTES_NOT_FOUND)

    meeting = manager.getRepository(MeetingEntity).findOne({ where: { id: minutes.meetingId } })

    isOwner = minutes.preparedBy === authUser.userId || meeting?.hostId === authUser.userId
    if (!isOwner) throw ForbiddenException(NOT_MINUTES_OWNER)

    if (minutes.status !== DRAFT) throw ConflictException(MINUTES_NOT_DRAFT)

    if (dto.versionNo !== minutes.versionNo)
      throw ConflictException(MINUTES_VERSION_CONFLICT, { currentVersionNo: minutes.versionNo, currentData: {...} })

    if (dto.title !== undefined) minutes.title = dto.title
    if (dto.minutesContent !== undefined) minutes.minutesContent = dto.minutesContent
    if (dto.decisionsJson !== undefined) minutes.decisionsJson = dto.decisionsJson
    if (dto.actionItemsJson !== undefined)
      minutes.actionItemsJson = dto.actionItemsJson.map(item => ({ ...item, id: item.id ?? randomUUID() }))

    if (meeting?.status === COMPLETED) {
      participants = manager.getRepository(MeetingParticipantEntity).find({ where: { meetingId: minutes.meetingId } })
      minutes.attendeesSnapshotJson = participants.map(p => ({ userId, participantRole, attendanceStatus, joinedAt, leftAt }))
    }

    oldVersionNo = minutes.versionNo
    minutes.versionNo += 1
    saved = manager.getRepository(MeetingMinutesEntity).save(minutes)
    return saved
  })
  // sau transaction (best-effort, giống pattern createDraft):
  auditLogsService.logEntityChange({ userId: authUser.userId, actionType: 'meeting_minutes_updated',
    entityType: 'meeting_minutes', entityId: saved.id,
    oldValueJson: { versionNo: oldVersionNo }, newValueJson: { versionNo: saved.versionNo, updatedFields } })
  return buildResponse(saved)
```
**Outcome**: Method hoàn chỉnh, throw đúng exception/code cho từng nhánh lỗi ở spec.md mục 6.
**Verification**: Unit test T007 pass toàn bộ các nhánh.

## Phase 3: Controller Endpoint

### Task T005 [US1] — Thêm route `PATCH :id`
**File**: `src/modules/minutes/controllers/minutes-list.controller.ts` (hoặc controller mới cùng prefix `meeting-minutes`, quyết định lúc code — xem plan.md mục 2.2)
**Action**: Thêm method controller `updateDraft` với `@Patch(':id')`, guard `JwtAuthGuard, PermissionsGuard`, `@RequirePermissions('meeting.minutes.update')`, `ParseUUIDPipe` cho `:id`, `ValidationPipe` inline, `@CurrentUser()` lấy user, gọi `minutesService.updateDraft`, trả `{ success: true, message: 'Cap nhat noi dung bien ban cuoc hop thanh cong', data: result }` với `HttpCode(200)`.
**Outcome**: Endpoint hoạt động end-to-end.
**Verification**: Test T008.

## Phase 4: Seed & Tests

### Task T006 [US1] — Seed permission mới
**File**: `src/database/migrations/<timestamp>-SeedMeetingMinutesUpdatePermission.ts`
**Action**: Copy pattern từ `20260702010000-SeedMeetingMinutesReadPermission.ts`, đổi permission_code=`meeting.minutes.update`, module_code=`minutes`, action_code=`minutes.update`, roles=`INTERNAL_USER, MANAGER, BUSINESS_ADMIN, SYSTEM_ADMIN`.
**Outcome**: Migration chạy được qua `migration:run`, permission + role_permissions insert đúng.
**Verification**: Chạy thử (nếu có DB local) theo quickstart.md mục 2.

### Task T007 [US1] — Unit test service
**File**: `src/modules/minutes/services/minutes.service.spec.ts`
**Action**: Mock `DataSource`/`EntityManager`, test các case liệt kê ở plan.md mục 10.1: happy path (từng field riêng lẻ + full 4 field), ownership (4 tổ hợp preparedBy/hostId đúng-sai), status không draft, version conflict, thiếu versionNo, không field nào update, vượt giới hạn field, action item tự sinh `id`/giữ `id` cũ, refresh snapshot có điều kiện.
**Outcome**: Coverage đầy đủ nhánh lỗi + happy path (ENG-01: ≥80% cho business logic mới).
**Verification**: `npm run test` pass.

### Task T008 [US1] — Unit test controller
**File**: controller spec tương ứng (tùy vị trí đặt route ở T005)
**Action**: Test controller gọi đúng service method với đúng tham số (`minutesId`, `dto`, `authUser`), trả đúng response shape, đúng `HttpStatus 200`.
**Outcome**: Test pass.
**Verification**: `npm run test` pass.

### Task T009 [US1] — Lint/build/test
**Action**: Chạy `npm run lint`, `npm run build`, `npm run test` cho toàn repo, đảm bảo không phá vỡ module khác (đặc biệt các test hiện có của `minutes` module).
**Outcome**: Build pass, test module `minutes` pass toàn bộ (cũ + mới).
**Verification**: Ghi lại kết quả thực tế (số test pass/fail) trong changelog của file này sau khi hoàn thành, theo đúng pattern các feature `minutes` trước.

## Requirements Coverage

### FR Coverage
| FR ID | Task(s) |
| :--- | :--- |
| FR-001, FR-008 | T002, T004 |
| FR-002, FR-003 | T004 |
| FR-004 | T002 (DTO không nhận field khóa) |
| FR-005 | T004 |
| FR-006, FR-007 | T004, T007 |
| FR-009, FR-010 | T004, T007 |
| FR-011, FR-012 | T004, T007 |
| FR-013, FR-014 | T004, T007 |
| FR-015..FR-019 | T002, T007 |
| FR-020, FR-021 | T004 |
| FR-022, FR-023 | T004 |
| FR-024, FR-025 | T004, T007 |

### AC Coverage
| AC ID | Task(s) |
| :--- | :--- |
| AC-001, AC-004, AC-005 | T007 |
| AC-002 | T004, T007 |
| AC-003 | T004, T007 |
| AC-006, AC-007 | T007 |
| AC-008 | T005 (guard) |
| AC-009, AC-010 | T004, T007 |
| AC-011, AC-012, AC-013 | T002, T007 |
| AC-014, AC-015 | T004, T007 |
| AC-016, AC-017 | T004, T007 |

### Error Code Coverage
| Error Code | HTTP Status | Task(s) |
| :--- | :--- | :--- |
| VALIDATION_ERROR (NO_UPDATE_FIELD) | 400 | T004, T007 |
| VALIDATION_ERROR (field khác) | 400 | T002, T007 |
| FORBIDDEN | 403 | T005 (guard) |
| NOT_MINUTES_OWNER | 403 | T004, T007 |
| MINUTES_NOT_FOUND | 404 | T004, T007 |
| MINUTES_NOT_DRAFT | 409 | T004, T007 |
| MINUTES_VERSION_CONFLICT | 409 | T004, T007 |

## Dependencies Graph
```text
T001 ─> T002 ─┐
       T003 ─┼─> T004 ─> T005 ─> T006
                    │
                    └──> T007, T008 ──> T009
```

## Implementation Order
| Step | Task(s) | Phase | Description |
| :--- | :--- | :--- | :--- |
| 1 | T001 | 0 | Xác minh code hiện tại trước khi sửa |
| 2 | T002, T003 | 1 | DTOs |
| 3 | T004 | 2 | Service |
| 4 | T005 | 3 | Controller |
| 5 | T006 | 4 | Seed permission |
| 6 | T007, T008 | 4 | Tests |
| 7 | T009 | 4 | Lint/build/test toàn repo |
