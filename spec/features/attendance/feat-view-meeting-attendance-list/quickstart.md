# Quickstart: UC-APM-02

## Test Scenarios

### Happy Path
1. Host view -> full data + attendanceSource
2. Participant view -> basic status only
3. Business Admin view -> full data
4. Manager (1-level) view -> full data for direct reports

### Validation
5. Invalid meetingId UUID -> 400
6. Invalid status filter -> 400
7. Search > 100 chars -> 400

### Authorization
8. Unauthenticated -> 401
9. No permission -> 403
10. Meeting soft-deleted -> 404
11. Meeting future (now < start_time) -> 409 ATTENDANCE_NOT_OPEN_YET

### Business Rules
12. scheduled + now >= start_time -> return list, not_checked_in
13. completed + no check-in -> absent
14. check-in <= start_time -> present, isLate=false
15. check-in > start_time by 1s -> late, lateMinutes=1
16. left_early -> status=left_early
17. search filters correctly
18. status filter works
19. Summary counts accurate
