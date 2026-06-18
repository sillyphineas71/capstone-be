# Quickstart - Yeu cau gia han phien hop (UC-IMM-02)

## Test Scenarios

### Happy Path - Auto applied (no conflict)
1. Meeting in_progress, room booking active, extensionMinutes=15, no room conflict.
2. Call POST /api/v1/meetings/{meetingId}/extension-requests with Host JWT.
3. Expect: 200/201, approvalMode=auto, status=applied, newEndTime=oldEndTime+15m.
4. Verify: meetings.end_time updated, room_bookings.reserved_end_time updated.
5. Verify: meeting_requests created (approval_mode=auto, approval_status=applied).
6. Verify: meeting_events has extension_requested, audit_logs has extend_meeting.

### Happy Path - Pending (conflict exists)
1. Meeting in_progress, room booking active, another booking exists right after.
2. Call POST with Host JWT, extensionMinutes=30.
3. Expect: 200/201, approvalMode=manual, status=pending, managerNotificationSent=true.
4. Verify: meeting_requests created (approval_mode=manual, approval_status=pending).
5. Verify: meetings.end_time NOT changed, room_bookings.reserved_end_time NOT changed.
6. Verify: notification created for Manager with CTA view_extension_request.

### Authorization - Not Host
1. Call with non-Host participant JWT.
2. Expect: 403 MEETING_EXTENSION_NOT_HOST.

### Authorization - Missing Permission
1. Call with user without meeting.extension.request.own permission.
2. Expect: 403 FORBIDDEN.

### Business Rule - Not in_progress
1. Meeting status = scheduled/completed/cancelled.
2. Call with Host JWT.
3. Expect: 409 MEETING_EXTENSION_NOT_IN_PROGRESS.

### Business Rule - No active booking
1. Meeting in_progress but no active room booking.
2. Call with Host JWT.
3. Expect: 409 MEETING_EXTENSION_NO_ACTIVE_BOOKING.

### Business Rule - Invalid duration
1. Call with extensionMinutes=10 (not in allowed set).
2. Expect: 400 MEETING_EXTENSION_INVALID_DURATION.

### Business Rule - Limit exceeded
1. Meeting already has 2 applied extensions (or 60 total minutes).
2. Call with extensionMinutes=15.
3. Expect: 409 MEETING_EXTENSION_LIMIT_EXCEEDED.

### Conflict Path - No approver found
1. Room conflict exists but Host has no direct_manager_id and department has no manager_user_id.
2. Call with Host JWT.
3. Expect: 409 MEETING_EXTENSION_NO_APPROVER.

### Conflict Path - Manager notification failure
1. Room conflict exists, approver resolved, but notification creation fails.
2. Expect: 500 MEETING_EXTENSION_MANAGER_NOTIFICATION_FAILED.

### Edge - Meeting not found (soft deleted)
1. Meeting soft-deleted.
2. Call with Host JWT.
3. Expect: 404 MEETING_NOT_FOUND.

### Edge - Multiple concurrent requests
1. Send 2 extension requests simultaneously for same meeting.
2. Expect: first succeeds, second sees updated end_time and processes normally.

## Verification Checklist (Post-Implementation)

- [ ] Auto-apply path: meetings.end_time, room_bookings.reserved_end_time updated.
- [ ] Auto-apply path: meeting_requests created (applied), meeting_events, audit_logs.
- [ ] Auto-apply path: WebSocket event pushed.
- [ ] Conflict path: meeting_requests created (pending), no data changes.
- [ ] Conflict path: Manager notification created with CTA view_extension_request.
- [ ] Conflict path: Host receives appropriate response message.
- [ ] Permission meeting.extension.request.own seeded correctly.
- [ ] MeetingEventType.EXTENSION_REQUESTED added to enum.
- [ ] Extension policy loaded from system_configs or fallback.
- [ ] Max extension count (2) and total minutes (60) enforced.
- [ ] Approver resolution: direct_manager_id -> department.manager_user_id.
- [ ] No overlap booking created in any path.
