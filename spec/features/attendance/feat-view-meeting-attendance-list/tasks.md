# Tasks: Xem danh sach diem danh cua cuoc hop (UC-APM-02)

**Feature**: APM-ATTENDANCE-LIST-001 — View Meeting Attendance List
**Module**: attendance
**Branch**: `013-view-meeting-attendance`
**Date**: 2026-06-16

**Input documents**:
- spec.md, plan.md, research.md, data-model.md, quickstart.md
- contracts/attendance-list-api.md

## Path Conventions

- All source files: `src/modules/attendance/`
- Test files: `src/modules/attendance/tests/`
- Entities exist: `attendance-record.entity.ts`, `attendance-event.entity.ts`

---

## Phase 1: Setup

**Purpose**: Tao cau truc thu muc co ban cho feature (module da ton tai)

- [x] T001 Tao controllers/ folder trong src/modules/attendance/ (neu chua co)
- [x] T002 [P] Tao services/ folder trong src/modules/attendance/ (neu chua co)
- [x] T003 [P] Tao dto/ folder trong src/modules/attendance/ (neu chua co)
- [x] T004 [P] Tao tests/ folder trong src/modules/attendance/ (neu chua co)

---

## Phase 2: Foundational

**Purpose**: Blocking prerequisites — DTOs, Controller shell, Service shell, Module wiring

- [x] T005 [FR-020, FR-021] [P] Tao QueryAttendanceDto trong src/modules/attendance/dto/query-attendance.dto.ts
  - import class-validator decorators
  - Fields: status (enum: all, present, late, absent, not_checked_in, left_early), search (@IsString @MaxLength(100) @IsOptional), page (@IsInt @Min(1) @IsOptional default 1), pageSize (@IsInt @Min(1) @Max(100) @IsOptional default 20)

- [x] T006 [FR-002] [P] Tao AttendanceItemDto trong src/modules/attendance/dto/attendance-item.dto.ts
  - Fields: participantId (uuid), userId (uuid), avatarUrl (string|null), fullName (string), departmentName (string|null), positionTitle (string|null), participantRole (string), attendanceStatus (string), checkInTime (string|null), attendanceSource (string|null — field-level auth), checkInMethod (string|null — field-level auth), isLate (boolean), lateMinutes (number)

- [x] T007 [FR-024] [P] Tao AttendanceListResponseDto trong src/modules/attendance/dto/attendance-list-response.dto.ts
  - meeting sub-object: id, title, status, startTime, endTime, roomId
  - permissions sub-object: canViewAttendanceSource (boolean)
  - summary sub-object: scope (string = "internal_participants_only"), totalParticipants, checkedInCount, presentCount, lateCount, absentCount, notCheckedInCount, attendanceRate
  - items: AttendanceItemDto[]
  - meta: page, pageSize, total, totalPages

- [x] T008 [FR-004, FR-016] Tao AttendanceController (shell) trong src/modules/attendance/controllers/attendance.controller.ts
  - @Controller('meetings/:meetingId/attendance')
  - Inject AttendanceService, JwtAuthGuard (class-level)
  - @Get() handler signature: getAttendanceList(@Param('meetingId', ParseUUIDPipe) meetingId: string, @Query() query: QueryAttendanceDto, @CurrentUser() currentUser: JwtPayload)
  - Body: goi service.getAttendanceList(meetingId, currentUser, query)

- [x] T009 [FR-001] Tao AttendanceService (shell) trong src/modules/attendance/services/attendance.service.ts
  - Inject: MeetingParticipantRepository, UserRepository, AttendanceRecordRepository (TypeORM)
  - Method signature: async getAttendanceList(meetingId: string, currentUser: JwtPayload, query: QueryAttendanceDto): Promise<AttendanceListResponseDto>
  - Body: throw NotImplementedException (se duoc implement o Phase 3)

- [x] T010 [Module] Cap nhat AttendanceModule trong src/modules/attendance/attendance.module.ts
- [x] T010b [FR-030] Inject AuditLogService vao AttendanceModule/AttendanceService
  - Add AttendanceController vao controllers: []
  - Add AttendanceService vao providers: []
  - Import MeetingsModule, AccountsModule (da co san)

---

## Phase 3: Business Logic — Authorization

- [x] T011 [FR-006, FR-018, FR-019] Implement validateAndGetMeeting() trong AttendanceService
  - Query MeetingRepository.findBy({ id: meetingId, deletedAt: IsNull() })
  - If not found: throw NotFoundException({ code: 'MEETING_NOT_FOUND' })
  - Check meeting status: if now < start_time -> throw ConflictException({ code: 'ATTENDANCE_NOT_OPEN_YET' })
  - If (scheduled AND now >= start_time) OR in_progress OR completed -> allowed
  - Return meeting entity (co start_time, end_time, status, host_id, organizer_id, room_id)

