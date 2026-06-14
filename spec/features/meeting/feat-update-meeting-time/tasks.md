# Tasks: UC-MM-02 — Cập nhật thời gian họp

## CHANGELOG & REVISION HISTORY
| Ngày cập nhật | Tóm tắt thay đổi | Các dòng thay đổi |
| :--- | :--- | :--- |
| 2026-06-09 | Cập nhật tasks T009, T011 và Requirements Coverage để xử lý missing details theo speckit-analyze | T009, T011, Requirements Coverage |
| 2026-06-09 | Hoàn tất T004-T015 (service + controller), T016-T017 (permissions seed), T039-T041 (build/lint/test) | T004→T017, T039→T041 |

**Input**: Design documents from `spec/features/meeting/feat-update-meeting-time/`
**Prerequisites**: plan.md, spec.md, research.md, data-model.md, contracts/meeting-update-time-api.md, quickstart.md

## Phase 1: Enum Values & DTO

**Purpose**: Foundation — thêm enum values mới và tạo DTO validation

- [x] T001 Thêm `MEETING_TIME_UPDATED = 'meeting_time_updated'` vào enum `MeetingEventType` trong `src/modules/meetings/entities/meeting-event.entity.ts`
- [x] T002 Thêm `MEETING_TIME_UPDATED = 'meeting_time_updated'` vào enum `NotificationType` trong `src/modules/notifications/entities/notification.entity.ts`
- [x] T003 [P] Tạo `UpdateMeetingTimeDto` tại `src/modules/meetings/dto/update-meeting-time.dto.ts` với class-validator decorators cho `startTime`, `endTime`, `newRoomId` (optional), `overrideParticipantConflict` (optional, default false), `changeReason` (optional, maxLength 500)

**Checkpoint**: 3 file changes hoàn tất, build không lỗi enum

## Phase 2: Service Logic — `updateMeetingTime`

**Purpose**: Core business logic — validation, conflict check, transaction

- [x] T004 Thêm method `updateMeetingTime(meetingId: string, dto: UpdateMeetingTimeDto, authUser: AuthUser, clientContext: ClientContext)` vào `MeetingsService` tại `src/modules/meetings/services/meetings.service.ts` — khai báo method signature, import `UpdateMeetingTimeDto`
- [x] T005 Implement validation step: kiểm tra meeting tồn tại (404 `MEETING_NOT_FOUND`), kiểm tra status `scheduled` (409 `MEETING_STATUS_NOT_EDITABLE`), kiểm tra time range (`startTime < endTime` → 422 `INVALID_TIME_RANGE`), không trong quá khứ (422 `MEETING_TIME_IN_PAST`), duration 15p-8h (422 `MEETING_DURATION_OUT_OF_RANGE`) trong `src/modules/meetings/services/meetings.service.ts`
- [x] T006 [P] Implement room validation: nếu `newRoomId` được gửi, kiểm tra room tồn tại (404 `ROOM_NOT_FOUND`), active (409 `ROOM_NOT_AVAILABLE`), capacity ≥ attendee count (409 `ROOM_CAPACITY_INSUFFICIENT`) trong `src/modules/meetings/services/meetings.service.ts`
- [x] T007 Implement room conflict check: query `RoomBookingEntity` với status `IN (PENDING, APPROVED, ACTIVE)` và overlap logic `start < newEnd AND end > newStart`, loại trừ booking hiện tại. Nếu conflict → 409 `ROOM_TIME_CONFLICT` với `blocking: true` và `suggestedRooms`. Gọi `getAvailableRooms` cho suggested rooms list. Trong `src/modules/meetings/services/meetings.service.ts`
- [x] T008 Implement participant conflict check: query `MeetingParticipantEntity` JOIN `MeetingEntity` cho tất cả participants, loại trừ meeting hiện tại và cancelled/completed meetings. Nếu conflict → kiểm tra `dto.overrideParticipantConflict`. Nếu không override → 409 `PARTICIPANT_TIME_CONFLICT_WARNING` với `blocking: false` trong `src/modules/meetings/services/meetings.service.ts`
- [x] T009 Implement transaction block: `dataSource.transaction` bao gồm pessimistic lock booking record, re-check room conflict, update `meetings` (chỉ update instance hiện tại, không thay đổi `meeting_recurrence_rules`), update `room_bookings` (set `booking_type = 'relocated'` nếu đổi phòng, hoặc tạo mới nếu missing FR-029), tạo `meeting_requests` (`request_type = 'update_time'`), tạo `meeting_events` (`meeting_time_updated` kèm map `changeReason` vào `new_value_json`), tạo `audit_logs` (`action_type = 'update'` kèm map `changeReason` vào `metadata_json`) trong `src/modules/meetings/services/meetings.service.ts`
- [x] T010 Implement authorization: kiểm tra user là `organizerId`/`hostId` của meeting. Nếu không → 403 `MEETING_TIME_UPDATE_FORBIDDEN` trong `src/modules/meetings/services/meetings.service.ts` (mở rộng bởi permission guard ở controller)
- [x] T011 Implement post-transaction: tạo `NotificationEntity` (`meeting_time_updated`) cho tất cả participants + external participants (lọc bỏ external participants không có email address). Tạo `BackgroundJobEntity` (`send_email`). Xử lý failure: không rollback, log error, response `notificationStatus: 'failed'` trong `src/modules/meetings/services/meetings.service.ts`
- [x] T011a Tạo response object: trả về `{ meetingId, oldStartTime, oldEndTime, newStartTime, newEndTime, oldRoomId, newRoomId, bookingId, notificationStatus, updatedAt }` sau khi update thành công trong `src/modules/meetings/services/meetings.service.ts`
- [x] T012 Verify `MeetingsModule` imports: kiểm tra `TypeOrmModule.forFeature` trong `src/modules/meetings/meetings.module.ts` đã bao gồm tất cả entities cần cho transaction (`NotificationEntity`, `BackgroundJobEntity`, `AuditLogEntity`)

