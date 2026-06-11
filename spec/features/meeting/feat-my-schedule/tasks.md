# Tasks: UC-MM-05 Tra cứu lịch trình cá nhân (My Schedule)
> **2026-06-11**: Trien khai code toan bo Phase 1-6 (seed, DTOs, service, controller, tests)

**Input**: Design documents from `spec/features/meeting/feat-my-schedule/`
**Prerequisites**: plan.md ✅, spec.md ✅, research.md ✅, data-model.md ✅, contracts/ ✅, quickstart.md ✅

**Organization**: Tasks are grouped by implementation phase. Feature này có 2 logic units:
- **US1**: `GET /api/v1/me/schedule` — schedule list với filters, overlap, effectiveUserRole
- **US2**: `GET /api/v1/me/schedule/{meetingId}` — popup detail

---

## Phase 1: Setup & Foundational

**Purpose**: Seed permission, verify entity registration, implement foundational utilities

- [x] T001 Create seed migration `20260609000002-seed-schedule-read-self.ts` in `src/database/seeds/`: insert `schedule.read.self` into `permissions` table, assign to admin/manager/employee roles via `role_permissions`
- [x] T002 [P] Verify and add missing entity imports in `MeetingsModule`: ensure `MediaFileEntity`, `RecordingConfigEntity`, `UserEntity` are registered in `TypeOrmModule.forFeature([...])` of `src/modules/meetings/meetings.module.ts`
- [x] T003 [P] Create custom `IsIanaTimezone` validator in `src/modules/meetings/validators/is-iana-timezone.validator.ts` using `Intl.supportedValuesOf('timeZone')` or a helper function

**Checkpoint**: Permission seeded, entities importable, timezone validator ready

---

## Phase 2: DTOs & Validation

**Purpose**: Create all DTO classes with class-validator decorators

- [x] T004 [P] [US1] Create `MyScheduleQueryDto` in `src/modules/meetings/dto/my-schedule-query.dto.ts` with fields:
  - `view`: `@IsEnum(['day', 'week', 'month'])` required
  - `from`: `@IsDateString({ strict: true })` required — add `@Transform(({ value }) => new Date(value).toISOString())` for ISO normalization
  - `to`: `@IsDateString({ strict: true })` required — add `@Transform(({ value }) => new Date(value).toISOString())` for ISO normalization
  - `timezone`: `@IsOptional()` + custom `@Validate(IsIanaTimezoneConstraint)` default `'Asia/Ho_Chi_Minh'`
  - `status`: `@IsOptional()` + `@IsEnum(['scheduled', 'in_progress', 'cancelled', 'completed'], { each: true })` + `@Transform(({ value }) => value ? value.split(',') : undefined)` — comma-separated string parsed to array
  - `role`: `@IsOptional()` + `@IsEnum(['organizer', 'host', 'attendee'])`
  - `roomId`: `@IsOptional()` + `@IsUUID('4')`
  - `q`: `@IsOptional()` + `@MaxLength(200)` — trim whitespace in service
- [x] T005 [P] [US1] Create `ScheduleResponseDto` in `src/modules/meetings/dto/schedule-response.dto.ts` with fields: `items: ScheduleEventDto[]`, `range: ScheduleRangeDto`, `empty: boolean`
- [x] T006 [P] [US1] Create `ScheduleEventDto` in `src/modules/meetings/dto/schedule-event.dto.ts` with: `meetingId`, `meetingCode`, `title`, `startTime`, `endTime`, `timezone`, `status`, `userRole`, `room` (nested `ScheduleRoomDto`), `colorKey`, `isCurrent`, `isPast`
- [x] T007 [P] [US1] Create `ScheduleRoomDto` in `src/modules/meetings/dto/schedule-room.dto.ts` with: `id`, `roomName`, `roomCode`, `location`
- [x] T008 [P] [US1] Create `ScheduleRangeDto` in `src/modules/meetings/dto/schedule-range.dto.ts` with: `view`, `from`, `to`, `timezone`
- [x] T009 [P] [US2] Create `MyScheduleDetailDto` in `src/modules/meetings/dto/my-schedule-detail.dto.ts` with nested objects for: `meeting`, `room`, `organizer`, `host`, `participants[]`, `externalParticipants[]`, `agendas[]`, `attachments[]`, `recordingConfig`, `userRole`
- [x] T010 [P] [US2] Create nested detail sub-DTOs: `DetailMeetingDto`, `DetailRoomDto`, `DetailUserDto`, `DetailParticipantDto`, `DetailExternalParticipantDto`, `DetailAgendaDto`, `DetailAttachmentDto`, `DetailRecordingConfigDto` in `src/modules/meetings/dto/`

