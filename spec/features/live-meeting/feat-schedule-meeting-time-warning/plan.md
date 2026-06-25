# Implementation Plan: Lập lịch cảnh báo thời gian còn lại (UC-IMM-12)

**Feature Directory**: `spec/features/live-meeting/feat-schedule-meeting-time-warning`
**Date**: 2026-06-19
**Spec**: [spec.md](spec.md)
**Checklist**: [checklists/requirements.md](checklists/requirements.md)

---

## 📝 CHANGELOG & REVISION HISTORY
| Ngày cập nhật | Tóm tắt thay đổi | Các dòng thay đổi |
| :--- | :--- | :--- |
| 2026-06-19 | Tạo plan lần đầu cho UC-IMM-12 Lập lịch cảnh báo thời gian còn lại | Toàn bộ file |
| 2026-06-19 | Bổ sung Constitution Check, Project Structure theo plan-template.md; đổi tên Section 1 → Summary | Sections Constitution Check, Project Structure, header |

---

## Summary

UC-IMM-12 là **internal process** — không có HTTP endpoint, không có actor người dùng trực tiếp.

Khi meeting chuyển sang `in_progress`, hệ thống tự động tính `warningScheduledAt = end_time - configMinutes` và enqueue một BullMQ delayed job vào queue `QUEUE_SCHEDULER`. Job này sẽ được UC-IMM-13 xử lý khi fired (gửi notification). UC-IMM-12 **chỉ phụ trách scheduling** — không gửi notification.

Feature hoạt động qua 3 trigger:
- **Start trigger** (sau UC-IMM-01 commit): Schedule warning job lần đầu.
- **Extension trigger / AF1** (sau UC-IMM-03 hoặc UC-IMM-02 auto-apply commit): Cancel job cũ, tính lại `warningScheduledAt` theo `end_time` mới, enqueue lại.
- **End trigger / AF3** (sau UC-IMM-05 commit): Remove job hoàn toàn để tránh cảnh báo giả.

Nếu `warningScheduledAt ≤ now() + 60s` (skip guard), không enqueue job, không tạo `background_jobs` — chỉ ghi `meeting_events` type `warning_scheduling_skipped`.

AF2: khi `remainingMinutes = end_time - now() ≤ configMinutes`, dùng `adjustedWarningMinutes = floor(remainingMinutes / 2)` và `warningScheduledAt = now() + adjustedWarningMinutes`.

---

## 2. Technical Context

| Aspect | Detail |
|---|---|
| **Framework** | NestJS (TypeScript) |
| **ORM** | TypeORM, DataSource — không dùng transaction riêng cho scheduling |
| **Database** | PostgreSQL, DB v3.2 Compact (39 tables) |
| **Queue** | BullMQ qua `QueueService` (@Global, đã có sẵn) — dùng `QUEUE_SCHEDULER` queue |
| **Queue cancel** | `QueueService.getQueue(queueName).getJob(jobId).remove()` |
| **Config** | `SystemConfigEntity`, key = `meeting_warning_before_minutes`, default = `10` |
| **Auth** | Không có — internal process |
| **Target Module** | `live-meeting` — thêm methods vào `LiveMeetingService` hiện có |
| **Module phụ thuộc** | `QueueModule` (đã @Global), `AdministrationModule` (BackgroundJobEntity, SystemConfigEntity, đã @Global), `MeetingsModule` (MeetingEventEntity), `QueueService`, `BackgroundJobsService` |
| **Trigger source** | `startMeeting()`, `decideExtension()` approve path, `endMeeting()` — tất cả post-commit best-effort |

### Infrastructure hiện có (đã sẵn sàng dùng)

| Component | Tên / Path |
|---|---|
| `QueueService` | `src/modules/queue/queue.service.ts` — `addJob()`, `getQueue()` |
| `BackgroundJobsService` | `src/modules/administration/services/background-jobs.service.ts` |
| `BackgroundJobEntity` | `src/modules/administration/entities/background-job.entity.ts` |
| `MeetingEventEntity` | `src/modules/meetings/entities/meeting-event.entity.ts` |
| `SystemConfigEntity` | `src/modules/administration/entities/system-config.entity.ts` |
| Queue `QUEUE_SCHEDULER` | Đã đăng ký trong `QueueModule` (`QUEUE_SCHEDULER` env → default `scheduler`) |

---

## Constitution Check

*GATE: Phải pass trước Phase 1 (Enum & Migration). Re-check sau Phase 4 (Core Service).*

