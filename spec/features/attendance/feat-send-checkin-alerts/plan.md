# Implementation Plan: Send Check-in Alerts (UC-APM-10)

**Branch**: `014-send-checkin-alerts` | **Date**: 2026-06-16 | **Spec**: spec.md  
**Input**: Feature specification from `spec/features/attendance/feat-send-checkin-alerts/spec.md`

---

## 1. Feature Summary

Tính năng tự động gửi cảnh báo email cho người tham dự nội bộ bắt buộc chưa check-in sau khi meeting đã `in_progress` vượt quá grace period (có thể cấu hình qua `system_configs`). Cron job quét định kỳ, phát hiện người vi phạm, gửi email nhắc nhở, gửi host summary, ghi meeting_events và audit_logs. Idempotency qua Redis keys.

**Primary Actor**: System (cron job)  
**Recipients**: Participant, Host  
**API Contract**: `POST /api/v1/internal/meetings/{meetingId}/late-checkin-alerts` (internal only)

---

## 2. Technical Context

### Technology Stack
| Component | Choice | Note |
|---|---|---|
| Language | TypeScript (NestJS) | Existing project |
| ORM | TypeORM | Existing |
| Database | PostgreSQL | Existing |
| Cron | `@nestjs/schedule` decorator (`@Cron`) | Existing pattern in SchedulerService |
| Cache/Idempotency | Redis (ioredis via RedisService) | Existing |
| Async queue | BullMQ via QueueService | Existing |
| Notification | NotificationsService | Existing: `enqueueEmailNotification()` |
| Auth (internal) | Service-to-service API key (`X-API-Key` header) | New InternalApiGuard |
| Logging | NestJS Logger | Existing |
| Audit | AuditLogEntity | Existing |

### Module Architecture

```
attendance/
  services/
    checkin-alert.service.ts    ← NEW: business logic
    checkin-alert.service.spec.ts
  controllers/
    checkin-alert.controller.ts  ← NEW: internal endpoint
    checkin-alert.controller.spec.ts
  dto/
    late-checkin-alert-response.dto.ts  ← NEW
  guards/
    internal-api.guard.ts       ← NEW: service-to-service auth

scheduler/
  scheduler.service.ts          ← UPDATE: add cron job method

notifications/
  entities/
    notification.entity.ts      ← UPDATE: add LATE_CHECKIN_ALERT to enum

meetings/
  entities/
    meeting-event.entity.ts     ← UPDATE: add ATTENDANCE_CHECKIN_ALERT_SENT to enum
```

### Dependencies
- `attendance` module: `RedisService`, `NotificationsService`, `QueueService`, `BackgroundJobsService`
- `MeetingsModule` for entity access (`MeetingEntity`, `MeetingParticipantEntity`)
- `AccountsModule` for `UserEntity`
- `AdministrationModule` for `AuditLogEntity`, `SystemConfigEntity`, `BackgroundJobsService`

---

## 3. Scope Confirmation

### In Scope
- Cron job quét meetings `in_progress` vượt grace period
- Lọc required participants (`is_required=true AND attendance_required=true`)
- Re-check attendance trước khi gửi
- Tạo notification type `late_checkin_alert` + enqueue email
- Gửi host summary (nếu config enabled)
- Redis idempotency keys chống duplicate
- Ghi `meeting_events` (event type: `attendance_checkin_alert_sent`)
- Ghi `audit_logs` (action: `checkin_alert_sent` / `checkin_alert_skipped`)
- Internal endpoint cho manual trigger
- Enum additions (không migration)

### Out of Scope (đã được guard bởi OOS-001..006 trong spec)
- Không tạo table mới
- Không gửi SMS/push notification
- Không xử lý external participants
- Không thay đổi attendance_status
- Không auto-release room / no-show
- Không ghi nhận check-in

---

## 4. Data Model Impact

### Enum Changes (no schema migration)
- `NotificationType.LATE_CHECKIN_ALERT = 'late_checkin_alert'` in `notification.entity.ts`
- `MeetingEventType.ATTENDANCE_CHECKIN_ALERT_SENT = 'attendance_checkin_alert_sent'` in `meeting-event.entity.ts`

### System Config Keys (seed data)
See `data-model.md` for full config key table.

### Redis Key Patterns
See `data-model.md` for Redis key schema.

### No New Tables, No New Columns
Feature uses 12 existing tables (meetings, rooms, meeting_participants, users, attendance_records, notifications, meeting_events, audit_logs, system_configs, background_jobs).

