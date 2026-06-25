# Implementation Plan: Xem danh sach diem danh cua cuoc hop (UC-APM-02)

**Branch**: `013-view-meeting-attendance` | **Date**: 2026-06-16
**Update**: Xử lý H1, M1 (Audit Log & Duplicate Fallback)
**Spec**: spec/features/attendance/feat-view-meeting-attendance-list/spec.md

## Summary

Tinh nang cho phep Host, Organizer, Participant, Business Admin, Manager (1 cap) xem danh sach diem danh read-only cua mot cuoc hop. Day la tinh nang doc du lieu tu attendance_records, meeting_participants, users va departments. Khong thay doi database schema. API moi: GET /api/v1/meetings/{meetingId}/attendance.

## Technical Context

**Language/Version**: TypeScript (NestJS)  
**Primary Dependencies**: NestJS, TypeORM, class-validator, JWT  
**Storage**: PostgreSQL (read-only queries)  
**Testing**: Jest  
**Target Platform**: Node.js LTS server  
**Project Type**: Web API (modular monolith)  
**Performance Goals**: < 3s response for 200 participants, 50 concurrent requests  
**Constraints**: Read-only, no data mutation, field-level auth enforced server-side  
**Scale**: 20-200 participants per meeting

## Constitution Check

| Gate | Status | Notes |
|---|---|---|
| **DB Gate** | PASS | Khong them bang moi, chi SELECT tu bang hien co |
| **Security Gate** | PASS | Field-level auth, JwtAuthGuard, khong leak sensitive fields |
| **Scope Gate** | PASS | Chi implement read-only attendance list |
| **Module Gate** | PASS | Module attendance da ton tai, khong xam pham module khac |
| **API Gate** | PASS | Format response theo convention API chung |
| **Auth Gate** | PASS | JwtAuthGuard + userId tu JWT |
| **Test Gate** | PASS | Unit test cho service methods + DTO validation |

## Project Structure

```
spec/features/attendance/feat-view-meeting-attendance-list/
├── spec.md              # Feature spec (co san)
├── plan.md              # File nay
├── research.md          # Phase 0 output
├── data-model.md        # Phase 1 output
├── quickstart.md        # Phase 1 output
├── contracts/
│   └── attendance-list-api.md  # API contract

src/modules/attendance/
├── attendance.module.ts         # Update: add controller + service imports
├── controllers/
│   └── attendance.controller.ts  # NEW: endpoint GET attendance list
├── services/
│   └── attendance.service.ts     # NEW: business logic
├── dto/
│   ├── query-attendance.dto.ts   # NEW: query params validation
│   ├── attendance-item.dto.ts    # NEW: response item DTO
│   └── attendance-response.dto.ts # NEW: response structure DTO
├── entities/                     # Co san, khong thay doi
│   ├── attendance-record.entity.ts
│   └── attendance-event.entity.ts
└── tests/
    └── attendance.service.spec.ts # NEW: unit tests
```

## Complexity Tracking

Không vi phạm constitution. Feature read-only, khong can migration.

## Implementation Phases

### Phase 1: Setup (khong can - module da ton tai)

### Phase 2: Foundational

#### T001: Tao AttendanceController + route

- Tao file: `src/modules/attendance/controllers/attendance.controller.ts`
- Endpoint: GET /api/v1/meetings/:meetingId/attendance
- Decorate voi @Controller('meetings/:meetingId/attendance')
- Inject AttendanceService, JwtAuthGuard
- @Get() handler goi service.getAttendanceList()
- Authentication guard o controller level

#### T002: Tao DTO files

- `src/modules/attendance/dto/query-attendance.dto.ts`:
  - @IsOptional() @IsEnum() status: AttendanceQueryStatus
  - @IsOptional() @IsString() @MaxLength(100) search
  - @IsOptional() @IsInt() @Min(1) page (default 1)
  - @IsOptional() @IsInt() @Min(1) @Max(100) pageSize (default 20)
  
- `src/modules/attendance/dto/attendance-item.dto.ts`:
  - participantId, userId, avatarUrl, fullName, departmentName, positionTitle
  - participantRole, attendanceStatus, checkInTime, attendanceSource, checkInMethod
  - isLate, lateMinutes (field-level auth for source/method)

- `src/modules/attendance/dto/attendance-response.dto.ts`:
  - meeting, permissions, summary, items theo spec

#### T003: Tao AttendanceService

- `src/modules/attendance/services/attendance.service.ts`

