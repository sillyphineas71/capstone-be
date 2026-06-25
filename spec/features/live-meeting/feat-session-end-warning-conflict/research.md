# Research: Gửi cảnh báo kết thúc phiên họp và xung đột lịch (UC-IMM-13)

**Date**: 2026-06-19
**Context**: Codebase analysis for feature implementation plan.

## 📝 CHANGELOG & REVISION HISTORY

| Ngày cập nhật | Tóm tắt thay đổi | Các dòng thay đổi |
| :--- | :--- | :--- |
| 2026-06-19 | Tạo research lần đầu cho UC-IMM-13 | Toàn bộ file |

---

## Codebase Analysis

### Module `live-meeting` (target)

- **Status**: Module active. `LiveMeetingService` đã hoạt động đầy đủ với các UC-IMM-01, 02, 03, 05, 12.
- **Constructor hiện tại**:
  ```typescript
  constructor(
    private readonly dataSource: DataSource,
    private readonly websocketService: WebsocketService,
    private readonly queueService: QueueService,
    private readonly backgroundJobsService: BackgroundJobsService,
    private readonly configService: ConfigService,
  )
  ```
- **UC-IMM-12 đã implemented**: `scheduleWarningJob()`, `rescheduleWarningJob()`, `cancelWarningJob()`, `readWarningConfig()` — tất cả trong `LiveMeetingService`.
- **File test hiện có**: `src/modules/live-meeting/tests/live-meeting-warning.service.spec.ts` — file đã tồn tại cho UC-IMM-12. UC-IMM-13 cần thêm test suites vào đây.
- **UC-IMM-13 sẽ tách thành 2 file mới**: `MeetingWarningService` (business logic) + `MeetingWarningProcessor` (BullMQ handler). Không thêm vào `LiveMeetingService` để tránh file quá lớn.

### Queue Infrastructure (đã sẵn sàng)

| Component | Path | Trạng thái |
|---|---|---|
| `QueueModule` | `src/modules/queue/queue.module.ts` | ✅ `@Global` — 8 queues đã đăng ký |
| `QueueService` | `src/modules/queue/queue.service.ts` | ✅ `@Global` — `addJob()`, `getQueue()` |
| Queue `scheduler` | env: `QUEUE_SCHEDULER`, default: `'scheduler'` | ✅ Đã đăng ký dưới token `QUEUE_SCHEDULER_NAME` |
| BullMQ job `meeting-time-warning` | enqueued bởi UC-IMM-12 | ✅ Đã có job enqueue logic |

**API của `QueueService`** (xác nhận):
```typescript
addJob<T>(queueName: string, jobName: string, data: T, options?: AddJobOptions): Promise<string | undefined>
getQueue(queueName: string): Queue | undefined
```

**BullMQ default job options** (từ `QueueModule`):
```typescript
defaultJobOptions: {
  attempts: 3,          // env BULL_DEFAULT_ATTEMPTS
  backoff: { type: 'exponential', delay: 5000 },  // env BULL_DEFAULT_BACKOFF_DELAY_MS
  removeOnComplete: true,  // env BULL_REMOVE_ON_COMPLETE
  removeOnFail: false,     // env BULL_REMOVE_ON_FAIL
}
```
→ UC-IMM-13 processor có tối đa 3 lần retry khi notification thất bại (NACK).

### BullMQ Processor Pattern trong NestJS

`@nestjs/bullmq` hỗ trợ 2 pattern để viết processor:

**Pattern 1 — `@Processor` + `@Process`** (legacy, vẫn hoạt động):
```typescript
@Processor('scheduler')
export class MeetingWarningProcessor {
  @Process('meeting-time-warning')
  async handle(job: Job<MeetingTimeWarningJobData>): Promise<void> { ... }
}
```

**Pattern 2 — `WorkerHost` + `process()`** (recommended `@nestjs/bullmq` v2+):
```typescript
@Processor('scheduler')
export class MeetingWarningProcessor extends WorkerHost {
  async process(job: Job<MeetingTimeWarningJobData>): Promise<void> {
    if (job.name === 'meeting-time-warning') { ... }
  }
}
```