---

## 5. API / Contract Plan

### Internal Endpoint
| Method | Path | Auth | Response |
|---|---|---|---|
| POST | `/api/v1/internal/meetings/{meetingId}/late-checkin-alerts` | `X-API-Key` header | 202 Accepted |

### New Guard
**InternalApiGuard**: Validates `X-API-Key` header against `INTERNAL_API_KEY` from config.  
Applied to internal endpoint only. Cron job calls service directly (no API call).

### Response Codes
- 202: Processing initiated (async)
- 400: Invalid meetingId format
- 401: Missing/invalid API key
- 403: Valid key but insufficient scope
- 404: Meeting not found
- 409: Meeting not in_progress

---

## 6. Authorization Plan

### Cron Job (System)
- No auth check (internal process)
- Runs within NestJS application context

### Internal Endpoint
- Auth: `InternalApiGuard` validates `X-API-Key` header
- No RBAC check (service-level auth only)
- No end-user JWT involved

### No Public Endpoints
End-users cannot trigger this feature manually.

---

## 7. Business Logic Plan

### CheckInAlertService

#### Main method: `processMeetings()`
Called by cron job. Scans all eligible meetings and processes them.

```
async processMeetings(): Promise<void>
  1. Read system configs (grace_minutes, enabled, etc.)
  2. If disabled → return
  3. Query meetings in_progress AND past grace period
  4. For each meeting → processMeeting(meeting)
```

#### Method: `processMeeting(meeting)`
```
async processMeeting(meeting): Promise<ProcessResult>
  1. Try acquire Redis lock per meeting (SET NX EX)
  2. If lock failed → skip (another instance processing)
  3. Query required participants with user info
  4. For each participant:
     a. Check Redis idempotency key
     b. If exists → skip (already alerted)
     c. Re-check attendance_records for this meeting+user
     d. If checked_in → skip
     e. If no email or inactive → record partial failure, skip
     f. Generate email content from meeting/room data
     g. Create notification (type=late_checkin_alert)
     h. Enqueue email via NotificationsService.enqueueEmailNotification()
     i. Set Redis idempotency key (TTL 24h)
     j. Increment alert counter
  5. If any alert sent AND notify_host_enabled:
     a. Check Host idempotency key
     b. If not exists → create host summary notification
     c. Set Host idempotency key
  6. If any alert sent:
     a. Record MeetingEvent (attendance_checkin_alert_sent)
     b. Record AuditLog (checkin_alert_sent) with metadata
  7. Release Redis lock
  8. Return result summary
```

#### Method: `triggerForMeeting(meetingId)`
Called by internal controller. Single-meeting processing.

```
async triggerForMeeting(meetingId): Promise<ProcessResult>
  1. Validate meeting exists
  2. Validate meeting status is in_progress
  3. Call processMeeting()
  4. Return result
```

### Email Content Template
```
Subject: [Nhắc nhở] Bạn chưa check-in cuộc họp "{title}"
Body:
  - Tên cuộc họp: {title}
  - Phòng: {room_name}
  - Giờ bắt đầu: {start_time}
  - Đã trễ: {late_minutes} phút
  - Vui lòng check-in ngay tại phòng họp.
```

### Host Summary Template
```
Subject: [Tổng hợp] Danh sách người chưa check-in cuộc họp "{title}"
Body:
  - Tên cuộc họp: {title}
  - Phòng: {room_name}
  - Số người chưa check-in: {count}
  - Danh sách: {list of names}
```

---

## 8. Validation Plan

### Validation Type | Implementation
| Validation | When | Implementation |
|---|---|---|
| Meeting ID format | Internal endpoint | Parse UUID, return 400 if invalid |
| Meeting exists | Internal endpoint + cron | Check DB, return 404 if not found |
| Meeting in_progress | Internal endpoint + cron | Check status field, skip if not in_progress |
| Grace period | Cron query | `WHERE COALESCE(actual_start_time, start_time) <= :checkTime` |
| is_required + attendance_required | Participant query | `WHERE is_required = true AND attendance_required = true` |
| Email validity | Per participant | `WHERE u.email IS NOT NULL AND u.is_active = true` |
| Attendance re-check | Before send | Query `attendance_records` for check_in_time |
| Idempotency | Before send + before host summary | Check Redis key existence |

---

## 9. Error Handling Plan

### Error Scenarios & Mitigation