| Gate | Điều kiện PASS | Trạng thái |
|---|---|---|
| **DB Gate** | Không thêm bảng mới ngoài DB v3.2 Compact (39 bảng). Chỉ thêm enum values + writes vào bảng đã có. | ✅ PASS |
| **Security Gate** | Không có plain-text credential. Internal process không expose secret. Log chỉ ghi meetingId, không ghi token/key. | ✅ PASS |
| **Scope Gate** | UC-IMM-12 chỉ phụ trách scheduling, không gửi notification (UC-IMM-13 riêng). Không tự thêm endpoint mới. | ✅ PASS |
| **Module Gate** | Logic nằm trong `live-meeting` module. QueueModule/AdministrationModule đã @Global — không vi phạm module boundary. | ✅ PASS |
| **API Gate** | Không có HTTP endpoint mới. Trigger hooks modify response của caller UC (start/end) theo đúng convention. | ✅ PASS |
| **Auth Gate** | Internal process không cần auth guard. `user_id` trong audit context vẫn đến từ JWT của caller UC. | ✅ PASS |
| **Test Gate** | 22 unit test cases (T-W01 → T-W22) cover tất cả service methods, guard checks, skip guard, error paths. | ✅ PASS |

**Complexity Justification**: Không có vi phạm. Không cần `## Complexity Tracking`.

---

## Project Structure

### Documentation (this feature)

```text
spec/features/live-meeting/feat-schedule-meeting-time-warning/
├── plan.md                              # This file
├── research.md                          # Codebase analysis, technology decisions
├── data-model.md                        # Entities impacted, enum changes, migration spec
├── quickstart.md                        # Test scenarios, verification checklist
├── contracts/
│   └── internal-warning-scheduling.md  # Internal service API contract (không có HTTP endpoint)
├── spec.md                              # Feature specification
└── checklists/
    └── requirements.md                 # Spec quality checklist
```

> `tasks.md` sẽ được tạo bởi `/speckit.tasks` (bước tiếp theo), không phải bởi `/speckit.plan`.

### Source Code (repository root)

```text
src/
├── database/
│   ├── migrations/
│   │   └── 20260619000001-AddWarningScheduledEventTypes.ts  # NEW — enum additions
│   └── seeds/
│       └── 20260619000001-SeedMeetingWarningConfig.ts        # NEW — meeting_warning_before_minutes
│
├── modules/
│   ├── meetings/
│   │   └── entities/
│   │       └── meeting-event.entity.ts                       # MODIFY — add WARNING_SCHEDULED, WARNING_SCHEDULING_SKIPPED
│   │
│   ├── administration/
│   │   └── entities/
│   │       └── background-job.entity.ts                      # MODIFY — add MEETING_TIME_WARNING, SCHEDULED
│   │
│   └── live-meeting/
│       ├── constants/
│       │   └── meeting-warning-error.constant.ts             # NEW
│       ├── types/
│       │   └── schedule-warning-result.type.ts               # NEW
│       ├── dto/
│       │   └── start-meeting-response.dto.ts                 # MODIFY — add warningScheduledAt?, warningSkipped?
│       ├── services/
│       │   └── live-meeting.service.ts                       # MODIFY — add 4 methods, inject QueueService + BackgroundJobsService
│       └── tests/
│           └── live-meeting.service.spec.ts                  # MODIFY — add 4 test suites
```

**Structure Decision**: Single NestJS module monolith. Toàn bộ thay đổi nằm trong module `live-meeting` (core logic) và entities của `meetings` + `administration` (enum additions). Không cần module mới.

---

## 3. Scope Confirmation

### IN SCOPE
- Thêm `WARNING_SCHEDULED`, `WARNING_SCHEDULING_SKIPPED` vào `MeetingEventType` enum.
- Thêm `MEETING_TIME_WARNING` vào `BackgroundJobType` enum.
- Thêm `SCHEDULED` vào `BackgroundJobStatus` enum (job đã enqueue với delay, chờ fired).
- TypeORM migration cập nhật 3 PostgreSQL enum types.
- Seed đảm bảo `system_configs` tồn tại key `meeting_warning_before_minutes = '10'`.
- Method `scheduleWarningJob(meetingId)` trong `LiveMeetingService` — Normal Flow + AF2.
- Method `rescheduleWarningJob(meetingId)` trong `LiveMeetingService` — AF1.
- Method `cancelWarningJob(meetingId)` trong `LiveMeetingService` — AF3.
- Gọi `scheduleWarningJob()` sau `startMeeting()` commit (best-effort).
- Gọi `rescheduleWarningJob()` sau `decideExtension()` approve commit (best-effort).
- Gọi `rescheduleWarningJob()` sau UC-IMM-02 auto-apply extension commit (best-effort).
- Gọi `cancelWarningJob()` sau `endMeeting()` commit (best-effort).
- Tạo `background_jobs` record khi enqueue thành công.
- Tạo `meeting_events` (`warning_scheduled` hoặc `warning_scheduling_skipped`).
- Error constants cho UC-IMM-12.
- Unit tests đầy đủ cho 3 methods.