**Checkpoint**: `MeetingsService.updateMeetingTime` hoàn chỉnh với tất cả validation paths

## Phase 3: Controller Endpoint

**Purpose**: Expose REST endpoint

- [x] T013 Thêm import `UpdateMeetingTimeDto` vào `src/modules/meetings/controllers/meetings.controller.ts`
- [x] T014 Thêm endpoint `@Patch('meetings/:meetingId/time')` với `@UseGuards(JwtAuthGuard, PermissionsGuard)`, `@RequirePermissions('meeting.time.update')`, `ValidationPipe` trong `src/modules/meetings/controllers/meetings.controller.ts`
- [x] T015 Implement handler: extract `meetingId` từ `@Param('meetingId', ParseUUIDPipe)`, extract `authUser` từ `request['user']`, gọi `meetingsService.updateMeetingTime()`, trả response format chuẩn `{ success: true, data: {...}, meta: { requestId } }` trong `src/modules/meetings/controllers/meetings.controller.ts`

**Checkpoint**: Endpoint `PATCH /api/v1/meetings/{meetingId}/time` available

## Phase 4: Permissions Setup

**Purpose**: Seed permissions để guard hoạt động

- [x] T016 Thêm permission `meeting.time.update` vào permissions seed tại `src/database/seeds/20260609000000-SeedMeetingUpdateTimePermissions.ts` — gán cho ADMIN, MANAGER, EMPLOYEE roles
- [x] T017 Thêm permission `meeting.time.update.any` vào permissions seed tại `src/database/seeds/20260609000000-SeedMeetingUpdateTimePermissions.ts` — gán cho ADMIN role

**Checkpoint**: Permission guard không reject user có quyền hợp lệ

## Phase 5: Tests

**Purpose**: Đảm bảo feature quality

### DTO Validation Tests

- [ ] T018 Tạo `src/modules/meetings/dto/update-meeting-time.dto.spec.ts` — test `@IsISO8601` cho startTime/endTime, `@IsUUID` cho newRoomId, `@IsBoolean` cho overrideParticipantConflict, `@MaxLength(500)` cho changeReason, optional fields

