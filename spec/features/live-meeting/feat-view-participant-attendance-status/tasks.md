# Tasks: UC-IMM-08 Xem trang thai diem danh nguoi tham du

**Input**: spec.md, plan.md, research.md, data-model.md, contracts/attendance-api.md
**Branch**: feat-view-participant-attendance-status
**Module**: live-meeting (NestJS, TypeORM)
**Type**: Read-only (khong mutation, khong transaction, khong migration)

---

## Phase 1: Setup & Data Types

**Purpose**: Constants, error codes, TypeScript types

- [x] T001 [P] Tao error constants file src/modules/live-meeting/constants/meeting-attendance-error.constant.ts
    - Pattern: MEETING_START_ERRORS, MEETING_END_ERRORS
    - Codes: MEETING_NOT_FOUND (404), MEETING_NOT_ACTIVE_OR_COMPLETED (409),
      FORBIDDEN_ATTENDANCE_ACCESS (403), PERMISSION_DENIED (403), VALIDATION_ERROR (422)

- [x] T002 [P] Tao TypeScript types file src/modules/live-meeting/types/attendance-participant.type.ts
    - Interface: AttendanceParticipant
    - Fields: userId, fullName, email, avatarUrl, departmentId, departmentName,
      participantRole, attendanceStatus (checked_in | late | absent),
      checkInTime (ISO-8601 | null), isProvisional (boolean), participantState (active | removed)
    - Interface: AttendanceMeta
    - Fields: page, pageSize, currentInvitedCount, checkedInCount, lateCount,
      absentCount, removedCount, totalPages
    - Interface: AttendanceResponse
    - Fields: meetingId, meetingStatus, actualStartTime (ISO-8601 | null),
      lateThresholdMinutes (number), participants (AttendanceParticipant[])
    - Enum: AttendanceStatus (checked_in, late, absent)
    - Enum: ParticipantState (active, removed)
    - Enum: MeetingAttendanceStatusGate (in_progress, completed)

---

## Phase 2: Data Transfer Object (DTO)

**Purpose**: Query validation + Response shape

- [x] T003 [P] Tao src/modules/live-meeting/dto/attendance-query.dto.ts
    - Class: AttendanceQueryDto
    - @IsOptional(), @IsString(), @MaxLength(100): q (search)
    - @IsOptional(), @IsEnum(): status (checked_in, late, absent)
    - @IsOptional(), @Type(() => Number), @IsInt(), @Min(1): page (default 1)
    - @IsOptional(), @Type(() => Number), @IsInt(), @Min(1), @Max(100): pageSize (default 20)
    - @IsOptional(), @IsString(): sortBy (validate allowlist)
    - @IsOptional(), @IsEnum(): sortOrder (asc, desc, default asc)
    - @IsOptional() @IsString() transformSortBy(): validate allowlist [full_name, attendance_status, check_in_time]

- [x] T004 [P] Tao src/modules/live-meeting/dto/attendance-response.dto.ts
    - Class: AttendanceParticipantDto (userId, fullName, email, avatarUrl,
      departmentId, departmentName, participantRole, attendanceStatus,
      checkInTime, isProvisional, participantState)
    - Class: AttendanceMetaDto (page, pageSize, currentInvitedCount,
      checkedInCount, lateCount, absentCount, removedCount, totalPages)
    - Class: MeetingAttendanceResponseDto (meetingId, meetingStatus,
      actualStartTime, lateThresholdMinutes, participants, meta)

- [x] T005 Cap nhat src/modules/live-meeting/dto/index.ts
    - Export: AttendanceQueryDto, MeetingAttendanceResponseDto,
      AttendanceParticipantDto, AttendanceMetaDto

---

## Phase 3: Service Logic â€” getMeetingAttendance()

**Purpose**: Core business logic â€” read-only attendance report

**Note**: This is ONE integrated service method. Tasks T006-T011 are the logical
steps WITHIN that single method, implemented together in one file change.

- [x] T006 Tao method getMeetingAttendance() trong src/modules/live-meeting/services/live-meeting.service.ts
    - Signature: async getMeetingAttendance(meetingId: string, userId: string, query: AttendanceQueryDto)
    - Pattern: giong getPresentAttendees() trong cung file

- [x] T007 Implement meeting validation trong getMeetingAttendance()
    - Load meeting (meetingsRepo.findOneBy): if null/deleted -> MEETING_NOT_FOUND
    - Check status IN (in_progress, completed): if not -> MEETING_NOT_ACTIVE_OR_COMPLETED
    - Check ownership:
      - Host: meeting.host_id === userId
      - Host: participant_role=host trong meeting_participants
      - Business Admin: permission attendance.read system scope
      - None match -> FORBIDDEN_ATTENDANCE_ACCESS (403)

