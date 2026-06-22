# Data Model — Lập lịch cảnh báo thời gian còn lại (UC-IMM-12)

## Tổng quan

UC-IMM-12 **không tạo bảng mới**. Toàn bộ thay đổi là:
- 4 enum values mới (cần TypeORM migration).
- INSERT/UPDATE vào các bảng đã có: `background_jobs`, `meeting_events`.
- READ từ: `meetings`, `system_configs`.

---

## Entities Impacted

### 1. `meeting_events` — INSERT

**Vai trò**: Timeline event ghi nhận trạng thái scheduling của warning job.

#### Event: `warning_scheduled` (Normal Flow / AF1 / AF2)

| Column | Value |
|---|---|
| `meeting_id` | meetingId |
| `event_type` | `warning_scheduled` |
| `event_time` | `now()` (server time) |
| `actor_user_id` | `null` (system action) |
| `source_type` | `scheduler` |
| `description` | `"Warning job đã được lập lịch"` |
| `new_value_json` | `{ "warningScheduledAt": "<ISO>", "jobId": "meeting-time-warning:{uuid}", "adjustedWarning": true/false }` |
| `metadata_json` | `{ "configMinutes": 10, "remainingMinutes": N }` |

#### Event: `warning_scheduling_skipped` (Skip Guard kích hoạt)

| Column | Value |
|---|---|
| `meeting_id` | meetingId |
| `event_type` | `warning_scheduling_skipped` |
| `event_time` | `now()` |
| `actor_user_id` | `null` |
| `source_type` | `scheduler` |
| `description` | `"Warning scheduling bị bỏ qua (thời gian quá gần)"` |
| `new_value_json` | `{ "warningScheduledAt": "<ISO>", "reason": "too_close_to_now" }` |
| `metadata_json` | `{ "configMinutes": 10, "remainingSeconds": N }` |

**Entity reference**: `MeetingEventEntity`

---

### 2. `background_jobs` — INSERT hoặc UPDATE

**Vai trò**: Tracking trạng thái BullMQ delayed job.

> **Lưu ý**: Chỉ tạo/cập nhật `background_jobs` khi enqueue BullMQ **thành công**. Skip guard → KHÔNG tạo record.

#### INSERT khi job chưa tồn tại

| Column | Value |
|---|---|
| `id` | `gen_random_uuid()` |
| `job_type` | `meeting_time_warning` |
| `related_entity_type` | `meeting` |
| `related_entity_id` | meetingId |
| `requested_by` | `null` (system) |
| `queue_name` | `scheduler` |
| `status` | `scheduled` |
| `priority` | `0` |
| `scheduled_at` | warningScheduledAt |
| `input_json` | `{ "meetingId": "uuid", "endTime": "<ISO>", "warningScheduledAt": "<ISO>", "adjustedWarningMinutes": N }` |
| `retry_count` | `0` |

**Query tham chiếu:**
```sql
INSERT INTO background_jobs
  (id, job_type, related_entity_type, related_entity_id, queue_name,
   status, priority, scheduled_at, input_json, retry_count, created_at)
VALUES
  (gen_random_uuid(), 'meeting_time_warning', 'meeting', $1, 'scheduler',
   'scheduled', 0, $2, $3, 0, now())
ON CONFLICT DO NOTHING;
```

#### UPDATE khi job đã tồn tại (reschedule — AF1)

| Column | Change | Value |
|---|---|---|
| `status` | UPDATE | `scheduled` |
| `scheduled_at` | UPDATE | warningScheduledAt mới |
| `input_json` | UPDATE | input mới với `endTime` mới |
| `updated_at` | UPDATE | `now()` |

**Query tham chiếu:**
```sql
UPDATE background_jobs
SET status = 'scheduled',
    scheduled_at = $1,
    input_json = $2,
    updated_at = now()
WHERE related_entity_id = $3
  AND job_type = 'meeting_time_warning';
```

#### UPDATE khi cancel (AF3)

| Column | Change | Value |
|---|---|---|
| `status` | UPDATE | `cancelled` |
| `updated_at` | UPDATE | `now()` |

---

### 3. `meetings` — READ ONLY

**Vai trò**: Kiểm tra guard và tính `warningScheduledAt`.

| Column | Read | Mục đích |
|---|---|---|
| `id` | READ | Lookup |
| `status` | READ | Guard check: phải là `in_progress` |
| `end_time` | READ | Tính `warningScheduledAt = end_time - configMinutes` |