| Scenario | Mitigation |
|---|---|
| Meeting status changed between scan and process | Re-check status at start of processMeeting() |
| Participant checked in between query and send | Re-check attendance_records right before enqueue |
| Redis unavailable for idempotency check | Fall back to checking meeting_events.metadata_json or notifications table |
| Email provider failure | NotificationsService.enqueueEmailNotification() handles retry via BullMQ |
| Notification Service unavailable | Enqueue background job; cron job continues without crashing |
| Missing email / inactive user | Skip participant, record partial failure in audit metadata |
| Cron instance overlap | Redis distributed lock per meeting |
| Config not found | Use safe defaults (grace_minutes=5, enabled=true) |

### Audit Log Details
Each `checkin_alert_sent` audit log contains:
```json
{
  "meetingId": "uuid",
  "graceMinutes": 5,
  "participantsAlerted": ["uuid1", "uuid2"],
  "hostAlerted": true,
  "partialFailures": [
    {"userId": "uuid3", "reason": "missing_email"}
  ],
  "totalFound": 3,
  "totalAlerted": 2
}
```

---

## 10. Testing Strategy

### Unit Tests

**CheckInAlertService**:
- `processMeetings()`: config disabled → skip
- `processMeetings()`: no eligible meetings → skip
- `processMeeting()`: meeting not_in_progress → skip
- `processMeeting()`: all participants checked in → no alerts
- `processMeeting()`: one participant missing → alert sent
- `processMeeting()`: participant missing email → partial failure
- `processMeeting()`: Redis idempotency key exists → skip duplicate
- `triggerForMeeting()`: valid meeting → process
- `triggerForMeeting()`: meeting not found → 404
- `triggerForMeeting()`: meeting not in_progress → 409

**InternalApiGuard**:
- Valid API key → pass
- Missing API key → 401
- Wrong API key → 401

### DTO Validation Tests
- late-checkin-alert-response.dto.ts: structure validation

### Integration / E2E
- End-to-end: cron → service → notification → event → audit
- Internal endpoint: full request/response cycle

---

## 11. Implementation Phases

### Phase 1: Enum & Infrastructure Updates
1. Add `LATE_CHECKIN_ALERT` to `NotificationType` enum
2. Add `ATTENDANCE_CHECKIN_ALERT_SENT` to `MeetingEventType` enum
3. Seed `system_configs` with default keys for check-in alert
4. Create `InternalApiGuard` guard

### Phase 2: Core Business Logic
5. Create `CheckInAlertService` with `processMeetings()`, `processMeeting()`, `triggerForMeeting()`
6. Register cron job method in `SchedulerService`
7. Create DTOs: `LateCheckinAlertResponseDto`

### Phase 3: Controller & API
8. Create `CheckInAlertController` with internal endpoint
9. Wire module dependencies (attendance module updates)
10. Apply `InternalApiGuard` to controller

### Phase 4: Tests
11. Unit tests for CheckInAlertService
12. DTO validation tests
13. Controller tests

---

## 12. Risks & Mitigations

| Risk | Severity | Mitigation |
|---|---|---|
| Cron job chạy overlap khi processing lâu | Medium | Redis lock per meeting, skip nếu lock fail |
| Redis unavailable cho idempotency | Medium | Fallback DB check qua meeting_events |
| Email provider latency / failure | Low | Queue async, retry mechanism built-in |
| Grace period sai nếu actual_start_time null | Low | Dùng COALESCE với start_time |
| Multi-instance deployment gửi duplicate | Medium | Redis lock + idempotency keys |
| Config sai / missing | Low | Default values an toàn |

---

## 13. Acceptance Criteria Traceability

| AC ID | Test Scenario | Phase | FR/ERR |
|---|---|---|---|
| AC-001 | TC-01: Happy path | Phase 2, 4 | FR-001..006 |
| AC-002 | TC-02: Grace period check | Phase 2, 4 | FR-002, FR-014 |
| AC-003 | TC-03: Not in_progress | Phase 2, 4 | FR-013, ERR-003 |
| AC-004 | TC-08: Unauthorized | Phase 3, 4 | FR-020, FR-021, ERR-001 |
| AC-005 | TC-08: Forbidden | Phase 3, 4 | ERR-002 |
| AC-006 | TC-11: All checked in | Phase 2, 4 | FR-011 |
| AC-007 | TC-05: Missing email | Phase 2, 4 | FR-012 |
| AC-008 | TC-01: Meeting event | Phase 2, 4 | FR-018, FR-022, FR-023 |
| AC-009 | TC-01: Audit log | Phase 2, 4 | FR-019, FR-027 |
