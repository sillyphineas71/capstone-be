# Data Model: Ket thuc phien hop (UC-IMM-05)

> Khong them bang moi. Toan bo dung bang co san trong DB v3.2 Compact.

## Entities Involved

### meetings (UPDATE)

| Field | Operation | Value |
|-------|-----------|-------|
| status | UPDATE | `completed` (tu `in_progress`) |
| actual_end_time | SET | `now()` (server time) |
| updated_by | SET | currentUserId |
| updated_at | SET | now() |

State transition: `in_progress` -> `completed` (terminal)

### meeting_events (INSERT)

| Field | Value |
|-------|-------|
| event_type | `meeting_ended` |
| meeting_id | meetingId |
| event_time | now() |
| actor_user_id | currentUserId |
| source_type | `manual` |
| description | 'Phien hop ket thuc' |
| old_value_json | { status: 'in_progress', actualEndTime: null } |
| new_value_json | { status: 'completed', actualEndTime: '...' } |

### room_bookings (UPDATE)

| Field | Operation | Dieu kien |
|-------|-----------|-----------|
| status | UPDATE -> `completed` | Luon luon (booking phai dang `active`) |

### room_booking_usages (UPDATE)

| Field | Operation | Gia tri |
|-------|-----------|--------|
| actual_end_time | SET | now() |
| usage_status | SET | `completed` (luon luon, cho ca end som hay tre) |

### meeting_requests (UPDATE)

| Field | Operation | Gia tri |
|-------|-----------|--------|
| approval_status | UPDATE | `cancelled` |
| decision_by | SET | currentUserId |
| decision_at | SET | now() |
| notes | SET | 'Cancelled because meeting was ended by Host/Business Admin before extension decision.' |

### room_events (INSERT - chi khi end som)

| Field | Value |
|-------|-------|
| event_type | `room_released` |
| metadata_json | { reason: 'meeting_ended_early', plannedEndTime, actualEndTime } |
| room_id | roomId tu booking |
| meeting_id | meetingId (reference) |
| event_time | now() |
| description | 'Room released because meeting ended early.' |

### audit_logs (INSERT)

| Field | Value |
|-------|-------|
| user_id | currentUserId |
| action_type | `end_meeting` |
| entity_type | `meeting` |
| entity_id | meetingId |
| old_value_json | { status, actualEndTime } |
| new_value_json | { status, actualEndTime } |
| ip_address | clientContext.ipAddress |
| user_agent | clientContext.userAgent |
| severity | `INFO` |

### notifications (INSERT)

| Field | Value |
|-------|-------|
| notification_type | `meeting_ended` |
| channel | `in_app` |
| priority | `high` |
| meeting_id | meetingId |

## State Transitions

```
Meeting:    IN_PROGRESS -> COMPLETED
Booking:    ACTIVE -> COMPLETED
Usage:      IN_USE -> COMPLETED       (luon luon)
RoomEvent:              ROOM_RELEASED (khi end som)
Request:    PENDING -> CANCELLED      (voi extension request)
```

## Transaction Boundary

1. LOCK tren `meetings`, `room_bookings` (active), `room_booking_usages`, và `meeting_requests` (pending)
2. Validate meeting exists, status = IN_PROGRESS, active booking exists (neu khong -> 409 STATE_INVALID)
3. UPDATE meetings (status, actual_end_time, updated_by, updated_at)
4. UPDATE room_bookings (status=completed)
5. UPDATE room_booking_usages (actual_end_time, usage_status=completed)
6. UPDATE meeting_requests (approval_status=cancelled)
7. IF now() < end_time: INSERT room_events (room_released)
8. INSERT meeting_events (meeting_ended)
9. INSERT audit_logs (end_meeting)
10. COMMIT
11. POST-COMMIT: WebSocket push (best-effort)

## Data Constraints

- `meetings.actual_end_time` phai NULL truoc khi end (neu co -> MEETING_ALREADY_COMPLETED)
- `meetings.status` phai = `in_progress`
- User phai la host hoac co permission `meeting.session.end` hoac `meeting.session.end.any`
