# Implementation Plan: Ket thuc phien hop (End Meeting Session)

**Branch**: `016-end-meeting-session` | **Date**: 2026-06-17 | **Spec**: [spec.md](spec.md)
**Input**: Feature specification UC-IMM-05, API Contract UC-98

## 1. Feature Summary

Cho phep Host (hoac Business Admin voi quyen override) ket thuc mot phien hop dang `IN_PROGRESS`.
He thong chuyen `meetings.status` -> `COMPLETED`, ghi `actual_end_time`, release phong neu ket thuc som,
tao meeting_events, audit_logs, va push realtime notification.

**43 Functional Requirements**, **18 Acceptance Criteria**, **10 Error Codes**.

## 2. Technical Context

| Aspect | Detail |
|--------|--------|
| Language | TypeScript (NestJS) |
| Framework | NestJS 10+ |
| Database | PostgreSQL (TypeORM) |
| ORM | TypeORM (DataSource.transaction + pessimistic_write) |
| Auth | JWT (JwtAuthGuard + PermissionsGuard) |
| Module | live-meeting (da co san) |
| Realtime | WebSocket via WebsocketService |
| Testing | Jest (unit test) |
| Codebase reference | UC-IMM-01 (start-meeting) làm pattern chính |

## 3. Scope Confirmation

**IN SCOPE**:
- End meeting dang IN_PROGRESS (Host voi `meeting.session.end`)
- Business Admin override (voi `meeting.session.end.any`)
- Update meetings, room_booking_usages, room_bookings, meeting_events, room_events, audit_logs
- Release phong neu ket thuc som
- Realtime WebSocket notification
- Xu ly pending extension request (khong auto-apply)
- Idempotent: tu choi neu da COMPLETED

**OUT OF SCOPE**:
- Bat dau phien hop (UC-IMM-01)
- Gia han phien hop (UC-IMM-02, UC-IMM-03)
- Tu dong reject pending extension request khi meeting ket thuc
- Xu ly recording/transcription/minutes khi meeting ket thuc
- Tinh presence duration (UC-89)
- Email notification
- Them bang/cot moi vao database

## 4. Data Model Impact

**KHONG them bang moi.** Tat ca cap nhat tren bang co san:

| Table | Operation | Condition |
|-------|-----------|-----------|
| meetings | UPDATE status, actual_end_time, updated_by, updated_at | Luon luon |
| meeting_events | INSERT meeting_ended | Luon luon |
| room_booking_usages | UPDATE actual_end_time, usage_status = completed | Luon luon |
| room_bookings | UPDATE status = completed | Luon luon (voi active booking) |
| room_events | INSERT room_released | Chi khi end som |
| meeting_requests | UPDATE approval_status = cancelled | Khi co pending extension |
| audit_logs | INSERT action_type = end_meeting | Luon luon |
| notifications | INSERT meeting_ended | Luon luon (in-app) |

## 5. API / Contract Plan

### Endpoint: POST /api/v1/live-meetings/{meetingId}/end

- **Permission**: `meeting.session.end` (controller-level guard)
- **Ownership check**: service-level (verify user la host/owner hoac co override)
- **Response 200**: `{ meetingId, status, actualEndTime, duration, roomReleased }`
- **No request body**
- **HTTP Statuses**: 200 (success), 401, 403, 404, 409 (business rule), 422 (validation)

### Controller Implementation

- File: `src/modules/live-meeting/controllers/live-meeting.controller.ts`
- Them method `endMeeting()` giong pattern `startMeeting()`
- `@Post('live-meetings/:meetingId/end')`, `@HttpCode(HttpStatus.OK)`, `@UseGuards(JwtAuthGuard, PermissionsGuard)`, `@RequirePermissions('meeting.session.end')`
- Lay `meetingId` tu param, `user` tu request, goi `liveMeetingService.endMeeting()`

### DTOs

- **EndMeetingResponseDto** (file moi: `src/modules/live-meeting/dto/end-meeting-response.dto.ts`)
  - meetingId: string, status: string, actualEndTime: string, duration: number, roomReleased: boolean
- Cap nhat `dto/index.ts` export DTO moi

## 6. Authorization Plan

| Level | Mechanism | Detail |
|-------|-----------|--------|
| Controller | @RequirePermissions('meeting.session.end') | Dam bao user co permission co ban |
| Service | Ownership check | User phai la host_id/owner_id cua meeting, HOAC co `meeting.session.end.any` |
| Override | `meeting.session.end.any` | Cho Business Admin / SYSTEM_ADMIN |