### OUT OF SCOPE
- HTTP endpoint mới — UC-IMM-12 là internal process.
- Gửi notification (UC-IMM-13).
- BullMQ job processor/worker (UC-IMM-13).
- Thêm bảng mới vào database.
- Outbox Pattern — best-effort accepted.
- Pause/resume meeting warning schedule.
- Multiple warning levels, per-meeting threshold.
- WebSocket push từ UC-IMM-12 — chỉ WebSocket từ UC-IMM-13.
- Thay đổi bất kỳ logic nào trong UC-IMM-01/02/03/05 ngoài thêm lời gọi trigger.

---

## 4. Data Model Impact

### Không thêm bảng mới. Thay đổi chỉ ở enum values và data writes.

#### 4.1 Enum additions — cần TypeORM migration

| Entity | Enum | Giá trị mới |
|---|---|---|
| `MeetingEventEntity` | `MeetingEventType` | `WARNING_SCHEDULED = 'warning_scheduled'` |
| `MeetingEventEntity` | `MeetingEventType` | `WARNING_SCHEDULING_SKIPPED = 'warning_scheduling_skipped'` |
| `BackgroundJobEntity` | `BackgroundJobType` | `MEETING_TIME_WARNING = 'meeting_time_warning'` |
| `BackgroundJobEntity` | `BackgroundJobStatus` | `SCHEDULED = 'scheduled'` |

> **Lưu ý**: `MeetingEventEntity` đã có `WARNING_SENT = 'warning_sent'` nhưng chưa có `warning_scheduled` hay `warning_scheduling_skipped`. Hai giá trị này khác nhau về semantic: `warning_sent` là khi notification đã được gửi (UC-IMM-13), `warning_scheduled` là khi job được enqueue (UC-IMM-12).

#### 4.2 INSERT — khi enqueue thành công (Normal / AF2)

| Table | Operation | Điều kiện |
|---|---|---|
| `background_jobs` | INSERT | Chỉ khi enqueue BullMQ thành công |
| `meeting_events` | INSERT event_type = `warning_scheduled` | Chỉ khi enqueue thành công |

#### 4.3 UPDATE — khi re-enqueue (AF1)

| Table | Operation | Điều kiện |
|---|---|---|
| `background_jobs` | UPDATE status=`scheduled`, scheduled_at=newTime, input_json | Record tồn tại |
| `background_jobs` | INSERT nếu record không tồn tại | Fallback upsert |
| `meeting_events` | INSERT event_type = `warning_scheduled` | Luôn tạo mới (không update cũ) |

#### 4.4 UPDATE — khi cancel (AF3)

| Table | Operation | Điều kiện |
|---|---|---|
| `background_jobs` | UPDATE status=`cancelled` | Record tồn tại |
| `meeting_events` | Không tạo mới | AF3 không ghi event |

#### 4.5 INSERT — skip case (FR-17)

| Table | Operation | Điều kiện |
|---|---|---|
| `background_jobs` | KHÔNG tạo | Skip guard = `warningScheduledAt ≤ now() + 60s` |
| `meeting_events` | INSERT event_type = `warning_scheduling_skipped` | Skip guard kích hoạt |

#### 4.6 READ

| Table | Fields | Mục đích |
|---|---|---|
| `meetings` | `end_time`, `status` | Guard check + tính warningScheduledAt |
| `system_configs` | `config_key = 'meeting_warning_before_minutes'` | Đọc config threshold |
| `background_jobs` | `related_entity_id = meetingId`, `job_type = meeting_time_warning` | Upsert / update cancel |

---

## 5. API / Contract Plan

**Không có HTTP endpoint mới.** UC-IMM-12 là internal process.

### Trigger hooks được thêm vào các UC hiện có

| UC | Method hiện tại | Vị trí gọi | Method UC-IMM-12 |
|---|---|---|---|
| UC-IMM-01 | `startMeeting()` | Sau `executeStartMeetingInTransaction()` commit | `scheduleWarningJob(meetingId)` |
| UC-IMM-03 | `decideExtension()` approve path | Sau transaction commit | `rescheduleWarningJob(meetingId)` |
| UC-IMM-02 | `requestExtension()` auto-apply path | Sau transaction commit | `rescheduleWarningJob(meetingId)` |
| UC-IMM-05 | `endMeeting()` | Sau `executeEndMeetingInTransaction()` commit | `cancelWarningJob(meetingId)` |

