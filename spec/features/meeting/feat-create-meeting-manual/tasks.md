# 📝 CHANGELOG & REVISION HISTORY
| Ngày cập nhật | Tóm tắt thay đổi | Các dòng thay đổi |
| :--- | :--- | :--- |
| 2026-06-08 | Tạo tasks lần đầu | Toàn bộ file |
| 2026-06-08 | Consistency fixes: thêm [P] marker cho T014, T015; thêm T015b+T015c (participant conflict); thêm T017b+T017c+T017d (GET rooms/available) | T014, T015, T015b, T015c, T017, T017b, T017c, T017d |
| 2026-06-08 | Mark T015c, T017d, T021-T031 as completed — all 36 meeting module tests pass | T015c, T017d, T021-T031 |

# Tasks: Tạo cuộc họp mới thủ công (MEETING-CREATE-MANUAL-001)

**Input**: Design documents from `spec/features/meeting/feat-create-meeting-manual/`
**Prerequisites**: spec.md, plan.md, research.md, data-model.md, contracts/create-meeting-api.md, quickstart.md

## Format: `[ID] [P?] [Story] Description`

- **[P]**: Can run in parallel (different files, no dependencies)
- **[Story]**: Which user story this task belongs to (US1 = create meeting manually)
- Include exact file paths in descriptions

## Path Conventions

- **Backend**: `src/modules/meetings/` (controller, service, DTOs)
- **Tests**: `src/modules/meetings/` (co-located with source)
- **Existing entities**: `src/modules/meetings/entities/`, `src/modules/rooms/entities/`, `src/modules/notifications/entities/`, `src/modules/administration/entities/`
- **Existing guards/decorators**: `src/modules/auth/guards/`, `src/modules/auth/decorators/`

---

## Phase 1: Setup — Kiểm tra & chuẩn bị hạ tầng

**Purpose**: Xác nhận các module, entities, guards, decorators đã tồn tại và có thể import được. Không tạo mới — chỉ verify.

- [x] T001 [P] Verify `MeetingEntity`, `MeetingRequestEntity`, `MeetingParticipantEntity`, `MeetingExternalParticipantEntity`, `MeetingEventEntity` đã được định nghĩa đúng với field mapping trong `data-model.md` tại `src/modules/meetings/entities/`
- [x] T002 [P] Verify `RoomEntity`, `RoomBookingEntity` đã có room status enum và booking status enum (pending/approved/active) tại `src/modules/rooms/entities/`
- [x] T003 [P] Verify `NotificationEntity` có field `recipientUserIdsJson` (jsonb), `deliveryStatus` enum (queued/sent/failed) tại `src/modules/notifications/entities/`
- [x] T004 [P] Verify `AuditLogEntity` có field `entityType`, `entityId`, `metadata` (jsonb) tại `src/modules/administration/entities/`
- [x] T005 [P] Verify `JwtAuthGuard`, `PermissionsGuard`, `@RequirePermissions()` decorator có sẵn tại `src/modules/auth/guards/` và `src/modules/auth/decorators/`
- [x] T006 [P] Verify `meetings.module.ts` đã import `AccountsModule` và `TypeOrmModule.forFeature([...meeting entities])` tại `src/modules/meetings/meetings.module.ts`

**Checkpoint**: Tất cả infrastructure cần thiết đã available, có thể bắt đầu implement.

---

## Phase 2: Foundational — Prerequisites bắt buộc

**Purpose**: Tạo custom validators, cập nhật module imports để các module khác (rooms, notifications, administration) có thể dùng được trong meetings module.

- [x] T007 [P] Create custom validator `IsFutureDate` tại `src/modules/meetings/validators/is-future-date.validator.ts` — kiểm tra `start_time > now`
- [x] T008 [P] Create custom validator `IsAfterStartTime` tại `src/modules/meetings/validators/is-after-start-time.validator.ts` — kiểm tra `end_time > start_time` (class-level validator)
- [x] T009 Update `meetings.module.ts` tại `src/modules/meetings/meetings.module.ts` — thêm imports: `RoomsModule`, `NotificationsModule`, `AdministrationModule` (hoặc `TypeOrmModule.forFeature([RoomBookingEntity, NotificationEntity, AuditLogEntity])`), và đăng ký `MeetingsController`, `MeetingsService`, custom validators vào providers

