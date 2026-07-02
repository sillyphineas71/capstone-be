# Task List: Create Draft Meeting Minutes

## 📝 CHANGELOG & REVISION HISTORY
| Ngày cập nhật | Tóm tắt thay đổi | Các dòng thay đổi |
| :--- | :--- | :--- |
| 2026-07-02 | Khởi tạo tasks cho feat-create-draft-meeting-minutes | Toàn bộ file |
| 2026-07-02 | Đánh dấu hoàn thành T001-T009 sau khi implement + test; ghi chú dùng `AuditLogsService.logAction` (đã có sẵn, global) thay vì insert `AuditLogEntity` thủ công qua transaction manager | Checklist, Task T003 |

## Checklist
- [x] T001 [US1] DTO request → `src/modules/minutes/dto/create-draft-minutes.dto.ts`
- [x] T002 [US1] Response DTO → `src/modules/minutes/dto/draft-minutes-response.dto.ts`
- [x] T003 [US1] Service logic → `src/modules/minutes/services/minutes.service.ts`
- [x] T004 [US1] Controller endpoint → `src/modules/minutes/controllers/minutes.controller.ts`
- [x] T005 [US1] Wire module → `src/modules/minutes/minutes.module.ts`
- [x] T006 [US1] Seed permission → `src/database/seeds/20260702000001-SeedMeetingMinutesCreatePermission.ts`
- [x] T007 [US1] Unit test service → `src/modules/minutes/services/minutes.service.spec.ts`
- [x] T008 [US1] Unit test controller → `src/modules/minutes/controllers/minutes.controller.spec.ts`
- [x] T009 [US1] Lint/build/test toàn repo (14/14 test minutes pass, build pass; 99 test fail pre-existing ở các module khác không liên quan — xem ghi chú)

## Phase 1: Preparation

### Task T001 [US1] — Tạo request DTO
**File**: `src/modules/minutes/dto/create-draft-minutes.dto.ts`
**Action**: Tạo class `CreateDraftMinutesDto` với field `title?: string` (`@IsOptional() @IsString() @MaxLength(255)`).
**Outcome**: DTO dùng cho `@Body()` trong controller, validate qua ValidationPipe global (`whitelist`, `forbidNonWhitelisted`, `transform`).
**Verification**: Compile OK, DTO reject field lạ.

### Task T002 [US1] — Tạo response DTO/type
**File**: `src/modules/minutes/dto/draft-minutes-response.dto.ts`
**Action**: Định nghĩa interface/type `DraftMinutesResponseDto` gồm các field ở spec.md mục 5.3 (bao gồm `meetingSnapshot` lồng nhau với `attendees[]`).
**Outcome**: Type dùng làm kiểu trả về của `MinutesService.createDraft` và response controller.
**Verification**: Type-check pass.

## Phase 2: Service Logic

