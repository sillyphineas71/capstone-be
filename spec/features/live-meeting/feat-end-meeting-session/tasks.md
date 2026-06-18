# Tasks: Ket thuc phien hop (UC-IMM-05)

**Feature**: Ket thuc phien hop (End Meeting Session)
**Plan**: [plan.md](plan.md)
**Branch**: `016-end-meeting-session`
**Created**: 2026-06-17

---

## Phase 1: Constants & Types

- [x] T001 Tao `meeting-end-error.constant.ts` trong `src/modules/live-meeting/constants/`
    - Pattern: giong `MEETING_START_ERRORS`
    - Codes: MEETING_NOT_FOUND, MEETING_NOT_IN_PROGRESS, MEETING_ALREADY_COMPLETED,
      MEETING_NOT_STARTED, MEETING_CANCELLED, PERMISSION_DENIED, STATE_INVALID
    - Export MeetingEndErrorCode type

- [x] T002 Cap nhat `dto/index.ts` trong `src/modules/live-meeting/dto/`
    - Them export cho `EndMeetingResponseDto` (se tao o T003)

---

## Phase 2: DTOs

- [x] T003 Tao `end-meeting-response.dto.ts` trong `src/modules/live-meeting/dto/`
    - Fields: meetingId (string), status (string), actualEndTime (string),
      duration (number), roomReleased (boolean)
    - Constructor(data) voi Object.assign(this, data)
    - Pattern: giong `StartMeetingResponseDto`

- [x] T004 Tao `end-meeting-response.dto.spec.ts` trong `src/modules/live-meeting/dto/`
    - Unit test verify DTO constructor + all fields
    - Pattern: giong `start-meeting-response.dto.spec.ts`

---

## Phase 3: Service Logic

- [x] T005 Them `endMeeting()` public method trong `live-meeting.service.ts`
    - Signature: `endMeeting(meetingId: string, authUser: AuthUser, clientContext: ClientContext)
      -> Promise<EndMeetingResponseDto>`
    - Call `executeEndMeetingInTransaction()`
    - Calculate duration = actualEndTime - meeting.actualStartTime (phut)
    - Set roomReleased = (actualEndTime < meeting.end_time)
    - Post-transaction: push WebSocket event (best-effort)
    - Return EndMeetingResponseDto

- [x] T006 Them `executeEndMeetingInTransaction()` private method
    - Pattern: giong `executeStartMeetingInTransaction()`
    - DataSource.transaction(async (em) => { ... })
    - Step 1: SELECT FOR UPDATE tren các bảng: `meetings`, `room_bookings` (active), `room_booking_usages`, và `meeting_requests` (pending)
    - Step 2: Validate meeting exists, status = IN_PROGRESS
    - Step 3: Validate active booking exists (neu khong -> throw STATE_INVALID 409)
    - Step 4: Calculate now = new Date()
    - Step 5: UPDATE meetings (status=COMPLETED, actualEndTime=now, updatedBy, updatedAt)
    - Step 6: UPDATE room_bookings (status=COMPLETED)
    - Step 7: UPDATE room_booking_usages (actualEndTime=now, usageStatus=COMPLETED luon luon)
    - Step 8: UPDATE pending `meeting_requests` -> approval_status=cancelled, decision_by, decision_at=now, notes='Cancelled because meeting was ended by Host/Business Admin before extension decision.'
    - Step 9: IF now < meeting.end_time: INSERT room_events (eventType = 'room_released', metadata_json = { reason: 'meeting_ended_early', plannedEndTime, actualEndTime }, description)
    - Step 10: INSERT meeting_events (event_type=MEETING_ENDED, source_type=MANUAL)
    - Step 11: INSERT audit_logs (action_type='end_meeting')
    - Step 12: INSERT notification (notification_type appropriate)
    - Return actualEndTime

- [x] T007 Them `validateMeetingCanEnd()` private method
    - Check meeting.status === MeetingStatus.IN_PROGRESS
    - Check meeting.actualEndTime === null (if set -> MEETING_ALREADY_COMPLETED)
    - Map status: SCHEDULED -> MEETING_NOT_STARTED, CANCELLED -> MEETING_CANCELLED
    - Pattern: giong `validateMeetingCanStart()`

- [x] T008 Them `shouldReleaseRoom()` private helper
    - Compare actualEndTime vs meeting.end_time
    - Return boolean: true if actualEndTime < endTime

- [x] T009 Xu ly Authorization + Ownership trong `endMeeting()`
    - Load user permissions via AuthzReadRepository
    - Kiem tra: user co `meeting.session.end` khong
    - Kiem tra: user la host/owner HOAC co `meeting.session.end.any` khong
    - Neu khong thoa: throw PERMISSION_DENIED
    - Pattern: giong `decideExtension()`

- [x] T010 Xu ly WebSocket push sau transaction
    - Pattern: giong websocket push trong startMeeting
    - Event type: `meeting.ended`
    - Payload: { meetingId, status: 'completed', actualEndTime, roomReleased, endedBy }
    - Best-effort: try/catch, khong rollback transaction

---

