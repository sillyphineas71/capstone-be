# Implementation Plan: Xem trang thai diem danh cua nguoi tham du (View Participant Attendance Status)

**Branch**: eat-view-participant-attendance-status | **Date**: 2026-06-17 | **Spec**: [spec.md](spec.md)
**Input**: Feature specification UC-IMM-08, API Contract UC-81/UC-101

---

## 1. Feature Summary

Endpoint GET /api/v1/meetings/{meetingId}/attendance cho phep Host/Business Admin
xem trang thai diem danh cua toan bo internal participants trong meeting.
He thong tong hop tu attendance_records, meeting_participants, users, departments,
tinh late threshold tu system_configs, va tra ve 3 trang thai: checked_in, late, absent.

42 Functional Requirements, 15 Acceptance Criteria, 9 Error Codes.
Read-only: khong thay doi trang thai he thong.


## 2. Technical Context

| Aspect | Detail |
|---|---|
| Language | TypeScript (NestJS 10+) |
| Framework | NestJS |
| ORM | TypeORM (read-only queries, no transaction needed) |
| Database | PostgreSQL (v3.2 Compact - 39 tables) |
| Auth | JWT + RBAC (JwtAuthGuard, PermissionsGuard) |
| Module | live-meeting (da co controller, service, dto, constants) |
| Endpoint prefix | /api/v1 |
| Response convention | { success, message, data, meta } |
| Testing | Jest (unit test) |
| Performance Goals | Response < 3s cho 100 participants, 50 concurrent |
| Constraints | Read-only, khong mutation, khong add bang, pageSize default 20 max 100 |

### Pattern reuse

- Controller: @UseGuards(JwtAuthGuard, PermissionsGuard) + @RequirePermissions
- Service: throw NotFoundException/ConflictException/ForbiddenException
- DTO: class-validator + Swagger decorators, export tu dto/index.ts
- Error constants: file rieng trong constants/
- Audit log: AuditLogEntity via em.create() + em.save() (non-blocking)
- Lay user tu JwtAuthGuard: request.user hoac @CurrentUser() decorator

---

## 3. Scope Confirmation

### In Scope

- Tao/update endpoint GET /api/v1/meetings/{meetingId}/attendance
- Xac thuc + permission attendance.read
- Kiem tra ownership: Host cua meeting (host_id hoac participant_role=host)
- Business Admin co quyen xem bat ky meeting (attendance.read system)

## Notes

- Feature read-only: khong tao/sua/xoa data, khong transaction, khong migration
- Su dung .addSelect(subQuery) hoac phuong phap phu hop de lay earliest valid check_in_time tu attendance_records (khong bat buoc dung LATERAL JOIN)
- attendance_events la fallback cho check-in time, khong phai nguon attendance status chinh
- presence_snapshots KHONG duoc query (out-of-scope)
- Field-level authorization khong can (participant da bi chan 403)
- pageSize (khong phai limit) theo spec clarification
- Late detection rule: check_in_time > (actual_start_time + late_threshold_minutes)
- Doc late_threshold_minutes tu system_configs (default 10)
- Provisional absent cho meeting in_progress
- Filter (?status=), search (?q=), pagination (?page=&pageSize=), sort (?sortBy=&sortOrder=)
- participantState: active | removed (cho participant removed nhung co attendance)
- Audit log non-blocking (action_type = read_meeting_attendance)
- earliest valid check-in time (khong phai latest)

### Out of Scope

Xem spec.md Section 8. Luu y:
- KHONG query presence_snapshots (da chuyen ve Future Enhancement)
- KHONG xu ly Department Admin scope
- KHONG export .xlsx
- KHONG WebSocket realtime push

---

## 4. Data Model Impact

KHONG thay doi schema (khong them bang, khong them cot, khong migration).

### Tables doc (read-only)

| Table | Fields su dung | Role |
|---|---|---|
| meetings | id, status, start_time, end_time, actual_start_time, host_id, deleted_at | Kiem tra status, time window, ownership, tinh late threshold |
| meeting_participants | meeting_id, user_id, participant_role, invitation_status, deleted_at | Loại declined khỏi danh sách active invitees; vẫn giữ participant bị removed/soft-deleted nếu có lịch sử điểm danh hợp lệ để bảo toàn báo cáo lịch sử. |
| users | id, full_name, email, avatar_url, department_id | Thong tin hien thi |
| departments | id, department_name | Phong ban |
| attendance_records | meeting_id, user_id, check_in_time, attendance_status | Nguon chinh cho attendance status |
| attendance_events | meeting_id, user_id, event_type, event_time | Fallback cho check-in time neu thieu attendance_records |
| system_configs | config_key, config_value, is_active | Doc late_threshold_minutes |
| audit_logs | (write) action_type, entity_type, entity_id, actor_id, metadata_json | Ghi log khi xem |

