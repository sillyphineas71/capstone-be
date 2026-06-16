# Research: Send Check-in Alerts (UC-APM-10)

**Date**: 2026-06-16 | **Branch**: 014-send-checkin-alerts | **Spec**: spec.md

## Codebase Analysis

### Existing Module Structure
- **Scheduler module** (`src/modules/scheduler/`): Has `SchedulerService` with `@Cron()` decorators. Currently skeleton with TODO methods for no-show, auto-release, reminder. Pattern: `@Cron(CronExpression.EVERY_5_MINUTES)`, config-driven enable/disable via `ConfigService`.
- **Notifications module** (`src/modules/notifications/`): Has `NotificationsService` with `enqueueEmailNotification()` pattern + `createNotification()`. Uses `NotificationEntity` with `NotificationType` enum. Need to add `LATE_CHECKIN_ALERT` to `NotificationType` enum.
- **Attendance module** (`src/modules/attendance/`): Has `AttendanceService` with participant attendance resolution logic. Reusable for checking attendance status.
- **Meeting events** (`src/modules/meetings/entities/meeting-event.entity.ts`): Has `MeetingEventEntity` with `MeetingEventType` enum. Need to add `ATTENDANCE_CHECKIN_ALERT_SENT` to enum.
- **Redis module** (`src/modules/redis/`): Has `RedisService` with `exists()`, `set()`, `setWithTtl()`, `get()`, `del()`. Perfect for idempotency keys.
- **Queue module** (`src/modules/queue/`): Has `QueueService` with `addJob()` for async processing.
- **Administration module**: Has `AuditLogEntity` and `SystemConfigEntity`. `SystemConfigEntity` stores config_key + config_value/value_type.

### Key Decisions

| Decision | Choice | Rationale |
|---|---|---|
| Cron job location | New check-in alert service inside `attendance` module, cron registration in `SchedulerService` | `SchedulerService` already owns all cron jobs. Business logic should live in feature module. |
| Notification type | Add `LATE_CHECKIN_ALERT = 'late_checkin_alert'` to existing `NotificationType` enum | Reuse existing notification infrastructure |
| Meeting event type | Add `ATTENDANCE_CHECKIN_ALERT_SENT = 'attendance_checkin_alert_sent'` to `MeetingEventType` enum | Consistent with existing event tracking pattern |
| Idempotency | Redis keys with TTL: `attendance:checkin-alert:{meetingId}:{participantId}:{graceMinutes}` | Simple, fast, supports multi-instance. TTL set to 24h for safety. |
| Grace period calc | `COALESCE(meetings.actual_start_time, meetings.start_time) + grace_minutes` | `actual_start_time` reflects real start when live-meeting module sets it |
| Auth for internal endpoint | Service-to-service API key (via config `INTERNAL_API_KEY`) | Avoids coupling to end-user JWT flow. Static key validated in guard. |
| Async email | Delegate to existing `NotificationsService.enqueueEmailNotification()` | Reuses queue + retry infrastructure |
| Audit logging | Use `AuditLogEntity` directly with `actionType = 'checkin_alert_sent'` or `'checkin_alert_skipped'` | Flexible JSON metadata for partial failure details |
| Config keys pattern | `attendance.checkin_alert.enabled` (boolean), `attendance.checkin_alert.grace_minutes` (number, default 5), `attendance.checkin_alert.scan_interval_seconds` (number, default 60), `attendance.checkin_alert.channels` (json array, default ["email"]), `attendance.checkin_alert.notify_host_enabled` (boolean, default true), `attendance.checkin_alert.max_retry_attempts` (number, default 3) | Consistent with existing config_group naming |

### Risks

| Risk | Mitigation |
|---|---|
| Cron job overlapping if previous run still executing | Use Redis distributed lock per meeting: `attendance:checkin-alert-lock:{meetingId}` with TTL = scan_interval_seconds |
| Redis unavailability at runtime | Fall back to DB check (`meeting_events.metadata_json` or `notifications` lookup) for idempotency |
| Large batch of meetings | Query with indexed time window (`start_time` between [now - maxGracePeriod, now + scanInterval]), process sequentially per meeting |
| Email template leakage | Store template in DB or config, not hard-coded. Only log notification_id, not full content. |