- [x] T012 [FR-005, FR-017, AC-003] [P] Implement checkAccess() trong AttendanceService
  - Check 1: currentUser.id == meeting.organizer_id? -> full access
  - Check 2: currentUser.id == meeting.host_id? -> full access
  - Check 3: currentUser is participant (query meeting_participants WHERE meetingId AND userId = currentUser.id AND invitationStatus != 'declined') -> basic access
  - Check 4: currentUser is in meeting_participants with participant_role = 'host'? -> full access
  - Check 5: currentUser is Business Admin or System Admin? (check roles/permissions) -> full access
  - Check 6: currentUser is direct manager of any participant? (users.direct_manager_id = currentUser.id) -> full access for those participants
  - If none match: throw ForbiddenException({ code: 'PERMISSION_DENIED' })
  - Return access level + canViewAttendanceSource boolean

- [x] T013 [FR-013, AC-001, AC-002] Implement canViewFieldLevelAuth() logic
  - canViewAttendanceSource = true if: organizer, host (host_id or participant_role='host'), business admin, system admin, direct manager of participant
  - canViewAttendanceSource = false if: participant thong thuong
  - Build set of participantIds ma currentUser la direct manager cua ho (user.direct_manager_id)

---

## Phase 4: Business Logic — Data Query & Derivation

- [x] T014 [FR-002, FR-003, FR-007, FR-DATA-001, FR-DATA-002] Implement getParticipantsWithAttendance() trong AttendanceService
  - Query meeting_participants WHERE meetingId AND invitationStatus != 'declined' AND deletedAt IS NULL
  - JOIN users (user.id = meeting_participants.user_id AND users.deletedAt IS NULL)
  - LEFT JOIN departments (departments.id = users.departmentId)
  - For each participant: LEFT JOIN LATERAL attendance_records ar2 ON ar2.meeting_id = :meetingId AND ar2.user_id = mp.user_id ORDER BY ar2.updated_at DESC, ar2.created_at DESC LIMIT 1
  - Alternative: query participants first, then batch query attendance_records and map in-memory
  - Exclude external participants (meeting_external_participants table — khong join)
  - Tra ve array participant objects voi user + department + attendance_record data

- [x] T015 [FR-011, FR-012, FR-025, FR-026, FR-027, FR-028, FR-029] Implement deriveAttendanceStatus() trong AttendanceService
  - Input: attendanceRecord (nullable), checkInTime, leftEarly, existingAttendanceStatus, meetingStartTime, meetingStatus
  - Logic (FR-025 priority):
    1. If no record OR checkInTime is null -> not_checked_in (in_progress/scheduled) | absent (completed)
    2. If leftEarly = true OR existingAttendanceStatus = 'left_early' -> left_early
    3. If existingAttendanceStatus = 'pending_review' -> pending_review
    4. If existingAttendanceStatus in ('present', 'late', 'absent') -> return existing
    5. If checkInTime > meetingStartTime -> late, isLate=true, lateMinutes = CEIL((checkInTime-startTime)/60), min 1
    6. If checkInTime <= meetingStartTime -> present, isLate=false
  - Return: { attendanceStatus, isLate, lateMinutes }

- [x] T016 [FR-024] Implement buildSummary() trong AttendanceService
  - totalParticipants = items.length (chỉ internal)
  - For each item: presentCount += 1 if present; lateCount += 1 if late; leftEarlyCount += 1 if left_early
  - checkedInCount = presentCount + lateCount + leftEarlyCount
  - notCheckedInCount = not_checked_in status count (when in_progress)
  - absentCount = absent status count (when completed)
  - attendanceRate = Math.round(checkedInCount / totalParticipants * 100)
  - scope = 'internal_participants_only'

- [x] T017 [FR-013, FR-023] Implement applyFieldLevelAuth() trong AttendanceService
  - If canViewAttendanceSource = true: keep all fields as-is
  - If canViewAttendanceSource = false:
    - For each item WHERE userId != currentUser.id:
      - Set attendanceSource = null
      - Set checkInMethod = null
      - Set confidenceScore = null

- [x] T018 [FR-008, FR-009] [P] Implement applyFilters() trong AttendanceService
  - If query.status is provided and != 'all': filter items by attendanceStatus matching query.status
  - If query.search is provided: filter items where fullName ILIKE '%search%' OR email ILIKE '%search%' OR employeeCode ILIKE '%search%'

- [x] T019 [NFR-003] [P] Implement applyPagination() trong AttendanceService
  - If no pagination: return all items
  - If page and pageSize provided:
    - const start = (page - 1) * pageSize
    - const paged = items.slice(start, start + pageSize)
    - meta: { page, pageSize, total: items.length, totalPages: Math.ceil(items.length / pageSize) }

