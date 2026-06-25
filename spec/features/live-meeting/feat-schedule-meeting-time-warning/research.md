# Research: Lập lịch cảnh báo thời gian còn lại (UC-IMM-12)

**Date**: 2026-06-19
**Context**: Codebase analysis for feature implementation plan.

## Codebase Analysis

### Module `live-meeting` (target)

- **Status**: Module active, `LiveMeetingService` đã hoạt động với các method `startMeeting()`, `endMeeting()`, `decideExtension()`, `requestExtension()`.
- **Current constructor**: `constructor(private readonly dataSource: DataSource, private readonly websocketService: WebsocketService)`
- **Cần thêm injection**: `QueueService` và `BackgroundJobsService` vào constructor.
- **QueueModule**: Đã `@Global` — không cần import thêm vào `LiveMeetingModule`.
- **AdministrationModule**: Đã `@Global` — `BackgroundJobsService` accessible.

### Queue Infrastructure (đã sẵn sàng)

| Component | Path | Trạng thái |
|---|---|---|
| `QueueService` | `src/modules/queue/queue.service.ts` | ✅ @Global, available |
| `QueueModule` | `src/modules/queue/queue.module.ts` | ✅ @Global |
| Queue `scheduler` | env: `QUEUE_SCHEDULER`, default: `'scheduler'` | ✅ Đã đăng ký |

**API của `QueueService`:**
```typescript
addJob<T>(queueName: string, jobName: string, data: T, options?: AddJobOptions): Promise<string | undefined>
getQueue(queueName: string): Queue | undefined
```
- `AddJobOptions extends Partial<JobsOptions>` — hỗ trợ `jobId` (dedupe), `delay` (ms).
- BullMQ với `jobId` cố định: nếu job cùng `jobId` đã tồn tại trong queue, `addJob()` **throw error** — cần `remove()` trước khi enqueue lại.

### BackgroundJobEntity (cần thêm enum values)

- **File**: `src/modules/administration/entities/background-job.entity.ts`
- `BackgroundJobType`: hiện có `import_accounts`, `send_email`, `transcription`, `export_report`, `export_minutes`, `media_processing` — **THIẾU `meeting_time_warning`**.
- `BackgroundJobStatus`: có `QUEUED`, `RUNNING`, `COMPLETED`, `FAILED`, `CANCELLED`, `RETRYING` — **THIẾU `SCHEDULED`** (dùng cho delayed job chờ fired).
- Fields hữu ích đã có: `scheduledAt` (timestamptz), `relatedEntityId` (uuid), `relatedEntityType` (varchar), `inputJson` (jsonb), `metadataJson` (jsonb), `errorMessage` (text), `queueName` (varchar).

### MeetingEventEntity (cần thêm enum values)

- **File**: `src/modules/meetings/entities/meeting-event.entity.ts`
- `MeetingEventType`: có `WARNING_SENT = 'warning_sent'` — **THIẾU `warning_scheduled`** và **`warning_scheduling_skipped`**.
  - `warning_sent` (UC-IMM-13) ≠ `warning_scheduled` (UC-IMM-12): khác nhau về semantic.
- `MeetingEventSourceType`: đã có `SCHEDULER = 'scheduler'` — **ĐÃ ĐỦ**, không cần thêm.
- `event_type` column: `varchar(60)` — đủ cho các giá trị mới.

### SystemConfigEntity (cần seed)

- **File**: `src/modules/administration/entities/system-config.entity.ts`
- Key `meeting_warning_before_minutes` — **chưa có trong seed hiện tại**.
- Pattern đọc config đang dùng trong project:
  ```typescript
  await this.dataSource.getRepository(SystemConfigEntity).findOne({
    where: { configKey: 'meeting_warning_before_minutes' }
  });
  ```

### BackgroundJobsService (existing)

- **File**: `src/modules/administration/services/background-jobs.service.ts`
- Được inject trong `NotificationsService` — xác nhận có thể inject vào `LiveMeetingService`.
- Methods được sử dụng: `createQueuedJob(dto)`, `markFailed(id, message)` (inferred từ usage).

### Trigger Points (methods cần wire trong LiveMeetingService)

| Method hiện có | Vị trí thêm trigger | UC-IMM-12 method |
|---|---|---|
| `startMeeting()` | Sau `executeStartMeetingInTransaction()` commit | `scheduleWarningJob(meetingId)` |
| `decideExtension()` approve path | Sau transaction commit | `rescheduleWarningJob(meetingId)` |
| `requestExtension()` auto-apply path | Sau transaction commit | `rescheduleWarningJob(meetingId)` |
| `endMeeting()` | Sau `executeEndMeetingInTransaction()` commit | `cancelWarningJob(meetingId)` |

Tất cả trigger đều là **post-commit**, **non-blocking**, **best-effort** — lỗi trong UC-IMM-12 không rollback caller UC.

### Pattern Transaction vs Post-Commit

UC-IMM-12 **KHÔNG dùng transaction**. Scheduling chạy sau commit của caller UC:
```typescript
// Trong startMeeting():
await this.executeStartMeetingInTransaction(meetingId, user); // main transaction
// Post-commit best-effort:
try {
  await this.scheduleWarningJob(meetingId); // UC-IMM-12 trigger
} catch (err) {
  this.logger.error('[startMeeting] schedule warning failed', err);
}
```

## Technology Decisions

| Decision | Choice | Rationale |
|---|---|---|
| Queue | BullMQ `QUEUE_SCHEDULER` (`'scheduler'`) — existing | Không cần queue mới, infrastructure sẵn sàng |
| Dedupe | BullMQ `jobId = 'meeting-time-warning:{meetingId}'` | Idempotency built-in, overwrite via remove+re-add |
| Thời gian cảnh báo | `system_configs.meeting_warning_before_minutes` | Align với config pattern hiện có |
| Cancel job | `QueueService.getQueue(name).getJob(id).remove()` | BullMQ native, không cần third-party |
| Error handling | Non-blocking `try/catch` toàn bộ | Per Q3/Q4 clarification — best-effort |
| DB write | Direct `dataSource.getRepository()` sau commit | Post-transaction, không cần EntityManager |
| BackgroundJobStatus cho delayed job | Thêm `SCHEDULED = 'scheduled'` vào enum | Cần giá trị phân biệt với `QUEUED` (sẽ chạy ngay) |

## Risks & Mitigations

| Risk | Mitigation |
|---|---|
| BullMQ `addJob()` với `jobId` đã tồn tại → throw error | `remove()` trước `addJob()` trong `rescheduleWarningJob()` |
| `cancelWarningJob()` thất bại → warning job vẫn fire sau end meeting | UC-IMM-13 kiểm tra `meetings.status = in_progress` trước khi gửi notification |
| `BackgroundJobStatus` thiếu `SCHEDULED` → TypeORM mismatch | T002 thêm enum value, T003 migration bắt buộc chạy trước deploy |
| `LiveMeetingService` thiếu `QueueService` injection | T011 thêm vào constructor — `QueueModule` đã @Global |
| Config key `meeting_warning_before_minutes` missing → fallback default 10 | `readWarningConfig()` có fallback, T004 seed đảm bảo row tồn tại |
| UC-IMM-02 auto-apply path không trigger reschedule | T015 wire hook vào `requestExtension()` auto-apply path |