### Response thêm vào UC-IMM-01

`StartMeetingResponseDto` bổ sung 2 fields optional:

```typescript
warningScheduledAt?: string;   // ISO-8601, trả về nếu enqueue thành công
warningSkipped?: boolean;       // true nếu skip guard kích hoạt
```

---

## 6. Authorization Plan

**Không có authorization** — UC-IMM-12 là internal process gọi nội bộ trong `LiveMeetingService`.

Bảo vệ duy nhất:
- Guard check: meeting phải `in_progress`, `end_time` không null.
- Logic chạy post-commit, nằm trong `LiveMeetingService` — không expose ra HTTP.

---

## 7. Business Logic Plan

### 7.1 Method: `scheduleWarningJob(meetingId: string): Promise<ScheduleWarningResult>`

```
1. Đọc meeting từ DB (chỉ cần end_time + status).
2. Guard: status = in_progress, end_time != null. Nếu không thỏa → log WARN + return { skipped: true, reason: 'guard_failed' }.
3. Đọc config: meeting_warning_before_minutes từ system_configs.
   - Parse sang integer. Fallback default = 10 nếu key không tồn tại hoặc parse lỗi.
4. Tính warningScheduledAt = end_time - configMinutes.
5. Kiểm tra AF2: remainingMinutes = end_time - now().
   - Nếu remainingMinutes ≤ configMinutes:
       adjustedWarningMinutes = Math.floor(remainingMinutes / 2)
       warningScheduledAt = now() + adjustedWarningMinutes
6. Kiểm tra skip guard: nếu warningScheduledAt ≤ now() + 60s:
   - Ghi meeting_events: event_type = WARNING_SCHEDULING_SKIPPED
   - Log WARN: '[scheduleWarningJob] Skipped — meetingId, warningScheduledAt, reason'
   - Return { skipped: true, reason: 'too_close', warningScheduledAt }
7. Tính delayMs = warningScheduledAt.getTime() - Date.now().
8. Enqueue BullMQ job qua QueueService.addJob():
   - queueName = schedulerQueueName (env QUEUE_SCHEDULER, default 'scheduler')
   - jobName = 'meeting-time-warning'
   - data = { meetingId, warningScheduledAt: ISO, endTime: ISO }
   - options = { jobId: `meeting-time-warning:${meetingId}`, delay: delayMs }
   (BullMQ tự dedupe bằng jobId — job cũ với jobId trùng sẽ bị overwrite nếu chưa fired)
9. Upsert background_jobs:
   - Tìm record hiện có: related_entity_id = meetingId, job_type = MEETING_TIME_WARNING.
   - Nếu tồn tại → UPDATE status=SCHEDULED, scheduled_at, input_json.
   - Nếu không → INSERT mới.
10. Ghi meeting_events: event_type = WARNING_SCHEDULED.
11. Log INFO: '[scheduleWarningJob] Scheduled — meetingId, warningScheduledAt, jobId, adjustedWarning?'
12. Return { skipped: false, warningScheduledAt }
```

> **Non-blocking**: Toàn bộ method này chạy trong `try/catch`. Lỗi bất kỳ → log ERROR + return `{ skipped: true, reason: 'error' }`. Không throw ra caller.

### 7.2 Method: `rescheduleWarningJob(meetingId: string): Promise<ScheduleWarningResult>`

```
1. Bước 1-3 giống scheduleWarningJob().
4. Cancel BullMQ job cũ:
   a. getQueue(schedulerQueueName).getJob(`meeting-time-warning:${meetingId}`)
   b. Nếu job tồn tại → job.remove()
   c. Nếu không tồn tại → bỏ qua (idempotent, log INFO)
5. Tính warningScheduledAt từ end_time mới (bước 4 của scheduleWarningJob).
6. Kiểm tra AF2 (bước 5 của scheduleWarningJob).
7. Kiểm tra skip guard (bước 6 của scheduleWarningJob).
8. Enqueue job mới (bước 7-8 của scheduleWarningJob).
9. Upsert background_jobs (bước 9 của scheduleWarningJob).
10. Ghi meeting_events: WARNING_SCHEDULED.
11. Return { skipped: false, warningScheduledAt }
```

### 7.3 Method: `cancelWarningJob(meetingId: string): Promise<void>`

