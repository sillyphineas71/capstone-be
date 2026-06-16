# Tasks: Send Check-in Alerts (UC-APM-10)

**Input**: Design documents from `spec/features/attendance/feat-send-checkin-alerts/`
**Prerequisites**: plan.md, spec.md, research.md, data-model.md, contracts/attendance-checkin-alerts-api.md, quickstart.md
**Branch**: `014-send-checkin-alerts`

---

## Phase 1: Setup â€” Enum & Infrastructure Updates

**Purpose**: Cáº­p nháº­t enum, seed config, táº¡o guard dÃ¹ng chung

- [x] T001 [AC-008] Verify and update `NotificationType` definitions for late check-in alerts:
  - Inspect existing implementation. If native PostgreSQL enum is used, generate a TypeORM migration and add required enum values safely.
  - If columns are `varchar`, update TypeScript enum/constant only and document that no DB schema migration is required.
  - Ensure both participant reminder and host summary notification types are supported according to project casing conventions (e.g. `LATE_CHECKIN_ALERT`, `LATE_CHECKIN_HOST_SUMMARY` or lowercase equivalents).
- [x] T002 [AC-008] Verify and update `MeetingEventType` definitions for late check-in alerts:
  - Inspect existing implementation and apply same logic as T001 (TypeORM migration if native enum, otherwise TS only).
  - Ensure meeting event type for alert sent is supported (e.g. `ATTENDANCE_CHECKIN_ALERT_SENT`).
- [x] T003 [P] Seed `system_configs` vá»›i default keys cho check-in alert:
  - `attendance.checkin_alert.enabled` = true (boolean)
  - `attendance.checkin_alert.grace_minutes` = 5 (number)
  - `attendance.checkin_alert.scan_interval_seconds` = 60 (number)
  - `attendance.checkin_alert.channels` = ["email"] (json)
  - `attendance.checkin_alert.notify_host_enabled` = true (boolean)
  - `attendance.checkin_alert.max_retry_attempts` = 3 (number)
  Táº¡o seed file táº¡i `src/database/seeds/YYYYMMDDHHMMSS-seed-checkin-alert-config.ts`
- [x] T004 [P] Táº¡o `InternalApiGuard` táº¡i `src/common/guards/internal-api.guard.ts`:
  - Äá»c `INTERNAL_API_KEY` tá»« `ConfigService`
  - So sÃ¡nh vá»›i `X-API-Key` header
  - Tráº£ vá» 401 náº¿u missing/sai key
- [x] T005 Táº¡o `LateCheckinAlertResponseDto` táº¡i `src/modules/attendance/dto/late-checkin-alert-response.dto.ts`:
  - Fields: `meetingId: string`, `status: string`, `totalParticipantsChecked: number`, `alertsSent: number`, `hostAlertSent: boolean`, `partialFailures: Array<{userId: string, reason: string}>`

---

## Phase 2: Core Business Logic â€” CheckInAlertService

**Purpose**: Service xá»­ lÃ½ cron job phÃ¡t hiá»‡n vÃ  gá»­i cáº£nh bÃ¡o

- [x] T006 Táº¡o `CheckInAlertService` táº¡i `src/modules/attendance/services/checkin-alert.service.ts` vá»›i constructor inject:
  - `DataSource` (TypeORM)
  - `RedisService`
  - `NotificationsService`
  - `QueueService`
  - `BackgroundJobsService`
  - `ConfigService`
  - `Logger`

- [x] T007 Implement method `loadConfig()` trong `CheckInAlertService`:
  - Query `system_configs` theo config_group `'attendance'`
  - Parse config values vá»›i default fallback:
    - `enabled` (default true)
    - `graceMinutes` (default 5)
    - `channels` (default ["email"])
    - `notifyHostEnabled` (default true)
    - `maxRetryAttempts` (default 3)

- [x] T008 Implement method `processMeetings()` trong `CheckInAlertService`:
  - Gá»i `loadConfig()`, náº¿u disabled â†’ return
  - Query meetings vá»›i:
    ```sql
    status = 'in_progress'
    AND COALESCE(actual_start_time, start_time) <= :checkTime
    AND deleted_at IS NULL
    ```
  - WHERE `:checkTime = NOW() - graceMinutes * interval '1 minute'`
  - JOIN `rooms` Ä‘á»ƒ láº¥y room_name
  - DÃ¹ng indexed query, giá»›i háº¡n time window, khÃ´ng full scan
  - For each meeting â†’ gá»i `processMeeting()`