**Checkpoint**: Module đã sẵn sàng nhận controller/service. Custom validators có thể dùng trong DTO.

---

## Phase 3: User Story 1 — Tạo cuộc họp mới thủ công (Core Feature) 🎯 MVP

**Goal**: Cho phép Internal Employee/Manager gửi POST /api/v1/meetings để tạo yêu cầu cuộc họp mới ở trạng thái pending_approval, kèm booking pending, participant records, notification record và audit log — tất cả trong một transaction.

**Independent Test**: Gửi POST /api/v1/meetings với JWT hợp lệ + `meeting.create` permission → nhận 201 + kiểm tra DB có đủ: meeting (pending_approval), meeting_request (pending), room_booking (pending), participant records, notification (queued), audit_log.

### 3.1 DTO & Validation Layer

- [x] T010 [P] [US1] Create `CreateMeetingDto` tại `src/modules/meetings/dto/create-meeting.dto.ts` — gồm tất cả fields từ spec Section 5.2 (title, description, host_id optional, start_time, end_time, room_id, meeting_type, meeting_mode, expected_attendee_count, capacity_override_confirmed, participant_user_ids, external_participants) với class-validator decorators đầy đủ
- [x] T011 [P] [US1] Create `ExternalParticipantDto` tại `src/modules/meetings/dto/external-participant.dto.ts` — gồm full_name, email (validated), organization (optional)
- [x] T012 [P] [US1] Create `CreateMeetingResponseDto` tại `src/modules/meetings/dto/create-meeting-response.dto.ts` — gồm id, meeting_code, title, status, approval_status, start_time, end_time, room_id, room_name, organizer_id, host_id, participant_count, booking_status, booking_code, created_at

### 3.2 Service Layer — Business Logic

- [x] T013 [US1] Implement method `MeetingsService.getRoomAvailability(roomId, startTime, endTime)` tại `src/modules/meetings/services/meetings.service.ts` — query room_bookings với status IN ('pending','approved','active') và overlap condition, trả về boolean + conflicting booking id
- [x] T014 [P] [US1] Implement method `MeetingsService.generateMeetingCode()` tại `src/modules/meetings/services/meetings.service.ts` — đếm số meeting trong ngày, format `MT-YYYYMMDD-NNN`
- [x] T015 [P] [US1] Implement method `MeetingsService.generateBookingCode()` tại `src/modules/meetings/services/meetings.service.ts` — đếm số booking trong ngày, format `BK-YYYYMMDD-NNN`
- [x] T015b [PH2] [US1] Implement method `MeetingsService.checkParticipantConflicts(userIds, startTime, endTime)` tại `src/modules/meetings/services/meetings.service.ts` — query meetings + meeting_participants với time overlap (ngoại trừ cancelled), trả về map userId → conflicting meeting info; support cả internal (user_id) và external (email) participants; gọi ở cuối T016 và lưu warning vào `meeting_requests.conflict_summary_json`
- [x] T015c [PH2] [US1] Write unit test cho `MeetingsService.checkParticipantConflicts()` — test happy path (no conflict), test single conflict, test multiple conflicts, test exclude cancelled meetings, test external participants
- [x] T016 [US1] Implement core method `MeetingsService.create(dto, authUser, ipAddress, userAgent)` tại `src/modules/meetings/services/meetings.service.ts` — bao gồm:
  - Resolve host_id (default = authUser.id)
  - Validate room tồn tại + active
  - Validate host user nếu khác authUser
  - Validate participant_user_ids tồn tại
  - Check room conflict via getRoomAvailability → throw 409 nếu conflict
  - Check capacity (nếu enabled): so sánh total participants vs room.capacity; nếu vượt quá và không có `capacity_override_confirmed=true` → throw 422; nếu có override → ghi chú cho audit
  - Generate meeting_code và booking_code
  - **DB Transaction** dùng `DataSource.transaction()`: tạo meeting → meeting_request → room_booking → meeting_participants (host + internal) → meeting_external_participants → meeting_event → notification → audit_log
  - Sau commit: return success response

### 3.3 Controller Layer — API Endpoint