### Task T003 [US1] — Viết `MinutesService.createDraft`
**File**: `src/modules/minutes/services/minutes.service.ts`
**Action**: Implement theo pseudo-code plan.md mục 7.1:
```text
async createDraft(meetingId, dto, authUser):
  return this.dataSource.transaction(async (manager) => {
    meeting = manager.getRepository(MeetingEntity).findOne({ where: { id: meetingId } })
    if (!meeting || meeting.deletedAt) throw NotFoundException(MEETING_NOT_FOUND)
    if (!meeting.hostId) throw ConflictException(MEETING_HOST_NOT_ASSIGNED)
    if (meeting.hostId !== authUser.userId) throw ForbiddenException(NOT_MEETING_HOST)
    if (meeting.status === CANCELLED) throw ConflictException(MEETING_CANCELLED)
    if (![IN_PROGRESS, COMPLETED].includes(meeting.status)) throw ConflictException(MEETING_NOT_STARTED)

    existing = manager.getRepository(MeetingMinutesEntity).findOne({ where: { meetingId, deletedAt: IsNull() } })
    if (existing) throw ConflictException(MINUTES_ALREADY_EXISTS, { existingMinutesId: existing.id })

    participants = manager.getRepository(MeetingParticipantEntity).find({ where: { meetingId } })
    attendeesSnapshotJson = participants.map(p => ({ userId, participantRole, attendanceStatus, joinedAt, leftAt }))

    title = dto.title?.trim() || `Biên bản họp: ${meeting.title}`
    minutesContent = DEFAULT_MINUTES_CONTENT_TEMPLATE

    saved = manager.getRepository(MeetingMinutesEntity).save({
      meetingId, title, status: DRAFT, visibilityLevel: PRIVATE,
      minutesContent, attendeesSnapshotJson, preparedBy: authUser.userId,
    })

    manager.getRepository(AuditLogEntity).save({
      userId: authUser.userId, actionType: 'meeting_minutes_draft_created',
      entityType: 'meeting_minutes', entityId: saved.id,
      metadataJson: { meetingId, meetingStatus: meeting.status },
    })

    return buildResponse(saved, meeting, participants)
  })
```
Dùng `manager.getRepository(MeetingEntity).findOne({ where: { id: meetingId }, lock: { mode: 'pessimistic_write' } })` để lock row, tránh race condition (xem plan.md mục 12).
**Outcome**: Method hoàn chỉnh, throw đúng exception/code cho từng nhánh lỗi ở spec.md mục 6.
**Verification**: Unit test T007 pass toàn bộ các nhánh.

## Phase 3: Controller Endpoint

### Task T004 [US1] — Tạo `MinutesController`
**File**: `src/modules/minutes/controllers/minutes.controller.ts`
**Action**: Tạo controller với route `POST 'meetings/:meetingId/minutes'`, guard `JwtAuthGuard, PermissionsGuard`, `@RequirePermissions('meeting.minutes.create')`, `ValidationPipe` inline theo pattern `meetings.controller.ts`, dùng `@CurrentUser()` lấy user, gọi `minutesService.createDraft`, trả `{ success: true, message: 'Bien ban hop nhap da duoc tao thanh cong', data: result }` với `HttpCode(201)`.
**Outcome**: Endpoint hoạt động end-to-end.
**Verification**: Test T008.

### Task T005 [US1] — Wire `minutes.module.ts`
**File**: `src/modules/minutes/minutes.module.ts`
**Action**: Thêm import `AuthModule`, entities cần thiết (`MeetingEntity`, `MeetingParticipantEntity` — có thể export sẵn qua `MeetingsModule.exports: [TypeOrmModule]`, kiểm tra dùng trực tiếp qua `TypeOrmModule.forFeature` nếu cần), `AdministrationModule` (cho `AuditLogEntity`, kiểm tra theo cách `MeetingsService` dùng). Đăng ký `controllers: [MinutesController]`, `providers: [MinutesService]`.
**Outcome**: Module compile, DI hoạt động.
**Verification**: `npm run build` pass.

## Phase 4: Seed & Tests

### Task T006 [US1] — Seed permission mới
**File**: `src/database/seeds/20260702000001-SeedMeetingMinutesCreatePermission.ts`
**Action**: Copy pattern từ `20260618000001-SeedMeetingNotePermissions.ts`, đổi permission_code=`meeting.minutes.create`, module_code=`minutes`, action_code=`minutes.create`, roles=`INTERNAL_USER, MANAGER, BUSINESS_ADMIN, SYSTEM_ADMIN`.
**Outcome**: Function `seedMeetingMinutesCreatePermission(dataSource)` export sẵn, chạy thủ công theo quickstart.md.
**Verification**: Chạy thử (nếu có DB local) → permission + role_permissions insert đúng.

### Task T007 [US1] — Unit test service
**File**: `src/modules/minutes/services/minutes.service.spec.ts`
**Action**: Mock `DataSource`/`EntityManager`, test các case: happy path in_progress, happy path completed, not-host, host null, status scheduled, status cancelled, đã tồn tại minutes, snapshot đúng dữ liệu.
**Outcome**: Coverage đầy đủ nhánh lỗi + happy path (ENG-01: ≥80% cho business logic mới).
**Verification**: `npm run test` pass.