Service check: Neu user khong phai host/owner va khong co override -> throw 403

## 7. Business Logic Plan

### Main flow: `endMeeting(meetingId, authUser, clientContext?)`

```
1. Validate permission + ownership
2. Call executeEndMeetingInTransaction(meetingId, sourceType, actorUserId, clientContext)
   a. SELECT FOR UPDATE tren `meetings`, `room_bookings` (active), `room_booking_usages`, `meeting_requests` (pending)
   b. Check meeting exists, status = IN_PROGRESS (if already COMPLETED -> 409)
   c. Check active booking exists (neu khong -> 409 STATE_INVALID)
   d. Calculate actualEndTime = now()
   e. Compare actualEndTime with meetings.end_time
   f. UPDATE meetings: status=COMPLETED, actual_end_time, updated_by, updated_at
   g. UPDATE room_bookings: status=completed
   h. UPDATE room_booking_usages: actual_end_time, usage_status=completed
   i. UPDATE pending meeting_requests: approval_status=cancelled, notes='Cancelled because meeting was ended...'
   j. IF actualEndTime < end_time (early end):
      - INSERT room_events: event_type=room_released
   k. INSERT meeting_events: event_type=meeting_ended
   l. INSERT audit_logs: action_type=end_meeting
   m. INSERT notifications: notification_type=meeting_ended
3. Post-transaction: push WebSocket event (best-effort)
4. Calculate duration = actualEndTime - meeting.actualStartTime (phut)
5. Return EndMeetingResponseDto
```

### Extension Request Handling

- Khi end meeting, lock va cap nhat cac pending extension requests (FR-040)
- Cac request nay phai update thanh `cancelled` cung trong transaction end meeting
- FR-041: Neu extension da duoc apply truoc do, `meetings.end_time` hien tai la extended time
  -> So sanh actualEndTime voi extended end_time de quyet dinh release

## 8. Validation Plan

| Validation | Layer | Error Code | HTTP |
|------------|-------|------------|------|
| meetingId UUID format | Pipe (ParseUUIDPipe) | VALIDATION_ERROR | 422 |
| Meeting exists + not deleted | Service | MEETING_NOT_FOUND | 404 |
| Status = IN_PROGRESS | Service | MEETING_NOT_IN_PROGRESS | 409 |
| actual_end_time = null | Service | MEETING_ALREADY_COMPLETED | 409 |
| Status != SCHEDULED | Service | MEETING_NOT_STARTED | 409 |
| Status != CANCELLED | Service | MEETING_CANCELLED | 409 |
| Active booking missing | Service | STATE_INVALID | 409 |
| Is authenticated | Guard | UNAUTHORIZED | 401 |
| Has permission | Guard | PERMISSION_DENIED | 403 |
| Is Host/owner or override | Service | PERMISSION_DENIED | 403 |

## 9. Error Handling Plan

### Error Codes Constant
- File moi: `src/modules/live-meeting/constants/meeting-end-error.constant.ts`
- Giong pattern `MEETING_START_ERRORS`
- Codes: MEETING_NOT_FOUND, MEETING_NOT_IN_PROGRESS, MEETING_ALREADY_COMPLETED, MEETING_NOT_STARTED, MEETING_CANCELLED, PERMISSION_DENIED, STATE_INVALID

### Exception Handling
- Dung `NotFoundException`, `ConflictException`, `BadRequestException` tu NestJS common
- Format payload: `{ success, message, error: { code, details } }`
- Transaction rollback neu co bat ky exception nao trong transaction block

## 10. Testing Strategy

### Unit Tests (service)
- File: `src/modules/live-meeting/tests/live-meeting.service.spec.ts` (add test suite)
- Test cases:
  1. End on time: verify status, actual_end_time, usage_status=completed, no room events
  2. End early: verify usage_status=completed, room_bookings.status=completed, room_events created (room_released)
  3. Meeting not found: throw NotFoundException
  4. Meeting not IN_PROGRESS: throw 409
  5. Meeting already COMPLETED: throw 409, not override actual_end_time
  6. Unauthorized user: throw 403
  7. Business Admin override: allow
  8. Race condition: mock lock, verify only first succeeds

