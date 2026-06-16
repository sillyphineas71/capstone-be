# Quickstart: Send Check-in Alerts (UC-APM-10)

**Date**: 2026-06-16 | **Spec**: spec.md

## Test Scenarios

### TC-01: Happy path — Send alerts to missing required participants
**Given**: Meeting in_progress, grace period = 5 min, 2 required participants not checked_in, 1 already checked_in  
**When**: Cron job runs after grace period  
**Then**: 
- 2 email notifications created (type=late_checkin_alert)
- Host summary notification created
- MeetingEvent (attendance_checkin_alert_sent) recorded
- AuditLog recorded
- Redis idempotency keys set

### TC-02: Skip meeting — Meeting not yet past grace period
**Given**: Meeting in_progress, started 2 min ago, grace period = 5 min  
**When**: Cron job runs  
**Then**: Meeting skipped, no notifications created

### TC-03: Skip meeting — Meeting not in_progress
**Given**: Meeting scheduled (not started)  
**When**: Cron job runs  
**Then**: Meeting skipped (status != in_progress)

### TC-04: Skip participant — Already checked in
**Given**: Meeting in_progress past grace, participant has attendance_status = 'present'  
**When**: Cron job runs  
**Then**: Participant excluded, no alert sent

### TC-05: Partial failure — Participant missing email
**Given**: Meeting in_progress, participant has no email or is_active = false  
**When**: Cron job runs  
**Then**: 
- Participant skipped
- Partial failure recorded in audit metadata
- Other participants still get alerts

### TC-06: Idempotency — Duplicate cron run
**Given**: Cron job ran once successfully  
**When**: Same cron job runs again within TTL window  
**Then**: Redis idempotency keys prevent duplicate alerts

### TC-07: Internal endpoint — Manual trigger
**Given**: Valid API key, meeting in_progress past grace period  
**When**: POST /api/v1/internal/meetings/{meetingId}/late-checkin-alerts  
**Then**: 202 Accepted, same processing logic executed

### TC-08: Internal endpoint — Invalid API key
**Given**: Missing/wrong API key  
**When**: POST to internal endpoint  
**Then**: 401 Unauthorized

### TC-09: Internal endpoint — Meeting not found
**Given**: Non-existent meetingId  
**When**: POST to internal endpoint  
**Then**: 404 Not Found

### TC-10: Internal endpoint — Meeting not in_progress
**Given**: Meeting in 'scheduled' status  
**When**: POST to internal endpoint  
**Then**: 409 Conflict

### TC-11: Host summary — Not sent if no missing participants
**Given**: Meeting in_progress, all required participants checked in  
**When**: Cron job runs  
**Then**: No host summary sent, no notifications created

## Verification Checklist

After implementation, verify:

- [ ] Cron job scans only `in_progress` meetings
- [ ] Grace period uses `COALESCE(actual_start_time, start_time)`
- [ ] Filter is_required=true AND attendance_required=true
- [ ] Re-check attendance_records before sending
- [ ] Redis idempotency keys prevent duplicate alerts
- [ ] Host summary sent only once per meeting+grace period
- [ ] MeetingEvent recorded with correct type
- [ ] AuditLog recorded with action and metadata
- [ ] Partial failures logged without crashing batch
- [ ] Internal endpoint returns correct HTTP codes
- [ ] No new database tables added
