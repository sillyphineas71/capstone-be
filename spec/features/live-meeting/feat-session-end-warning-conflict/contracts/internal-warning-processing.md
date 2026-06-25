# Internal Service Contract — Warning Processing (UC-IMM-13)

## 📝 CHANGELOG & REVISION HISTORY

| Ngày cập nhật | Tóm tắt thay đổi | Các dòng thay đổi |
| :--- | :--- | :--- |
| 2026-06-19 | Tạo contract lần đầu cho UC-IMM-13 internal service | Toàn bộ file |

---

## Lưu ý

UC-IMM-13 **không có HTTP endpoint**. Đây là tài liệu contract cho:
1. `MeetingWarningService.processWarningJob()` — business logic method chính.
2. `MeetingWarningProcessor` — BullMQ job handler.
3. Các helper methods trong `MeetingWarningService`.

Upstream producer là UC-IMM-12 (`LiveMeetingService.scheduleWarningJob()`). UC-IMM-13 là consumer.

---

## BullMQ Job Contract (Upstream UC-IMM-12 → UC-IMM-13)

### Queue

| Field | Value |
|---|---|
| **Queue name** | `'scheduler'` (env: `QUEUE_SCHEDULER`, default: `'scheduler'`) |
| **Job name** | `'meeting-time-warning'` |
| **Job ID** | `meeting-time-warning:{meetingId}` |

### Job Data Payload (produced by UC-IMM-12)

```typescript
interface MeetingTimeWarningJobData {
  meetingId: string;           // UUID — ID meeting cần cảnh báo
  warningScheduledAt: string;  // ISO-8601 — thời điểm job được schedule
  endTime: string;             // ISO-8601 — meeting.end_time tại thời điểm UC-IMM-12 enqueue
}
```

> **⚠️ Lưu ý cho consumer**: `endTime` trong payload là snapshot từ lúc enqueue. `processWarningJob()` **phải** đọc lại `meetings.end_time` mới nhất từ DB để tính `remainingMinutes` chính xác — vì meeting có thể đã được extend sau khi job enqueue.

### Job Options (set bởi QueueModule defaults)

| Option | Value |
|---|---|
| `attempts` | `3` (env: `BULL_DEFAULT_ATTEMPTS`) |
| `backoff` | `{ type: 'exponential', delay: 5000ms }` |
| `removeOnComplete` | `true` |
| `removeOnFail` | `false` |

---

## 1. `MeetingWarningProcessor` — BullMQ Processor Class

**Module**: `live-meeting`
**File**: `src/modules/live-meeting/processors/meeting-warning.processor.ts`
**Auth**: Không — internal BullMQ processor
**Visibility**: Không expose qua HTTP

### Class Signature

```typescript
@Processor('QUEUE_SCHEDULER_NAME')  // token từ QueueModule
export class MeetingWarningProcessor extends WorkerHost {
  async process(job: Job<MeetingTimeWarningJobData>): Promise<void>
}
```

### Behavior

| Condition | Action | BullMQ Outcome |
|---|---|---|
| `job.name = 'meeting-time-warning'` | Delegate sang `MeetingWarningService.processWarningJob(job.data)` | ACK hoặc NACK tùy result |
| Service return `{ skipped: true }` | Ghi log, return void | ACK (job completed) |
| Service return `{ skipped: false }` | Ghi log summary, return void | ACK (job completed) |
| Service throw exception | Không catch trong processor | NACK → BullMQ retry |
| `job.name` không match | Log WARN + return | ACK (unknown job, no retry) |

---

## 2. `MeetingWarningService.processWarningJob()` — Main Method

**Module**: `live-meeting`
**File**: `src/modules/live-meeting/services/meeting-warning.service.ts`
**Auth**: Không
**Transaction**: Không — independent best-effort writes
**Throws**: Chỉ throw khi `notifications` INSERT thất bại (→ BullMQ retry)

### Signature

```typescript
async processWarningJob(
  jobData: MeetingTimeWarningJobData
): Promise<WarningProcessorResult>
```

### Input

```typescript
interface MeetingTimeWarningJobData {
  meetingId: string;
  warningScheduledAt: string;  // ISO-8601
  endTime: string;             // ISO-8601 (snapshot — không dùng để tính remainingMinutes)
}
```

### Output — `WarningProcessorResult`