```
1. Try:
   a. getQueue(schedulerQueueName).getJob(`meeting-time-warning:${meetingId}`)
   b. Nếu job tồn tại → job.remove(). Log INFO cancel success.
   c. Nếu không tồn tại → log INFO 'job not found, skip cancel' (idempotent).
2. Update background_jobs:
   a. Tìm record: related_entity_id = meetingId, job_type = MEETING_TIME_WARNING.
   b. Nếu tồn tại → UPDATE status = CANCELLED.
   c. Nếu không → bỏ qua.
3. KHÔNG ghi meeting_events (AF3 không tạo event).
4. Catch lỗi → log ERROR + tiếp tục (non-blocking).
```

### 7.4 Helper: `readWarningConfig(): Promise<number>`

```
1. Tìm system_configs WHERE config_key = 'meeting_warning_before_minutes'.
2. Parse config_value thành integer.
3. Nếu không tìm thấy hoặc parse lỗi → log WARN + return DEFAULT_WARNING_MINUTES (= 10).
```

### 7.5 BullMQ dedupe behavior

BullMQ với `jobId` cố định (`meeting-time-warning:{meetingId}`):
- Nếu job cũ còn trong queue (`delayed` / `waiting`) → BullMQ **throw error** "job already exists" khi add cùng jobId.
- Để overwrite: cần `job.remove()` trước, sau đó `addJob()` lại — đây là flow của `rescheduleWarningJob`.
- `scheduleWarningJob()` (dùng khi start lần đầu): job chưa tồn tại → addJob thành công.
- Nếu `scheduleWarningJob()` được gọi lại (idempotent duplicate trigger): BullMQ throw "already exists" → catch → log + bỏ qua.

---

## 8. Validation Plan

UC-IMM-12 không có HTTP input validation. Validation là guard checks nội bộ:

| Guard Check | Layer | Hành động khi fail |
|---|---|---|
| Meeting tồn tại | Service (scheduleWarningJob) | log WARN + return skipped |
| `meetings.status = in_progress` | Service | log WARN + return skipped |
| `meetings.end_time != null` | Service | log WARN + return skipped |
| `warningScheduledAt > now() + 60s` | Service (skip guard) | ghi `warning_scheduling_skipped` event + return skipped |
| `config_value` parse thành integer | Service (readWarningConfig) | log WARN + dùng default 10 |
| BullMQ enqueue thất bại | Service (try/catch) | log ERROR + return skipped (non-blocking) |
| `background_jobs` upsert thất bại | Service (try/catch) | log ERROR + continue (best-effort) |
| `meeting_events` insert thất bại | Service (try/catch) | log ERROR + continue (best-effort) |

---

## 9. Error Handling Plan

### Error constants

**File mới**: `src/modules/live-meeting/constants/meeting-warning-error.constant.ts`

```typescript
export const MEETING_WARNING_ERRORS = {
  MEETING_NOT_FOUND_FOR_SCHEDULING: 'MEETING_NOT_FOUND_FOR_SCHEDULING',
  MEETING_NOT_IN_PROGRESS_FOR_SCHEDULING: 'MEETING_NOT_IN_PROGRESS_FOR_SCHEDULING',
  MEETING_END_TIME_NULL: 'MEETING_END_TIME_NULL',
  WARNING_SCHEDULING_SKIPPED: 'WARNING_SCHEDULING_SKIPPED',
  WARNING_ENQUEUE_FAILED: 'WARNING_ENQUEUE_FAILED',
  WARNING_CANCEL_FAILED: 'WARNING_CANCEL_FAILED',
} as const;
```

### Exception policy

UC-IMM-12 **không throw exception** ra caller. Tất cả errors được:
1. Log với structured message: `[methodName] error: REASON — meetingId: X, details: Y`.
2. Caught trong top-level `try/catch`.
3. Return `{ skipped: true, reason: 'error' }` hoặc `void` (cancelWarningJob).

### Transaction boundary

**Không có transaction riêng cho UC-IMM-12.** Tất cả writes (`background_jobs`, `meeting_events`) là independent operations, không atomic với nhau. Known limitation đã được accept theo Q4.

| Write | Transaction scope | Failure behavior |
|---|---|---|
| BullMQ enqueue | — (BullMQ internal) | log + skip subsequent writes |
| `background_jobs` INSERT/UPDATE | Không | log ERROR + continue |
| `meeting_events` INSERT | Không | log ERROR + continue |

### Consistency với caller UC