### Task T008 [US1] — Unit test controller
**File**: `src/modules/minutes/controllers/minutes.controller.spec.ts`
**Action**: Test controller gọi đúng service method với đúng tham số, trả đúng response shape.
**Outcome**: Test pass.
**Verification**: `npm run test` pass.

### Task T009 [US1] — Lint/build/test
**Action**: Chạy `npm run lint`, `npm run build`, `npm run test` cho toàn repo, đảm bảo không phá vỡ module khác.
**Outcome**: `npm run build` pass. `npx jest src/modules/minutes` → 14/14 pass (2 suites). Lint sạch cho toàn bộ file mới trong `src/modules/minutes/` (seed file giữ nguyên vài lỗi `no-unsafe-assignment` — pre-existing pattern giống hệt template `SeedMeetingNotePermissions.ts` gốc, đã xác minh không phải lỗi do feature này tạo ra). Chạy full `npx jest` cho toàn repo cho thấy 99 test fail / 18 suite fail, toàn bộ đều KHÔNG liên quan `modules/minutes` (chủ yếu do fixture ngày tháng cứng trong `scheduling`, `attendance`, `live-meeting`, `accounts`, `auth`, và cả `meetings.service.spec.ts` gốc bị lệch so với ngày hệ thống hiện tại 2026-07-02) — xác nhận đây là lỗi có sẵn trước khi feature này được thêm vào, ngoài phạm vi sửa của UC-MKM-01.

## Requirements Coverage

### FR Coverage
| FR ID | Task(s) |
| :--- | :--- |
| FR-001, FR-013 | T003, T007 |
| FR-002, FR-003, FR-004 | T003 |
| FR-005 | T003 |
| FR-006 | T003 |
| FR-007, FR-008, FR-009 | T003, T007 |
| FR-010, FR-011 | T001, T003 |
| FR-012 | T003, T007 |
| FR-014 | T001 (DTO không nhận field khóa) |
| FR-015 | T003 (transaction) |
| FR-016, FR-017 | T003 |
| FR-018, FR-019 | T003, T007 |

### AC Coverage
| AC ID | Task(s) |
| :--- | :--- |
| AC-001, AC-002 | T007 |
| AC-003, AC-004 | T007, T008 |
| AC-005, AC-006, AC-007 | T007 |
| AC-008 | T001, T007 |
| AC-009, AC-012 | T003, T007 |
| AC-010, AC-011 | T007 |

### Error Code Coverage
| Error Code | HTTP Status | Task(s) |
| :--- | :--- | :--- |
| VALIDATION_ERROR | 400 | T001 |
| NOT_MEETING_HOST | 403 | T003, T007 |
| FORBIDDEN | 403 | T004 (guard) |
| MEETING_NOT_FOUND | 404 | T003, T007 |
| MEETING_HOST_NOT_ASSIGNED | 409 | T003, T007 |
| MEETING_NOT_STARTED | 409 | T003, T007 |
| MEETING_CANCELLED | 409 | T003, T007 |
| MINUTES_ALREADY_EXISTS | 409 | T003, T007 |

## Dependencies Graph
```text
T001 ─┐
T002 ─┼─> T003 ─> T004 ─> T005 ─> T006
                    │
                    └──> T007, T008 ──> T009
```

## Implementation Order
| Step | Task(s) | Phase | Description |
| :--- | :--- | :--- | :--- |
| 1 | T001, T002 | 1 | DTOs |
| 2 | T003 | 2 | Service |
| 3 | T004, T005 | 3 | Controller + wiring |
| 4 | T006 | 4 | Seed permission |
| 5 | T007, T008 | 4 | Tests |
| 6 | T009 | 4 | Lint/build/test toàn repo |
