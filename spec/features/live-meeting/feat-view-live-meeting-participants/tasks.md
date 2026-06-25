# Tasks: Xem danh sach nguoi tham du dang co mat (View Live Meeting Participants)

**Input**: Design documents from spec/features/live-meeting/feat-view-live-meeting-participants/
**Prerequisites**: plan.md, spec.md, research.md, data-model.md, contracts/present-attendees-api.md
**Tests**: Unit tests included (bat buoc theo plan.md Section 10)
**Organization**: Tasks theo dependency tu infrastructure -> domain -> endpoint -> test

---

## Phase 1: Setup & Data Types

**Purpose**: Tao error constants va TypeScript types lam co so cho cac phase sau

- [x] T001 [P] Tao error constants file src/modules/live-meeting/constants/present-attendees-error.constant.ts chua cac error code: INVALID_QUERY, FORBIDDEN_LIVE_PARTICIPANTS_ACCESS, MEETING_NOT_FOUND, MEETING_NOT_IN_PROGRESS
- [x] T002 [P] Tao TypeScript type presentAttendeeQuery trong src/modules/live-meeting/types/present-attendee.type.ts gom: PresentStatus enum (present, maybe_present, left, absent, unknown), PresentAttendeeItem interface, PresentAttendeesResponse interface, PresentAttendeesQueryDto interface (search, departmentId, page, limit, sortBy, sortOrder)

---

## Phase 2: Data Transfer Object (DTO)

**Purpose**: Dinh nghia response shape cho endpoint

- [x] T003 [P] Tao src/modules/live-meeting/dto/present-attendees-response.dto.ts gom PresentAttendeesResponseDto (meetingId, occupancyCount, presentUsers[], updatedAt, meta)
- [x] T004 Cap nhat src/modules/live-meeting/dto/index.ts de export PresentAttendeesResponseDto

---

## Phase 3: Service Logic - getPresentAttendees

**Purpose**: Implement core business logic: validate meeting, kiem tra quyen, query presence data, field-level authorization, audit log

### 3.1 Validation and Authorization

- [x] T005 Them method getPresentAttendees() trong src/modules/live-meeting/services/live-meeting.service.ts:
  - Load meeting tu database bang meetingId
  - Kiem tra meeting ton tai (throw MEETING_NOT_FOUND neu null hoac soft-delete)
  - Kiem tra status + time window:
    - IN_PROGRESS: OK
    - SCHEDULED + now trong [start_time, end_time + 30m]: OK
    - Con lai: throw MEETING_NOT_IN_PROGRESS
  - Kiem tra authorization:
    - Check userId co phai Host (meetings.host_id === currentUserId hoac participant_role = host)
    - Check role Business Admin / System Admin
    - Neu khong: throw FORBIDDEN_LIVE_PARTICIPANTS_ACCESS

### 3.2 Query and Data Mapping

- [x] T006 Them query trong getPresentAttendees(): dung TypeORM QueryBuilder de LEFT JOIN:
  - meeting_participants JOIN users JOIN departments
  - LEFT JOIN LATERAL attendance_records (ORDER BY updated_at DESC LIMIT 1)
  - LEFT JOIN LATERAL presence_snapshots (ORDER BY snapshot_time DESC LIMIT 1)
  - WHERE mp.meeting_id = :meetingId AND mp.user_id IS NOT NULL AND mp.invitation_status IS DISTINCT FROM declined

- [x] T007 Implement presenceStatus mapping trong getPresentAttendees() theo priority:
  - ps.presence_status = present -> PRESENT
  - ar.attendance_status IN (present, late) -> PRESENT
  - ps.presence_status = maybe_present -> MAYBE_PRESENT
  - ar.check_in_time != null AND ar.checkout_time != null -> LEFT
  - ar.attendance_status = absent -> ABSENT
  - Default -> UNKNOWN
  - Dong thoi map presenceSource theo FR-031 priority: room_camera > door_checkin > manual_host > not_detected (uu tien presence_snapshots.source truoc, attendance_records.attendance_source sau)
  - Xu ly duplicate handler: presence_snapshots dung subquery ORDER BY snapshot_time DESC LIMIT 1 de chi lay 1 ban ghi moi nhat cho 1 user, tranh duplicate participant trong response