| Caller UC | Failure của UC-IMM-12 | Impact lên caller |
|---|---|---|
| UC-IMM-01 `startMeeting()` | Không ảnh hưởng — meeting đã `in_progress` | `StartMeetingResponseDto.warningScheduledAt` = null |
| UC-IMM-03 `decideExtension()` | Không ảnh hưởng — extension đã applied | Warning job cũ có thể còn; UC-IMM-13 sẽ fire job cũ |
| UC-IMM-05 `endMeeting()` | Không ảnh hưởng — meeting đã `completed` | **Risk**: job cũ vẫn có thể fire nếu cancel thất bại (xem Risk section) |

---

## 10. Testing Strategy

### Unit Tests — `live-meeting.service.spec.ts` (thêm test suite mới)

#### Suite: `scheduleWarningJob()`

| Test Case | FR/Scenario | Mô tả |
|---|---|---|
| T-W01 | FR-01/02/03, Scenario 1 | Happy path: enqueue đúng, background_jobs tạo, event warning_scheduled |
| T-W02 | FR-12, Scenario 3 | AF2: remainingMinutes < config → adjustedWarningMinutes = floor(R/2), warningScheduledAt = now + M |
| T-W03 | FR-17, Scenario 5 | Skip guard: warningScheduledAt ≤ now+60s → warning_scheduling_skipped event, NO background_jobs |
| T-W04 | FR-14, ERR-01 | Config key missing → default 10 phút |
| T-W05 | ERR-02 | Config value không parse được → default 10 phút |
| T-W06 | FR-18, ERR-04 | Meeting không `in_progress` → log + return skipped |
| T-W07 | ERR-05 | end_time = null → log + return skipped |
| T-W08 | ERR-03 | Meeting không tồn tại → log + return skipped |
| T-W09 | FR-15, NFR-05 | BullMQ enqueue thất bại → log + non-blocking, KHÔNG ghi meeting_events |
| T-W10 | ERR-08 | background_jobs upsert thất bại → log + continue (job vẫn enqueued) |
| T-W11 | NFR-03 | Idempotent: gọi 2 lần → BullMQ "already exists" error bị catch, không throw |

#### Suite: `rescheduleWarningJob()` — AF1

| Test Case | FR/Scenario | Mô tả |
|---|---|---|
| T-W12 | FR-11, Scenario 2 | Happy path: cancel job cũ + enqueue mới với end_time mới, upsert background_jobs |
| T-W13 | FR-16, ERR-10 | Job cũ không tìm thấy → skip cancel, enqueue mới bình thường |
| T-W14 | FR-11 + skip guard | AF1 + skip guard: reschedule nhưng warningScheduledAt ≤ now+60s → skipped |

#### Suite: `cancelWarningJob()` — AF3

| Test Case | FR/Scenario | Mô tả |
|---|---|---|
| T-W15 | FR-13, Scenario 4 | Happy path: job bị remove, background_jobs status = CANCELLED |
| T-W16 | ERR-10 | Job không tồn tại trong queue → log INFO + tiếp tục idempotent |
| T-W17 | ERR-11 | background_jobs update thất bại → log ERROR + non-blocking |
| T-W18 | FR-13 | KHÔNG tạo meeting_events khi cancel |

#### Suite: Trigger integration từ caller UC

| Test Case | Mô tả |
|---|---|
| T-W19 | `startMeeting()` gọi `scheduleWarningJob()` sau commit — mock scheduleWarningJob, verify được gọi |
| T-W20 | `endMeeting()` gọi `cancelWarningJob()` sau commit — mock cancelWarningJob, verify được gọi |
| T-W21 | `decideExtension()` approve path gọi `rescheduleWarningJob()` sau commit |
| T-W22 | `scheduleWarningJob()` thất bại không ảnh hưởng `startMeeting()` response |

### Migration Tests

- Verify enum values mới tồn tại trong DB sau migration.
- Không rollback enum bị ảnh hưởng schema cũ.

---

## 11. Implementation Phases

### Phase 1: Entity & Enum Additions

| Task | File | Mô tả |
|---|---|---|
| T001 | `src/modules/meetings/entities/meeting-event.entity.ts` | Thêm `WARNING_SCHEDULED = 'warning_scheduled'` và `WARNING_SCHEDULING_SKIPPED = 'warning_scheduling_skipped'` vào `MeetingEventType` enum |
| T002 | `src/modules/administration/entities/background-job.entity.ts` | Thêm `MEETING_TIME_WARNING = 'meeting_time_warning'` vào `BackgroundJobType` và `SCHEDULED = 'scheduled'` vào `BackgroundJobStatus` |
| T003 | `src/database/migrations/20260619000001-AddWarningScheduledEventTypes.ts` | Migration cập nhật 3 PostgreSQL enum types: `meeting_event_type`, `background_job_type`, `background_job_status` |

