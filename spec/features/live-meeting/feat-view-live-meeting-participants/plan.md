# Implementation Plan: Xem danh sach nguoi tham du dang co mat (View Live Meeting Participants)

**Branch**: `feat-view-live-meeting-participants` | **Date**: 2026-06-17 | **Spec**: spec.md

---

## 1. Feature Summary

Tao endpoint `GET /api/v1/live-meetings/{meetingId}/present-attendees` cho phep Host/Business Admin xem realtime danh sach nguoi dang co mat trong phien hop dang dien ra.

PresenceStatus chi su dung 5 trang thai tu DB: `present`, `maybe_present`, `left`, `absent`, `unknown`.
Field-level authorization: Participant thuong khong thay presenceSource/confidenceScore/checkInTime/lastSeenAt cua nguoi khac.
Audit: Ghi `audit_logs` non-blocking voi action `read_live_participants`.

---

## 2. Technical Context

| Muc | Gia tri |
|---|---|
| Language/Version | TypeScript (NestJS 10+) |
| Framework | NestJS |
| ORM | TypeORM |
| Database | PostgreSQL (v3.2 Compact - 39 tables) |
| Auth | JWT + RBAC (JwtAuthGuard, PermissionsGuard, RequirePermissions) |
| Testing | Jest |
| Module hien tai | live-meeting (da co controller, service, dto, types, constants) |
| Endpoint prefix | /api/v1 |
| Response convention | { success, message, data, meta } |
| Performance Goals | Response < 3s cho 20-100 participants, 50 concurrent requests |
| Constraints | Read-only, khong tao/sua/xoa data, khong add bang moi, khong WebSocket bat buoc |

### Pattern reuse

- Controller: `@UseGuards(JwtAuthGuard, PermissionsGuard)` + `@RequirePermissions(...)`, lay user tu `request['user']`
- Service: throw `NotFoundException`/`ConflictException`/`ForbiddenException`
- DTO: class-validator + Swagger decorators
- Error constants: file rieng trong `constants/`
- Audit log: `AuditLogEntity` qua `em.create()` + `em.save()`

---

## 3. Scope Confirmation

### In Scope

- Tao endpoint `GET /api/v1/live-meetings/{meetingId}/present-attendees`
- Kiem tra authentication + permission `meeting.presence.read`
- Kiem tra ownership: Host cua meeting, Business Admin, System Admin
- Truy xuat presence data tu `meeting_participants` + `users` + `departments` + `attendance_records` + `presence_snapshots`
- Field-level authorization cho Participant thuong
- Search (`?search=`), filter (`?departmentId=`), pagination (`?page=&limit=`), sort (`?sortBy=&sortOrder=`)
- Audit log non-blocking
- 5 presenceStatus: present, maybe_present, left, absent, unknown
- joinedAt priority: attendance_records.check_in_time > attendance_events.event_time > meeting_participants.joined_at
- Grace window: scheduled meeting cho phep khi [start_time, end_time + 30m]

### Out of Scope

Xem spec.md Section 8.

---

## 4. Data Model Impact

Khong thay doi schema (khong them bang, khong them cot, khong migration).

### Tables doc (read-only)

| Table | Fields su dung | Role |
|---|---|---|
| meetings | id, status, start_time, end_time, room_id, host_id, organizer_id, deleted_at | Kiem tra status, time window, ownership |
| meeting_participants | meeting_id, user_id, participant_role, invitation_status, joined_at | Internal participants |
| users | id, full_name, email, avatar_url, department_id | Thong tin hien thi |
| departments | id, department_name | Phong ban |
| attendance_records | meeting_id, user_id, check_in_time, attendance_status, attendance_source, checkout_time, updated_at | Check-in status + source |
| attendance_events | meeting_id, user_id, event_type, event_time | Fallback joinedAt |
| presence_snapshots | room_id, user_id, presence_status, source, snapshot_time, confidence, metadata_json | Presence realtime |
| rooms | id, room_name, current_status | AF Admin |
| audit_logs | userId, actionType, entityType, entityId, newValueJson, ipAddress, userAgent, severity | Audit |