- [x] T008 Implement late threshold + attendance data query
    - Doc late_threshold_minutes tu system_configs (config_key = attendance.late_threshold)
    - Neu khong ton tai or inactive -> default 10
    - Parse config_value: neu khong phai int -> default 10 + log warning
    - Tinh late_threshold_time = COALESCE(actual_start_time, start_time) + threshold phut
    - Query participants (QueryBuilder LEFT JOIN):
      - Base: meeting_participants WHERE meeting_id AND invitation_status != declined AND user_id IS NOT NULL
      - Báº¯t buá»™c dÃ¹ng `.withDeleted()` cho query base (náº¿u Entity cÃ³ DeleteDateColumn) Ä‘á»ƒ láº¥y Ä‘Æ°á»£c participant Ä‘Ã£ bá»‹ soft-delete.
      - LEFT JOIN users, departments
      - Láº¥y earliest valid check-in time: CÃ³ thá»ƒ dÃ¹ng `.addSelect(subQuery)` hoáº·c cÆ¡ cháº¿ join phÃ¹ há»£p (khÃ´ng báº¯t buá»™c `LEFT JOIN LATERAL` náº¿u TypeORM khÃ´ng há»— trá»£ tá»‘t), miá»…n sao tÃ­nh late theo earliest valid check-in.
      - Fallback check-in time: `MIN(event_time)` tá»« `attendance_events` (event_type IN check_in, enter_room).

- [x] T009 Implement attendance status classification + participantState
    - Moi participant:
      - attendanceStatus:
        - co attendance_record:
          - attendance_status = late -> late
          - attendance_status = present + check_in_time <= threshold -> checked_in
          - attendance_status = present + check_in_time > threshold -> late (FR-023 override)
          - attendance_status = absent -> absent
        - khong co -> absent, isProvisional = (meeting.status == in_progress)
      - checkInTime: earliest check_in_time tu attendance_records; neu null fallback MIN(event_time) tu attendance_events
      - participantState:
        - mp.deleted_at NOT NULL + co attendance_record -> removed
        - mp.deleted_at NOT NULL + NO attendance_record -> EXCLUDE from results (FR-038b)
        - else -> active
    - Meta counts:
      - currentInvitedCount: participants with participantState = active
      - checkedInCount, lateCount, absentCount: based on attendanceStatus
      - removedCount: participants with participantState = removed

- [x] T010 Implement search, filter, pagination, sort trong getMeetingAttendance()
    - Search (q): WHERE LOWER(u.full_name) LIKE '%:q%' OR LOWER(u.email) LIKE '%:q%'
    - Filter (status): WHERE attendanceStatus = :status (post-query filter)
    - Pagination: .skip((page-1)*pageSize).take(pageSize)
    - Sort: ORDER BY, dung CASE WHEN cho attendance_status sort
    - Default sort: full_name ASC

- [x] T011 Them audit log non-blocking trong getMeetingAttendance()
    - After response, fire-and-forget: auditLogRepo.save({
        actionType: 'read_meeting_attendance',
        entityType: 'meeting',
        entityId: meetingId,
        actorId: userId,
        metadataJson: { viewerRole, resultCount },
        severity: 'info'
      })
    - Khong await (Promise without await) de khong blocking response
    - Neu fail, chi log internal, khong anh huong response (FR-040)

---

## Phase 4: Controller Endpoint

**Purpose**: HTTP endpoint GET /api/v1/meetings/{meetingId}/attendance

- [x] T012 Them method getAttendance() trong src/modules/live-meeting/controllers/live-meeting.controller.ts
    - Route: @Get('meetings/:meetingId/attendance')
    - Guard: @UseGuards(JwtAuthGuard, PermissionsGuard)
    - Permission: @RequirePermissions('attendance.read')
    - Params:
      - meetingId (ParseUUIDPipe)
      - @Query() query: AttendanceQueryDto (ValidationPipe)
    - Inject: @Req() (lay user), @Ip(), @Headers('user-agent')
    - Call service.getMeetingAttendance(meetingId, userId, query)
    - Error handling: NotFoundException -> 404, ConflictException -> 409,
      ForbiddenException -> 403, BadRequestException -> 422
    - Swagger: @ApiOperation, @ApiParam, @ApiQuery, @ApiResponse cho 200/401/403/404/409/422
    - Response format: { success, message, data, meta }

---

## Phase 5: Unit Tests

**Purpose**: Verify business logic, error handling, response shape