```typescript
interface WarningProcessorResult {
  skipped: boolean;
  reason?: 'meeting_not_found' | 'meeting_not_in_progress' | 'already_sent' | 'host_not_found';
  branch?: 'A' | 'B';
  warningLevel?: 'standard' | 'overdue' | 'strict' | 'urgent';
  notificationId?: string;
  remainingMinutes?: number;
}
```

### Behavior Matrix

| Condition | Result | DB Writes | Log Level |
|---|---|---|---|
| Meeting không tồn tại | `{ skipped: true, reason: 'meeting_not_found' }` | Không có | ERROR |
| `meeting.status != in_progress` | `{ skipped: true, reason: 'meeting_not_in_progress' }` | Không có | WARN |
| `meeting_events.warning_sent` đã tồn tại | `{ skipped: true, reason: 'already_sent' }` | Không có | INFO |
| Host không resolve được | `{ skipped: true, reason: 'host_not_found' }` | Không có | WARN |
| Branch A, `remainingMinutes > 0` | `{ skipped: false, branch: 'A', warningLevel: 'standard', ... }` | notifications + meeting_events + background_jobs | INFO |
| Branch A, `remainingMinutes = 0` | `{ skipped: false, branch: 'A', warningLevel: 'overdue', ... }` | notifications + meeting_events + background_jobs | INFO + WARN (late) |
| Branch B, `remainingMinutes > 0` | `{ skipped: false, branch: 'B', warningLevel: 'strict', ... }` | notifications + meeting_events + background_jobs | INFO |
| Branch B, `remainingMinutes = 0` | `{ skipped: false, branch: 'B', warningLevel: 'urgent', ... }` | notifications + meeting_events + background_jobs | INFO + WARN (late) |
| Conflict query DB lỗi | Fallback Branch A → `{ skipped: false, branch: 'A', ... }` | notifications + meeting_events + background_jobs | ERROR (conflict query) + INFO |
| `notifications` INSERT lỗi | **THROW** (→ BullMQ retry) | `background_jobs.status = failed` | ERROR |

### Side Effects (khi `skipped = false`)

| Effect | Điều kiện |
|---|---|
| INSERT `notifications` | Luôn (trừ skip cases) |
| `emitToUser(hostId, 'meeting.time.warning', hostPayload)` | Sau INSERT notifications thành công |
| `emitToRoom('meeting:{meetingId}', 'meeting.time.warning', safePayload)` | Sau INSERT notifications thành công |
| UPDATE `background_jobs.status = completed` | Sau notifications thành công (best-effort) |
| INSERT `meeting_events.warning_sent` | Sau notifications thành công (best-effort) |
| UPDATE `background_jobs.status = failed` | Khi notifications INSERT thất bại |

---

## 3. `MeetingWarningService.resolveHost()` — Helper

**Visibility**: `private`
**Throws**: Không bao giờ throw

### Signature

```typescript
private async resolveHost(
  meeting: MeetingEntity,
  meetingId: string
): Promise<string | null>
```

### Behavior

| Condition | Return |
|---|---|
| `meeting.host_id != null` | `meeting.host_id` |
| `meeting.host_id = null` → tìm `meeting_participants.participant_role = 'host'` | `participant.user_id` |
| Cả hai đều không có | `null` (caller xử lý skip) |

---

## 4. `MeetingWarningService.detectConflict()` — Helper

**Visibility**: `private`
**Throws**: Throw nếu DB query lỗi (caller catch và fallback Branch A)

### Signature

```typescript
private async detectConflict(
  roomId: string,
  meetingEndTime: Date,
  meetingId: string,
  bufferMinutes: number
): Promise<RoomBookingEntity | null>
```

### Logic

```
1. Query room_bookings:
   WHERE room_id = roomId
   AND reserved_start_time >= meetingEndTime
   AND status IN ('pending', 'approved', 'active')
   ORDER BY reserved_start_time ASC LIMIT 1

2. Nếu không có kết quả → return null

3. Nếu có kết quả:
   - Loại trừ nếu nextBooking.meeting_id === meetingId (self-conflict)
   - bufferMs = bufferMinutes * 60_000
   - conflictThreshold = meetingEndTime.getTime() + bufferMs
   - Nếu nextBooking.reservedStartTime.getTime() <= conflictThreshold → return nextBooking
   - Ngược lại → return null

4. Catch DB error → throw (caller fallback Branch A)
```

### Return