→ **Chọn Pattern 2** (`WorkerHost`) vì align với `@nestjs/bullmq` v2 và dễ test hơn.
→ Cần check version `@nestjs/bullmq` trong `package.json` trước khi implement để xác nhận API.

### NotificationEntity (cần thêm 2 enum values)

- **File**: `src/modules/notifications/entities/notification.entity.ts`
- **Column**: `notification_type` — `VARCHAR(60)` (xác nhận từ entity inspection).
- **Hiện tại**: `NotificationType` có 14 values, **THIẾU** `meeting_time_warning` và `meeting_time_conflict_warning`.
- **Kết luận**: Chỉ cần thay đổi TypeScript enum — **KHÔNG cần DB migration** vì column là VARCHAR, không phải PostgreSQL native ENUM.

### MeetingEventEntity (đã đủ)

- **File**: `src/modules/meetings/entities/meeting-event.entity.ts`
- `MeetingEventType.WARNING_SENT = 'warning_sent'` ✅ — đã có từ UC-IMM-12.
- `MeetingEventSourceType.SCHEDULER = 'scheduler'` ✅ — đã có.
- **Không cần thêm enum value mới** cho UC-IMM-13.

### BackgroundJobEntity (đã đủ)

- **File**: `src/modules/administration/entities/background-job.entity.ts`
- `BackgroundJobType.MEETING_TIME_WARNING = 'meeting_time_warning'` ✅ — đã có từ UC-IMM-12.
- `BackgroundJobStatus.COMPLETED / FAILED / CANCELLED` ✅ — đã có.
- **Không cần thêm enum value mới** cho UC-IMM-13.

### RoomBookingEntity (xác nhận tên cột)

- **File**: `src/modules/rooms/entities/room-booking.entity.ts`
- `reservedStartTime` → DB column `reserved_start_time` ✅ (đã xác nhận — không phải `reserved_start_at`).
- `reservedEndTime` → DB column `reserved_end_time` ✅.
- `status` → `RoomBookingStatus` enum có `PENDING`, `APPROVED`, `ACTIVE`, `COMPLETED`, `CANCELLED`, `RELEASED` ✅.
- Conflict query sử dụng TypeScript: `RoomBookingStatus.PENDING`, `RoomBookingStatus.APPROVED`, `RoomBookingStatus.ACTIVE`.

### MeetingParticipantEntity (xác nhận)

- **File**: `src/modules/meetings/entities/meeting-participant.entity.ts`
- `participantRole` → `ParticipantRole.HOST = 'host'` ✅ — dùng cho fallback Host resolve.
- `invitationStatus` → `InvitationStatus` có `PENDING`, `ACCEPTED`, `DECLINED`, `TENTATIVE` ✅.
- **Không có field `status`** (field này không tồn tại trong schema) — xác nhận BR-07 / FR-036.
- `attendanceStatus` tồn tại (`ParticipantAttendanceStatus`) nhưng **không được dùng** để quyết định recipient.

### WebsocketService (xác nhận API)

- **File**: `src/modules/websocket/websocket.service.ts`
- `emitToRoom(room: string, event: string, data: unknown): void` — broadcast toàn room.
- `emitToUser(userId: string, event: string, data: unknown): void` — emit đến `user:{userId}` room.
- `broadcast(event: string, data: unknown): void` — global broadcast (không dùng).
- `LiveMeetingModule` đã import `WebsocketModule` → `WebsocketService` accessible.

**Cách tách payload theo đối tượng (BR-17)**:
1. `emitToUser(hostId, 'meeting.time.warning', hostPayload)` → Host nhận qua `user:{hostId}` room (full payload với control flags).
2. `emitToRoom('meeting:{meetingId}', 'meeting.time.warning', safePayload)` → Tất cả participants nhận safe payload (không có control flags).
3. Host cũng nhận event từ meeting room nhưng chỉ có safe payload — frontend Host ưu tiên payload từ `user:{hostId}` room.

