# API Contract: View Meeting Attendance (UC-IMM-08)

**Base URL**: /api/v1

## GET /api/v1/meetings/{meetingId}/attendance

### Path Params
meetingId: UUID (required)

### Query Params
status, q, page, pageSize, sortBy, sortOrder (see spec for details)

### Response 200
JSON with meetingId, meetingStatus, participants array (userId, fullName,
attendanceStatus, checkInTime, isProvisional, participantState), meta.

### Error Codes
422 VALIDATION_ERROR (invalid input)
401 UNAUTHORIZED (no auth)
403 PERMISSION_DENIED (lacks attendance.read)
403 FORBIDDEN_ATTENDANCE_ACCESS (not Host nor Admin)
404 MEETING_NOT_FOUND (not found)
409 MEETING_NOT_ACTIVE_OR_COMPLETED (wrong status)
500 INTERNAL_ERROR (server error)