- [x] T009 Implement method `processMeeting(meeting)` trong `CheckInAlertService`:
  - **Redis lock**: `SET attendance:checkin-alert-lock:{meetingId} {instanceId} NX EX :ttl`
    - Náº¿u fail â†’ skip meeting (instance khÃ¡c Ä‘ang xá»­ lÃ½)
  - **Load participants**:
    ```sql
    SELECT mp.id, mp.user_id, mp.attendance_status, u.email, u.is_active, u.full_name
    FROM meeting_participants mp
    JOIN users u ON u.id = mp.user_id
    WHERE mp.meeting_id = :meetingId
      AND mp.is_required = true
      AND mp.attendance_required = true
      AND mp.invitation_status != 'declined'
      AND mp.attendance_status NOT IN ('present', 'late')
      AND NOT EXISTS (
        SELECT 1
        FROM attendance_records ar
        WHERE ar.meeting_id = mp.meeting_id
          AND ar.user_id = mp.user_id
          AND (
            ar.is_present = true
            OR ar.check_in_time IS NOT NULL
            OR ar.attendance_status IN ('present', 'late')
          )
      )
    ```
  - **For each participant**:
    1. Check Redis idempotency key: `attendance:checkin-alert:{meetingId}:{userId}:{graceMinutes}`
       - Náº¿u exists â†’ skip (Ä‘Ã£ gá»­i cáº£nh bÃ¡o)
    2. Re-check attendance:
       ```sql
       SELECT 1 FROM attendance_records
       WHERE meeting_id = :meetingId
         AND user_id = :userId
         AND (is_present = true OR check_in_time IS NOT NULL OR attendance_status IN ('present', 'late'))
       LIMIT 1
       ```
       - Náº¿u cÃ³ record (hoáº·c `attendance_status` Ä‘Ã£ lÃ  'present'/'late') â†’ skip (Ä‘Ã£ check-in)
    3. Check email há»£p lá»‡: `u.email IS NOT NULL AND u.is_active = true`
       - Náº¿u khÃ´ng há»£p lá»‡ â†’ record partial failure, skip
    4. Táº¡o email content vá»›i template:
       - Subject: `[Nháº¯c nhá»Ÿ] Báº¡n chÆ°a check-in cuá»™c há»p "{title}"`
       - Body: tÃªn meeting, phÃ²ng, giá» báº¯t Ä‘áº§u, sá»‘ phÃºt Ä‘Ã£ trá»…, hÆ°á»›ng dáº«n check-in
    5. Gá»i `NotificationsService.enqueueEmailNotification()` vá»›i:
       - `notificationType: NotificationType.LATE_CHECKIN_ALERT`
       - `channel: EMAIL`
       - `relatedEntityType: 'meeting'`
       - `relatedEntityId: meetingId`
       - `toEmails: [userEmail]`
       - `payloadJson: { meetingId, participantId, graceMinutes }`
    6. Set Redis idempotency key: `SET attendance:checkin-alert:{meetingId}:{userId}:{graceMinutes} 1 EX 86400`
    7. Increment alert counter

  - **Host summary** (náº¿u cÃ³ alert sent AND `notifyHostEnabled`):
    1. TÃ¬m hostId tá»« meeting hoáº·c participant role 'host'
    2. Check Redis: `attendance:checkin-alert-host:{meetingId}:{hostId}:{graceMinutes}`
       - Náº¿u exists â†’ skip
    3. Táº¡o host summary notification:
       - Subject: `[Tá»•ng há»£p] Danh sÃ¡ch ngÆ°á»i chÆ°a check-in cuá»™c há»p "{title}"`
       - Content: danh sÃ¡ch tÃªn ngÆ°á»i vi pháº¡m
       - Gá»­i qua `NotificationsService.enqueueEmailNotification()`
    4. Set host idempotency key

  - **Transaction Boundary**:
    - Create notification/background job and write meeting event/audit log in a small transaction per recipient/summary where feasible.
    - Do not wrap the whole meeting batch in one transaction. Náº¿u má»™t participant fail, khÃ´ng rollback cÃ¡c participant Ä‘Ã£ xá»­ lÃ½ thÃ nh cÃ´ng (giá»¯ best-effort per-recipient semantics).
    - **Ghi MeetingEvent**: Náº¿u cÃ³ alert sent
      - `eventType: MeetingEventType.ATTENDANCE_CHECKIN_ALERT_SENT`
      - `sourceType: SCHEDULER`
      - `metadataJson: { meetingId, graceMinutes, participantsAlerted: [userIds], hostAlerted: bool, partialFailures: [...] }`
    - **Ghi AuditLog**: Náº¿u cÃ³ alert sent hoáº·c partial failure
      - `actionType: 'checkin_alert_sent'` hoáº·c `'checkin_alert_skipped'`
      - `entityType: 'meeting'`
      - `entityId: meetingId`
      - `newValueJson: { metadata summary }`

  - **Release Redis lock**: `DEL attendance:checkin-alert-lock:{meetingId}`

  - **Return** `ProcessingResult`