---

## 5. API / Contract Plan

### Endpoint

`GET /api/v1/live-meetings/{meetingId}/present-attendees`
Permission: `meeting.presence.read`

### Query Params

| Param | Type | Required | Default | Description |
|---|---|---|---|---|
| search | string | No | - | Tim kiem full_name/email (max 100) |
| departmentId | UUID | No | - | Loc phong ban |
| page | int | No | 1 | So trang |
| limit | int | No | 20 | So ban ghi (1-100) |
| sortBy | string | No | full_name | Allowlist: full_name, department_name, presence_status, joined_at |
| sortOrder | string | No | asc | asc / desc |

### Error Codes

| HTTP | Error Code | When |
|---:|---|---|
| 400 | INVALID_QUERY | search > 100, page/limit invalid |
| 401 | UNAUTHORIZED | Token missing/expired |
| 403 | FORBIDDEN_LIVE_PARTICIPANTS_ACCESS | Khong phai Host/Admin |
| 404 | MEETING_NOT_FOUND | Meeting khong ton tai |
| 409 | MEETING_NOT_IN_PROGRESS | Meeting chua/buoc vao in_progress |
| 500 | INTERNAL_ERROR | Loi server |

---

## 6. Authorization Plan

### Permission check flow

1. `JwtAuthGuard` (xac thuc JWT)
2. `RequirePermissions('meeting.presence.read')`
3. Service layer ownership check:
   - Host: `meetings.host_id === currentUserId` hoac `participant_role = 'host'`
   - Business Admin / System Admin: check permissions/roles
   - Neu khong: throw `ForbiddenException` voi code `FORBIDDEN_LIVE_PARTICIPANTS_ACCESS`

### Field-level authorization

| Role | presenceSource | confidenceScore | checkInTime | joinedAt | lastSeenAt |
|---|---|---|---|---|---|
| Host | full | full | full | full | full |
| Business Admin | full | full | full | full | full |
| System Admin | full | full | full | full | full |
| Participant (others) | null | null | null | null | null |
| Participant (self) | full | null | full | null | null |

---

## 7. Business Logic Plan

### Flow

```
Request
  -> JwtAuthGuard (401)
  -> PermissionsGuard + meeting.presence.read (403)
  -> Controller: ParseUUIDPipe(meetingId), lay currentUserId
  -> Service.getPresentAttendees(meetingId, currentUserId, query)
       1. Load meeting (meetingsRepo.findOne)
          - null -> throw MEETING_NOT_FOUND
       2. Kiem tra status + time window:
          - IN_PROGRESS: OK
          - SCHEDULED + [start_time <= now <= end_time + 30m]: OK
          - Con lai: throw MEETING_NOT_IN_PROGRESS
       3. Kiem tra authorization:
          - Host: meetings.host_id === currentUserId
          - Host: meeting_participants co participant_role = 'host'
          - Business/System Admin: check permissions/roles
          - Neu khong: throw FORBIDDEN_LIVE_PARTICIPANTS_ACCESS
       4. Query internal participants (QueryBuilder with LEFT JOINs)
       5. Map presenceStatus theo priority
       6. Map joinedAt theo priority
       7. Ap dung search/filter/pagination/sort
       8. Dem occupancyCount
       9. Field-level authorization mapping
       10. Ghi audit log (non-blocking)
       11. Return response
```

### PresenceStatus mapping priority

1. `presence_snapshots.presence_status = 'present'` -> present
2. `attendance_records.attendance_status IN ('present','late')` -> present
3. `presence_snapshots.presence_status = 'maybe_present'` -> maybe_present
4. Co attendance_record + checkout_time -> left
5. `attendance_records.attendance_status = 'absent'` -> absent
6. Default -> unknown

---

## 8. Validation Plan

| Field | Validation |
|---|---|
| meetingId | ParseUUIDPipe |
| search | Trim, max 100 chars, printable only |
| departmentId | UUID format (optional) |
| page | >= 1, default 1 |
| limit | >= 1, <= 100, default 20 |
| sortBy | Allowlist: full_name, department_name, presence_status, joined_at |
| sortOrder | asc / desc |

