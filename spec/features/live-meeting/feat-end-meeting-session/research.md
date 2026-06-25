# Research: Kết thúc phiên họp (End Meeting Session)

## CHANGELOG
| Ngay | Tom tat |
|------|---------|
| 2026-06-17 | Tao research cho UC-IMM-05 |

## Codebase Analysis

### Existing Patterns (tu UC-IMM-01 va UC-IMM-03)

**Transaction Pattern**: `LiveMeetingService` dung `DataSource.transaction()` voi `pessimistic_write` lock tren `meetings` row.

**Service Pattern**: Service nhan `(meetingId, authUser, clientContext?)` -> validate -> transaction -> post-transaction side-effects.

**Error Handling**: Dung NestJS `NotFoundException`, `ConflictException`, `BadRequestException` voi payload format `{ success, message, error: { code, details } }`.

**Event/Audit**: Dung `MeetingEventEntity`, `AuditLogEntity` voi `oldValueJson`/`newValueJson`.

**WebSocket**: Dung `WebsocketService.pushToMeeting` sau transaction commit (best-effort).

**DTO Pattern**: DTO class voi constructor(Object.assign), response format `{ success, message, data }`.

### Available Entities & Imports

| Entity | Module | Usage |
| --- | --- | --- |
| MeetingEntity | meetings | meetings table - UPDATE status, actual_end_time |
| MeetingEventEntity | meetings | meeting_events - INSERT meeting_ended |
| MeetingEventType | meetings | Enum meeting_started, meeting_ended |
| RoomBookingEntity | rooms | room_bookings - UPDATE status = completed |
| RoomBookingStatus | rooms | Enum: approved, active, completed |
| RoomBookingUsageEntity | rooms | room_booking_usages - UPDATE actual_end_time, usage_status |
| RoomUsageStatus | rooms | Enum: not_started, in_use, completed |
| RoomEventEntity | rooms | room_events - INSERT room_released |
| AuditLogEntity | administration | audit_logs - INSERT end_meeting audit |
| WebsocketService | websocket | pushToMeeting for realtime notification |
| AuthUser | common | { userId: string } payload |
| MeetingStatus | meetings | Enum: scheduled, in_progress, completed, cancelled |
| MeetingEventSourceType | meetings | Enum: manual, device |

### Dependencies / Integrations

- Module `live-meeting` hien tai import: `AuthModule`, `WebsocketModule`.
- `AdministrationModule` la @Global nen `AuditLogEntity` co san.
- Entities tu `MeetingsModule` va `RoomsModule` truy cap qua TypeORM repository.
- Can check `RoomEventEntity` co san trong entity exports cua `RoomsModule` khong.
- Permission `meeting.session.end` va `meeting.session.end.any` can duoc seed neu chua ton tai.
- WebSocket event type `meeting.session.ended` can align voi `meeting.session.started` hien co.

## Technology Decisions

| Decision | Choice | Rationale |
|----------|--------|-----------|
| ORM | TypeORM | Align voi codebase hien tai |
| Lock mechanism | pessimistic_write (SELECT FOR UPDATE) | Giong UC-IMM-01 |
| Transaction | DataSource.transaction() | Reuse pattern hien co |
| Error codes | MEETING_END_ERRORS constant object | Kem STATE_INVALID (409) cho active booking |
| Room release | now() < end_time -> update usage (completed) + booking + create room_event (room_released) | Logic spec |
| Permission check | @RequirePermissions('meeting.session.end') + ownership check | Controller guard + service verify |
| WebSocket | WebsocketService.pushToMeeting | Reuse existing service |
| Audit | AuditLogEntity via em.create/save | Giong UC-IMM-01 |
| MeetingEvent | MeetingEventEntity via em.create/save | Giong UC-IMM-01 |

## Unknowns Resolved

- **MeetingEventType cho meeting_ended**: Dung `MeetingEventType.MEETING_ENDED`.
- **RoomEvent type**: Dung `room_released`.
- **WebSocket event name**: `meeting.ended` voi payload payload toi thieu { meetingId, status: 'completed', actualEndTime, roomReleased, endedBy }.
- **Pending Extension**: Bat buoc cancel trong cung transaction.
- **Usage Status**: Luon luon la `completed`, khong su dung `released`.
- **Active Booking**: Bat buoc kiem tra ton tai active booking, neu khong throw `STATE_INVALID`.

## Risks

1. RoomEvent entity chua exported -> can verify truoc implement.
2. Permission seed chua co -> can migration moi.