- [x] T010 Implement method `triggerForMeeting(meetingId: string)` trong `CheckInAlertService`:
  - Validate meeting tá»“n táº¡i â†’ 404 náº¿u khÃ´ng
  - Validate meeting status = `in_progress` â†’ 409 náº¿u khÃ´ng
  - Gá»i `processMeeting()` vá»›i meeting Ä‘Ã£ load
  - Return result

- [x] T011 Implement Redis fallback mechanism trong `CheckInAlertService`:
  - Náº¿u Redis `exists()`/`set()` fail â†’ fallback dÃ¹ng DB query:
    ```sql
    SELECT 1 FROM meeting_events
    WHERE meeting_id = :meetingId
      AND event_type = 'attendance_checkin_alert_sent'
      AND metadata_json->>'participantId' = :userId
    LIMIT 1
    ```
  - Log warning khi Redis unavailable

- [x] T012 ÄÄƒng kÃ½ cron job trong `SchedulerService` táº¡i `src/modules/scheduler/scheduler.service.ts`:
  - ThÃªm method má»›i `checkCheckinAlerts()` vá»›i `@Cron()` dÃ¹ng config key `scan_interval_seconds`
  - Inject `CheckInAlertService`
  - Gá»i `checkInAlertService.processMeetings()`
  - Log káº¿t quáº£ má»—i láº§n cháº¡y (sá»‘ meeting, sá»‘ alert, sá»‘ partial failure)
  - Config-driven enable/disable (Ä‘á»c tá»« `ConfigService` key má»›i hoáº·c `system_configs`)

- [x] T013 [P] Export `CheckInAlertService` tá»« `AttendanceModule` táº¡i `src/modules/attendance/attendance.module.ts`:
  - Add `CheckInAlertService` vÃ o `providers`
  - Import necessary modules: `RedisModule`, `NotificationsModule` (hoáº·c forwardRef), `QueueModule`, `AdministrationModule`
  - Export `CheckInAlertService` náº¿u scheduler module cáº§n inject

---

## Phase 3: Controller & API

**Purpose**: Internal endpoint theo UC-92 contract

- [x] T014 Táº¡o `CheckInAlertController` táº¡i `src/modules/attendance/controllers/checkin-alert.controller.ts`:
  - Route: `internal/meetings/:meetingId/late-checkin-alerts`
  - Method: `POST`
  - Auth: `InternalApiGuard` (header `X-API-Key`)
  - Gá»i `CheckInAlertService.triggerForMeeting(meetingId)`
  - Response: 202 Accepted vá»›i `LateCheckinAlertResponseDto`
  - Error responses: 400, 401, 403, 404, 409

- [x] T015 [P] Wire controller vÃ o `AttendanceModule` táº¡i `src/modules/attendance/attendance.module.ts`:
  - Add `CheckInAlertController` vÃ o `controllers`
  - Import `CommonModule` hoáº·c Ä‘Äƒng kÃ½ `InternalApiGuard` global

- [x] T016 ÄÄƒng kÃ½ route prefix `internal` cho internal endpoints:
  - KhÃ´ng require JWT auth (chá»‰ `InternalApiGuard`)
  - Cáº¥u hÃ¬nh trong controller decorator hoáº·c module routing

---

## Phase 4: Tests