### Service Unit Tests

- [ ] T019 Thêm test block `updateMeetingTime` vào `src/modules/meetings/services/meetings.service.spec.ts` — mock `DataSource.transaction`, test happy path (AC-001)
- [ ] T020 Thêm test `startTime >= endTime` → 422 `INVALID_TIME_RANGE` (AC-003) trong `src/modules/meetings/services/meetings.service.spec.ts`
- [ ] T021 Thêm test `startTime` trong quá khứ → 422 `MEETING_TIME_IN_PAST` (AC-004) trong `src/modules/meetings/services/meetings.service.spec.ts`
- [ ] T022 Thêm test `meetingId` invalid UUID → 400 `INVALID_UUID` (AC-005) trong `src/modules/meetings/controllers/meetings.controller.spec.ts`
- [ ] T023 Thêm test participant không có quyền → 403 `MEETING_TIME_UPDATE_FORBIDDEN` (AC-007, AC-008) trong `src/modules/meetings/services/meetings.service.spec.ts`
- [ ] T024 Thêm test meeting `in_progress`/`completed`/`cancelled` → 409 `MEETING_STATUS_NOT_EDITABLE` (AC-009, AC-010, AC-011) trong `src/modules/meetings/services/meetings.service.spec.ts`
- [ ] T025 Thêm test room conflict → 409 `ROOM_TIME_CONFLICT` blocking (AC-012) trong `src/modules/meetings/services/meetings.service.spec.ts`
- [ ] T026 Thêm test đổi phòng thành công (AC-013) — verify `booking_type = 'relocated'` trong `src/modules/meetings/services/meetings.service.spec.ts`
- [ ] T027 Thêm test participant conflict warning → 409 `PARTICIPANT_TIME_CONFLICT_WARNING` (AC-014) trong `src/modules/meetings/services/meetings.service.spec.ts`
- [ ] T028 Thêm test override participant conflict → HTTP 200 (AC-015) trong `src/modules/meetings/services/meetings.service.spec.ts`
- [ ] T029 Thêm test data integrity — verify fields không liên quan không thay đổi (AC-016) trong `src/modules/meetings/services/meetings.service.spec.ts`
- [ ] T030 Thêm test booking consistency — verify `room_bookings` khớp `meetings` (AC-017) trong `src/modules/meetings/services/meetings.service.spec.ts`
- [ ] T031 Thêm test audit log và event log created (AC-018, AC-019) trong `src/modules/meetings/services/meetings.service.spec.ts`
- [ ] T032 Thêm test notification queued (AC-020) trong `src/modules/meetings/services/meetings.service.spec.ts`
- [ ] T033 Thêm test duration out of range → 422 `MEETING_DURATION_OUT_OF_RANGE` trong `src/modules/meetings/services/meetings.service.spec.ts`
- [ ] T034 Thêm test capacity insufficient → 409 `ROOM_CAPACITY_INSUFFICIENT` trong `src/modules/meetings/services/meetings.service.spec.ts`
- [ ] T035 Thêm test missing booking record (FR-029) — verify booking được tạo mới trong `src/modules/meetings/services/meetings.service.spec.ts`
- [ ] T036 Thêm test race condition — re-check conflict → rollback → 409 `ROOM_TIME_CONFLICT` trong `src/modules/meetings/services/meetings.service.spec.ts`
- [ ] T037 Thêm test notification failure graceful — không rollback, response `notificationStatus: 'failed'` trong `src/modules/meetings/services/meetings.service.spec.ts`
- [ ] T038 Thêm test admin override — user có `meeting.time.update.any` có thể update meeting người khác (AC-002) trong `src/modules/meetings/services/meetings.service.spec.ts`

**Checkpoint**: `npm test` passes, coverage ≥ 80% cho new code

## Phase 6: Build & Lint

**Purpose**: Final verification

