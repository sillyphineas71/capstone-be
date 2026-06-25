# API Contract - Yeu cau gia han phien hop (UC-IMM-02)

## Endpoint: Request Meeting Extension

| Field | Value |
|---|---|
| Method | POST |
| Endpoint | /api/v1/meetings/{meetingId}/extension-requests |
| Permission | meeting.extension.request.own |
| System Role | INTERNAL_USER, MANAGER, BUSINESS_ADMIN, SYSTEM_ADMIN |
| Async | No |
| Auth | JWT Bearer token |

### Request
Path param: meetingId (UUID). Body: extensionMinutes (int), reason (string, max 500).

### Response 200/201 - Auto applied (no conflict)
Success: requestId, meetingId, approvalMode=auto, status=applied, oldEndTime, newEndTime, extensionMinutes, conflictCheckStatus=clear.

### Response 200/201 - Pending (conflict)
Success: requestId, meetingId, approvalMode=manual, status=pending, oldEndTime, requestedNewEndTime, extensionMinutes, conflictCheckStatus=blocked, managerNotificationSent=true.

### Error Codes
| HTTP | Code | Description |
|---|---|---|
| 400 | MEETING_EXTENSION_INVALID_DURATION | Invalid extensionMinutes |
| 403 | FORBIDDEN | Missing permission meeting.extension.request.own |
| 403 | MEETING_EXTENSION_NOT_HOST | Not the meeting Host |
| 404 | MEETING_NOT_FOUND | Meeting not found |
| 409 | MEETING_EXTENSION_NOT_IN_PROGRESS | Not in_progress status |
| 409 | MEETING_EXTENSION_NO_ACTIVE_BOOKING | No active room booking |
| 409 | MEETING_EXTENSION_LIMIT_EXCEEDED | Exceeded max extensions/total minutes |
| 409 | MEETING_EXTENSION_NO_APPROVER | No approver found (conflict path) |
| 500 | MEETING_EXTENSION_MANAGER_NOTIFICATION_FAILED | Failed to notify manager |

### Business Rules
- meeting.extension.request.own permission + Host ownership.
- Meeting must be in_progress with active room booking.
- Extension duration from system_configs or fallback [15,30,60].
- Max 2 applied extensions, max 60 total minutes.
- No conflict: auto-approve, update meeting/booking/usage, event, audit, WS.
- Conflict: create pending request, resolve approver, send notification with CTA view_extension_request.