---

## Phase 5: Controller Wiring & Error Handling

- [x] T020 [FR-004, FR-030] Complete AttendanceController.getAttendanceList()
  - Try-catch block:
    - Call service.validateAndGetMeeting(meetingId) -> 404 if not found, 409 if future
    - Call service.checkAccess(meeting, currentUser) -> 403 if denied
    - Call service.getParticipantsWithAttendance(meetingId)
    - Call service.deriveAttendanceStatus() for each participant
    - Call service.buildSummary()
    - Call service.applyFieldLevelAuth()
    - Call service.applyFilters()
    - Call service.applyPagination()
    - [FR-030] Call best-effort AuditLogService.log({ action_type: read_attendance_list, entity_type: attendance_records, metadata_json: {...} })
    - Return ApiResponse.success() with data and meta
  - Catch NestJS exceptions (NotFoundException, ForbiddenException, ConflictException, BadRequestException) -> let them propagate to global exception filter
  - Catch unexpected errors -> InternalServerErrorException({ code: 'INTERNAL_ERROR' })

- [x] T021 [FR-020] Apply ParseUUIDPipe on meetingId param (da co o T008)
  - Return 400 voi VALIDATION_ERROR neu invalid UUID

---

## Phase 6: Testing

- [x] T022 [Test, AC-008] [P] Unit test: AttendanceService.validateAndGetMeeting()
  - Test: meeting found + valid status -> returns meeting
  - Test: meeting not found -> throws NotFoundException
  - Test: meeting soft-deleted -> throws NotFoundException
  - Test: meeting future (now < start_time) -> throws ConflictException with ATTENDANCE_NOT_OPEN_YET
  - Test: meeting scheduled + now >= start_time -> returns meeting (cho phep truy cap)

- [x] T023 [Test, AC-003] [P] Unit test: AttendanceService.checkAccess()
  - Test: currentUser is organizer -> full access, canViewAttendanceSource = true
  - Test: currentUser is host -> full access
  - Test: currentUser is participant_role='host' -> full access
  - Test: currentUser is participant -> basic access, canViewAttendanceSource = false
  - Test: currentUser is business admin -> full access
  - Test: currentUser is direct manager of participant -> full access for those participants
  - Test: currentUser is not in meeting and not admin -> throws ForbiddenException

- [x] T024 [Test, AC-011, AC-012, AC-013] [P] Unit test: AttendanceService.deriveAttendanceStatus()
  - Test: no record + in_progress -> not_checked_in
  - Test: no record + completed -> absent
  - Test: left_early = true -> left_early
  - Test: pending_review -> pending_review
  - Test: checkInTime <= startTime -> present, isLate = false
  - Test: checkInTime > startTime by 1s -> late, lateMinutes = 1 (khong grace period)
  - Test: checkInTime > startTime by 65s -> late, lateMinutes = 2 (CEIL)
  - Test: duplicate attendance_records -> returns newest record (fallback behavior)

- [x] T025 [Test] [P] Unit test: AttendanceService.buildSummary()
  - Test: 20 participants (12 present, 3 late, 1 left_early, 4 not_checked_in) -> checkedInCount=16, attendanceRate=80
  - Test: completed meeting, 5 absent -> absentCount=5, notCheckedInCount=0
  - Test: scope = 'internal_participants_only'

- [x] T026 [Test, AC-002] [P] Unit test: AttendanceService.applyFieldLevelAuth()
  - Test: canViewAttendanceSource=true -> giu nguyen fields
  - Test: canViewAttendanceSource=false, currentUser khong phai owner cua record -> null source/method
  - Test: canViewAttendanceSource=false, currentUser la owner cua record -> giu source/method

- [x] T027 [Test] [P] Unit test: QueryAttendanceDto validation
  - Test: valid query params pass validation
  - Test: invalid status filter -> validation error
  - Test: search > 100 chars -> validation error
  - Test: page < 1 -> validation error
  - Test: pageSize > 100 -> validation error

- [x] T028 [Test] [P] Unit test: AttendanceController.getAttendanceList()
  - Test: valid request -> 200 with correct response structure
  - Test: success request -> triggers AuditLogService
  - Test: denied request (403/404) -> does NOT trigger AuditLogService
  - Test: invalid meetingId UUID -> 400
  - Test: valid DTO -> goi service dung method

---

## Phase 7: Polish & Cross-Cutting Concerns

- [x] T029 [Polish] Verify response format dung convention API: { success, message, data, meta }
- [x] T030 [Polish, FR-001] Verify read-only: khong co save/update/delete operations trong service
- [x] T031 [Polish, FR-004] Verify JwtAuthGuard applied at controller level — moi request deu can auth
- [x] T032 [Polish] Verify consistent error codes: VALIDATION_ERROR, MEETING_NOT_FOUND, PERMISSION_DENIED, ATTENDANCE_NOT_OPEN_YET, INTERNAL_ERROR
- [x] T033 [Test] Run quickstart.md test scenarios de verify