---

## 5. API / Contract Plan

### Endpoint

GET /api/v1/meetings/{meetingId}/attendance
(Su dung lai endpoint UC-81 theo UC-101)

Permission: attendance.read

### Query Params

| Param | Type | Required | Default | Description |
|---|---|---|---|---|
| meetingId | UUID (path) | Yes | - | Meeting ID |
| status | string | No | - | Filter: checked_in, late, absent |
| q | string | No | - | Search full_name/email (max 100 chars) |
| page | int | No | 1 | Page number |
| pageSize | int | No | 20 | Page size (1-100) |
| sortBy | string | No | full_name | Allowlist: full_name, attendance_status, check_in_time |
| sortOrder | string | No | asc | asc/desc |

### Response Structure

Success 200:
`
{
  success: true,
  data: {
    meetingId: uuid,
    meetingStatus: string (in_progress/completed),
    actualStartTime: ISO-8601/null,
    lateThresholdMinutes: int,
    participants: [{
      userId, fullName, email, avatarUrl,
      departmentId, departmentName,
      participantRole, attendanceStatus,
      checkInTime (ISO-8601/null),
      isProvisional (bool),
      participantState (active/removed)
    }]
  },
  meta: {
    page, pageSize, currentInvitedCount, checkedInCount,
    lateCount, absentCount, removedCount, totalPages
  }
}
`

### Error Codes

| HTTP | Error Code | When |
|---|---|---|
| 422 | VALIDATION_ERROR | meetingId invalid, q > 100, page/pageSize invalid |
| 401 | UNAUTHORIZED | Token missing/expired |
| 403 | PERMISSION_DENIED | Lacks attendance.read |
| 403 | FORBIDDEN_ATTENDANCE_ACCESS | Not Host nor Business Admin |
| 404 | MEETING_NOT_FOUND | meetingId not found/deleted |
| 409 | MEETING_NOT_ACTIVE_OR_COMPLETED | Wrong status |
| 500 | INTERNAL_ERROR | Server/DB error |

---

## 6. Authorization Plan

### Permission check flow

1. JwtAuthGuard (xac thuc JWT)
2. PermissionsGuard + @RequirePermissions('attendance.read')
3. Service layer ownership check:
   - Host: meetings.host_id === currentUserId
   - Host: meeting_participants.participant_role = host (neu khong phai host_id)
   - Business Admin: co permission attendance.read o scope he thong
   - Neu khong match: throw ForbiddenException

### Data scope

- Host: chi xem duoc meeting minh la host
- Business Admin: xem duoc moi meeting (in_progress/completed)
- Participant thuong: KHONG duoc phep (403)
- Department Admin: OUT OF SCOPE

---

## 7. Business Logic Plan

### Flow: getMeetingAttendance(meetingId, currentUserId, query)

1. Load meeting (meetingsRepo.findOneBy)
   - null/deleted -> throw MEETING_NOT_FOUND (404)
2. Kiem tra status
   - NOT IN (in_progress, completed) -> throw MEETING_NOT_ACTIVE_OR_COMPLETED (409)
3. Kiem tra authorization
   - Host: meetings.host_id === currentUserId
   - Host: participant_role=host trong meeting_participants
   - Business Admin: he thong check permission
   - Khong match -> throw FORBIDDEN_ATTENDANCE_ACCESS (403)
4. Doc late_threshold_minutes tu system_configs
   - config_key = attendance.late_threshold
   - Neu khong ton tai hoac invalid -> default 10
5. Tinh late_threshold_time = COALESCE(meetings.actual_start_time, meetings.start_time) + threshold_minutes
6. Query participants (QueryBuilder)
   - Base: meeting_participants WHERE meeting_id AND invitation_status != declined
   - Bắt buộc dùng `.withDeleted()` khi query `meeting_participants` (nếu entity có cột DeleteDateColumn/deleted_at) để không bỏ sót người đã bị remove.
   - LEFT JOIN users, departments
   - LEFT JOIN attendance_records (WHERE meeting_id AND user_id)
   - LEFT JOIN attendance_events (WHERE meeting_id AND user_id AND event_type IN ('check_in','enter_room'))
7. Map attendace status cho moi participant:
   - Co attendance_record:
     a. attendance_status = late -> late
     b. attendance_status = present AND check_in_time <= threshold -> checked_in
     c. attendance_status = present AND check_in_time > threshold -> late (override)
     d. attendance_status = absent -> absent
   - Khong co attendance_record:
     -> absent, isProvisional = (meeting.status == in_progress)
8. Xac dinh participantState:
   - mp.deleted_at IS NOT NULL AND co attendance_record -> removed
   - Con lai -> active
   - mp.deleted_at IS NOT NULL KHONG co attendance_record -> LOAI KHOI KET QUA
