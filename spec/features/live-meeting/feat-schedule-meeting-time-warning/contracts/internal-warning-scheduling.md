# Internal Service Contract — Warning Scheduling (UC-IMM-12)

## Lưu ý

UC-IMM-12 **không có HTTP endpoint**. Đây là tài liệu contract cho các internal service methods của `LiveMeetingService` liên quan đến warning scheduling. Các UC caller (UC-IMM-01, UC-IMM-02, UC-IMM-03, UC-IMM-05) phải tuân thủ contract này khi trigger UC-IMM-12.

---

## 1. `scheduleWarningJob(meetingId: string): Promise<ScheduleWarningResult>`

**Module**: `live-meeting`  
**Service**: `LiveMeetingService`  
**Visibility**: `public` (để UC-IMM-01 và module khác gọi được nếu cần)  
**Auth**: Không — internal call only  
**Transaction**: Không — post-commit, best-effort  
**Throws**: Không bao giờ throw (non-blocking)

### Trigger

Được gọi trong `startMeeting()` **sau khi transaction commit thành công**:

```typescript
// Trong LiveMeetingService.startMeeting():
await this.executeStartMeetingInTransaction(meetingId, user);
// Post-commit (best-effort):
const warningResult = await this.scheduleWarningJob(meetingId);
```

### Input

| Parameter | Type | Description |
|---|---|---|
| `meetingId` | `string` (UUID) | ID của meeting vừa được start |

### Output — `ScheduleWarningResult`

```typescript
interface ScheduleWarningResult {
  skipped: boolean;
  reason?: 'guard_failed' | 'too_close' | 'error';
  warningScheduledAt?: Date;
}
```

| Field | Type | Description |
|---|---|---|
| `skipped` | `boolean` | `true` nếu không enqueue job |
| `reason` | string? | Lý do skip (nếu có) |
| `warningScheduledAt` | Date? | Thời điểm job sẽ được fired (nếu enqueue thành công) |

### Behavior

| Điều kiện | Hành động | skipped | reason | warningScheduledAt |
|---|---|---|---|---|
| Meeting `in_progress`, `end_time - configMinutes > now() + 60s` | Enqueue BullMQ job | `false` | — | Date object |
| `remainingMinutes ≤ configMinutes` (AF2) | Dùng `floor(R/2)` | `false` | — | Date object |
| `warningScheduledAt ≤ now() + 60s` | Skip, ghi event | `true` | `'too_close'` | Date object |
| Meeting không phải `in_progress` | Skip | `true` | `'guard_failed'` | undefined |
| `end_time` null | Skip | `true` | `'guard_failed'` | undefined |
| Meeting không tồn tại | Skip | `true` | `'guard_failed'` | undefined |
| BullMQ / DB lỗi | Skip | `true` | `'error'` | undefined |

### Side Effects

| Effect | Điều kiện |
|---|---|
| INSERT `background_jobs` | Enqueue thành công (skipped = false) |
| INSERT `meeting_events` (`warning_scheduled`) | Enqueue thành công (skipped = false) |
| INSERT `meeting_events` (`warning_scheduling_skipped`) | Skip guard kích hoạt (`reason = 'too_close'`) |

---

## 2. `rescheduleWarningJob(meetingId: string): Promise<ScheduleWarningResult>`

**Module**: `live-meeting`  
**Service**: `LiveMeetingService`  
**Visibility**: `public`  
**Auth**: Không — internal call only  
**Transaction**: Không — post-commit, best-effort  
**Throws**: Không bao giờ throw

### Trigger

Được gọi trong 2 vị trí:

```typescript
// 1. Trong decideExtension() approve path:
await this.executeExtensionInTransaction(meetingId, decision, user);
const warningResult = await this.rescheduleWarningJob(meetingId); // post-commit

// 2. Trong requestExtension() auto-apply path:
await this.executeAutoApplyExtensionInTransaction(meetingId, user);
const warningResult = await this.rescheduleWarningJob(meetingId); // post-commit
```

### Input / Output

Giống `scheduleWarningJob()`.

### Behavior khác biệt so với `scheduleWarningJob()`

1. **Luôn remove job cũ trước**: `getQueue(name).getJob(jobId)?.remove()`.
2. Nếu không tìm thấy job cũ → bỏ qua remove, log INFO, tiếp tục enqueue mới.
3. Sau đó enqueue job mới với `end_time` mới (đã được cập nhật bởi extension).

---

## 3. `cancelWarningJob(meetingId: string): Promise<void>`

**Module**: `live-meeting`  
**Service**: `LiveMeetingService`  
**Visibility**: `public`  
**Auth**: Không — internal call only  
**Transaction**: Không — post-commit, best-effort  
**Throws**: Không bao giờ throw

### Trigger

Được gọi trong `endMeeting()` **sau khi transaction commit thành công**:

```typescript
// Trong LiveMeetingService.endMeeting():
await this.executeEndMeetingInTransaction(meetingId, user);
// Post-commit (best-effort):
await this.cancelWarningJob(meetingId);
```

### Input

| Parameter | Type | Description |
|---|---|---|
| `meetingId` | `string` (UUID) | ID của meeting vừa được end |

### Output

`void` — không trả dữ liệu.

### Side Effects

| Effect | Điều kiện |
|---|---|
| `QueueService.getQueue().getJob(jobId).remove()` | Job tồn tại trong queue |
| UPDATE `background_jobs.status = 'cancelled'` | Record tồn tại |

> **KHÔNG tạo `meeting_events` mới khi cancel.** AF3 theo spec là silent cancel.

---

## BullMQ Job Specification

| Field | Value |
|---|---|
| Queue name | `'scheduler'` (env: `QUEUE_SCHEDULER`, default: `'scheduler'`) |
| Job name | `'meeting-time-warning'` |
| Job ID | `meeting-time-warning:{meetingId}` |
| Delay | `warningScheduledAt.getTime() - Date.now()` (ms) |

### Job Data Payload

```typescript
interface MeetingTimeWarningJobData {
  meetingId: string;           // UUID
  warningScheduledAt: string;  // ISO-8601
  endTime: string;             // ISO-8601
}
```

### Dedupe Behavior

- BullMQ giữ `jobId` unique trong queue.
- `scheduleWarningJob()`: Nếu job với jobId đã tồn tại (duplicate trigger), catch error → log INFO → return skipped.
- `rescheduleWarningJob()`: Luôn `remove()` trước, sau đó `addJob()` — không bị conflict.

---

## Contract với UC-IMM-13 (consumer)

UC-IMM-13 (Meeting Time Warning Sender) sẽ process job này khi BullMQ fires. UC-IMM-13 phải:

1. Kiểm tra `meetings.status = in_progress` trước khi gửi notification (defense against stale jobs nếu `cancelWarningJob()` thất bại).
2. Dùng `meetingId` từ job data để load meeting.
3. Dùng `endTime` từ job data chỉ để reference, không phải source of truth.

---

## Caller Summary

| Caller UC | Method | Timing |
|---|---|---|
| UC-IMM-01 `startMeeting()` | `scheduleWarningJob(meetingId)` | Post-commit |
| UC-IMM-03 `decideExtension()` approve | `rescheduleWarningJob(meetingId)` | Post-commit |
| UC-IMM-02 `requestExtension()` auto-apply | `rescheduleWarningJob(meetingId)` | Post-commit |
| UC-IMM-05 `endMeeting()` | `cancelWarningJob(meetingId)` | Post-commit |