### SystemConfigEntity (cần seed mới)

- **File**: `src/modules/administration/entities/system-config.entity.ts`
- Key `meeting_warning_before_minutes` đã được seed bởi UC-IMM-12.
- Key `meeting_warning_conflict_buffer_minutes` **chưa có trong seed** — cần seed mới.
- Pattern đọc config (đang dùng trong project):
  ```typescript
  await this.dataSource.getRepository(SystemConfigEntity).findOne({
    where: { configKey: 'meeting_warning_conflict_buffer_minutes' }
  });
  ```

### LiveMeetingModule (cần cập nhật)

- **File**: `src/modules/live-meeting/live-meeting.module.ts`
- Hiện tại: chỉ import `AuthModule`, `WebsocketModule`.
- Cần thêm: `MeetingWarningProcessor` và `MeetingWarningService` vào `providers[]`.
- Cần đảm bảo: BullMQ queue token `QUEUE_SCHEDULER_NAME` được import vào module để Processor đăng ký đúng queue.
- `QueueModule` đã `@Global` nhưng BullMQ Processor cần `BullModule.registerQueue` trong module của mình để `@Processor` decorator resolve đúng queue.

---

## Technology Decisions

| Decision | Choice | Rationale |
|---|---|---|
| BullMQ Processor pattern | `WorkerHost` pattern (`@nestjs/bullmq` v2+) | Recommended pattern, dễ test, type-safe |
| Business logic tách biệt | `MeetingWarningService` riêng (không thêm vào `LiveMeetingService`) | `LiveMeetingService` đã có nhiều methods; tách riêng tăng testability |
| Notification write | Trực tiếp `DataSource.getRepository(NotificationEntity)` | Không có `NotificationsService` CRUD public trong codebase; align với pattern hiện tại trong `LiveMeetingService` |
| WebSocket Host payload | `emitToUser(hostId, ...)` + `emitToRoom(meetingId, ...)` tách biệt | `WebsocketService` có sẵn cả 2 method, không cần custom gateway logic |
| NotificationType enum | TypeScript enum change, không cần DB migration | Column là `VARCHAR(60)` — đã xác nhận từ entity |
| Error handling | Non-blocking cho WebSocket, background_jobs, meeting_events; NACK (throw) chỉ khi notification INSERT thất bại | Align với convention của `LiveMeetingService` và UC-IMM-12 |
| Conflict detection transaction | Không dùng transaction riêng | UC-IMM-13 chỉ đọc `room_bookings` — read-only, không cần transaction |
| remainingMinutes late job | `Math.max(0, raw)` clamp | Đơn giản, không dùng float, không throw |

---

## Risks Identified

| Risk | Severity | Mitigation |
|---|---|---|
| BullMQ `@Processor` decorator cần queue token đúng — nếu `LiveMeetingModule` không import BullMQ token → processor không bind | High | T012: verify `BullModule.registerQueue` hoặc token import trong `LiveMeetingModule` |
| `@nestjs/bullmq` version có thể không support `WorkerHost` nếu quá cũ | Medium | Check `package.json` → nếu v1 dùng `@Process` pattern thay; document decision |
| Race condition: notification INSERT thành công nhưng `meeting_events` INSERT thất bại → BullMQ retry sẽ duplicate notification (idempotency gap) | Low | Sau retry thứ 2, `meeting_events.warning_sent` vẫn chưa có → duplicate. Mitigation: check `notifications` record existence thêm ngoài `meeting_events` check |
| WebSocket `emitToUser()` dùng room `user:{userId}` — frontend Host phải subscribe cả `user:{userId}` room và `meeting:{meetingId}` room | Medium | Document trong contract; không phải backend blocker |
| `system_configs` seed thứ tự (seed 00002 sau 00001) — chạy seed UC-IMM-13 trước UC-IMM-12 có thể gây lỗi nếu foreign key | None | Hai seed độc lập, không có FK giữa `system_configs` rows |
