# Data Model: Send Check-in Alerts (UC-APM-10)

**Date**: 2026-06-16 | **Spec**: spec.md

## Entity Usage

| Entity | Usage | Query Pattern | Notes |
|---|---|---|---|
| `meetings` | Scan for `in_progress` meetings past grace period | `WHERE status = 'in_progress' AND start_time <= :checkTime` | Index on `(status, start_time)` |
| `rooms` | Get room name/location for email template | JOIN `meetings.room_id` | Read-only |
| `meeting_participants` | Filter required participants | `WHERE meeting_id = :id AND is_required = true AND attendance_required = true` | Read-only |
| `users` | Get email, is_active | JOIN via `meeting_participants.user_id` | Filter `is_active = true` and `email IS NOT NULL` |
| `attendance_records` | Re-check check-in status | `WHERE meeting_id = :mid AND user_id = :uid AND check_in_time IS NOT NULL` | Latest record per user |
| `notifications` | Create alert records | INSERT only | `notification_type = 'late_checkin_alert'` |
| `meeting_events` | Log sent alerts | INSERT only | `event_type = 'attendance_checkin_alert_sent'` |
| `audit_logs` | Audit trail | INSERT only | `action_type = 'checkin_alert_sent'` |
| `system_configs` | Read config values | `WHERE config_key = :key AND is_active = true` | Cache config at cron job start |
| `background_jobs` | Enqueue email sending | INSERT via NotificationsService | Reuse existing pattern |

## No New Tables, No New Columns

Feature uses only existing 39 tables in database v3.2 compact.  
Only enum additions needed (no schema migration required).

## Enum Additions

### NotificationType enum (notification.entity.ts)
Add: `LATE_CHECKIN_ALERT = 'late_checkin_alert'`

### MeetingEventType enum (meeting-event.entity.ts)  
Add: `ATTENDANCE_CHECKIN_ALERT_SENT = 'attendance_checkin_alert_sent'`

## Redis Keys

| Key Pattern | Purpose | TTL | Value |
|---|---|---|---|
| `attendance:checkin-alert:{meetingId}:{participantId}:{graceMinutes}` | Idempotency per participant | 86400s (24h) | `'1'` |
| `attendance:checkin-alert-host:{meetingId}:{hostId}:{graceMinutes}` | Idempotency per host summary | 86400s (24h) | `'1'` |
| `attendance:checkin-alert-lock:{meetingId}` | Distributed lock for cron | `scan_interval_seconds * 2` | `instanceId` |

## System Config Keys

All keys live in `system_configs` table with `config_group = 'attendance'`:

| config_key | value_type | Default | Description |
|---|---|---|---|
| `attendance.checkin_alert.enabled` | boolean | true | Master toggle |
| `attendance.checkin_alert.grace_minutes` | number | 5 | Minutes after meeting start to wait before alerting |
| `attendance.checkin_alert.scan_interval_seconds` | number | 60 | Cron job scan interval |
| `attendance.checkin_alert.channels` | json | ["email"] | Allowed notification channels |
| `attendance.checkin_alert.notify_host_enabled` | boolean | true | Send summary to host |
| `attendance.checkin_alert.max_retry_attempts` | number | 3 | Max retry for failed sends |

## Data Flow

```
SchedulerService (cron) 
  → CheckInAlertService.processMeetings()
    → Query meetings in_progress AND past grace period
    → For each meeting:
      → Acquire Redis lock per meeting
      → Query required participants (is_required=true AND attendance_required=true)
      → For each participant:
        → Check Redis idempotency key
        → Re-check attendance_records
        → If not checked_in:
          → Check user email + is_active
          → Create Notification (type=late_checkin_alert)
          → Enqueue email via NotificationsService
          → Set Redis idempotency key
      → If any alert sent:
        → Send Host summary notification (with idempotency check)
        → Record MeetingEvent (type=attendance_checkin_alert_sent)
        → Record AuditLog (action=checkin_alert_sent)
      → Release Redis lock
```

## Query Patterns

### Scan eligible meetings
```sql
SELECT m.id, m.title, m.start_time, m.actual_start_time, m.room_id, m.host_id, r.name as room_name
FROM meetings m
LEFT JOIN rooms r ON r.id = m.room_id
WHERE m.status = 'in_progress'
  AND COALESCE(m.actual_start_time, m.start_time) <= :checkTime
  AND m.deleted_at IS NULL
```

Where `:checkTime` = `now() - graceMinutes * interval '1 minute'`

### Get required participants with user info
```sql
SELECT mp.id, mp.user_id, mp.attendance_status, u.email, u.is_active, u.full_name
FROM meeting_participants mp
JOIN users u ON u.id = mp.user_id
WHERE mp.meeting_id = :meetingId
  AND mp.is_required = true
  AND mp.attendance_required = true
  AND mp.invitation_status != 'declined'
```

### Re-check attendance
```sql
SELECT 1 FROM attendance_records
WHERE meeting_id = :meetingId
  AND user_id = :userId
  AND check_in_time IS NOT NULL
LIMIT 1
```