### Phase 2: Seed & Config

| Task | File | Mô tả |
|---|---|---|
| T004 | `src/database/seeds/20260619000001-SeedMeetingWarningConfig.ts` | Seed `system_configs`: INSERT ON CONFLICT DO NOTHING cho `meeting_warning_before_minutes = '10'` |

### Phase 3: Constants & Types

| Task | File | Mô tả |
|---|---|---|
| T005 | `src/modules/live-meeting/constants/meeting-warning-error.constant.ts` | Tạo `MEETING_WARNING_ERRORS` constant |
| T006 | `src/modules/live-meeting/types/schedule-warning-result.type.ts` | Tạo `ScheduleWarningResult` interface: `{ skipped: boolean; reason?: string; warningScheduledAt?: Date }` |

### Phase 4: Core Service Methods

| Task | File | Mô tả |
|---|---|---|
| T007 | `src/modules/live-meeting/services/live-meeting.service.ts` | Thêm `private readWarningConfig(): Promise<number>` |
| T008 | `src/modules/live-meeting/services/live-meeting.service.ts` | Thêm `scheduleWarningJob(meetingId): Promise<ScheduleWarningResult>` — Normal Flow + AF2 + skip guard |
| T009 | `src/modules/live-meeting/services/live-meeting.service.ts` | Thêm `rescheduleWarningJob(meetingId): Promise<ScheduleWarningResult>` — AF1 |
| T010 | `src/modules/live-meeting/services/live-meeting.service.ts` | Thêm `cancelWarningJob(meetingId): Promise<void>` — AF3 |

### Phase 5: Inject QueueService & BackgroundJobsService

| Task | File | Mô tả |
|---|---|---|
| T011 | `src/modules/live-meeting/services/live-meeting.service.ts` | Inject `QueueService` và `BackgroundJobsService` vào constructor (đã @Global, không cần import thêm vào module) |
| T012 | `src/modules/live-meeting/services/live-meeting.service.ts` | Thêm `CONFIG_QUEUE_SCHEDULER_NAME` constant đọc từ `ConfigService` (hoặc hardcode default `'scheduler'`) |

### Phase 6: Wire Trigger Hooks

| Task | File | Mô tả |
|---|---|---|
| T013 | `src/modules/live-meeting/services/live-meeting.service.ts` | Gọi `this.scheduleWarningJob(meetingId)` trong `startMeeting()` sau post-transaction block |
| T014 | `src/modules/live-meeting/services/live-meeting.service.ts` | Gọi `this.rescheduleWarningJob(meetingId)` trong `decideExtension()` approve path sau post-transaction block |
| T015 | `src/modules/live-meeting/services/live-meeting.service.ts` | Gọi `this.rescheduleWarningJob(meetingId)` trong `requestExtension()` auto-apply path sau post-transaction block |
| T016 | `src/modules/live-meeting/services/live-meeting.service.ts` | Gọi `this.cancelWarningJob(meetingId)` trong `endMeeting()` sau post-transaction block |
| T017 | `src/modules/live-meeting/dto/start-meeting-response.dto.ts` | Thêm `warningScheduledAt?: string` và `warningSkipped?: boolean` vào `StartMeetingResponseDto` |

### Phase 7: Testing

| Task | File | Mô tả |
|---|---|---|
| T018 | `src/modules/live-meeting/tests/live-meeting.service.spec.ts` | Thêm test suite cho `scheduleWarningJob()` — T-W01 đến T-W11 |
| T019 | `src/modules/live-meeting/tests/live-meeting.service.spec.ts` | Thêm test suite cho `rescheduleWarningJob()` — T-W12 đến T-W14 |
| T020 | `src/modules/live-meeting/tests/live-meeting.service.spec.ts` | Thêm test suite cho `cancelWarningJob()` — T-W15 đến T-W18 |
| T021 | `src/modules/live-meeting/tests/live-meeting.service.spec.ts` | Thêm trigger integration tests — T-W19 đến T-W22 |

---

## 12. Risks & Mitigations