**Checkpoint**: All DTOs defined with validators — ready for service implementation

---

## Phase 3: Service Layer — US1 (Schedule List)

**Goal**: Implement `getMySchedule()` with full query logic

**Independent Test**: Call `GET /api/v1/me/schedule?view=week&from=2026-06-08T00:00:00%2B07:00&to=2026-06-15T00:00:00%2B07:00` → expect 200 with items array

- [x] T010 [US1] Implement `getMySchedule(userId: string, query: MyScheduleQueryDto)` method in `src/modules/meetings/services/meetings.service.ts`:
  - Validate date range (from < to, within view limits) — throw `UnprocessableEntityException` with `INVALID_DATE_RANGE` or `DATE_RANGE_TOO_WIDE`
  - Validate from/to format (strict ISO-8601 with offset) — throw `BadRequestException` with `INVALID_DATETIME_FORMAT`
  - Build TypeORM QueryBuilder on `meetings` table:
    ```sql
    SELECT m.id, m.meeting_code, m.title, m.start_time, m.end_time, m.timezone, m.status,
           CASE WHEN m.organizer_id = :userId THEN 'organizer'
                WHEN m.host_id = :userId THEN 'host'
                ELSE 'attendee' END AS effective_user_role,
           r.id AS room_id, r.room_name, r.room_code, r.location_description, r.site_name, r.area_name
    FROM meetings m
    LEFT JOIN meeting_participants mp ON mp.meeting_id = m.id AND mp.user_id = :userId
    LEFT JOIN rooms r ON r.id = m.room_id
    WHERE (m.organizer_id = :userId OR m.host_id = :userId OR mp.id IS NOT NULL)
      AND m.status NOT IN ('draft', 'pending_approval')
      AND m.start_time < :to AND m.end_time > :from
      AND m.deleted_at IS NULL
    ```
  - Add optional filters dynamically:
    - `status`: if provided, add `AND m.status = ANY(:status)`
    - `role`: if provided, add `HAVING effective_user_role = :role`
    - `roomId`: if provided, add `AND m.room_id = :roomId`
    - `q`: if provided and non-empty after trim, add `AND (m.title ILIKE :q OR m.meeting_code ILIKE :q)` with `%wildcard%`
  - Add `GROUP BY m.id, r.id, effective_user_role`
  - Add `ORDER BY m.start_time ASC`
  - Use `getRawMany()` and map to `ScheduleEventDto[]`
  - Compute `isCurrent` (NOW() BETWEEN start_time AND end_time) and `isPast` (end_time < NOW())
  - Set `colorKey` = status value
  - Return `{ items: ScheduleEventDto[], range: ScheduleRangeDto, empty: boolean }`
- [x] T011 [US1] Implement `validateScheduleDateRange()` private helper in service:
  - If `from >= to` → throw 422 `INVALID_DATE_RANGE`
  - If `view=month` and diff > 31 days → throw 422 `DATE_RANGE_TOO_WIDE`
  - If `view=week` and diff > 7 days → throw 422 `DATE_RANGE_TOO_WIDE`
  - If `view=day` and diff > 1 day → throw 422 `DATE_RANGE_TOO_WIDE`