- [x] T017 [US1] Create `MeetingsController` tại `src/modules/meetings/controllers/meetings.controller.ts` — endpoint `POST /api/v1/meetings` với `@UseGuards(JwtAuthGuard, PermissionsGuard)` + `@RequirePermissions('meeting.create')`, inject `MeetingsService`, nhận `CreateMeetingDto + Request` (user, ip, user-agent), gọi service.create(), trả về 201 + CreateMeetingResponseDto
- [x] T017b [PH2] [US1] Implement method `MeetingsService.getAvailableRooms(startTime, endTime, capacity?)` tại `src/modules/meetings/services/meetings.service.ts` — query rooms active + đủ capacity, loại trừ rooms có booking conflict (status pending/approved/active), trả về list rooms; hỗ trợ filter optional capacity tối thiểu
- [x] T017c [PH2] [US1] Implement endpoint `GET /api/v1/rooms/available?startTime=&endTime=&minCapacity=` tại `MeetingsController` — query params validated, gọi getAvailableRooms, trả về list rooms; guard: JwtAuthGuard (any authenticated user)
- [x] T017d [PH2] [US1] Write unit test cho `MeetingsService.getAvailableRooms()` — test no conflict, test with conflict, test capacity filter, test inactive rooms excluded
- [x] T018 [US1] Implement error handling trong controller/service: map tất cả exceptions từ plan Section 10 (400/401/403/404/409/422/500) với error codes tương ứng, response format theo API contract

### 3.4 Integration — Cross-module wiring

- [x] T019 [US1] Wire up `NotificationsModule` hoặc trực tiếp dùng `TypeOrmModule.forFeature([NotificationEntity])` trong `meetings.module.ts` để service có thể tạo notification record
- [x] T020 [US1] Wire up `AdministrationModule` hoặc trực tiếp dùng `TypeOrmModule.forFeature([AuditLogEntity])` trong `meetings.module.ts` để service có thể tạo audit log

**Checkpoint**: User Story 1 hoàn chỉnh — POST /api/v1/meetings hoạt động đúng spec.

---

## Phase 4: Testing

**Purpose**: Kiểm tra tính đúng đắn của business logic, validation, authorization, và error handling.

- [x] T021 [P] [US1] Write unit test cho `MeetingsService.create()` — success flow: verify tất cả records được tạo trong transaction, đúng status (pending_approval, pending)
- [x] T022 [P] [US1] Write unit test cho room conflict: verify throw 409 khi room đã có booking overlap
- [x] T023 [P] [US1] Write unit test cho capacity exceeded: verify throw 422 khi participant_count > capacity (không override)
- [x] T024 [P] [US1] Write unit test cho capacity override: verify 201 + audit log có ghi nhận override
- [x] T025 [P] [US1] Write unit test cho room not found: verify throw 404
- [x] T026 [P] [US1] Write unit test cho host default + auto-add: verify host = authUser khi không gửi host_id, host auto-added vào participants
- [x] T027 [P] [US1] Write unit test cho code generation: verify meeting_code và booking_code đúng format
- [x] T028 [P] [US1] Write unit test cho notification + audit log: verify notification record có delivery_status='queued', audit log có entity_type='meeting_request' + metadata đúng
- [x] T029 [P] [US1] Write unit test cho transaction rollback: mock lỗi sau khi insert meeting → verify không có record nào được tạo
- [x] T030 [P] [US1] Write unit test cho `MeetingsController.create()` — verify gọi service đúng params, trả về 201
- [x] T031 [P] [US1] Write unit test cho validation: verify từng field trong CreateMeetingDto bị từ chối khi sai (title trống, end_time < start_time, start_time quá khứ, email sai format)
- [ ] T032 [P] [US1] Write unit test cho authorization: verify endpoint bị chặn khi không có JWT (401) hoặc thiếu permission (403)
- [ ] T033 [P] [US1] Write integration test cho full success flow: gọi POST /api/v1/meetings → verify 201 + verify DB records

**Checkpoint**: Tất cả test cases pass. Feature sẵn sàng cho review.

---

## Phase 5: Polish & Cross-Cutting

**Purpose**: Documentation, cleanup, validation.

- [ ] T034 [P] Run `npm run lint` và fix tất cả lint errors
- [ ] T035 [P] Run `npm run build` và verify build không lỗi
- [ ] T036 [P] Run `quickstart.md` verification notes: kiểm tra từng item (entity mapping, transaction, auth, validation, code gen, overlap check, host auto-add, notification record, audit log, capacity override)
- [ ] T037 [P] Update CHANGELOG hoặc documentation nếu có thay đổi về API schema

