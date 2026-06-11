# Tasks: Gỡ bỏ thành viên nội bộ khỏi cuộc họp

- **Feature ID**: UC-MM-08
- **Feature Name**: Remove Internal Meeting Participant
- **Module / Domain**: Meeting Management (meetings)
- **Created Date**: 2026-06-11
- **Total Tasks**: 43

---

## Phase 1: Setup & Foundation

Các task setup, khởi tạo DTO, enum, permission seed. Không thuộc user story cụ thể.

- [ ] T001 [P] Thêm `participant_removed` vào `MeetingEventType` enum trong `src/modules/meetings/entities/meeting-event.entity.ts`
- [ ] T002 [P] Thêm `meeting_participant_removed` vào `NotificationType` enum trong `src/modules/notifications/entities/notification.entity.ts`
- [ ] T003 [P] Tạo `RemoveParticipantParamsDto` trong `src/modules/meetings/dto/remove-participant-params.dto.ts` với `meetingId` (IsUUID) và `participantUserId` (IsUUID)
- [ ] T004 [P] Tạo `RemoveParticipantBodyDto` trong `src/modules/meetings/dto/remove-participant-body.dto.ts` với:
  - `reason` (IsOptional, IsString, MaxLength(1000))
  - `scope` (IsOptional, IsEnum, mặc định `instance`) — để xác định instance-only vs series-wide; nếu `scope = 'series'` → rejected
- [ ] T005 [P] Tạo `RemoveParticipantResponseDto` trong `src/modules/meetings/dto/remove-participant-response.dto.ts` gồm `meetingId`, `removedParticipantUserId`, `removed`, `removedAt`, `notificationQueued`, `notificationId`, `backgroundJobId`
- [ ] T006 [P] Thêm permission seed `meeting.participant.remove` vào seed script nếu chưa có (kiểm tra trong `src/database/seeds/`)
- [ ] T007 [P] Tạo `RemoveScope` enum trong `src/modules/meetings/types/remove-scope.type.ts` với values `instance` và `series`

## Phase 2: Service Layer — Core Business Logic (US-01 + US-02)

Xây dựng method `removeParticipant()` trong MeetingsService. Host/Organizer/Admin remove internal participant.

### Step 1: Meeting existence check (gate cho mọi check sau)

- [ ] T008 [US1] Viết validation check đầu tiên: tìm meeting theo `meetingId`. Nếu không tồn tại → throw `NotFoundException` với code `MEETING_NOT_FOUND`. Các check T009→T012 chỉ chạy sau khi T008 pass.

### Step 2: Conditional checks (chạy sau T008, dependency chain)

- [ ] T009 [US1] Viết validation check: kiểm tra `meeting.status === 'scheduled'`, nếu không → throw `ConflictException` với code `MEETING_NOT_REMOVABLE`. (Chạy sau T008)
- [ ] T010 [US1] [US2] Viết authorization + permission check hợp nhất:
  - Requester là Host (`meetings.host_id`) hoặc Organizer (`meetings.organizer_id`) → allowed
  - Requester có permission `meeting.participant.remove` (Admin) → allowed
  - Requester là participant thường → 403 FORBIDDEN
  - (Logic này đã gộp T022 cũ: Admin permission check là một nhánh trong cùng method, không tách riêng)
  (Chạy sau T008)
- [ ] T011 [P] [US1] Viết validation check: tìm participant trong `meeting_participants`, nếu không tồn tại → throw `NotFoundException` với code `PARTICIPANT_NOT_IN_MEETING`. (Có thể chạy song song với T009/T010/T012)
- [ ] T012 [US1] Viết validation check: kiểm tra target không phải Host/Organizer, nếu phải → throw `ConflictException` với code `CANNOT_REMOVE_HOST_OR_ORGANIZER` (kể cả Admin). (Chạy sau T008)
- [ ] T013 [P] [US1] Viết validation check: kiểm tra target không là `owner_id` trong `meeting_agendas`, nếu có → throw `ConflictException` với code `PARTICIPANT_OWNS_AGENDA_ITEMS` kèm `agendaItemIds` trong error details. (Có thể chạy song song)

### Step 3: Recurring scope check (chạy sau T008)

- [ ] T014 [US1] Viết recurring scope check:
  - Đọc `meeting_recurrence_rules` để xác định meeting có thuộc recurring series không
  - Nếu request body có `scope = 'series'` → throw `UnprocessableEntityException` với code `RECURRING_SERIES_SCOPE_NOT_SUPPORTED` (FR-020)
  - Nếu `scope = 'instance'` hoặc không gửi scope → apply instance-only (FR-019, mặc định)
  - (Chạy sau T008, cần thông tin meeting đã load)