---

## Dependencies & Execution Order

### Phase Dependencies

- **Phase 1 (Setup)**: No dependencies
- **Phase 2 (Foundational)**: Depends on Phase 1
- **Phase 3-4 (Business Logic)**: Depends on Phase 2 (service shell + DTOs + controller shell)
- **Phase 5 (Controller Wiring)**: Depends on Phase 3-4
- **Phase 6 (Testing)**: Depends on Phase 5 — tests verify implementation
- **Phase 7 (Polish)**: Depends on Phase 6

### Task Dependencies

| From | To | Reason |
|---|---|---|
| T001-T004 | T005-T007 | Folder structure needed for DTOs |
| T005-T007 | T008-T009 | DTOs needed for controller + service signatures |
| T008-T010 | T011-T019 | Service shell needed for business logic methods |
| T011-T019 | T020 | Business logic needed before controller wiring |
| T020-T021 | T022-T028 | Full implementation needed before testing |
| T022-T028 | T029-T033 | Tests pass before polish |

### Parallel Opportunities

- **DTO creation (T005, T006, T007)**: All 3 can run in parallel
- **Folder creation (T001, T002, T003, T004)**: All can run in parallel
- **Business logic methods (T011, T012, T018, T019)**: Can be parallel where no inter-dependency
- **Unit tests (T022-T028)**: All can run in parallel
- **Polish tasks (T029-T033)**: All can run in parallel

---

## Implementation Strategy (MVP)

1. Complete Phase 1 + Phase 2 (DTOs + Controller + Service shell + Module update)
2. Complete Phase 3 (Authorization logic) — can test permission checks
3. Complete Phase 4 (Data query + status derivation + summary + field auth + filter/pagination)
4. Complete Phase 5 (Controller wiring — full API endpoint ready)
5. Complete Phase 6 (All unit tests)
6. Complete Phase 7 (Polish)

MVP = Phase 1 + Phase 2 + Phase 3-4 + Phase 5. Testing can be deferred but recommended.

## Requirements Coverage

| Requirement ID | Task(s) | Description |
|---|---|---|
| FR-001 (Read-only) | T009, T030 | Khong co write operations |
| FR-002 (DataSource) | T014 | Join attendance_records + meeting_participants |
| FR-003 (Exclude External) | T014 | Chi lay internal participants |
| FR-004 (Auth check) | T008, T031 | JwtAuthGuard o controller |
| FR-005 (Access control) | T012 | checkAccess() logic |
| FR-006 (Future meeting) | T011 | ATTENDANCE_NOT_OPEN_YET |
| FR-007 (Data retrieval) | T014 | getParticipantsWithAttendance() |
| FR-008 (Status filter) | T018 | applyFilters() |
| FR-009 (Search) | T018 | applyFilters() search ILIKE |
| FR-011 (In-progress) | T015 | not_checked_in for in_progress |
| FR-012 (Completed) | T015 | absent for completed |
| FR-013 (Field-level auth) | T017 | applyFieldLevelAuth() |
| FR-016 (401 unauthorized) | T008, T031 | JwtAuthGuard |
| FR-017 (403 forbidden) | T012 | checkAccess() throw Forbidden |
| FR-018 (404 not found) | T011 | validateAndGetMeeting() throw NotFound |
| FR-019 (409 future) | T011 | ConflictException with ATTENDANCE_NOT_OPEN_YET |
| FR-020 (400 invalid filter) | T005 | QueryAttendanceDto validation |
| FR-021 (400 search >100) | T005 | @MaxLength(100) |
| FR-024 (Summary) | T016 | buildSummary() |
| FR-025 (Status derivation) | T015 | deriveAttendanceStatus() priority logic |
| FR-026 (Present) | T015 | checkInTime <= startTime -> present |
| FR-027 (Late) | T015 | checkInTime > startTime -> late |
| FR-028 (Left early) | T015 | left_early -> left_early |
| FR-029 (No check-in) | T015 | not_checked_in / absent |
| AC-001 | T012, T015, T016, T017 | Host sees all fields |
| AC-002 | T017 | Participant source fields hidden |
| AC-003 | T012, T017 | Manager sees direct reports |
| AC-008 | T011, T015 | scheduled+now>=start_time -> not_checked_in |
| AC-011 | T015 | check-in <= startTime -> present |
| AC-012 | T015 | check-in > startTime -> late, lateMinutes=1 |
| AC-013 | T011, T015 | completed+no check-in -> absent |
| NFR-001 (Perf <3s) | T014, T019 | Index+paginate |
| NFR-007 (Index) | T014 | Index tren meeting_id, user_id |
