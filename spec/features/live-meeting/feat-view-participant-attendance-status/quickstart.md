# Quickstart: UC-IMM-08 View Participant Attendance Status

**Date**: 2026-06-17

## Test Scenarios

1. Completed meeting, Host views: 200, isProvisional=false for all
2. In_progress meeting, Host views: unchecked-in has isProvisional=true
3. Late detection: check-in 09:12 vs threshold 09:10 -> late
4. On-time check-in: check-in 09:08 vs threshold 09:10 -> checked_in
5. Early check-in override: present + check-in > threshold -> late (FR-023)
6. Earliest check-in (multiple records): MIN(check_in_time) (FR-037)
7. Fallback attendance_events: MIN(event_time) when no attendance_record
8. Removed participant WITH attendance: included, participantState=removed
9. Removed participant WITHOUT attendance: excluded
10. Status filter ?status=late: only late participants
11. Search ?q=Nguyen: matching full_name/email
12. No auth: 401
13. Regular participant: 403
14. Business Admin: success for any meeting
15. Scheduled meeting: 409
16. Cancelled meeting: 409
17. Extension: late threshold unchanged (based on original actual_start_time)
18. Audit log: action_type=read_meeting_attendance recorded

## Verification Notes

- attendanceStatus display: checked_in (not present)
- pageSize default 20, max 100
- absent in in_progress = provisional (isProvisional=true)
- removed participant with attendance kept (participantState=removed)
- LATERAL JOIN performance: check execution plan
