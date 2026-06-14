# Quickstart: Cancel Scheduled Meeting (UC-MM-04)

## 📝 CHANGELOG & REVISION HISTORY
| Ngày cập nhật | Tóm tắt thay đổi | Các dòng thay đổi |
| :--- | :--- | :--- |
| 2026-06-09 | Quickstart test scenarios cho UC-MM-04 | Toàn bộ file |

---

## Test Scenarios

### Happy Path

| # | Scenario | Steps | Expected Result |
|---|---|---|---|
| 1 | **Organizer cancels meeting** | 1. Create meeting (user A as organizer, status=scheduled)<br>2. Login as user A<br>3. POST `/meetings/:id/cancel` with reason | 200 OK, meeting cancelled, booking cancelled, events created, audit logged, notification queued |
| 2 | **Host cancels meeting** | 1. Create meeting (user A as organizer, user B as host)<br>2. Login as user B<br>3. POST `/meetings/:id/cancel` | 200 OK, meeting cancelled |
| 3 | **Admin cancels any meeting** | 1. Login as admin<br>2. POST `/meetings/:id/cancel` (user A's meeting) | 200 OK, though admin ≠ organizer/host |
| 4 | **Cancel without reason** | 1. POST `/meetings/:id/cancel` with body `{}` | 200 OK, cancellationReason = null |
| 5 | **Cancel without room booking** | 1. Create meeting with no room<br>2. Cancel | 200 OK, roomReleased=false, releasedBookingId=null |
| 6 | **Cancel with room booking** | 1. Create meeting with room<br>2. Cancel | 200 OK, roomReleased=true, booking.status='cancelled' |
| 7 | **Usage not_started → released** | 1. Create meeting with room + usage (usage_status=not_started)<br>2. Cancel | usage_status='released', released_at/released_by/release_reason set |
| 8 | **No usage record exists** | 1. Create meeting with room but no usage record<br>2. Cancel | 200 OK, no new usage record created |

### Error Cases

| # | Scenario | Steps | Expected Result |
|---|---|---|---|
| 9 | **Unauthenticated user** | 1. No Authorization header<br>2. POST | 401 Unauthorized |
| 10 | **Participant (no permission)** | 1. Login as participant (not organizer/host/admin)<br>2. POST | 403 Forbidden |
| 11 | **User has `cancel.own` but not organizer/host** | 1. Login as user C (has permission but C.id ≠ organizer_id ≠ host_id)<br>2. POST | 403 Forbidden, created_by not used |
| 12 | **Meeting in_progress** | 1. Meeting status = in_progress<br>2. POST | 409 Conflict |
| 13 | **Meeting completed** | 1. Meeting status = completed<br>2. POST | 409 Conflict |
| 14 | **Already cancelled** | 1. Meeting status = cancelled<br>2. POST | 409 Conflict |
| 15 | **Meeting already started** | 1. Meeting start_time <= now<br>2. POST | 409 Conflict |
| 16 | **Meeting not found** | 1. Non-existent meetingId<br>2. POST | 404 Not Found |
| 17 | **Invalid UUID** | 1. meetingId = "abc"<br>2. POST | 400 Bad Request |
| 18 | **Reason too long** | 1. Reason > 1000 chars<br>2. POST | 422 Unprocessable Entity |
| 19 | **Unknown field in body** | 1. Body contains `{"deleteMeeting": true}`<br>2. POST | 400 Bad Request |
| 20 | **Concurrent cancel** | 1. Send 2 identical requests simultaneously<br>2. Both POST | First: 200, Second: 409. Only 1 notification. |

### Verification Queries (after implementation)

```sql
-- Check meeting status
SELECT id, status, cancellation_reason, updated_by, updated_at
FROM meetings WHERE id = :meetingId;

-- Check booking status (if applicable)
SELECT id, status, cancellation_reason, updated_at
FROM room_bookings WHERE meeting_id = :meetingId;

-- Check usage status (if applicable)
SELECT id, usage_status, released_at, released_by, release_reason
FROM room_booking_usages WHERE booking_id = :bookingId;

-- Check meeting_events
SELECT event_type, old_value_json, new_value_json, metadata_json
FROM meeting_events WHERE meeting_id = :meetingId
ORDER BY event_time DESC LIMIT 1;

-- Check room_events (if applicable)
SELECT event_type FROM room_events WHERE room_id = :roomId
ORDER BY created_at DESC LIMIT 1;

-- Check audit_logs
SELECT action_type, entity_type, entity_id, old_value_json, new_value_json
FROM audit_logs WHERE entity_id = :meetingId;

-- Check notification
SELECT notification_type, subject, delivery_status
FROM notifications WHERE related_entity_id = :meetingId;

-- Check background_job
SELECT job_type, status, payload_json
FROM background_jobs ORDER BY created_at DESC LIMIT 1;
```

### Things to Verify After Implementation

- [ ] Meeting query không còn trả về meeting `scheduled` (đã `cancelled`)
- [ ] Room availability check bỏ qua booking đã `cancelled`
- [ ] Notification subject bắt đầu bằng `[CANCELLED]` hoặc `[ĐÃ HỦY]`
- [ ] Notification content bao gồm cancellation reason (nếu có)
- [ ] Email/notif gửi đến cả internal + external participants
- [ ] `cancelledAt` trong response === `updatedAt` của meeting
- [ ] Usage `in_use` không bị thay đổi khi cancel
- [ ] Không tạo usage record mới nếu chưa có
- [ ] `roomReleased = true` chỉ khi có booking được release
- [ ] Meeting soft-deleted (`deletedAt != null`) → 404, không cho cancel
- [ ] Permission seed: `meeting.cancel.own` và `meeting.cancel.any` tồn tại trong DB