9. Tinh meta counts:
   - currentInvitedCount: participants active (loai removed)
   - checkedInCount: checked_in
   - lateCount: late
   - absentCount: absent
   - removedCount: removed participants co attendance
10. Ap dung search/filter/pagination/sort
11. Mask fields neu user la Participant (khong ap dung vi Participant da bi chan 403)
    -> Khong can field-level authorization
12. Ghi audit log (non-blocking)
13. Return response

### Late detection chi tiet

`
late_threshold_minutes = system_configs.get('attendance.late_threshold') ?? 10
base_time = meetings.actual_start_time ?? meetings.start_time
late_threshold_time = base_time + (late_threshold_minutes * INTERVAL '1 minute')

if record.check_in_time <= late_threshold_time:
    status = checked_in
else:
    status = late
`

(Tuong thich voi FR-023: present + check_in_time > threshold -> late)

### Earliest check-in time (FR-037)

- Khi co nhieu attendance_records: lay MIN(check_in_time) (earliest)
- Khi attendance_records thieu: lay MIN(event_time) tu attendance_events
  WHERE event_type IN ('check_in','enter_room')
- Default: null

---

## 8. Validation Plan

| Field | Validation | Error |
|---|---|---|
| meetingId | ParseUUIDPipe | VALIDATION_ERROR (422) |
| q | Trim, max 100 chars | VALIDATION_ERROR (422) |
| page | >= 1, default 1 | VALIDATION_ERROR (422) |
| pageSize | >= 1, <= 100, default 20 | VALIDATION_ERROR (422) |
| status | Allowlist [checked_in, late, absent] | Ignore filter (FR-030) |
| sortBy | Allowlist [full_name, attendance_status, check_in_time] | VALIDATION_ERROR (422) |
| sortOrder | Allowlist [asc, desc] | VALIDATION_ERROR (422) |

---

## 9. Error Handling Plan

| Error | HTTP | Code | Condition |
|---|---|---|---|
| UUID invalid | 422 | VALIDATION_ERROR | meetingId sai format |
| Search too long | 422 | VALIDATION_ERROR | q > 100 chars |
| Page/pageSize invalid | 422 | VALIDATION_ERROR | page < 1, pageSize < 1 or > 100 |
| Sort invalid | 422 | VALIDATION_ERROR | sortBy/sortOrder khong trong allowlist |
| Unauthenticated | 401 | UNAUTHORIZED | Token missing/expired |
| Forbidden (permission) | 403 | PERMISSION_DENIED | Thieu attendance.read |
| Forbidden (ownership) | 403 | FORBIDDEN_ATTENDANCE_ACCESS | Khong phai Host/Business Admin |
| Not found | 404 | MEETING_NOT_FOUND | meetingId khong ton tai |
| Wrong status | 409 | MEETING_NOT_ACTIVE_OR_COMPLETED | Meeting chua/in_progress/completed |
| System error | 500 | INTERNAL_ERROR | DB loi, unhandled exception |

---

## 10. Testing Strategy

### Unit Tests (Service)

File: src/modules/live-meeting/tests/live-meeting.service.spec.ts

| Test Case | Focus | Expected |
|---|---|---|
| Host view completed meeting | Happy path | All participants, isProvisional=false, day du meta |
| Host view in_progress meeting | Provisional absent | Unchecked-in co isProvisional=true |
| Late detection | Threshold check | Check-in 09:12 vs threshold 09:10 -> late |
| On-time check-in | Threshold check | Check-in 09:08 vs threshold 09:10 -> checked_in |
| Fallback actual_start_time | Null handling | actual_start_time null -> dung start_time |
| Early check-in override late | FR-023 | present + check_in > threshold -> late |
| Earliest check-in (multiple records) | FR-037 | MIN(check_in_time) |
| Fallback attendance_events | Missing attendance record | MIN(event_time) |
| Removed participant with attendance | FR-038b | Included, participantState=removed |
| Removed participant without attendance | FR-038b | Excluded from results |
| Status filter | FR-008 | ?status=late chi tra ve late |
| Search | FR-009 | ?q=Nguyen matching |
| Meeting not found | ERR-007 | throw MEETING_NOT_FOUND |
| Wrong status | ERR-008 | throw MEETING_NOT_ACTIVE_OR_COMPLETED |
| Not host/admin | ERR-006 | throw FORBIDDEN_ATTENDANCE_ACCESS |
| Business Admin access | FR-033 | Success cho bat ky meeting |
| Pagination defaults | Default page=1 pageSize=20 | FR-029b |
| Audit log written | FR-039 | Check audit_logs call |

### Unit Tests (Controller)

File: src/modules/live-meeting/tests/live-meeting.controller.spec.ts

