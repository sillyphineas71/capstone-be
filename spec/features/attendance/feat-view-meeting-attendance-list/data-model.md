# Data Model: UC-APM-02

## Entities (Read-only)

- **meetings**: id, title, status, start_time, end_time, organizer_id, host_id, room_id, deleted_at
- **meeting_participants**: id, meeting_id, user_id, participant_role, invitation_status, attendance_status, deleted_at
- **users**: id, full_name, avatar_url, department_id, position_title, direct_manager_id, employee_code, email
- **departments**: id, department_name
- **attendance_records**: id, meeting_id, participant_id, user_id, check_in_method, attendance_source, check_in_time, is_present, is_late, left_early, late_minutes, attendance_status, confidence_score

## Setting derivation logic

1. No record OR check_in_time IS NULL -> not_checked_in (in_progress) / absent (completed)
2. left_early = true -> left_early
3. attendance_status = pending_review -> pending_review
4. check_in_time > start_time -> late, lateMinutes=CEIL((check_in_time-start_time)/60)
5. check_in_time <= start_time -> present, isLate=false
6. Prefer existing attendance_status if valid