- [x] T012 [US1] Implement `resolveEffectiveUserRole()` private helper in service:
  - Priority: organizer_id = userId → 'organizer' > host_id = userId → 'host' > participant → 'attendee'
  - Used both in query (CASE WHEN) and detail endpoint
- [x] T013 [US1] Implement `normalizeSearchQuery()` private helper:
  - Trim whitespace from `q`
  - If empty after trim → skip filter entirely (return null)
  - Return `%{q}%` for ILIKE matching

**Checkpoint**: `getMySchedule()` functional — can return schedule list with all filters

---

## Phase 4: Service Layer — US2 (Schedule Detail)

**Goal**: Implement `getMyScheduleDetail()` with access check and full related data

**Independent Test**: Call `GET /api/v1/me/schedule/{meetingId}` with valid meetingId where user is participant → expect 200 with full detail

- [x] T014 [US2] Implement `getMyScheduleDetail(userId: string, meetingId: string)` method in `src/modules/meetings/services/meetings.service.ts`:
  - Load meeting with `organizer` and `host` relations via `findOne({ where: { id: meetingId }, relations: ['organizer', 'host'] })`
  - If not found → throw `NotFoundException` with `MEETING_NOT_FOUND`
  - Access check: verify user is organizer (meeting.organizerId === userId) OR host (meeting.hostId === userId) OR participant (query `meeting_participants` table)
  - If not authorized → throw `ForbiddenException` with `FORBIDDEN_NOT_PARTICIPANT`
- [x] T015 [P] [US2] Load room info: query `rooms` table by `meeting.roomId` (if not null)
- [x] T016 [P] [US2] Load participants list: query `meeting_participants` JOIN `users`, sorted by `participant_role`
- [x] T017 [P] [US2] Load external participants: query `meeting_external_participants` by `meeting_id`
- [x] T018 [P] [US2] Load agendas: query `meeting_agendas` by `meeting_id`, ordered by `sort_order ASC`
- [x] T019 [P] [US2] Load attachments: query `media_files` by `reference_type = 'meeting'` AND `reference_id = meetingId`
- [x] T020 [P] [US2] Load recording config: query `recording_configs` by `meeting_id` (limit 1)
- [x] T021 [US2] Assemble all loaded data into `MyScheduleDetailDto` and return it

**Checkpoint**: `getMyScheduleDetail()` functional — can return full meeting detail for authorized users

---

## Phase 5: Controller Layer

**Goal**: Wire up both endpoints with guards, permissions, and validation

- [x] T022 [US1] Add controller method `getMySchedule()` in `src/modules/meetings/controllers/meetings.controller.ts`:
  ```typescript
  @Get('me/schedule')
  @UseGuards(JwtAuthGuard, PermissionsGuard)
  @RequirePermissions('schedule.read.self')
  @UsePipes(new ValidationPipe({ whitelist: true, transform: true, forbidNonWhitelisted: true }))
  async getMySchedule(
    @CurrentUser() user: { userId: string },
    @Query() dto: MyScheduleQueryDto,
  ): Promise<{ success: boolean; message: string; data: ScheduleResponseDto }>
  ```
  - Call `this.meetingsService.getMySchedule(user.userId, dto)`
  - Return `{ success: true, message: 'Lấy lịch thành công', data: result }`
- [x] T023 [US2] Add controller method `getMyScheduleDetail()` in `src/modules/meetings/controllers/meetings.controller.ts`:
  ```typescript
  @Get('me/schedule/:meetingId')
  @UseGuards(JwtAuthGuard, PermissionsGuard)
  @RequirePermissions('schedule.read.self')
  @UsePipes(new ValidationPipe({ whitelist: true, transform: true }))
  async getMyScheduleDetail(
    @CurrentUser() user: { userId: string },
    @Param('meetingId', ParseUUIDPipe) meetingId: string,
  ): Promise<{ success: boolean; message: string; data: MyScheduleDetailDto }>
  ```
  - Call `this.meetingsService.getMyScheduleDetail(user.userId, meetingId)`
  - Return `{ success: true, message: 'Chi tiết cuộc họp', data: result }`