- [x] T008 Implement joinedAt mapping trong getPresentAttendees() theo priority:
  - ar.check_in_time
  - attendance_events.event_time (event_type = check_in hoac enter_room, earliest)
  - mp.joined_at
  - null (default)

### 3.3 Search, Filter, Pagination

- [x] T009 Them search/filter/pagination/sort logic trong getPresentAttendees():
  - search: ILIKE tren full_name hoac email (trim, max 100 chars)
  - departmentId: filter theo department_id
  - page/limit: skip/limit (default page=1, limit=20, max limit=100)
  - sortBy: allowlist (full_name, department_name, presence_status, joined_at), default full_name ASC
  - Dem occupancyCount = so luong participant co presenceStatus = PRESENT hoac MAYBE_PRESENT

### 3.4 Field-level Authorization

- [x] T010 Implement field-level authorization mapping trong getPresentAttendees():
  - Host/Business Admin/System Admin -> full fields (presenceSource, confidenceScore, checkInTime, joinedAt, lastSeenAt)
  - Participant thuong xem nguoi khac -> presenceSource=null, confidenceScore=null, checkInTime=null, joinedAt=null, lastSeenAt=null
  - Participant xem chinh minh -> presenceSource=full, checkInTime=full, confidenceScore=null, joinedAt=null, lastSeenAt=null

### 3.5 Audit Log

- [x] T011 Them audit log non-blocking trong getPresentAttendees():
  - Tao AuditLogEntity voi actionType = read_live_participants, entityType = meeting, entityId = meetingId
  - newValueJson chua viewerUserId, viewerRole, resultCount, filters (search, departmentId)
  - ipAddress, userAgent tu controller context
  - Fire-and-forget (khong await, khong blocking response)

---

## Phase 4: Controller Endpoint

**Purpose**: Tao REST endpoint GET /api/v1/live-meetings/{meetingId}/present-attendees

- [x] T012 Them method getPresentAttendees() trong src/modules/live-meeting/controllers/live-meeting.controller.ts:
  - @Get(live-meetings/:meetingId/present-attendees)
  - @UseGuards(JwtAuthGuard, PermissionsGuard)
  - @RequirePermissions(meeting.presence.read)
  - ParseUUIDPipe cho meetingId
  - Lay currentUserId tu request[user]
  - Lay query params (search, departmentId, page, limit, sortBy, sortOrder)
  - Goi service.getPresentAttendees()
  - @ApiOperation, @ApiParam, @ApiResponse, @ApiQuery Swagger decorators
  - Lay @Ip() va @Headers(user-agent) de truyen vao service cho audit log
  - Tra ve { success, message, data, meta }

- [x] T013 [P] Tao pipe/validator query params trong controller:
  - Trim search string
  - Validate page >= 1, limit 1-100
  - Validate sortBy thuoc allowlist
  - Validate sortOrder = asc hoac desc
  - Validate departmentId UUID format (neu co)

---

## Phase 5: Unit Tests

**Purpose**: Dam bao business logic va response shape dung

### 5.1 Service Tests

- [x] T014 [P] Them test cho LiveMeetingService.getPresentAttendees trong src/modules/live-meeting/tests/live-meeting.service.spec.ts:
  - Happy path: Host xem danh sach -> 200, response co day du fields
  - Meeting not found -> throw MEETING_NOT_FOUND
  - Meeting wrong status (scheduled + ngoai window) -> throw MEETING_NOT_IN_PROGRESS
  - Meeting scheduled + trong grace window -> 200 OK
  - Forbidden: user khong phai Host/Admin -> throw FORBIDDEN_LIVE_PARTICIPANTS_ACCESS
  - Participant view: fields = null cho nguoi khac
  - Participant self-view: presenceSource, checkInTime hien thi
  - Search param -> filtered results
  - Department filter -> filtered results
  - Pagination -> page/limit hoat dong
  - Sort -> sortBy/sortOrder hoat dong
  - occupancyCount dem dung
  - Duplicate handler: Mock DB tra ve 2 snapshot cho cung 1 user (cung room_id, user_id), xac nhan response chi co 1 item cho user do (khong bi duplicate)
  - Non-blocking Audit: Mock audit write bi loi (throw exception), xac nhan API van tra ve 200 OK (audit failure khong anh huong response)