---

## 9. Error Handling Plan

| Error | HTTP | Code | Condition |
|---|---|---|---|
| UUID invalid | 400 | INVALID_QUERY | meetingId/departmentId sai format |
| Search too long | 400 | INVALID_QUERY | search > 100 |
| Page/limit invalid | 400 | INVALID_QUERY | page < 1, limit < 1 or > 100 |
| Unauthenticated | 401 | UNAUTHORIZED | Token missing/expired |
| Forbidden | 403 | FORBIDDEN_LIVE_PARTICIPANTS_ACCESS | Khong phai Host/Admin |
| Not found | 404 | MEETING_NOT_FOUND | meetingId khong ton tai |
| Not in progress | 409 | MEETING_NOT_IN_PROGRESS | Status khong phu hop |
| System error | 500 | INTERNAL_ERROR | DB loi, unhandled exception |

---

## 10. Testing Strategy

### Unit Tests

- `getPresentAttendees` happy path (Host full view)
- `getPresentAttendees` not found (404)
- `getPresentAttendees` wrong status (409)
- `getPresentAttendees` forbidden (403)
- Field-level filtering (Participant limited view, self-view)
- Search + department filter
- Controller response shape

### Test Coverage Targets

- Service: 100% coverage business logic
- Controller: response shape + status codes
- DTO: validation pipes

---

## 11. Implementation Phases

| Phase | Tasks | Output |
|---|---|---|
| 1 | Error constants + Types | `constants/present-attendees-error.constant.ts`, `types/present-attendee.type.ts` |
| 2 | Response DTO | `dto/present-attendees-response.dto.ts`, update `dto/index.ts` |
| 3 | Service method | `LiveMeetingService.getPresentAttendees()` |
| 4 | Controller endpoint | `LiveMeetingController.getPresentAttendees()` |
| 5 | Unit tests | Update `live-meeting.service.spec.ts`, `live-meeting.controller.spec.ts` |

---

## 12. Risks & Mitigations

| Risk | Impact | Mitigation |
|---|---|---|
| presence_snapshots thieu index (room_id, user_id) | Query cham | Kiem tra index, de xuat migration neu can |
| attendance_records duplicate | Duplicate participant | DISTINCT ON (user_id) ORDER BY updated_at DESC |
| Audit log blocking response | Latency | Fire-and-forget (Promise without await) |
| Field-level auth leak | Security leak | Enforce o service layer, khong dua vao frontend |
| Large result set > 100 | Slow response | Force pagination (max limit = 100) |

---

## 13. Acceptance Criteria Traceability

| AC ID | Kich ban | Test focus |
|---|---|---|
| AC-001 | Host full view | Service: isHost=true, response day du fields |
| AC-002 | Admin room monitoring | Service: isAdmin=true, kiem tra occupancyCount |
| AC-003 | Participant field limited | Field-level filtering -> fields = null |
| AC-004 | Participant self-view | isSelf=true -> presenceSource, checkInTime hien thi |
| AC-005 | Scheduled + grace window | Status check -> 200 |
| AC-006 | Scheduled + out window | Status check -> 409 |
| AC-007 | Meeting not found | meetingRepo.findOne -> 404 |
| AC-008 | Forbidden | Auth check -> 403 |
| AC-009 | Search | search param -> filtered results |
| AC-010 | Department filter | departmentId param -> filtered |
| AC-011 | Audit log | Check audit_logs table |

---

## 14. File Structure Changes

### New files

```
src/modules/live-meeting/
  constants/present-attendees-error.constant.ts
  types/present-attendee.type.ts
  dto/present-attendees-response.dto.ts
```

### Modified files

```
src/modules/live-meeting/
  controllers/live-meeting.controller.ts
  services/live-meeting.service.ts
  dto/index.ts
  tests/live-meeting.service.spec.ts
  tests/live-meeting.controller.spec.ts
```

### No change

- Database schema (no migration)
- Entities (no new entity)
- Other modules
- WebSocket Gateway
- Seed data