### Step 4: Transaction

- [ ] T015 [US1] Implement database transaction block (dùng `DataSource.transaction()`) bao gồm:
  - DELETE `meeting_participants` WHERE `meeting_id` = :mid AND `user_id` = :uid
  - INSERT INTO `meeting_events` (event_type = 'participant_removed', metadata = { removedUserId, removedByUserId, reason? })
  - INSERT INTO `audit_logs` (action = 'remove_participant', actor_id, target_id, target_type = 'meeting', details)
  - INSERT INTO `notifications` (notification_type = 'meeting_participant_removed', recipient_id, title, body)
  - INSERT INTO `background_jobs` (job_type = 'send_email', status = 'pending', payload)
- [ ] T016 [US1] Implement transaction error handling: nếu bất kỳ INSERT nào thất bại → rollback toàn bộ; nếu audit thất bại → best-effort (ghi warning log, không rollback)
- [ ] T017 [US1] Implement idempotency: nếu participant không còn trong `meeting_participants` (đã bị gỡ trước đó) → throw `NotFoundException` với code `PARTICIPANT_NOT_IN_MEETING`
- [ ] T018 [US1] Implement success response: build `RemoveParticipantResponseDto` với `removed = true`, `removedAt` (current timestamp), `notificationId`, `backgroundJobId` từ transaction kết quả
- [ ] T019 [US1] Implement optional reason handling: nếu `reason` được cung cấp, lưu vào metadata của `meeting_events` và `audit_logs`

## Phase 3: Controller & Routing (US-01 + US-02)

Gắn endpoint vào controller, tích hợp guard và permission check.

- [ ] T020 [P] [US1] Thêm endpoint `DELETE /api/v1/meetings/:meetingId/participants/:participantUserId` vào `src/modules/meetings/controllers/meetings.controller.ts`. Decorators:
  - `@Delete(':meetingId/participants/:participantUserId')`
  - `@UseGuards(JwtAuthGuard)`
  - `@HttpCode(HttpStatus.OK)` (200)
- [ ] T021 [US1] Gắn `@CurrentUser()` decorator để lấy requester ID, gọi `removeParticipant()` từ service
- [ ] T022 [US1] Gắn `ValidationPipe` cho path params (`RemoveParticipantParamsDto`) và body (`RemoveParticipantBodyDto`)

## Phase 4: Unit Tests (US-01 + US-02 + US-03)

### Service tests

- [ ] T023 [P] [US1] Viết test: `removeParticipant` happy path — Host removes attendee → 200, verify DELETE meeting_participants + INSERT vào 4 bảng còn lại
- [ ] T024 [P] [US1] Viết test: `removeParticipant` meeting not found → 404 MEETING_NOT_FOUND
- [ ] T025 [P] [US1] Viết test: `removeParticipant` meeting not scheduled → 409 MEETING_NOT_REMOVABLE (test cả in_progress, completed, cancelled)
- [ ] T026 [P] [US1] Viết test: `removeParticipant` no permission → 403 FORBIDDEN (participant thường)
- [ ] T027 [P] [US1] Viết test: `removeParticipant` participant not in meeting → 404 PARTICIPANT_NOT_IN_MEETING
- [ ] T028 [P] [US1] Viết test: `removeParticipant` target is Host → 409 CANNOT_REMOVE_HOST_OR_ORGANIZER
- [ ] T029 [P] [US1] Viết test: `removeParticipant` target is Organizer → 409 CANNOT_REMOVE_HOST_OR_ORGANIZER
- [ ] T030 [P] [US1] Viết test: `removeParticipant` Admin targets Host/Organizer → 409 CANNOT_REMOVE_HOST_OR_ORGANIZER
- [ ] T031 [P] [US1] Viết test: `removeParticipant` target owns agenda items → 409 PARTICIPANT_OWNS_AGENDA_ITEMS kèm agendaItemIds trong error details
- [ ] T032 [P] [US1] Viết test: `removeParticipant` body scope = 'series' → 422 RECURRING_SERIES_SCOPE_NOT_SUPPORTED
- [ ] T033 [P] [US1] Viết test: `removeParticipant` body scope = 'instance' — hợp lệ, không reject
- [ ] T034 [P] [US1] Viết test: `removeParticipant` transaction rollback → giả lập fail, verify participant không bị remove, không có event/notification/job
- [ ] T035 [P] [US1] Viết test: `removeParticipant` duplicate remove → 1st success, 2nd → 404 PARTICIPANT_NOT_IN_MEETING
- [ ] T036 [P] [US1] Viết test: `removeParticipant` with reason → reason trong event metadata và audit details
- [ ] T037 [P] [US1] Viết test: `removeParticipant` without reason → metadata không có reason field
- [ ] T038 [P] [US1] Viết test: `removeParticipant` reason > 1000 characters → 400 VALIDATION_ERROR
- [ ] T039 [P] [US3] Viết test: verify notification record created với notification_type = 'meeting_participant_removed'
- [ ] T040 [P] [US3] Viết test: verify background_job record created với job_type = 'send_email'
- [ ] T041 [P] [US3] Viết test: verify audit_log record created với action = 'remove_participant'
- [ ] T042 [P] [US1] Viết test: controller response format — check success/error/data structure đúng convention