**Purpose**: Unit tests + DTO validation + Controller tests

### Unit Tests â€” CheckInAlertService

- [ ] T017 [AC-001] Test `processMeetings()` khi `attendance.checkin_alert.enabled = false` â†’ return ngay, khÃ´ng query DB
- [ ] T018 [AC-001] Test `processMeetings()` khi khÃ´ng cÃ³ meeting nÃ o `in_progress` â†’ khÃ´ng gá»i `processMeeting()`
- [ ] T019 [AC-003] Test `processMeeting()` khi meeting khÃ´ng cÃ²n `in_progress` táº¡i thá»i Ä‘iá»ƒm xá»­ lÃ½ â†’ skip
- [ ] T020 [AC-006] Test `processMeeting()` khi táº¥t cáº£ required participants Ä‘Ã£ check-in â†’ khÃ´ng gá»­i alert, khÃ´ng ghi event
- [ ] T021 [AC-006] Test `processMeeting()` khi má»™t participant chÆ°a check-in â†’ táº¡o notification + enqueue email + ghi event + audit
- [ ] T022 [AC-007] Test `processMeeting()` khi participant thiáº¿u email hoáº·c inactive â†’ ghi partial failure, khÃ´ng gá»­i alert
- [ ] T023 [AC-008] Test `processMeeting()` khi Redis idempotency key tá»“n táº¡i â†’ skip participant (chá»‘ng duplicate)
- [ ] T024 [AC-001] Test `processMeeting()` khi host summary Ä‘Æ°á»£c gá»­i â†’ chá»‰ gá»­i 1 láº§n má»—i meeting+grace period
- [ ] T025 [AC-001] Test `triggerForMeeting()` vá»›i meetingId há»£p lá»‡, meeting `in_progress` â†’ gá»i `processMeeting()`, tráº£ vá» 202
- [ ] T026 [AC-004] Test `triggerForMeeting()` vá»›i meetingId khÃ´ng tá»“n táº¡i â†’ 404
- [ ] T027 [AC-004] Test `triggerForMeeting()` vá»›i meeting khÃ´ng pháº£i `in_progress` â†’ 409
- [ ] T027a [AC-008] Add unit tests for Redis idempotency fallback: Mock RedisService throw error, verify fallback sang DB-based check, khÃ´ng crash cron, váº«n gá»­i Ä‘Ãºng hoáº·c skip duplicate.

### Unit Tests â€” Guards & DTOs

- [ ] T028 [P] Test `InternalApiGuard` vá»›i `X-API-Key` Ä‘Ãºng â†’ pass
- [ ] T029 [P] Test `InternalApiGuard` vá»›i `X-API-Key` sai â†’ 401
- [ ] T030 [P] Test `InternalApiGuard` vá»›i `X-API-Key` missing â†’ 401
- [ ] T031 Test `LateCheckinAlertResponseDto` validation (náº¿u cÃ³ validation decorators)

### Controller Tests

- [ ] T032 Test `POST /api/v1/internal/meetings/:meetingId/late-checkin-alerts` happy path â†’ 202
- [ ] T033 Test internal endpoint vá»›i missing API key â†’ 401
- [ ] T034 Test internal endpoint vá»›i meeting khÃ´ng tá»“n táº¡i â†’ 404
- [ ] T035 Test internal endpoint vá»›i meeting khÃ´ng `in_progress` â†’ 409

---

## Requirements Coverage

### Functional Requirements