**Checkpoint**: Feature hoàn chỉnh, clean build, tất cả test pass.

---

## Dependencies & Execution Order

### Phase Dependencies

| Phase | Depends On | Description |
|-------|-----------|-------------|
| Phase 1 (Setup) | None | Can start immediately |
| Phase 2 (Foundational) | Phase 1 | Module imports, validators |
| Phase 3 (US1) | Phase 1, Phase 2 | Core feature |
| Phase 4 (Tests) | Phase 3 | Tests depend on implementation |
| Phase 5 (Polish) | Phase 3, Phase 4 | Final validation |

### Task Dependencies

| Task | Depends On | Notes |
|------|-----------|-------|
| T001-T006 | None | Parallel setup checks |
| T007-T008 | Phase 1 | Parallel custom validators |
| T009 | T007, T008, Phase 1 | Module wiring |
| T010-T012 | T009 | Parallel DTOs |
| T013-T016 | T010-T012 | Service methods (sequential: T014 depends on T013 patterns, T016 depends on all) |
| T017-T018 | T013-T016 | Controller |
| T019-T020 | T009 | Parallel module wiring |
| T021-T033 | Phase 3 | All parallel tests |
| T034-T037 | Phase 4 | Parallel polish tasks |

### Parallel Opportunities

- **Phase 1**: T001-T006 chạy song song (verify entities độc lập)
- **Phase 2**: T007, T008 chạy song song (custom validators độc lập)
- **Phase 3 DTOs**: T010, T011, T012 chạy song song (DTOs không phụ thuộc nhau)
- **Phase 3 Module wiring**: T019, T020 chạy song song
- **Phase 4**: T021-T033 tất cả đều chạy song song (unit tests độc lập)
- **Phase 5**: T034-T037 chạy song song

### Execution Order (Sequential)

```
T001-T006 → T007-T008 + T009 → T010-T012 → T013-T016 → T017-T020 → T021-T033 → T034-T037
```

### Implementation Strategy (MVP)

1. **Complete Phase 1**: Verify infrastructure ✅
2. **Complete Phase 2**: Module imports + validators ready
3. **Complete Phase 3 (US1)**: Full feature implementation
4. **STOP and VALIDATE**: Test POST /api/v1/meetings manually
5. **Complete Phase 4**: Run all tests
6. **Complete Phase 5**: Lint + build + validate quickstart

---

## Requirements Coverage

### Mapping: Task → Functional Requirements

| Task | FRs Covered | ACs Covered |
|------|-------------|-------------|
| T007 (IsFutureDate) | FR-019 | AC-004 |
| T008 (IsAfterStartTime) | FR-018 | AC-003 |
| T010 (CreateMeetingDto) | FR-023, ERR-001-005 | AC-002, AC-003, AC-004 |
| T012 (ResponseDto) | FR-026 | AC-001 |
| T013 (getRoomAvailability) | FR-006, FR-012, FR-017 | AC-007 |
| T014 (generateMeetingCode) | FR-041 | — |
| T015 (generateBookingCode) | FR-042 | — |
| T016 (service.create) | FR-001 đến FR-005, FR-008-011, FR-014, FR-020, FR-025, FR-029-037, FR-040, FR-DATA-001 đến FR-DATA-007 | AC-001, AC-005-012 |
| T017 (controller) | FR-024, FR-026, FR-027, FR-028, FR-029 | AC-005, AC-006 |
| T018 (error handling) | FR-017-023, FR-033, FR-036, ERR-001-013 | AC-002-008 |
| T019 (notification wiring) | FR-009, FR-015, FR-016, FR-034 | AC-012 |
| T020 (audit wiring) | FR-035 | AC-011 |
| T021-T033 (tests) | NFR-017 | All ACs |

### Total Tasks: 37
- Phase 1: 6 tasks (T001-T006)
- Phase 2: 3 tasks (T007-T009)
- Phase 3 (US1): 11 tasks (T010-T020)
- Phase 4: 13 tasks (T021-T033)
- Phase 5: 4 tasks (T034-T037)

### Parallel Tasks: 26 out of 37 (70%)