### Cross-cutting test

- [ ] T043 [P] [US1] Viết test: verify không có `.ics` file được tạo ra trong quá trình remove (assert không gọi ICS generation service)

## Phase 5: Integration & Documentation

- [ ] T044 [P] Kiểm tra module imports: đảm bảo `MeetingsModule` import đầy đủ các dependency (DataSource, NotificationModule, BackgroundJobModule nếu cần)
- [ ] T045 [P] Cập nhật API documentation / Postman collection nếu có

---

## Dependencies

```
Phase 1 (T001-T007) ──┬──→ Phase 2 ──→ Phase 3 ──→ Phase 4 ──→ Phase 5
                       │
                       └──→ T008 (gate) ──┬──→ T009 (status check)
                                          ├──→ T010 (auth check)
                                          ├──→ T012 (Host/Organizer protection)
                                          ├──→ T014 (recurring scope)
                                          │
                                          ├──→ T011 (parallel — participant lookup)
                                          └──→ T013 (parallel — agenda check)
```

Trong Phase 1: T001→T007 chạy song song [P]
Trong Phase 2 Step 2: T009, T010, T012, T014 phụ thuộc T008 (sequential). T011, T013 có thể chạy song song.
Trong Phase 4: tất cả test chạy song song [P]

## Requirements Coverage

### Functional Requirements

| Task | FR |
|---|---|
| T008 | FR-009 (meeting not found) |
| T009 | FR-011, FR-012 (state validation) |
| T010 | FR-003, FR-004, BR-01 (authorization + permission) |
| T011 | FR-010, FR-012 (participant in meeting) |
| T012 | FR-005 (cannot remove Host/Organizer) |
| T013 | FR-022, FR-023 (agenda owner validation) |
| T014 | FR-019, FR-020 (recurring scope) |
| T015 | FR-013, FR-014, FR-015, FR-016, FR-017, FR-024 (transaction + entities) |
| T016 | FR-022, FR-025 (rollback on failure) |
| T017 | FR-023 (idempotent remove) |
| T018 | FR-026, FR-027 (response contract) |
| T019 | FR-018 (optional reason) |
| T020-T022 | FR-001, FR-002 (auth + routing) |
| T006 | FR-003 (permission setup) |
| T004 | FR-020 (scope parameter) |
| T043 | FR-021 (no .ics generation) |

### Acceptance Criteria

| Task | AC |
|---|---|
| T023 | AC-01 (happy path) |
| T024 | AC-07 variant (meeting not found) |
| T025 | AC-06 (state validation) |
| T026 | AC-05 (no permission) |
| T027 | AC-07 (participant not in meeting) |
| T028-T029 | AC-04 (cannot remove Host/Organizer) |
| T030 | AC-PERM-ADMIN-001 (Admin + Host/Organizer) |
| T031 | AC-AGENDA-001 (agenda owner) |
| T032 | AC-REC-002 (series-wide) |
| T033 | AC-REC-001 (instance-only) |
| T034 | AC-12 (rollback on fail) |
| T035 | AC-11 (duplicate remove) |
| T036-T037 | AC-01 variant (with/without reason) |
| T038 | AC-08 variant (reason max length) |
| T039 | AC-09 (notification created) |
| T040 | AC-09 (background job created) |
| T041 | AC-10 (audit log created) |
| T042 | AC-01 (response format) |
| T043 | AC-ICS-001 (no .ics generation) |