| Test Case | Focus | Expected |
|---|---|---|
| Happy path response shape | Status 200, dung data/meta format | Response dung schema |
| Invalid UUID | 422 | VALIDATION_ERROR |
| Auth guard | 401 without token | UNAUTHORIZED |
| Permission guard | 403 without attendance.read | PERMISSION_DENIED |

### DTO Validation Tests

File: src/modules/live-meeting/dto/attendance-query.dto.spec.ts (optional)

### Test Coverage Targets

- Service: 100% business logic branches
- Controller: response shape + status codes
- DTO: validation pipes (pageSize default/range, status allowlist)

---

## 11. Implementation Phases

| Phase | Tasks | Output |
|---|---|---|
| 1 | Constants: error constants + types | constants/meeting-attendance-error.constant.ts, types/ |
| 2 | Query DTO + Response DTO | dto/attendance-query.dto.ts, dto/attendance-response.dto.ts |
| 3 | Service method: getMeetingAttendance() | services/live-meeting.service.ts (them method) |
| 4 | Controller endpoint | controllers/live-meeting.controller.ts (them/update endpoint) |
| 5 | Unit tests: service + controller | tests/live-meeting.service.spec.ts, .controller.spec.ts |

### File Changes

**New files:**
- src/modules/live-meeting/constants/meeting-attendance-error.constant.ts
- src/modules/live-meeting/dto/attendance-query.dto.ts
- src/modules/live-meeting/dto/attendance-response.dto.ts
- src/modules/live-meeting/types/attendance-participant.type.ts

**Modified files:**
- src/modules/live-meeting/dto/index.ts (export new DTOs)
- src/modules/live-meeting/controllers/live-meeting.controller.ts
- src/modules/live-meeting/services/live-meeting.service.ts
- src/modules/live-meeting/tests/live-meeting.service.spec.ts
- src/modules/live-meeting/tests/live-meeting.controller.spec.ts

**No change:**
- Database schema (no migration)
- Entities (no new entity)
- Other modules
- Seed data
- WebSocket Gateway

---

## 12. Risks & Mitigations

| Risk | Impact | Mitigation |
|---|---|---|
| attendance_records duplicate cho cung meeting+user | Late tinh sai | DISTINCT + MIN(check_in_time), use earliest |
| attendance_events thieu index | Query cham | Kiem tra index (meeting_id, user_id, event_type, event_time) |
| system_configs key khong ton tai | Threshold khong xac dinh | Default 10 phut (FR-017) |
| Audit log blocking response | Latency | Fire-and-forget (Promise without await) |
| Removed participant edge case | Thieu hoac sai du lieu | FR-038b: chi include neu co attendance_record |
| Large dataset > 10000 participants | Memory/performance | Force pageSize max 100, SQL pagination |
| Sorting theo attendance_status | Custom sort logic | Dung CASE WHEN trong ORDER BY |

---

## 13. Acceptance Criteria Traceability

| AC ID | Scenario | Test Phase | Focus |
|---|---|---|---|
| AC-001 | Completed, Host views | P3 (service) | isProvisional=false, meta day du |
| AC-002 | In_progress, Host views | P3 (service) | Unchecked-in isProvisional=true |
| AC-003 | Check-in 09:12, threshold 09:10 | P3 (service) | Status = late |
| AC-004 | Check-in 09:08, threshold 09:10 | P3 (service) | Status = checked_in |
| AC-005 | No actual_start_time | P3 (service) | Fallback start_time -> threshold 09:10 |
| AC-006 | ?status=late filter | P3 (service) | Chi late participants |
| AC-007 | ?q=Nguyen search | P3 (service) | Matching results |
| AC-008 | No auth | P4 (controller) | 401 |
| AC-009 | Regular participant | P3 (service) | 403 |
| AC-010 | Business Admin | P3 (service) | Success |
| AC-011 | Scheduled | P3 (service) | 409 |
| AC-012 | Cancelled | P3 (service) | 409 |
| AC-013 | Extension threshold | P3 (service) | actual_start_time unchanged |
| AC-014 | Extension attendance | P3 (service) | Data from same meeting_id |
| AC-015 | Audit log | P3 (service) | action_type=read_meeting_attendance |

---

## 14. File Structure Changes

### New files

`
src/modules/live-meeting/
  constants/meeting-attendance-error.constant.ts
  dto/attendance-query.dto.ts
  dto/attendance-response.dto.ts
  types/attendance-participant.type.ts
`

### Modified files

`
src/modules/live-meeting/
  controllers/live-meeting.controller.ts
  services/live-meeting.service.ts
  dto/index.ts
  tests/live-meeting.service.spec.ts
  tests/live-meeting.controller.spec.ts
`

### No change

- Database schema (no migration)
- Entities (no new entity)
- Other modules
- WebSocket Gateway
- Seed data