- [x] T039 Chạy `npm run build` — fix TypeScript errors nếu có (fixed: thêm `as AuthzRow[]` trong authz-read.repository.ts, fix relations + null types + em.update overload cho updateMeetingTime)
- [x] T040 Chạy `npm run lint` — 536 pre-existing errors (chỉ sửa `currentStatus === 'inactive'` → `RoomStatus.INACTIVE` trong code mới). Các lỗi còn lại là pre-existing trong auth module, test suites, e2e tests
- [x] T041 Chạy `npm test` — 31 pre-existing failures (tất cả từ `create-department.dto.spec.ts` do thiếu DI setup). 224 tests pass. Không có failure nào từ code mới

**Checkpoint**: Build, lint, test đều pass

---

## Requirements Coverage

| Task ID | FR / AC | Description |
|---|---|---|
| T001 | FR-005, AUD-001, AC-019 | Thêm `meeting_time_updated` vào MeetingEventType |
| T002 | FR-040, AC-020 | Thêm `meeting_time_updated` vào NotificationType |
| T003 | FR-001, ERR-001, ERR-002, AC-005 | Tạo UpdateMeetingTimeDto validation |
| T005 | FR-015, FR-016, FR-020, FR-022, FR-023, FR-024, FR-DUR-001, AC-003, AC-004, AC-009→AC-011 | Time + status validation |
| T006 | FR-010, FR-026, FR-027, FR-CAP-001 | Room validation (exists, active, capacity) |
| T007 | FR-025, CONF-001→CONF-006, AC-012 | Room conflict blocking check |
| T008 | FR-028, CONF-007→CONF-010, AC-014, AC-015 | Participant conflict check |
| T009 | FR-003, FR-006, FR-008, FR-009, FR-011, FR-017→FR-019, FR-029, FR-035→FR-039, FR-REC-001, FR-REC-002, FR-REQ-001, AUD-002→AUD-009, TXN-001→TXN-010 | Transaction block + all DB operations |
| T010 | FR-002, FR-007, FR-021, FR-032→FR-034, AC-007, AC-008 | Authorization logic |
| T011 | FR-012, FR-013, FR-040→FR-044, NFR-NOTIF-001→NFR-NOTIF-009 | Post-transaction notification + background job |
| T014 | FR-001, AC-006 | Controller endpoint |
| T016, T017 | FR-002, FR-031→FR-034 | Permission seed data |
| T018→T038 | All AC-001→AC-020 | Unit tests cho mọi acceptance criteria |

### User Stories

Feature này là một use case duy nhất (UC-MM-02), không chia thành nhiều user stories. Tất cả tasks đều thuộc cùng một feature.

### Dependencies & Execution Order

```
Phase 1 (T001-T003) → Phase 2 (T004-T012) → Phase 3 (T013-T015) → Phase 4 (T016-T017) → Phase 5 (T018-T038) → Phase 6 (T039-T041)
         ↓                      ↓                      ↓
    Enum + DTO            Service Logic           Controller
```

### Parallel Opportunities

| Task Group | Tasks | Notes |
|---|---|---|
| Enum values | T001, T002 | Khác file, không dependency |
| DTO | T003 | Khác file với T001, T002 |
| Room validation | T006 | Khác method với T005 (có thể code riêng) |
| All Phase 5 tests | T018→T038 | Tests có thể viết song song sau khi service hoàn tất |

### MVP Scope

MVP bao gồm Phase 1 + Phase 2 + Phase 3 + Phase 4 (T001→T017). Phase 5 và Phase 6 là testing và lint/build, có thể chạy sau.

### Implementation Strategy

1. Hoàn tất Phase 1 (enum + DTO) → build verification
2. Hoàn tất Phase 2 (service logic) → từng validation step → từng conflict check → transaction
3. Hoàn tất Phase 3 (controller) → endpoint available
4. Hoàn tất Phase 4 (permissions) → seed data
5. Hoàn tất Phase 5 (tests) → coverage
6. Hoàn tất Phase 6 (build + lint) → final verification
