# Data Model: UC-IMM-08 View Participant Attendance Status

**Date**: 2026-06-17
**Note**: Read-only. No schema changes.

## Entity Usage

### meetings
id, status (in_progress/completed gate), host_id (auth), actual_start_time (late base), start_time (fallback), deleted_at

### meeting_participants
meeting_id, user_id, participant_role, invitation_status (exclude declined), deleted_at (determine removed)

### users
id, full_name (search), email (search), avatar_url, department_id

### departments
id, department_name

### attendance_records
meeting_id, user_id, check_in_time (earliest via MIN), attendance_status (present/late/absent), created_at

### attendance_events (fallback)
meeting_id, user_id, event_type (check_in/enter_room), event_time (MIN)

### system_configs
config_key (attendance.late_threshold), config_value (int), is_active

### audit_logs (write)
action_type (read_meeting_attendance), entity_type (meeting), entity_id, actor_id

## Query Plan (QueryBuilder)

LEFT JOIN LATERAL attendance_records (MIN check_in_time)
LEFT JOIN LATERAL attendance_events (MIN event_time for check_in/enter_room)
WHERE mp.invitation_status != declined AND mp.user_id IS NOT NULL

## Status Calc
checked_in: present AND check_in <= threshold
late: late OR (present AND check_in > threshold)
absent: no record OR absent

## State
Read-only - no state transitions.
