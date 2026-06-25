# Quickstart — Bắt đầu phiên họp (UC-IMM-01)

## Test Scenarios

### Happy Path — Manual Start
1. Tạo meeting với `status = scheduled`, `start_time = T+10m`, `end_time = T+60m`, có `room_id`, có `host_id`.
2. Đảm bảo có `room_bookings` (status=approved) và `room_booking_usages` (usage_status=not_started).
3. Gọi `POST /api/v1/live-meetings/{meetingId}/start` với JWT của host.
4. **Expect**: 200 OK, `data.status = in_progress`, `data.actualStartTime` không null.
5. Kiểm tra: `meetings.status = in_progress`, `actual_start_time` được set.
6. Kiểm tra: `meeting_events` có record với `event_type = meeting_started`.
7. Kiểm tra: `room_bookings.status = active`.
8. Kiểm tra: `room_booking_usages.usage_status = in_use`, `actual_start_time` được set.
9. Kiểm tra: `audit_logs` có record với `action_type = start_meeting`.

### Time Window — Too Early
1. Tạo meeting với `start_time = T+30m`.
2. Gọi start meeting ở thời điểm hiện tại (trước start_time - 15m).
3. **Expect**: 409 `MEETING_START_TOO_EARLY`.

### Time Window — Expired
1. Tạo meeting với `end_time` là quá khứ.
2. Gọi start meeting.
3. **Expect**: 409 `MEETING_START_WINDOW_EXPIRED`.

### Idempotent — Already Started
1. Start meeting thành công (lần 1).
2. Gọi start meeting lại (lần 2) với cùng meetingId.
3. **Expect**: 200 OK, `data.alreadyStarted = true`.
4. Kiểm tra: KHÔNG có `meeting_events` `meeting_started` thứ hai.
5. Kiểm tra: KHÔNG có `audit_logs` `start_meeting` thứ hai.

### Authorization — Not Host/Organizer
1. Tạo meeting với `host_id = userA`, `organizer_id = userA`.
2. Gọi start meeting với JWT của userB (không phải host/organizer).
3. **Expect**: 403 `FORBIDDEN`.

### Authorization — Missing Permission
1. Gọi start meeting với user có JWT nhưng không có `meeting.session.start`.
2. **Expect**: 403.

### Business Rule — Wrong Status (Completed)
1. Tạo meeting với `status = completed`.
2. Gọi start meeting.
3. **Expect**: 409 `MEETING_ALREADY_COMPLETED`.

### Business Rule — Wrong Status (Cancelled)
1. Tạo meeting với `status = cancelled`.
2. Gọi start meeting.
3. **Expect**: 409 `MEETING_CANCELLED`.

### Business Rule — Wrong Status (Pending Approval)
1. Tạo meeting với `status = pending_approval`.
2. Gọi start meeting.
3. **Expect**: 409 `MEETING_PENDING_APPROVAL`.

### Business Rule — Wrong Status (Draft)
1. Tạo meeting với `status = draft`.
2. Gọi start meeting.
3. **Expect**: 409 `MEETING_IN_DRAFT_STATUS`.

### Not Found — Soft Deleted
1. Tạo meeting và soft-delete nó.
2. Gọi start meeting.
3. **Expect**: 404 `MEETING_NOT_FOUND`.

### Race Condition — Concurrent Requests
1. Gửi 2 request start meeting đồng thời cho cùng meeting.
2. **Expect**: 1 request thành công, request còn lại nhận 200 OK với `alreadyStarted=true`.

## Verification Checklist (Post-Implementation)

- [ ] API returns 200 with `in_progress` status and `actualStartTime`.
- [ ] `room_bookings.status` updated to `active`.
- [ ] `room_booking_usages.usage_status` updated to `in_use`.
- [ ] `meeting_events` has `meeting_started` event.
- [ ] `audit_logs` has `start_meeting` action.
- [ ] Time window rules enforced correctly (±15m edge).
- [ ] Host only — Organizer also allowed.
- [ ] Idempotent: second call returns `alreadyStarted=true` without duplicate events.
- [ ] Race condition handled by `SELECT FOR UPDATE`.
- [ ] AF1 internal service call works.
- [ ] MeetingEventSourceType.DEVICE added.
- [ ] Permission `meeting.session.start` seeded.