**Checkpoint**: Both endpoints exposed and protected — full feature accessible via HTTP

---

## Phase 6: Tests

**Purpose**: Unit tests for service methods, controller, and DTO validation

### 6.1 Service Tests

- [ ] T024 [P] [US1] Write service test: `getMySchedule()` returns events for valid range — mock `QueryBuilder` with `getRawMany()` returning 3 events; verify response has 3 items with correct fields
- [ ] T025 [P] [US1] Write service test: `getMySchedule()` overlap boundary — meeting starts before `from`, ends after `from`; verify it's included
- [ ] T026 [P] [US1] Write service test: `getMySchedule()` empty range returns empty items with `empty = true`
- [ ] T027 [P] [US1] Write service test: `getMySchedule()` effectiveUserRole — user is both organizer and participant; verify one event with `userRole = 'organizer'`
- [ ] T028 [P] [US1] Write service test: `getMySchedule()` role filter — user is organizer, filter `role=attendee`; verify meeting excluded
- [ ] T029 [P] [US1] Write service test: `getMySchedule()` q search on meeting_code — `q='001'` matches `meeting_code = 'MTG-2026-001'`
- [ ] T030 [P] [US1] Write service test: `getMySchedule()` q whitespace-only — `q='   '` ignored, all results returned
- [ ] T031 [P] [US1] Write service test: `getMySchedule()` invalid date range — `from >= to` throws 422 `INVALID_DATE_RANGE`
- [ ] T032 [P] [US1] Write service test: `getMySchedule()` range too wide — 60 days for month view throws 422 `DATE_RANGE_TOO_WIDE`
- [ ] T033 [P] [US1] Write service test: `getMySchedule()` cancelled meeting still appears with `status = 'cancelled'`
- [ ] T034 [P] [US1] Write service test: `getMySchedule()` filter by status — only returns meetings matching given status
- [ ] T035 [P] [US1] Write service test: `getMySchedule()` sort by start_time ASC — verify order
- [ ] T036 [P] [US2] Write service test: `getMyScheduleDetail()` returns full detail for participant
- [ ] T037 [P] [US2] Write service test: `getMyScheduleDetail()` non-participant throws 403 `FORBIDDEN_NOT_PARTICIPANT`
- [ ] T038 [P] [US2] Write service test: `getMyScheduleDetail()` meeting not found throws 404 `MEETING_NOT_FOUND`

### 6.2 Controller Tests

- [ ] T039 [P] [US1] Write controller test: `getMySchedule()` returns 200 with correct response structure
- [ ] T040 [P] [US1] Write controller test: `getMySchedule()` 400 on invalid view param
- [ ] T041 [P] [US2] Write controller test: `getMyScheduleDetail()` 403 for non-participant
- [ ] T042 [P] [US2] Write controller test: `getMyScheduleDetail()` 404 for non-existent meeting

### 6.3 DTO Validation Tests

- [ ] T043 [P] [US1] Write DTO test: `MyScheduleQueryDto` — valid params pass; missing `from` fails; `view=year` fails; `roomId=abc` fails; `q` > 200 chars fails; `timezone=ABC` fails

**Checkpoint**: All acceptance criteria covered by automated tests

---

## Phase 7: Build & Final Review

**Purpose**: Ensure compilation, lint, and all tests pass before delivery

- [ ] T044 Run `npm run build` — verify zero compilation errors
- [ ] T045 Run `npm run lint` — verify no lint errors in changed files
- [ ] T046 Run `npm run test -- --testPathPattern=meetings` — verify all 20+ tests pass
- [ ] T047 Run quickstart.md smoke test scenarios manually — verify happy path + error cases

---

## Requirements Coverage

### Acceptance Criteria → Task Mapping