**Methods can co:**
1. `getAttendanceList(meetingId, currentUser, query)` - main orchestrator
10. `AuditLogService.log` - non-blocking audit log (best-effort)
2. `validateAndGetMeeting(meetingId)` - check meeting ton tai, status, deleted
3. `checkAccess(meetingId, currentUser)` - check organizer/host/participant/admin/manager
4. `getParticipantsWithAttendance(meetingId)` - query join participants + users + departments + attendance_records
5. `deriveAttendanceStatus(record, meeting)` - apply derivation logic
6. `buildSummary(items, meetingStatus)` - calculate summary stats
7. `applyFieldLevelAuth(items, currentUser, meeting, participantIds)` - filter source fields
8. `applyFilters(items, status?, search?)` - filter/search in-memory (or SQL)
9. `applyPagination(items, page, pageSize)` - paginate

**Query logic (TypeORM):**
```
this.meetingParticipantRepo.find({
  where: { meetingId, invitationStatus: Not('declined'), deletedAt: IsNull() },
  relations: ['user', 'user.department'],
})
// Then for each participant, find latest attendance_record
this.attendanceRecordRepo.findOne({
  where: { meetingId, userId: participant.userId },
  order: { updatedAt: 'DESC', createdAt: 'DESC' },
})
```

#### T004: Update AttendanceModule

- Add controller va service vao imports/providers trong `attendance.module.ts`
- Import MeetingsModule (cho MeetingEntity), AccountsModule (cho UserEntity)
- Export service neu can

### Phase 3: Business Logic

#### T005: Implement authorization logic

- Check: user is in meeting_participants? (host/attendee)
- Check: user is organizer/host via meetings table?
- Check: user is business admin/system admin?
- Check: user is direct manager of any participant?
- Set canViewAttendanceSource = true/false in response

#### T006: Implement attendance status derivation

Follow spec FR-025 priority:
1. No record -> not_checked_in (in_progress) / absent (completed)
2. left_early -> left_early
3. check_in_time > start_time -> late
4. check_in_time <= start_time -> present
5. Respect existing attendance_status if present and valid
6. lateMinutes = CEIL((check_in_time - start_time)/60), min 1

#### T007: Implement field-level authorization

- If canViewAttendanceSource = false:
  - Set attendanceSource = null
  - Set checkInMethod = null
  - Set confidenceScore = null for OTHER participants
  - Keep these fields for the current user's own record

#### T008: Implement summary calculation

- totalParticipants = items.length
- checkedInCount = present + late + left_early
- presentCount
- lateCount
- absentCount (when completed) / notCheckedInCount (when in_progress)
- attendanceRate = Math.round(checkedInCount / totalParticipants * 100)

### Phase 4: Controller Wiring & Error Handling

#### T009: Wire controller with proper error handling

- Catch all expected errors and map to proper HTTP codes
- Implement try/catch with NestJS exception filters
- Ensure read-only: no save/update/delete operations

#### T010: Validate UUID meetingId param

- Use ParseUUIDPipe at controller level
- Return 400 with VALIDATION_ERROR if invalid

### Phase 5: Testing

#### T011: Unit test AttendanceService
- Test: Audit log được gọi với đúng parameters khi thành công
- Test: Audit log không được gọi nếu có exception ném ra (403, 404)
- Test: duplicate attendance_records -> returns newest record (fallback behavior)

- Test: getAttendanceList returns correct data
- Test: checkAccess for organizer/host/participant/admin/manager
- Test: deriveAttendanceStatus present/late/not_checked_in/absent/left_early
- Test: field-level auth hides source for participant
- Test: field-level auth shows source for host/organizer
- Test: summary calculation
- Test: filter by status
- Test: search by name
- Test: pagination works

#### T012: Unit test DTOs

- Test: valid query params pass validation
- Test: invalid status filter fails
- Test: search > 100 chars fails
- Test: invalid page/pageSize fails

## Acceptance Criteria Traceability

| AC ID | Implementation Tactic | Verification |
|---|---|---|
| AC-001 | T003+T005+T006+T007 | Unit: host sees all fields |
| AC-002 | T007 | Unit: participant source fields hidden |
| AC-003 | T005+T007 | Unit: manager sees direct reports |
| AC-008 | T006 | Unit: scheduled+now>=start_time returns not_checked_in |
| AC-011 | T006 | Unit: check-in <= start_time -> present |
| AC-012 | T006 | Unit: check-in > start_time -> late, lateMinutes=1 |
| AC-013 | T006 | Unit: completed+no check-in -> absent |

## Risks & Mitigations

| Risk | Impact | Mitigation |
|---|---|---|
| Duplicate attendance_records for same user+meeting | Wrong status display | ORDER BY updated_at DESC, created_at DESC, LIMIT 1 |
| Performance with large meeting | Slow response | Pagination, index on meeting_id+user_id |
| Field-level auth bypass | Leak sensitive source info | Enforce at service layer, not just response serialization |
| Manager scope interpretation | Wrong access | Chi 1 cap, check direct_manager_id exact match |