### Unit Tests (controller)
- File: `src/modules/live-meeting/tests/live-meeting.controller.spec.ts` (add test suite)
- Test cases:
  1. Happy path: verify route, params, response format
  2. Invalid UUID: 422
  3. Auth guard: 401 without token
  4. Permission guard: 403 without correct permission

### DTO Validation Test
- File: `src/modules/live-meeting/dto/end-meeting-response.dto.spec.ts`
- Verify DTO constructor + field types

## 11. Implementation Phases

### Phase 1: Constants & Types
- Tao `meeting-end-error.constant.ts` (ke thua pattern tu MEETING_START_ERRORS)
- Cap nhat `dto/index.ts`

### Phase 2: DTOs
- Tao `dto/end-meeting-response.dto.ts`
- Tao `dto/end-meeting-response.dto.spec.ts`

### Phase 3: Service
- Them `endMeeting()` public method
- Them `executeEndMeetingInTransaction()` private method (transaction + lock)
- Them `validateMeetingCanEnd()` private method (checks status, actual_end_time)
- Them `shouldReleaseRoom()` private helper (so sanh now() vs end_time)
- Xu ly notification INSERT + WebSocket push

### Phase 4: Controller
- Them `endMeeting()` endpoint trong `live-meeting.controller.ts`

### Phase 5: Permission Seed (neu can)
- Neu `meeting.session.end` chua co trong DB, them seed migration
- Check migration seed hien co truoc khi tao moi

### Phase 6: Tests
- Them test suite vao `live-meeting.service.spec.ts`
- Them test suite vao `live-meeting.controller.spec.ts`
- Chay toan bo tests, dam bao pass

## 12. Risks & Mitigations

| Risk | Impact | Mitigation |
|------|--------|------------|
| RoomEventEntity chua exported tu RoomsModule | Delay | Kiem tra entity exports; dung em.query raw query neu can |
| Permission `meeting.session.end` chua co seed | Blocking | Them seed migration; kiem tra migration hien co |
| WebSocket event type khong dong nhat | Bug | Kiem tra `meeting.session.started` event name thuc te |
| Extension pending + end meeting race condition | Inconsistency | Dung SELECT FOR UPDATE tranh race |
| Double-click double-submit tu UI | Duplicate | Idempotent check: actual_end_time != null -> 409 |

## 13. Acceptance Criteria Traceability

| AC ID | Test Scenario | Phase |
|-------|--------------|-------|
| AC-001 | End on time, usage=completed | P3 (service) |
| AC-002 | End early, usage=released, roomReleased=true | P3 (service) |
| AC-003 | Invalid meetingId -> 422 | P4 (controller) |
| AC-004 | Unauthenticated -> 401 | P4 (controller) |
| AC-005 | Participant -> 403 | P3 (service) |
| AC-006 | Admin override -> 200 | P3 (service) |
| AC-007 | Meeting SCHEDULED -> 409 | P3 (service) |
| AC-008 | Meeting already COMPLETED -> 409 | P3 (service) |
| AC-009 | Meeting CANCELLED -> 409 | P3 (service) |
| AC-010 | Status transition verify | P3 (service) |
| AC-011 | Room usage early end verify | P3 (service) |
| AC-012 | Room usage on-time verify | P3 (service) |
| AC-013 | Audit log created | P3 (service) |
| AC-014 | Meeting event created | P3 (service) |
| AC-015 | WebSocket push | P3 (post-transaction) |
| AC-016 | Pending extension cancelled | P3 (service) |
| AC-017 | Extension applied + early end | P3 (service) |
| AC-018 | Race condition: double end | P3 (service test) |

---

## Appendix: File Inventory

### Files to CREATE
- `src/modules/live-meeting/constants/meeting-end-error.constant.ts`
- `src/modules/live-meeting/dto/end-meeting-response.dto.ts`
- `src/modules/live-meeting/dto/end-meeting-response.dto.spec.ts`
- (Them seed migration file neu can)

### Files to MODIFY
- `src/modules/live-meeting/dto/index.ts` (export DTO moi)
- `src/modules/live-meeting/controllers/live-meeting.controller.ts` (them endMeeting method)
- `src/modules/live-meeting/services/live-meeting.service.ts` (them endMeeting methods)
- `src/modules/live-meeting/tests/live-meeting.service.spec.ts` (them test suite)
- `src/modules/live-meeting/tests/live-meeting.controller.spec.ts` (them test suite)