| AC | Description | Task(s) |
|---|---|---|
| AC-001 | 3 events, week view | T010, T024 |
| AC-002 | Popup detail | T014-T021, T036 |
| AC-003 | Empty state | T010, T026 |
| AC-004 | Missing from → 400 | T010, T040, T043 |
| AC-005 | Date range reversed → 422 | T011, T031 |
| AC-006 | Range too wide → 422 | T011, T032 |
| AC-007 | No token → 401 | T022-T023 (guard) |
| AC-008 | Non-participant → 403 | T014, T037, T041 |
| AC-009 | Meeting not found → 404 | T014, T038, T042 |
| AC-010 | Role priority, no duplicate | T010, T012, T027 |
| AC-011 | Cancelled still shown | T010, T033 |
| AC-012 | Filter by status | T010, T034 |
| AC-013 | Overlap boundary | T010, T025 |
| AC-014 | effectiveUserRole filter | T010, T012, T028 |
| AC-015 | Missing offset → 400 | T010, T043 |
| AC-016 | q search meeting_code | T010, T013, T029 |

### FR → Task Mapping

| FR | Description | Task(s) |
|---|---|---|
| FR-001 | Self-scope data isolation | T010 |
| FR-002 | effectiveUserRole priority | T010, T012 |
| FR-003 | Status filter (scheduled/in_progress/cancelled/completed) | T010 |
| FR-004 | Sort by start_time ASC | T010 |
| FR-005 | Overlap query [from, to) | T010 |
| FR-006 | Detail access check | T014 |
| FR-007 | Role/q filters | T010, T013 |
| FR-008 | isCurrent highlight | T010 |
| FR-009 | isPast indicator | T010 |
| FR-010 | Recurring meeting display | T010 (inherent) |
| FR-011 | Recording config in detail | T020 |
| FR-012 | Attachments in detail | T019 |
| FR-013 | Missing/Invalid params | T010, T011, T043 |
| FR-014 | from >= to → 422 | T011 |
| FR-015-FR-017 | Range limits per view | T011 |
| FR-018 | Meeting not found → 404 | T014 |
| FR-019 | Unauthenticated → 401 | T022-T023 |
| FR-020 | Invalid view → 400 | T043 |
| FR-021 | Empty state | T010 |
| FR-022 | JWT required | T022-T023 |
| FR-023 | No userId override | T022-T023 (inherent) |
| FR-024 | Forbidden for non-participant | T014 |
| FR-025 | No duplicate event | T010 (GROUP BY) |
| FR-026 | Color/icon mapping | T010 (colorKey = status) |
| FR-027 | Overlap query condition | T010 |
| FR-028 | Timezone normalize to timestamptz | T010 |
| FR-029 | q search title + meeting_code, trim, skip if empty | T010, T013 |
| FR-030 | effectiveUserRole + role filter | T010, T012 |

---

## Dependencies & Execution Order

### Phase Dependencies

```
Phase 1 Setup & Foundational ──► Phase 2 DTOs
                                       │
                                       ▼
                              Phase 3 Service US1 ──► Phase 5 Controller
                                       │
                              Phase 4 Service US2 ───┘
                                       │
                                       ▼
                              Phase 6 Tests
                                       │
                                       ▼
                              Phase 7 Build & Review
```

### Parallel Opportunities

| Tasks | Reason |
|---|---|
| T002, T003 | Different files, no dependencies |
| T004-T009 | All DTO files, no dependencies |
| T015-T020 | All detail sub-queries, independent of each other |
| T024-T043 | All test files, can run in parallel once service/controller code exists |
| T044-T046 | Independent build/lint/test commands |

### MVP Scope

Complete **Phases 1–3 + T022** for a working schedule list endpoint (US1). This covers the primary use case: user can view their schedule. Add US2 (Phase 4) and tests (Phase 6) incrementally.

> **2026-06-11**: Hoan thanh code toan bo feature (build pass, cac test moi cho service/controller/DTO da duoc tao)