- [x] T013 [P] Them test suite getMeetingAttendance vao src/modules/live-meeting/tests/live-meeting.service.spec.ts
    - **Setup**: mock meetingsRepo, meetingParticipantsRepo, attendanceRecordsRepo,
      attendanceEventsRepo, systemConfigsRepo, auditLogRepo
    - Test cases (18 tests):
      1. [Host, completed] All participants with isProvisional=false, meta counts correct (AC-001)
      2. [Host, in_progress] Unchecked-in has isProvisional=true (AC-002)
      3. [Late detection] checkIn 09:12, threshold 09:10 -> late (AC-003, FR-014)
      4. [On-time] checkIn 09:08, threshold 09:10 -> checked_in (AC-004, FR-015)
      5. [Fallback start_time] actual_start_time null -> use start_time (AC-005, FR-016)
      6. [Override FR-023] present + check_in > threshold -> late
      7. [Earliest check-in FR-037] 2 records: 09:05 and 09:12 -> earliest 09:05 used
      8. [Fallback attendance_events FR-037] no attendance_record -> MIN(event_time)
      9. [Removed with attendance FR-038b] included, participantState=removed
      10. [Removed without attendance FR-038b] excluded
      11. [Status filter FR-008] ?status=late returns only late
      12. [Search FR-009] ?q=Nguyen returns matching participants
      13. [Not found ERR-007] meeting null -> 404
      14. [Wrong status ERR-008] meeting scheduled -> 409
      15. [Regular participant ERR-006] not host/admin -> 403
      16. [Business Admin FR-033] admin can view any meeting -> success
      17. [Pagination defaults FR-029b] page=1, pageSize=20 default
      18. [Audit log FR-039] verify auditLogRepo.save called
      19. [Audit log fail FR-040] mock audit log throw exception -> API van success 200, log error noi bo

- [x] T014 [P] Them test suite getAttendance vao src/modules/live-meeting/tests/live-meeting.controller.spec.ts
    - Test cases:
      1. Happy path: GET /meetings/:meetingId/attendance -> 200, response shape matches DTO
      2. Invalid UUID -> 422 VALIDATION_ERROR
      3. Without JWT -> 401 UNAUTHORIZED
      4. Without attendance.read -> 403 PERMISSION_DENIED
    - Pattern: giong present-attendees endpoint tests

---

## Phase 6: Integration Verification

**Purpose**: End-to-end verification

- [x] T015 Chay unit tests, verify all pass
    - Command: npm test -- --testPathPattern=live-meeting
    - Verify: 18 service tests + 4 controller tests = 22 tests pass

- [x] T016 Kiem tra quickstart.md scenarios
    - Verify main scenarios (S1-S12) bang unit test results
    - Kiem tra edge cases: removed participant, pagination defaults, filter ignore invalid status

- [x] T017 Xoa file backup neu con (backup_plan_b64.txt)
    - Clean up misc files trong feature directory

---

## Requirements Coverage

| Task | FR chinh | AC chinh | Core Concern |
|---|---|---|---|
| T001 | - | - | Error constants |
| T002 | - | - | Types |
| T003 | FR-029, FR-029b, FR-030 | - | Query DTO + validation |
| T004 | FR-035, FR-038 | AC-001, AC-002 | Response DTO |
| T005 | - | - | DTO exports |
| T006 | FR-001, FR-003 | AC-001, AC-002 | Service method |
| T007 | FR-002, FR-025, FR-026, FR-027, FR-028, FR-031, FR-032, FR-033, FR-034 | AC-008, AC-009, AC-010, AC-011, AC-012 | Meeting validation + auth |
| T008 | FR-014, FR-015, FR-016, FR-017, FR-018 | AC-003, AC-004, AC-005 | Late threshold + data query |
| T009 | FR-004, FR-005, FR-010, FR-020, FR-021, FR-022, FR-023, FR-035, FR-037, FR-038, FR-038b, FR-041, FR-042 | AC-001, AC-002, AC-003, AC-004, AC-006 | Status classification |
| T010 | FR-008, FR-009, FR-029b | AC-006, AC-007 | Search/filter/pagination |
| T011 | FR-039, FR-040 | AC-015 | Audit log |
| T012 | FR-001 | AC-001, AC-002, AC-008, AC-011 | Controller endpoint |
| T013 | FR-001 thru FR-042, ERR-001 thru ERR-009 | AC-001 thru AC-015 | Service unit tests |
| T014 | - | AC-008, AC-011 | Controller tests |
| T015 | - | - | Test execution |
| T016 | - | AC-001 thru AC-015 | Scenario verification |
| T017 | - | - | Cleanup |

---

## Notes

- Feature read-only: khong tao/sua/xoa data, khong transaction, khong migration
- Su dung .addSelect(subQuery) hoac query phu hop de lay earliest valid check_in_time (khong bat buoc dung LATERAL JOIN)
- attendance_events la fallback cho check-in time, khong phai nguon attendance status chinh
- presence_snapshots KHONG duoc query (out-of-scope)
- Field-level authorization khong can (participant da bi chan 403)
- pageSize (khong phai limit) theo spec clarify
