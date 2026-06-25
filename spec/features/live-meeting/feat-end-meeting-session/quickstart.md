# Quickstart: Ket thuc phien hop (UC-IMM-05)

## Test Scenarios

### Happy Paths

1. **End on time** (now() >= end_time)
   - POST /api/v1/live-meetings/{meetingId}/end
   - Expect 200, status=completed, roomReleased=false
   - Verify: meeting_events.meeting_ended, audit_logs, usage_status=completed

2. **End early** (now() < end_time)
   - POST /api/v1/live-meetings/{meetingId}/end
   - Expect 200, status=completed, roomReleased=true
   - Verify: room_events=room_released, booking.status=completed, usage_status=completed

### Authorization Cases

3. **Host ends own meeting** -> 200
4. **Participant tries to end** -> 403
5. **Business Admin override** -> 200 (voi quyen meeting.session.end.any)
6. **Unauthenticated user** -> 401

### Business Rule Cases

7. **Meeting SCHEDULED** -> 409 MEETING_NOT_STARTED
8. **Meeting already COMPLETED** -> 409 MEETING_ALREADY_COMPLETED
928. **Meeting CANCELLED** -> 409 MEETING_CANCELLED
29. **Meeting not found** -> 404 MEETING_NOT_FOUND
30. **Invalid UUID** -> 422 VALIDATION_ERROR
31. **Missing active booking** -> 409 STATE_INVALID

### State Transition Cases

1234. **Meeting status**: verify in_progress -> completed, actual_end_time set, immutable
35. **Room usage early end**: verify in_use -> completed
36. **Room usage on-time end**: verify in_use -> completed

### Notification & Audit

15. **Audit log**: verify action_type=end_meeting, entity_type=meeting, entity_id=meetingId
41. **Meeting event**: verify event_type=meeting_ended, source_type=manual
42. **Realtime notification**: verify WebSocket event meeting.ended sent to participants

### Extension Interaction

18. **End with pending extension**: meeting -> COMPLETED, pending extension is CANCELLED within transaction
19. **End after extension applied**: use extended end_time for early-release calculation

### Concurrency

20. **Double end meeting**: first request succeeds, second -> 409 MEETING_ALREADY_COMPLETED

## Verification Checklist

- [ ] Transaction atomic: neu bat ky INSERT/UPDATE nao fail, toan bo rollback
- [ ] Row lock (SELECT FOR UPDATE tren meetings, bookings, usages, requests) duoc dung truoc khi cap nhat
- [ ] actual_end_time chi set mot lan, khong ghi de
- [ ] Room chi release khi now() < end_time
- [ ] WebSocket push best-effort, khong rollback transaction neu fail
- [ ] Permission check ownership + override