## Phase 4: Controller

- [x] T011 Them `endMeeting()` endpoint trong `live-meeting.controller.ts`
    - Route: `@Post('live-meetings/:meetingId/end')`
    - Guard: `@UseGuards(JwtAuthGuard, PermissionsGuard)`
    - Permission: `@RequirePermissions('meeting.session.end')`
    - `@HttpCode(HttpStatus.OK)`
    - Params: meetingId (ParseUUIDPipe)
    - Inject: @Req(), @Ip(), @Headers('user-agent')
    - Call service.endMeeting(), return response format
    - Pattern: giong `startMeeting()` endpoint
    - Swagger: @ApiOperation, @ApiParam, @ApiResponse cho 200/401/403/404/409/422

---

## Phase 5: Permission Seed

- [x] T012 Kiem tra va them seed migration cho permission `meeting.session.end`
    - Kiem tra trong migration seed hien co (`src/database/seeds/`) xem permission da ton tai chua
    - Neu chua: tao migration seed file moi (format: `YYYYMMDDHHMMSS-seed-end-meeting-permission.ts`)
    - Them `meeting.session.end` vao bang `permissions`, map vao role `INTERNAL_USER`, `MANAGER`, `BUSINESS_ADMIN`, `SYSTEM_ADMIN`
    - (Option) Them `meeting.session.end.any` cho `BUSINESS_ADMIN`, `SYSTEM_ADMIN`
    - Note: `meeting.session.end` la permission co ban cho Host end meeting cua minh
    - Pattern: tham khao seed tu UC-MM-03 (20260609000001)

---

## Phase 6: Tests

- [x] T013 Them test suite `endMeeting` vao `live-meeting.service.spec.ts`
    - Test cases:
      1. End on time: now() >= end_time -> status=COMPLETED, actualEndTime set, usage=COMPLETED, roomReleased=false
      2. End early: now() < end_time -> usage=COMPLETED, roomReleased=true, room_event 'room_released' created, booking=COMPLETED
      3. Meeting not found: throw NotFoundException (MEETING_NOT_FOUND)
      4. Meeting SCHEDULED: throw 409 MEETING_NOT_STARTED
      5. Meeting already COMPLETED: throw 409 MEETING_ALREADY_COMPLETED, actualEndTime not overridden
      6. Meeting CANCELLED: throw 409 MEETING_CANCELLED
      7. Participant (not host, no override): throw 403 PERMISSION_DENIED
      8. Business Admin override: allow (user co meeting.session.end.any)
      9. Race condition: mock lock, first success, second -> 409
      10. Missing active booking: throw 409 STATE_INVALID
      11. Rollback transaction: throw error during insert/update -> transaction rollback, no WS emit
      12. WebSocket best-effort: WS emit fail sau commit -> HTTP transaction van thanh cong
      13. Pending extension: verify request duoc update thanh cancelled cung transaction
    - Pattern: giong test suite `startMeeting` trong cung file

- [x] T014 Them test suite `endMeeting` vao `live-meeting.controller.spec.ts`
    - Test cases:
      1. Happy path: verify route POST /live-meetings/:meetingId/end, params, response format
      2. Invalid UUID: 422
      3. Auth guard: 401 without token
      4. Permission guard: 403 without `meeting.session.end`
    - Pattern: giong test suite `startMeeting` trong cung file

---

## Requirements Coverage

| Task | FR | AC | Core Concern |
|------|-----|------|--------------|
| T001 | - | - | Error constants |
| T002 | - | - | DTO exports |
| T003 | - | - | Response DTO |
| T004 | - | - | DTO validation test |
| T005 | FR-001, FR-003 | AC-001, AC-002 | Public endMeeting method |
| T006 | FR-006, FR-007, FR-008, FR-009, FR-010, FR-031, FR-033, FR-034, FR-035, FR-036 | AC-001, AC-002, AC-010, AC-011, AC-012, AC-014 | Core transaction |
| T007 | FR-002, FR-019, FR-020, FR-021, FR-022 | AC-007, AC-008, AC-009 | Status validation |
| T008 | FR-009, FR-033, FR-034 | AC-001, AC-002, AC-011, AC-012 | Room release logic |
| T009 | FR-018, FR-028, FR-029, FR-030 | AC-004, AC-005, AC-006 | Authorization + ownership |
| T010 | FR-011, FR-015, FR-038, FR-039 | AC-015 | WebSocket push |
| T011 | FR-001 | AC-001, AC-002, AC-003, AC-004 | Controller endpoint |
| T012 | - | - | Permission seed |
| T013 | FR-001 -> FR-043 | AC-001 -> AC-018 | Service unit tests |
| T014 | - | AC-003, AC-004, AC-005 | Controller tests |

## Notes

- `meeting.session.end` da ton tai? Can kiem tra trong seed migration hien co
- `RoomEventEntity` da co trong RoomsModule exports? Can verify truoc T006
- WebSocket event name `meeting.ended`
- Khong can request body cho end meeting
- Tat ca cac cap nhat trong 1 transaction, rollback neu bat ky buoc nao fail