**Query tham chiếu:**
```sql
SELECT id, status, end_time
FROM meetings
WHERE id = $1
  AND deleted_at IS NULL;
```

---

### 4. `system_configs` — READ ONLY

**Vai trò**: Lấy ngưỡng cảnh báo (số phút trước khi kết thúc).

| Column | Read | Mục đích |
|---|---|---|
| `config_key` | WHERE | `meeting_warning_before_minutes` |
| `config_value` | READ | Parse thành integer, fallback default = 10 |

---

## TypeORM Entity Changes Required

### 1. `MeetingEventType` — Thêm 2 enum values

**File**: `src/modules/meetings/entities/meeting-event.entity.ts`

```typescript
export enum MeetingEventType {
  // ... existing values ...
  WARNING_SENT = 'warning_sent',              // UC-IMM-13 (đã có)
  WARNING_SCHEDULED = 'warning_scheduled',    // UC-IMM-12 — THÊM MỚI
  WARNING_SCHEDULING_SKIPPED = 'warning_scheduling_skipped', // UC-IMM-12 — THÊM MỚI
}
```

> **Phân biệt**: `WARNING_SENT` là khi notification đã gửi (UC-IMM-13); `WARNING_SCHEDULED` là khi BullMQ job được enqueue (UC-IMM-12).

### 2. `BackgroundJobType` — Thêm 1 enum value

**File**: `src/modules/administration/entities/background-job.entity.ts`

```typescript
export enum BackgroundJobType {
  // ... existing values ...
  MEETING_TIME_WARNING = 'meeting_time_warning', // UC-IMM-12 — THÊM MỚI
}
```

### 3. `BackgroundJobStatus` — Thêm 1 enum value

**File**: `src/modules/administration/entities/background-job.entity.ts`

```typescript
export enum BackgroundJobStatus {
  QUEUED = 'queued',       // Job sẽ chạy ngay
  SCHEDULED = 'scheduled', // UC-IMM-12 — THÊM MỚI: Job delayed, chờ fired tại warningScheduledAt
  RUNNING = 'running',
  COMPLETED = 'completed',
  FAILED = 'failed',
  CANCELLED = 'cancelled',
  RETRYING = 'retrying',
}
```

> `SCHEDULED` khác `QUEUED`: job `QUEUED` sẽ chạy ngay khi có worker; job `SCHEDULED` có `delay`, chỉ available sau `scheduledAt`.

---

## State Transitions

### Background Job Status (UC-IMM-12)

```
[start meeting]
    ↓ enqueue BullMQ
  SCHEDULED ──────────────────────> CANCELLED  (endMeeting / cancelWarningJob)
     │
     │ [warningScheduledAt reached]
     ↓
  RUNNING   (UC-IMM-13 processor handles)
     │
     ├──> COMPLETED  (notification sent)
     └──> FAILED     (notification failed)
```

### Meeting Events (UC-IMM-12)

```
[scheduleWarningJob called]
    ├── enqueue OK  → INSERT meeting_events: warning_scheduled
    └── skip guard  → INSERT meeting_events: warning_scheduling_skipped
                      (NO background_jobs record)
```

---

## Data Constraints Summary

| Entity | Constraint | Type |
|---|---|---|
| `meetings` | `status = in_progress` trước khi schedule | Business |
| `meetings` | `end_time IS NOT NULL` | Business |
| `meetings` | `deleted_at IS NULL` | Soft-delete |
| `background_jobs` | Chỉ 1 record per meetingId + job_type | Upsert logic |
| `meeting_events` | Có thể có nhiều `warning_scheduled` (reschedule) | Không unique |
| `background_jobs` | Không tạo khi skip guard kích hoạt | Business |
| `background_jobs.status` | Không set `SCHEDULED` nếu BullMQ enqueue thất bại | Business |

---

## Redis / Cache

UC-IMM-12 không dùng Redis trực tiếp. BullMQ dùng Redis nội bộ để store delayed jobs — đã được setup bởi `QueueModule`.

---

## Migration Required

**File**: `src/database/migrations/20260619000001-AddWarningScheduledEventTypes.ts`

```typescript
// Cập nhật 3 PostgreSQL enum types:
// 1. meeting_event_type: ADD 'warning_scheduled', 'warning_scheduling_skipped'
// 2. background_job_type: ADD 'meeting_time_warning'
// 3. background_job_status: ADD 'scheduled'
```

> Migration phải chạy TRƯỚC khi deploy code mới. Đây là blocking prerequisite.