| Requirement | Task(s) | Notes |
|---|---|---|
| FR-001: Cron job quÃ©t meetings in_progress | T008, T012 | processMeetings() + SchedulerService cron |
| FR-002: Grace period check | T008 | `COALESCE(actual_start_time, start_time) + grace_minutes` |
| FR-003: Filter is_required=true AND attendance_required=true | T009 | Participant query filter |
| FR-004: Láº¥y participant list khi vÆ°á»£t grace period | T009 | processMeeting() loads participants |
| FR-005: Táº¡o notification type late_checkin_alert | T009 | enqueueEmailNotification() |
| FR-006: Host summary (max 1 láº§n per grace period) | T009 | Host idempotency key |
| FR-007: Cron hoáº¡t Ä‘á»™ng khi meeting in_progress | T008, T009 | Status check |
| FR-008: Batch xá»­ lÃ½ Ä‘á»™c láº­p | T008, T009 | For loop, per-meeting processing |
| FR-009: Config attendance.checkin_alert.enabled | T007 | loadConfig() |
| FR-010: Secondary channel optional | T009 | Template chá»‰ cÃ³ email channel |
| FR-011: Re-check trÆ°á»›c khi gá»­i | T009 | attendance_records query trÆ°á»›c enqueue |
| FR-012: Skip náº¿u email missing/inactive | T009 | Partial failure handling |
| FR-013: Skip náº¿u meeting khÃ´ng in_progress | T009 | Re-check status |
| FR-014: Skip náº¿u chÆ°a vÆ°á»£t grace period | T008 | WHERE clause |
| FR-015: Retry náº¿u notification service lá»—i | T009 | enqueueEmailNotification() tá»± retry |
| FR-016: Query indexed time window | T008 | start_time range query |
| FR-017: Re-check attendance trÆ°á»›c enqueue | T009 | Trong vÃ²ng láº·p participant |
| FR-018: Ghi meeting_events | T009 | INSERT meeting_event |
| FR-019: Ghi audit_logs | T009 | INSERT audit_log |
| FR-020: Internal endpoint auth (API key) | T004, T014 | InternalApiGuard |
| FR-021: Invalid key rejection | T004, T029, T030 | InternalApiGuard tráº£ 401 |
| FR-022: Noti vá»›i related_entity_type='meeting' | T009 | enqueueEmailNotification params |
| FR-023: meeting_events metadata JSON | T009 | metadataJson |
| FR-024: DÃ¹ng system_configs | T007 | loadConfig() |
| FR-025: Notification channel=email, type=late_checkin_alert | T009 | NotificationType.LATE_CHECKIN_ALERT |
| FR-026: Host summary notification | T009 | Host idempotency + separate notification |
| FR-027: Audit log ghi sent/partial failure | T009 | actionType checkin_alert_sent / checkin_alert_skipped |
| FR-029: State + Event (in_progress + vÆ°á»£t grace) | T008, T009 | processMeeting() |
| FR-030: Retry khi service unavailable | T009, T011 | BullMQ retry |
| FR-031: Skip participant vá»«a check-in | T009 | Re-check attendance_records |

### Acceptance Criteria

| AC | Task(s) | Notes |
|---|---|---|
| AC-001: Happy path â€” cron gá»­i alert + host summary + event + audit | T017â€“T021 | Full flow test |
| AC-002: Grace period chÆ°a vÆ°á»£t | T008, T018 | query WHERE clause |
| AC-003: Meeting khÃ´ng in_progress | T009, T020 | Status re-check |
| AC-004: Unauthorized (no token) | T029, T030, T033 | InternalApiGuard |
| AC-005: Forbidden | T028, T029 | InternalApiGuard (key sai) |
| AC-006: Táº¥t cáº£ Ä‘Ã£ check-in | T020 | processMeeting no alert |
| AC-007: Participant thiáº¿u email | T022 | Partial failure test |
| AC-008: meeting_events Ä‘Æ°á»£c ghi | T021 | Assert meeting event created |
| AC-009: audit_logs Ä‘Æ°á»£c ghi | T021 | Assert audit log created |

---

## Dependencies & Execution Order

### Phase Dependencies
- **Phase 1 (Setup)**: No dependencies â€” can start immediately
- **Phase 2 (Business Logic)**: Depends on T001â€“T005 hoÃ n thÃ nh
- **Phase 3 (Controller)**: Depends on T002 (MeetingEventType) + T004 (InternalApiGuard) + T006â€“T010 (Service) hoÃ n thÃ nh
- **Phase 4 (Tests)**: Depends on Phase 2 + Phase 3 hoÃ n thÃ nh

### Parallel Opportunities
- T003 vÃ  T004 cÃ³ thá»ƒ cháº¡y song song
- T013 (export service) cÃ³ thá»ƒ cháº¡y song song vá»›i T012 (cron job registration)
- T028, T029, T030 (guard tests) cÃ³ thá»ƒ cháº¡y song song
- T017â€“T027 (service tests) cÃ³ thá»ƒ cháº¡y song song sau khi T006â€“T010 hoÃ n thÃ nh
- T032â€“T035 (controller tests) song song vá»›i service tests