| Result | Meaning |
|---|---|
| `RoomBookingEntity` | Branch B — có conflict trong buffer window |
| `null` | Branch A — không có conflict |
| `throw` | DB error — caller fallback Branch A + log ERROR |

---

## 5. `MeetingWarningService.readConflictBufferConfig()` — Helper

**Visibility**: `private`
**Throws**: Không bao giờ throw

### Signature

```typescript
private async readConflictBufferConfig(): Promise<number>
```

### Behavior

| Condition | Return | Log |
|---|---|---|
| Key tồn tại, value parse được, >= 0 | Giá trị đã parse | — |
| Key không tồn tại | `0` | WARN |
| Value không parse được thành integer | `0` | WARN |
| Value là số âm | `0` | WARN |

---

## 6. WebSocket Events Contract

### Event: `meeting.time.warning`

**Emit bởi**: `MeetingWarningService` qua `WebsocketService`

#### Host Payload (emit qua `emitToUser(hostId, ...)`)

```typescript
interface MeetingTimeWarningHostPayload {
  meetingId: string;
  warningType: 'standard' | 'conflict';
  warningLevel: 'standard' | 'overdue' | 'strict' | 'urgent';
  remainingMinutes: number;          // >= 0, không âm
  extensionAllowed: boolean;
  disableExtensionReason: string | null;
  nextBooking?: {
    bookingId: string;
    reservedStartTime: string;       // ISO-8601
  };
  endTime: string;                   // ISO-8601
  timestamp: string;                 // ISO-8601, thời điểm emit
}
```

> Emitted to room: `user:{hostId}`

#### Participant / Room Display Payload (emit qua `emitToRoom('meeting:{meetingId}', ...)`)

```typescript
interface MeetingTimeWarningSafePayload {
  meetingId: string;
  warningType: 'standard' | 'conflict';
  remainingMinutes: number;          // >= 0
  endTime: string;                   // ISO-8601
  timestamp: string;                 // ISO-8601
}
```

> Emitted to room: `meeting:{meetingId}`
> Host cũng nhận event này từ meeting room nhưng frontend Host ưu tiên payload từ `user:{hostId}` room.

---

## 7. Contract với UC-IMM-02 và UC-IMM-03 (downstream)

UC-IMM-13 **không gọi** UC-IMM-02 hay UC-IMM-03. Tuy nhiên, payload từ UC-IMM-13 ảnh hưởng đến behavior của chúng:

| Payload field | Ý nghĩa cho downstream |
|---|---|
| `extensionAllowed: true` (Branch A) | Frontend Host hiển thị CTA gia hạn → click → gọi UC-95 (UC-IMM-02) |
| `extensionAllowed: false` (Branch B) | Frontend Host ẩn/disable CTA gia hạn |
| `nextBooking` | Frontend hiển thị thông tin booking kế tiếp để Host biết không thể gia hạn |
| `disableExtensionReason` | Frontend dùng làm tooltip/message khi CTA bị disable |

> **Lưu ý**: Dù `extensionAllowed: false`, Host vẫn có thể gọi UC-IMM-02 trực tiếp. Backend UC-IMM-02 sẽ tự kiểm tra conflict lần cuối và reject nếu cần. `extensionAllowed` chỉ là UX hint, không phải enforcement.

---

## 8. Contract với UC-IMM-12 (upstream)

UC-IMM-13 consume jobs được enqueue bởi UC-IMM-12. UC-IMM-13 phải:

1. **Không tin `endTime` trong job payload** làm source of truth — luôn đọc lại `meetings.end_time` từ DB.
2. Guard check `meetings.status = in_progress` (defense against stale job nếu UC-IMM-12 `cancelWarningJob()` thất bại).
3. Idempotency guard: check `meeting_events.warning_sent` trước khi create (defense against BullMQ retry).

---

## Caller Summary (không có — UC-IMM-13 là pure consumer)

| Upstream | Method gọi UC-IMM-13 | Timing |
|---|---|---|
| BullMQ queue `scheduler` | Fire job `meeting-time-warning:{meetingId}` | Tại `warningScheduledAt` |
| UC-IMM-12 `scheduleWarningJob()` | Enqueue job (không gọi trực tiếp) | Khi meeting start |
| UC-IMM-12 `rescheduleWarningJob()` | Re-enqueue job (không gọi trực tiếp) | Khi extension approved |