| Risk | Likelihood | Impact | Mitigation |
|---|---|---|---|
| BullMQ `addJob()` với `jobId` đã tồn tại throw error thay vì overwrite | Medium | High (double warning job) | Trong `rescheduleWarningJob()` luôn `remove()` trước `addJob()`. Trong `scheduleWarningJob()` catch "job already exists" và bỏ qua |
| `cancelWarningJob()` thất bại → job fired sau khi meeting đã `completed` | Low | Medium (cảnh báo giả cho ended meeting) | UC-IMM-13 kiểm tra `meetings.status = in_progress` trước khi gửi notification. Documented risk |
| `BackgroundJobStatus.SCHEDULED` chưa có → TypeORM enum mismatch | High | Blocking | T002 thêm enum value, T003 migration bắt buộc chạy trước deploy |
| `QueueService.getQueue()` return `undefined` nếu queue name sai | Medium | High (cancel không hoạt động) | Assert queue exists khi inject; log ERROR nếu null; unit test mock verify |
| `decideExtension()` auto-apply (UC-IMM-02) không gọi `rescheduleWarningJob()` | Medium | High (cảnh báo sai sau gia hạn tự động) | T015 phải wire vào cả `requestExtension()` auto-apply path, không chỉ `decideExtension()` |
| `readWarningConfig()` query miss (SystemConfigEntity không có data) | Low | Low (dùng default 10) | T004 seed đảm bảo row tồn tại; unit test T-W04 cover fallback |
| `ConfigService` inject vào `LiveMeetingService` cho scheduler queue name | Low | Medium | Kiểm tra constructor hiện tại — nếu chưa inject `ConfigService`, thêm vào Phase 5 |

---

## 13. Acceptance Criteria Traceability

| Scenario | AC Description | FR Coverage | Task | Verification |
|---|---|---|---|---|
| Scenario 1 (Happy path) | Meeting start → warning_scheduled tại `end_time - 10m`, background_jobs created, meeting_events created, response trả `warningScheduledAt` | FR-01, FR-02, FR-03, FR-04, FR-05, FR-06, FR-19, BR3 | T008, T013, T017, T-W01 | Unit test T-W01 + trigger test T-W19 |
| Scenario 2 (AF1) | Extension approved → job cũ bị cancel, warningScheduledAt mới, background_jobs upserted | FR-07, FR-11, FR-20, BR1 | T009, T014, T-W12 | Unit test T-W12 + trigger test T-W21 |
| Scenario 3 (AF2) | remainingMinutes < config → adjustedWarningMinutes = floor(R/2), warningScheduledAt = now+M, input_json có adjustedWarning | FR-10, FR-12, BR6 | T008, T-W02 | Unit test T-W02 |
| Scenario 4 (AF3) | Meeting end → job removed, background_jobs cancelled, KHÔNG có event | FR-08, FR-13, FR-22, BR2 | T010, T016, T-W15 | Unit test T-W15, T-W18 + trigger test T-W20 |
| Scenario 5 (Skip guard) | warningScheduledAt ≤ now+60s → NO enqueue, NO background_jobs, YES warning_scheduling_skipped event | FR-17, BR4, ERR-06 | T008, T-W03 | Unit test T-W03 |

---

## Appendix: File Inventory

### Files to CREATE

| File | Phase | Mô tả |
|---|---|---|
| `src/database/migrations/20260619000001-AddWarningScheduledEventTypes.ts` | P1 / T003 | Migration: thêm enum values cho meeting_event_type, background_job_type, background_job_status |
| `src/database/seeds/20260619000001-SeedMeetingWarningConfig.ts` | P2 / T004 | Seed: `meeting_warning_before_minutes = '10'` |
| `src/modules/live-meeting/constants/meeting-warning-error.constant.ts` | P3 / T005 | Error constants |
| `src/modules/live-meeting/types/schedule-warning-result.type.ts` | P3 / T006 | `ScheduleWarningResult` interface |

### Files to MODIFY

| File | Phase | Thay đổi |
|---|---|---|
| `src/modules/meetings/entities/meeting-event.entity.ts` | P1 / T001 | Thêm `WARNING_SCHEDULED`, `WARNING_SCHEDULING_SKIPPED` vào `MeetingEventType` |
| `src/modules/administration/entities/background-job.entity.ts` | P1 / T002 | Thêm `MEETING_TIME_WARNING` vào `BackgroundJobType`, `SCHEDULED` vào `BackgroundJobStatus` |
| `src/modules/live-meeting/services/live-meeting.service.ts` | P4-P6 / T007-T016 | Thêm `readWarningConfig`, `scheduleWarningJob`, `rescheduleWarningJob`, `cancelWarningJob`; inject `QueueService`/`BackgroundJobsService`/`ConfigService`; wire trigger hooks |
| `src/modules/live-meeting/dto/start-meeting-response.dto.ts` | P6 / T017 | Thêm `warningScheduledAt?` và `warningSkipped?` |
| `src/modules/live-meeting/tests/live-meeting.service.spec.ts` | P7 / T018-T021 | Thêm 4 test suites (22 test cases) |