### 5.2 Controller Tests

- [x] T015 [P] Them test cho endpoint trong src/modules/live-meeting/tests/live-meeting.controller.spec.ts:
  - Response shape dung (success, message, data, meta)
  - HTTP status code dung (200, 401, 403, 404, 409)
  - ParseUUIDPipe hoat dong (400 neu meetingId invalid)
  - Query params duoc truyen vao service

---

## Phase 6: Integration Verification

**Purpose**: Xac nhan toan bo feature hoat dong dung

- [ ] T016 Chay unit tests, verify all pass
- [ ] T017 Kiem tra quickstart.md scenarios (S1-S9) manual hoac integration tests
- [ ] T018 Kiem tra audit_logs duoc ghi khi goi API thanh cong

---

## Dependencies and Execution Order

### Phase Dependencies

Phase 1 (Setup): Khong co dependency
Phase 2 (DTO): Depends on T003 -> T004
Phase 3 (Service): Depends on Phase 1 (error constants + types)
Phase 4 (Controller): Depends on Phase 2 (DTO) + Phase 3 (Service)
Phase 5 (Tests): Depends on Phase 3 + Phase 4
Phase 6 (Verification): Depends on Phase 5

### Trong Phase 3

T005 (validation + auth) -> T006 (query) -> T007 (presenceStatus) -> T008 (joinedAt) -> T009 (search/filter/pagination) -> T010 (field-level auth) -> T011 (audit log)

Cac task T005-T011 trong cung method getPresentAttendees() nen lam lien tiep.

### Parallel Opportunities

| Task | Can chay song song voi |
|---|---|
| T001 | T002 (different files, khong dependency) |
| T003 | Independent sau T001, T002 |
| T014 | T015 (service test vs controller test) |
| T013 | T012 (pipe/validator co the lam truoc hoac song song) |

---

## Requirements Coverage

### Functional Requirements Coverage

| Task | FR duoc implement |
|---|---|
| T005 | FR-005, FR-006, FR-017, FR-018, FR-019, FR-020, FR-024, FR-025, FR-026 |
| T006 | FR-002, FR-007, FR-DATA-001, FR-DATA-002 |
| T007 | FR-030, FR-031 |
| T008 | FR-032 |
| T009 | FR-008, FR-009, NFR-001, NFR-002, NFR-009 |
| T010 | FR-013, FR-027, FR-028 |
| T011 | FR-034, FR-035, FR-036 |
| T012 | FR-001, FR-004, FR-029, FR-033, FR-039, FR-040 |

### Acceptance Criteria Coverage

| AC ID | Task(s) |
|---|---|
| AC-001 (Host full view) | T005, T006, T007, T008, T009, T010, T012 |
| AC-002 (Admin room monitoring) | T005, T006, T007, T008, T009, T010, T012 |
| AC-003 (Participant fields limited) | T010 |
| AC-004 (Participant self-view) | T010 |
| AC-005 (Scheduled + grace window) | T005 |
| AC-006 (Scheduled + out window) | T005 |
| AC-007 (Meeting not found) | T005 |
| AC-008 (Forbidden) | T005 |
| AC-009 (Search) | T009 |
| AC-010 (Department filter) | T009 |
| AC-011 (Audit log) | T011 |

### Error Codes Coverage

| Error Code | Task |
|---|---|
| INVALID_QUERY (400) | T013 |
| UNAUTHORIZED (401) | JwtAuthGuard (co san) |
| FORBIDDEN_LIVE_PARTICIPANTS_ACCESS (403) | T005 |
| MEETING_NOT_FOUND (404) | T005 |
| MEETING_NOT_IN_PROGRESS (409) | T005 |
| INTERNAL_ERROR (500) | T011 (catch trong audit) |

---

## Summary

| Item | Count |
|---|---|
| Total tasks | 18 |
| Parallel tasks [P] | 5 (T001, T002, T003, T014, T015) |
| Sequential tasks | 13 |
| New files created | 3 (error.constant.ts, type.ts, dto.ts) |
| Modified files | 5 (index.ts, service.ts, controller.ts, 2 test files) |
| Phases | 6 |
