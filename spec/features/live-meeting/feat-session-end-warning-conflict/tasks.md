# Tasks: Gửi cảnh báo kết thúc phiên họp và xung đột lịch (UC-IMM-13)

**Input**: Design documents từ `spec/features/live-meeting/feat-session-end-warning-conflict/`
**Prerequisites**: [plan.md](plan.md) ✅ | [spec.md](spec.md) ✅ | [research.md](research.md) ✅ | [data-model.md](data-model.md) ✅ | [contracts/](contracts/) ✅

**Tests**: Tests được yêu cầu rõ ràng trong spec (NFR + Acceptance Criteria coverage — AC-001 → AC-011).

**Lưu ý quan trọng**: UC-IMM-13 là **internal BullMQ job processor** — không có HTTP endpoint, không có User Story theo nghĩa người dùng thao tác. Các "Flow" dưới đây là các **luồng kỹ thuật** tương ứng với các components chính. Mỗi flow có thể implement và test độc lập.

---

## 📝 CHANGELOG & REVISION HISTORY

| Ngày cập nhật | Tóm tắt thay đổi | Các dòng thay đổi |
| :--- | :--- | :--- |
| 2026-06-19 | Tạo tasks.md lần đầu cho UC-IMM-13 | Toàn bộ file |
| 2026-06-19 | Vá lỗ hổng Idempotency Gap (Tuỳ chọn 1): T010 STEP 3 bổ sung query `NotificationEntity` song song với query `MeetingEventEntity`; T013 thêm test case T-P04b verify notification-based idempotency guard | T010 STEP 3, T013 suite description + T-P04b |

---

## Format: `[ID] [P?] [Flow?] Description`

- **[P]**: Có thể chạy song song (file khác nhau, không phụ thuộc nhau)
- **[FL1]**: Thuộc Flow 1 — Enum & Seed (bootstrapping enums + config seed)
- **[FL2]**: Thuộc Flow 2 — Constants & Types (error codes + result type)
- **[FL3]**: Thuộc Flow 3 — Core Service Helpers (`readConflictBufferConfig`, `resolveHost`, `detectConflict`, `buildNotificationPayload`, `buildWsPayloads`)
- **[FL4]**: Thuộc Flow 4 — Main Workflow (`processWarningJob` — 13-step business logic)
- **[FL5]**: Thuộc Flow 5 — BullMQ Processor (`MeetingWarningProcessor` — ACK/NACK wrapper)
- **[FL6]**: Thuộc Flow 6 — Module Registration (providers + queue token wiring)

---

## Path Conventions

- Entity: `src/modules/<module>/entities/<entity>.entity.ts`
- Service: `src/modules/<module>/services/<service>.service.ts`
- Processor: `src/modules/<module>/processors/<processor>.processor.ts`
- DTO: `src/modules/<module>/dto/<dto>.dto.ts`
- Constants: `src/modules/<module>/constants/<name>.constant.ts`
- Types: `src/modules/<module>/types/<name>.type.ts`
- Seed: `src/database/seeds/<timestamp>-<Name>.ts`
- Test: `src/modules/<module>/tests/<service>.service.spec.ts`

---

## Phase 1: Setup — Enum & Seed (Blocking Prerequisites)

**Mục đích**: Bổ sung 2 enum values vào `NotificationType` (TypeScript-only — không cần DB migration vì column là VARCHAR(60)) và tạo seed cho `system_configs`. Phải hoàn thành trước Phase 3 vì `MeetingWarningService` dùng `NotificationType.MEETING_TIME_WARNING` và `MEETING_TIME_CONFLICT_WARNING`.

**⚠️ KHÔNG có TypeORM migration mới** cho Phase 1. Column `notification_type` là `VARCHAR(60)`, không phải PostgreSQL native ENUM — chỉ TypeScript enum thay đổi. So sánh với UC-IMM-12 dùng `ALTER TYPE` vì `MeetingEventType` và `BackgroundJobType` là PostgreSQL ENUM thật.

- [x] T001 [P] [FL1] Thêm `MEETING_TIME_WARNING = 'meeting_time_warning'` và `MEETING_TIME_CONFLICT_WARNING = 'meeting_time_conflict_warning'` vào `NotificationType` enum trong `src/modules/notifications/entities/notification.entity.ts`. **Không tạo migration**. Giữ nguyên toàn bộ 14 values hiện có. Verify: enum values phải <= 60 ký tự (vừa với `VARCHAR(60)`). Coverage: FR-010, FR-011.

- [x] T002 [P] [FL1] Tạo seed `src/database/seeds/20260619000002-SeedMeetingWarningConflictConfig.ts`: INSERT INTO `system_configs` `(config_key, config_value, description)` VALUES `('meeting_warning_conflict_buffer_minutes', '0', 'Buffer window in minutes after meeting end_time for conflict detection. 0 = detect only at exact end_time.')` ON CONFLICT (config_key) DO NOTHING. Seed phải idempotent (safe khi chạy lại). Có thể chạy song song với T001 (file khác nhau).
  > Coverage: FR-035, BR-03.

**Checkpoint Phase 1**: TypeScript compiles — `NotificationType.MEETING_TIME_WARNING` và `MEETING_TIME_CONFLICT_WARNING` accessible. Seed tồn tại và có thể chạy.

---

## Phase 2: Foundational — Constants & Types

**Mục đích**: Chuẩn bị error codes và result type trước khi viết service logic. Các task trong phase này không phụ thuộc nhau và có thể chạy song song.

- [x] T003 [P] [FL2] Bổ sung 10 error codes UC-IMM-13 vào `MEETING_WARNING_ERRORS` object trong `src/modules/live-meeting/constants/meeting-warning-error.constant.ts` (file đã tồn tại từ UC-IMM-12). Thêm vào sau các constants hiện có — không xóa, không sửa constants cũ:
  ```typescript
  // UC-IMM-13 error codes (bổ sung sau UC-IMM-12 codes)
  MEETING_NOT_FOUND_FOR_WARNING: 'MEETING_NOT_FOUND_FOR_WARNING',
  MEETING_NOT_IN_PROGRESS_FOR_WARNING: 'MEETING_NOT_IN_PROGRESS_FOR_WARNING',
  WARNING_ALREADY_SENT: 'WARNING_ALREADY_SENT',
  HOST_NOT_RESOLVED: 'HOST_NOT_RESOLVED',
  CONFLICT_DETECTION_FAILED: 'CONFLICT_DETECTION_FAILED',
  CONFLICT_BUFFER_CONFIG_INVALID: 'CONFLICT_BUFFER_CONFIG_INVALID',
  WARNING_NOTIFICATION_CREATE_FAILED: 'WARNING_NOTIFICATION_CREATE_FAILED',
  WARNING_WEBSOCKET_PUSH_FAILED: 'WARNING_WEBSOCKET_PUSH_FAILED',
  BACKGROUND_JOB_UPDATE_FAILED: 'BACKGROUND_JOB_UPDATE_FAILED',
  MEETING_EVENT_CREATE_FAILED: 'MEETING_EVENT_CREATE_FAILED',
  ```
  > Coverage: ERR-001 → ERR-009.

- [x] T004 [P] [FL2] Tạo file `src/modules/live-meeting/types/warning-processor-result.type.ts` với interface `WarningProcessorResult`:
  ```typescript
  export interface WarningProcessorResult {
    skipped: boolean;
    reason?: 'meeting_not_found' | 'meeting_not_in_progress' | 'already_sent' | 'host_not_found';
    branch?: 'A' | 'B';
    warningLevel?: 'standard' | 'overdue' | 'strict' | 'urgent';
    notificationId?: string;
    remainingMinutes?: number;
  }
  ```
  Đây là return type của `MeetingWarningService.processWarningJob()`. File này khác T003 → có thể chạy song song.
  > Coverage: FR-023, contracts/internal-warning-processing.md Section 2.

**Checkpoint Phase 2**: Hai file constants và types đã có. TypeScript compiles. `WarningProcessorResult` accessible từ các import.

---

## Phase 3: Core Service — Helper Methods

**Goal**: Tạo `MeetingWarningService` với 5 private helper methods. Methods này không phụ thuộc vào nhau về logic, nhưng tất cả nằm trong cùng file `meeting-warning.service.ts` — implement tuần tự từ T005 đến T009 để tránh merge conflict.

**Independent Test**: Unit tests T013 (suites H, I) có thể verify `resolveHost()` và `readConflictBufferConfig()` hoàn toàn độc lập với mock DataSource.

### Implementation cho Phase 3

- [x] T005 [FL3] Tạo file `src/modules/live-meeting/services/meeting-warning.service.ts` với class skeleton `MeetingWarningService`, decorator `@Injectable()`. Inject dependencies trong constructor:
  ```typescript
  constructor(
    private readonly dataSource: DataSource,
    private readonly websocketService: WebsocketService,
    private readonly configService: ConfigService,
  ) {}
  ```
  Thêm private method `readConflictBufferConfig(): Promise<number>`:
  1. Query `system_configs` với `config_key = 'meeting_warning_conflict_buffer_minutes'`.
  2. Nếu không tìm thấy → log WARN `CONFLICT_BUFFER_CONFIG_INVALID` + return `0`.
  3. Parse `configValue` với `parseInt()`. Nếu `isNaN(parsed)` → log WARN + return `0`. Nếu `parsed < 0` → log WARN + return `0`.
  4. return `parsed`.
  > Phụ thuộc: T003 (error constants), T004 (không cần, file độc lập). Covers FR-035, ERR-004c.

- [x] T006 [FL3] Thêm private method `resolveHost(meeting: MeetingEntity, meetingId: string): Promise<string | null>` vào `MeetingWarningService`:
  1. Nếu `meeting.hostId != null` → return `meeting.hostId`.
  2. Query `meeting_participants` WHERE `meetingId = meetingId` AND `participantRole = ParticipantRole.HOST` LIMIT 1.
  3. Nếu tìm thấy → return `participant.userId`.
  4. Nếu không → return `null`. **Không throw bao giờ.**
  > Phụ thuộc: T005 (cùng file). Covers FR-034, T-P33, T-P34, T-P35.

- [x] T007 [FL3] Thêm private method `detectConflict(roomId: string, meetingEndTime: Date, meetingId: string, bufferMinutes: number): Promise<RoomBookingEntity | null>` vào `MeetingWarningService`:
  1. Query `room_bookings`:
     ```typescript
     WHERE room_id = roomId
       AND meeting_id != meetingId  // loại trừ self-conflict
       AND reserved_start_time >= meetingEndTime
       AND status IN (RoomBookingStatus.PENDING, RoomBookingStatus.APPROVED, RoomBookingStatus.ACTIVE)
     ORDER BY reserved_start_time ASC LIMIT 1
     ```
  2. Nếu không có kết quả → return `null` (no conflict → Branch A).
  3. Nếu có kết quả:
     - `bufferMs = bufferMinutes * 60_000`
     - `conflictThreshold = new Date(meetingEndTime.getTime() + bufferMs)`
     - Nếu `nextBooking.reservedStartTime <= conflictThreshold` → return `nextBooking` (Branch B).
     - Ngược lại → return `null` (ngoài buffer → Branch A).
  4. `catch (error) → throw error` — caller sẽ catch và fallback Branch A.
  > **Dùng TypeScript field names** (`reservedStartTime`), không dùng raw SQL. Phụ thuộc: T005. Covers FR-003, FR-010, FR-011, FR-019, T-P09 → T-P15.

- [x] T008 [FL3] Thêm private method `buildNotificationPayload(branch: 'A' | 'B', meeting: MeetingEntity, remainingMinutes: number, warningLevel: 'standard' | 'overdue' | 'strict' | 'urgent', hostId: string, nextBooking?: RoomBookingEntity): Partial<NotificationEntity>` vào `MeetingWarningService`. Logic:

  **Branch A** (`warningLevel = 'standard' | 'overdue'`):
  - `notificationType = NotificationType.MEETING_TIME_WARNING`
  - `priority = NotificationPriority.NORMAL`
  - `subject`: nếu `remainingMinutes > 0` → `"Cuộc họp sắp kết thúc — còn {N} phút"`, nếu `= 0` → `"Cuộc họp đã quá giờ kết thúc"`
  - `payloadJson.extensionAllowed = true`
  - `payloadJson.cta = { type: 'request_extension', label: 'Gia hạn cuộc họp' }`
  - `payloadJson.conflictWithNextBooking = false`
  - `payloadJson.nextBooking = null`

  **Branch B** (`warningLevel = 'strict' | 'urgent'`):
  - `notificationType = NotificationType.MEETING_TIME_CONFLICT_WARNING`
  - `priority = NotificationPriority.HIGH`
  - `subject`: nếu `remainingMinutes > 0` → `"Cảnh báo: Phòng họp sắp bị xung đột — còn {N} phút"`, nếu `= 0` → `"Cuộc họp đã quá giờ và có xung đột"`
  - `payloadJson.extensionAllowed = false`
  - `payloadJson.disableExtensionReason = 'Phòng đã có lịch cuộc họp kế tiếp. Không thể gia hạn.'`
  - `payloadJson.cta = null`
  - `payloadJson.conflictWithNextBooking = true`
  - `payloadJson.nextBooking = { bookingId: nextBooking.id, reservedStartTime: nextBooking.reservedStartTime.toISOString() }`

  Các fields chung: `channel = IN_APP`, `relatedEntityType = 'meeting'`, `relatedEntityId = meetingId`, `recipientScope = 'user_list'`, `recipientUserIdsJson = JSON.stringify([hostId])`, `deliveryStatus = SENT`, `sentAt = new Date()`.
  > Phụ thuộc: T005, T001 (NotificationType), T003 (error constants không trực tiếp). Covers FR-010 → FR-011, FR-025 → FR-027, T-P20 → T-P23.

- [x] T009 [FL3] Thêm 2 private methods `buildHostWsPayload(...)` và `buildParticipantWsPayload(...)` vào `MeetingWarningService`:

  **`buildHostWsPayload`** (full payload — gửi qua `emitToUser(hostId, ...)`):
  ```typescript
  {
    meetingId: string,
    warningType: 'standard' | 'conflict',    // 'standard' = Branch A, 'conflict' = Branch B
    warningLevel: 'standard' | 'overdue' | 'strict' | 'urgent',
    remainingMinutes: number,                // >= 0
    extensionAllowed: boolean,
    disableExtensionReason: string | null,
    nextBooking?: { bookingId: string; reservedStartTime: string },
    endTime: string,                         // ISO-8601
    timestamp: string,                       // ISO-8601 now
  }
  ```

  **`buildParticipantWsPayload`** (safe payload — gửi qua `emitToRoom('meeting:{meetingId}', ...)`):
  ```typescript
  {
    meetingId: string,
    warningType: 'standard' | 'conflict',
    remainingMinutes: number,
    endTime: string,                         // ISO-8601
    timestamp: string,                       // ISO-8601 now
    // KHÔNG có: extensionAllowed, disableExtensionReason, nextBooking
  }
  ```
  > Phụ thuộc: T005. Covers BR-17, FR-012, AC-010, T-P24, T-P25.

**Checkpoint Phase 3**: `MeetingWarningService` tồn tại với 5 private helpers. TypeScript compiles. `resolveHost()` và `readConflictBufferConfig()` testable độc lập qua T017.

---

## Phase 4: Core Service — Main Workflow (`processWarningJob`)

**Goal**: Implement `processWarningJob()` — method chính của UC-IMM-13, thực hiện đầy đủ 13 bước FR-023 theo plan.md §7.1.

**Independent Test**: Unit tests T013-T016 (suites A-G) verify toàn bộ flow này với mock DataSource, WebsocketService.

### Implementation cho Phase 4

- [x] T010 [FL4] Thêm public method `processWarningJob(jobData: MeetingTimeWarningJobData): Promise<WarningProcessorResult>` vào `MeetingWarningService`. Implement đầy đủ 13 bước (wrap toàn bộ trong `try/catch` outer):

  **STEP 1 — Guard Meeting tồn tại** (ERR-001): `findOne({ where: { id: meetingId } })` trên `MeetingEntity`. Nếu `null` → log ERROR `MEETING_NOT_FOUND_FOR_WARNING` + return `{ skipped: true, reason: 'meeting_not_found' }`.

  **STEP 2 — Guard Meeting status** (ERR-002): Nếu `meeting.status !== MeetingStatus.IN_PROGRESS` → log WARN `MEETING_NOT_IN_PROGRESS_FOR_WARNING` + return `{ skipped: true, reason: 'meeting_not_in_progress' }`.

  **STEP 3 — Idempotency check** (FR-033): Thực hiện **2 query song song** để phát hiện job đã xử lý trước đó — bao gồm cả trường hợp retry sau khi `notifications` INSERT thành công nhưng `meeting_events` INSERT thất bại:
  ```typescript
  const [existingEvent, existingNotification] = await Promise.all([
    this.dataSource.getRepository(MeetingEventEntity).findOne({
      where: { meetingId, eventType: MeetingEventType.WARNING_SENT },
    }),
    this.dataSource.getRepository(NotificationEntity).findOne({
      where: {
        relatedEntityType: 'meeting',
        relatedEntityId: meetingId,
        notificationType: In([
          NotificationType.MEETING_TIME_WARNING,
          NotificationType.MEETING_TIME_CONFLICT_WARNING,
        ]),
      },
    }),
  ]);
  if (existingEvent || existingNotification) {
    this.logger.log(`WARNING_ALREADY_SENT — meetingId=${meetingId}, source=${existingEvent ? 'event' : 'notification'}`);
    return { skipped: true, reason: 'already_sent' };
  }
  ```
  **Lý do dual-source**: Nếu STEP 10 (notifications INSERT) thành công nhưng STEP 13 (meeting_events INSERT) thất bại → BullMQ retry sẽ không tìm thấy `meeting_events.warning_sent` và tạo duplicate notification. Query thêm `NotificationEntity` bắt được case này và ACK job an toàn. Đây là **Tuỳ chọn 1 — Dual-source Idempotency Guard** đã phân tích trong Analyze report.

  **STEP 4 — Tính `remainingMinutes`** (FR-002, BR-11): `const rawMinutes = Math.floor((meeting.endTime.getTime() - Date.now()) / 60_000)`. `const remainingMinutes = Math.max(0, rawMinutes)`. Nếu `rawMinutes < 0` → log WARN `[processWarningJob] Late job — meetingId=${meetingId}, delay=${Math.abs(rawMinutes)}min` (NFR-005, ERR-004b).

  **STEP 5 — Đọc `conflictBufferMinutes`** (FR-035): Gọi `this.readConflictBufferConfig()`.

  **STEP 6 — Resolve Host** (FR-034): Gọi `this.resolveHost(meeting, meetingId)`. Nếu `null` → log WARN `HOST_NOT_RESOLVED` + return `{ skipped: true, reason: 'host_not_found' }`.

  **STEP 7 — Conflict detection** (FR-003, FR-010, FR-011, FR-015, FR-019):
  - Nếu `meeting.roomId = null` → `nextBooking = null` (Branch A, skip query, covers FR-015).
  - Ngược lại: `try { nextBooking = await this.detectConflict(meeting.roomId, meeting.endTime, meetingId, conflictBufferMinutes) } catch { log ERROR CONFLICT_DETECTION_FAILED; nextBooking = null; }` (fallback Branch A — ERR-003, AC-005).

  **STEP 8 — Xác định `warningLevel`** (FR-032, BR-14, BR-15):
  ```
  nextBooking != null (Branch B) + remainingMinutes > 0  → warningLevel = 'strict'
  nextBooking != null (Branch B) + remainingMinutes = 0  → warningLevel = 'urgent'
  nextBooking = null (Branch A) + remainingMinutes > 0   → warningLevel = 'standard'
  nextBooking = null (Branch A) + remainingMinutes = 0   → warningLevel = 'overdue'
  ```
  `const branch = nextBooking != null ? 'B' : 'A'`.

  **STEP 9 — Build notification payload** (FR-023 step 9): Gọi `this.buildNotificationPayload(branch, meeting, remainingMinutes, warningLevel, hostId, nextBooking ?? undefined)`.

  **STEP 10 — Tạo `notifications` record** (FR-006, ERR-005, AC-006):
  ```typescript
  try {
    const saved = await this.dataSource.getRepository(NotificationEntity).save(payload);
    notificationId = saved.id;
  } catch (error) {
    this.logger.error('WARNING_NOTIFICATION_CREATE_FAILED', { meetingId, error });
    // UPDATE background_jobs.status = failed (best-effort)
    await this.updateBackgroundJobStatus(meetingId, BackgroundJobStatus.FAILED, null, error.message).catch(() => {});
    throw error;  // NACK → BullMQ retry
  }
  ```

  **STEP 11 — Push WebSocket** (FR-012, BR-17, ERR-007, AC-007): Wrap trong `try/catch`:
  ```typescript
  const hostPayload = this.buildHostWsPayload(branch, warningLevel, remainingMinutes, extensionAllowed, ...);
  const safePayload = this.buildParticipantWsPayload(branch, remainingMinutes, meeting.endTime);
  this.websocketService.emitToUser(hostId, 'meeting.time.warning', hostPayload);
  this.websocketService.emitToRoom(`meeting:${meetingId}`, 'meeting.time.warning', safePayload);
  // catch → log WARN WARNING_WEBSOCKET_PUSH_FAILED, tiếp tục (non-critical)
  ```

  **STEP 12 — Update `background_jobs`** (FR-007, FR-009, ERR-008): Gọi helper `updateBackgroundJobStatus(meetingId, BackgroundJobStatus.COMPLETED, { notificationId, warningType: branch === 'B' ? 'conflict' : 'standard', remainingMinutes })`. Nếu record không tìm thấy → log WARN, tiếp tục. Nếu UPDATE lỗi → log ERROR `BACKGROUND_JOB_UPDATE_FAILED` + tiếp tục (non-critical).

  **STEP 13 — Ghi `meeting_events`** (FR-008, FR-029, ERR-009): INSERT `MeetingEventEntity`:
  ```typescript
  {
    meetingId, eventType: MeetingEventType.WARNING_SENT,
    sourceType: MeetingEventSourceType.SCHEDULER, actorUserId: null,
    description: `Time warning sent: ${branch === 'B' ? 'conflict' : 'standard'}, ${remainingMinutes} min remaining`,
    metadataJson: JSON.stringify({
      warningType: branch === 'B' ? 'conflict' : 'standard',
      warningLevel, remainingMinutes, notificationId,
      extensionAllowed: branch === 'A',
      conflictBufferMinutes,
      conflictBookingId: nextBooking?.id ?? null
    })
  }
  ```
  Nếu lỗi → log ERROR `MEETING_EVENT_CREATE_FAILED` + tiếp tục (non-critical).

  **Log summary** (NFR-004): `this.logger.log('[processWarningJob] DONE — meetingId=${meetingId}, branch=${branch}, warningLevel=${warningLevel}, remainingMinutes=${remainingMinutes}, notificationId=${notificationId}')`.

  **Return**: `{ skipped: false, branch, warningLevel, notificationId, remainingMinutes }`.

  > Thêm private helper `updateBackgroundJobStatus(meetingId, status, outputJson?, errorMessage?)` riêng để tái dùng ở STEP 10 và STEP 12.
  > Phụ thuộc: T003-T009 tất cả. Covers FR-002, FR-003, FR-006 → FR-012, FR-015, FR-017 → FR-021, FR-023 → FR-029, FR-031 → FR-035, toàn bộ ERR matrix, AC-001 → AC-011.

**Checkpoint Phase 4**: `processWarningJob()` compile. Verify T-P01 và T-P20 (happy path Branch A) trước khi wire processor.

---

## Phase 5: BullMQ Processor

**Goal**: Tạo `MeetingWarningProcessor` — lớp wrapper mỏng nhận BullMQ job, delegate sang `MeetingWarningService`, xử lý ACK/NACK đúng.

**Independent Test**: `MeetingWarningProcessor` không cần test riêng — behavior phủ bởi test của `MeetingWarningService`. Chỉ cần verify registration đúng qua Phase 6.

- [x] T011 [FL5] Tạo file `src/modules/live-meeting/processors/meeting-warning.processor.ts`. Implement `MeetingWarningProcessor`:
  ```typescript
  import { Processor, WorkerHost } from '@nestjs/bullmq';
  import { Job } from 'bullmq';
  import { MeetingWarningService } from '../services/meeting-warning.service';
  import { MeetingTimeWarningJobData } from '../types/...';  // hoặc định nghĩa inline

  @Processor('scheduler')  // queue name khớp QUEUE_SCHEDULER env
  export class MeetingWarningProcessor extends WorkerHost {
    constructor(private readonly meetingWarningService: MeetingWarningService) {
      super();
    }

    async process(job: Job<MeetingTimeWarningJobData>): Promise<void> {
      if (job.name !== 'meeting-time-warning') {
        this.logger.warn(`[MeetingWarningProcessor] Unknown job name: ${job.name}`);
        return;  // ACK — không retry job không biết
      }
      // Delegate hoàn toàn sang service
      // Nếu service throw → processor không catch → BullMQ sẽ NACK và retry
      await this.meetingWarningService.processWarningJob(job.data);
    }
  }
  ```
  **Lưu ý**: Processor chỉ throw khi `processWarningJob()` throw (ERR-005 — notification failure → BullMQ retry). Tất cả các skip cases khác return void → ACK.

  > **⚠️ Kiểm tra trước khi code**: Xem `package.json` để xác nhận version `@nestjs/bullmq`. Nếu v1 (không có `WorkerHost`) → dùng `@Process('meeting-time-warning')` method decorator thay vì `process()` override. Document lựa chọn trong comment.
  > Phụ thuộc: T010. Covers FL5, contracts/internal-warning-processing.md Section 1.

**Checkpoint Phase 5**: Processor file tồn tại. TypeScript compiles. `MeetingWarningProcessor` injectable.

---

## Phase 6: Module Registration

**Goal**: Đăng ký `MeetingWarningProcessor` và `MeetingWarningService` vào `LiveMeetingModule` để NestJS DI container resolve được.

- [x] T012 [FL6] Cập nhật `src/modules/live-meeting/live-meeting.module.ts`:
  1. Thêm `MeetingWarningService` vào `providers[]`.
  2. Thêm `MeetingWarningProcessor` vào `providers[]`.
  3. Kiểm tra `imports[]` — `LiveMeetingModule` cần `BullModule.registerQueue({ name: 'scheduler' })` (hoặc dùng token constant từ `QueueModule`) để `@Processor` decorator của `MeetingWarningProcessor` resolve đúng queue. Nếu `QueueModule` đã export queue token có thể dùng; nếu không, thêm `BullModule.registerQueue` riêng.
  4. Verify `WebsocketModule` đã trong `imports[]` (đã có từ UC-IMM-12 — kiểm tra không thêm duplicate).
  5. **Không thêm import module mới ngoài BullMQ queue registration** vì `AdministrationModule`, `ConfigModule`, `TypeOrmModule.forRoot` đều `@Global`.

  > **⚠️ Risk**: Nếu queue không được đăng ký đúng → processor không nhận job → feature im lặng thất bại. Verify bằng manual test local với Redis thật sau Phase 6.
  > Phụ thuộc: T011. Covers research.md risk "BullMQ @Processor không đăng ký đúng queue token".

**Checkpoint Phase 6**: App khởi động không lỗi. `MeetingWarningProcessor` lắng nghe queue `scheduler`. Gọi `processWarningJob()` thủ công qua test script hoặc integration test.

---

## Phase 7: Testing

**Mục đích**: Thêm 9 test suites (39 test cases T-P01 → T-P39) vào file test hiện có. Tất cả test cho `MeetingWarningService` — processor không cần test riêng.

**Cấu trúc**: Tất cả trong `src/modules/live-meeting/tests/live-meeting-warning.service.spec.ts` (file đã có từ UC-IMM-12 — thêm describe blocks mới sau describe blocks hiện có).

**Mock setup**: Tạo mock factory cho `MeetingWarningService` với `DataSource`, `WebsocketService`, `ConfigService` được mock.

### Tests cho Suite A+B — Guard & Idempotency + remainingMinutes

- [x] T013 [FL4] Viết `describe('MeetingWarningService — processWarningJob Guard, Idempotency, remainingMinutes')` với 9 test cases:

  - **T-P01** `[ERR-001]` Meeting không tồn tại (`findOne` trả `null`): assert return `{ skipped: true, reason: 'meeting_not_found' }`, log ERROR, KHÔNG có `notifications` INSERT. Covers FR-017, ERR-001.

  - **T-P02** `[ERR-002, AC-003]` `meeting.status = 'completed'`: assert return `{ skipped: true, reason: 'meeting_not_in_progress' }`, log WARN, KHÔNG có `notifications` INSERT. Covers FR-018, ERR-002, AC-003.

  - **T-P03** `[ERR-002]` `meeting.status = 'cancelled'`: assert return skipped với `reason = 'meeting_not_in_progress'`. Covers FR-018, ERR-002.

  - **T-P04** `[NFR-007, AC-008]` `meeting_events.warning_sent` đã tồn tại (primary idempotency path): mock `MeetingEventEntity` query trả record có `eventType = WARNING_SENT`; `NotificationEntity` query trả `null`. Assert return `{ skipped: true, reason: 'already_sent' }`, log INFO chứa `source=event`, KHÔNG có `notifications` INSERT, KHÔNG có duplicate `meeting_events`. Covers FR-033, NFR-007, AC-008.

  - **T-P04b** `[NFR-007, AC-008 — Idempotency Gap patch]` `meeting_events.warning_sent` **chưa có** nhưng `notifications` record đã tồn tại (retry sau khi notification INSERT thành công nhưng meeting_events INSERT thất bại): mock `MeetingEventEntity` query trả `null`; mock `NotificationEntity` query trả record với `relatedEntityType = 'meeting'`, `relatedEntityId = meetingId`, `notificationType = 'meeting_time_warning'`. Assert return `{ skipped: true, reason: 'already_sent' }`, log INFO chứa `source=notification`, KHÔNG có second `notifications` INSERT (không duplicate). Covers FR-033, NFR-007, AC-008; vá lỗ hổng Idempotency Gap (Tuỳ chọn 1).

  - **T-P05** `[FR-034]` `meetings.host_id = null`, `meeting_participants` không có `participant_role = 'host'`: assert return `{ skipped: true, reason: 'host_not_found' }`, log WARN, KHÔNG có `notifications` INSERT. Covers FR-034, ERR-002 (host variant).

  - **T-P06** `[FR-002, BR-11]` `end_time = now() + 600s` → `remainingMinutes = 10`: assert `WarningProcessorResult.remainingMinutes = 10`, `notifications.payloadJson.remainingMinutes = 10`. Covers FR-002, BR-11.

  - **T-P07** `[FR-031, BR-13, AC-009]` `end_time = 5 phút trước` (late job) → raw = -5 → clamp = 0: assert `remainingMinutes = 0`, log WARN chứa `delay=5min`, `notifications` vẫn được tạo với `remainingMinutes = 0`. Covers FR-031, BR-13, AC-009.

  - **T-P08** `[FR-031]` `end_time = now()` (biên) → raw = 0 → clamp = 0: assert `remainingMinutes = 0`, KHÔNG log late warning (biên không phải late). Covers FR-031.

### Tests cho Suite C — Conflict Detection

- [x] T014 [FL3] Viết `describe('MeetingWarningService — detectConflict')` với 7 test cases (test trực tiếp `detectConflict()` qua reflection hoặc qua `processWarningJob()` với setup phù hợp):

  - **T-P09** `[FR-010, AC-001]` `room_id` hợp lệ, không có booking kế tiếp → `detectConflict` return `null` → Branch A. Assert `notifications.notification_type = meeting_time_warning`. Covers FR-010, AC-001.

  - **T-P10** `[FR-011, AC-002]` Có booking kế tiếp `reserved_start_time = meeting.end_time`, `buffer = 0` → Branch B. Assert `notifications.notification_type = meeting_time_conflict_warning`. Covers FR-011, AC-002.

  - **T-P11** `[FR-003, AC-011]` Buffer = 5 min, booking `reserved_start_time = end_time + 3min` (trong buffer) → Branch B. Covers FR-003, AC-011.

  - **T-P12** `[FR-003, AC-011]` Buffer = 5 min, booking `reserved_start_time = end_time + 6min` (ngoài buffer) → Branch A. Assert `notifications.notification_type = meeting_time_warning`. Covers FR-003, AC-011.

  - **T-P13** `[FR-015, AC-004]` `meeting.room_id = null` → skip conflict query entirely → Branch A: assert `dataSource.getRepository(RoomBookingEntity).findOne()` NOT called, `notifications.notification_type = meeting_time_warning`. Covers FR-015, AC-004.

  - **T-P14** `[FR-019, ERR-003, AC-005]` `room_bookings` query throw exception → catch, fallback Branch A: assert log ERROR `CONFLICT_DETECTION_FAILED`, `notifications.notification_type = meeting_time_warning`, `background_jobs.status = completed`. Covers FR-019, ERR-003, AC-005.

  - **T-P15** `[FR-003]` Booking với `status = 'cancelled'` không được tính là conflict → Branch A. Covers FR-003.

### Tests cho Suite D+E — warningLevel Matrix + Notification Payload

- [x] T015 [FL4] Viết `describe('MeetingWarningService — warningLevel & Notification Payload')` với 8 test cases:

  - **T-P16** `[FR-010, AC-001]` Branch A + `remainingMinutes = 10` → `warningLevel = 'standard'`. Assert `notifications.payloadJson.warningLevel = 'standard'`. Covers FR-010, AC-001.

  - **T-P17** `[FR-032, BR-14, AC-009]` Branch A + `remainingMinutes = 0` → `warningLevel = 'overdue'`. Assert `notifications.payloadJson.warningLevel = 'overdue'`. Covers FR-032, BR-14, AC-009.

  - **T-P18** `[FR-011, AC-002]` Branch B + `remainingMinutes = 10` → `warningLevel = 'strict'`. Assert `notifications.payloadJson.warningLevel = 'strict'`. Covers FR-011, AC-002.

  - **T-P19** `[FR-032, BR-15, AC-009]` Branch B + `remainingMinutes = 0` → `warningLevel = 'urgent'`. Assert `notifications.payloadJson.warningLevel = 'urgent'`. Covers FR-032, BR-15, AC-009.

  - **T-P20** `[FR-010, AC-001]` Branch A payload: assert `extensionAllowed = true`, `cta.type = 'request_extension'`, `conflictWithNextBooking = false`, `nextBooking = null`. Covers FR-010, AC-001.

  - **T-P21** `[FR-011, AC-002]` Branch B payload: assert `extensionAllowed = false`, `cta = null`, `conflictWithNextBooking = true`, `nextBooking.reservedStartTime` có giá trị ISO-8601. Covers FR-011, AC-002.

  - **T-P22** `[FR-011]` Priority: Branch B → `priority = 'high'`; Branch A → `priority = 'normal'`. Assert đúng giá trị trong notification record. Covers FR-011, FR-025.

  - **T-P23** `[FR-026]` `deliveryStatus = 'sent'`, `sentAt` không null và là Date. Covers FR-026.

### Tests cho Suite F+G — WebSocket Push + Post-notification Writes

- [x] T016 [FL4] Viết `describe('MeetingWarningService — WebSocket + Post-notification Writes')` với 9 test cases:

  - **T-P24** `[FR-012, BR-17, AC-010]` Host nhận `emitToUser(hostId, 'meeting.time.warning', hostPayload)`: assert `websocketService.emitToUser` được gọi với `hostId` và payload có fields `extensionAllowed`, `warningLevel`, `disableExtensionReason`. Covers FR-012, BR-17, AC-010.

  - **T-P25** `[FR-012, BR-17, AC-010]` Meeting room nhận `emitToRoom('meeting:{meetingId}', ...)` với safe payload: assert payload KHÔNG có `extensionAllowed`, KHÔNG có `nextBooking`, KHÔNG có `disableExtensionReason`. Assert `meetingId` và `remainingMinutes` có mặt trong payload. Covers FR-012, BR-17, AC-010.

  - **T-P26** `[FR-021, ERR-007, AC-007]` `websocketService.emitToUser()` throw exception: assert log WARN `WARNING_WEBSOCKET_PUSH_FAILED`, `background_jobs.status = completed` (không phải failed), `meeting_events.warning_sent` được tạo bình thường, notification KHÔNG rollback. Covers FR-021, ERR-007, AC-007.

  - **T-P27** `[FR-007, FR-009]` `background_jobs` record: assert UPDATE `status = 'completed'`, `completed_at` được set, `output_json` chứa `notificationId`, `warningType`, `remainingMinutes`. Covers FR-007, FR-009.

  - **T-P28** `[FR-008, FR-029]` `meeting_events` record: assert INSERT với `event_type = 'warning_sent'`, `source_type = 'scheduler'`, `actor_user_id = null`. Covers FR-008, FR-029.

  - **T-P29** `[FR-027]` `meeting_events.metadata_json` chứa đầy đủ: `warningType`, `warningLevel`, `remainingMinutes`, `notificationId`, `extensionAllowed`, `conflictBufferMinutes`, `conflictBookingId`. Covers FR-027.

  - **T-P30** `[ERR-005, AC-006]` `notifications` INSERT throw exception: assert service **throw** error (→ BullMQ NACK), `background_jobs.status = failed`, `meeting_events` KHÔNG được tạo. Covers ERR-005, AC-006.

  - **T-P31** `[ERR-008]` `background_jobs` UPDATE throw: assert log ERROR `BACKGROUND_JOB_UPDATE_FAILED`, method trả về bình thường (không throw), notification đã tạo thành công. Covers ERR-008.

  - **T-P32** `[ERR-009]` `meeting_events` INSERT throw: assert log ERROR `MEETING_EVENT_CREATE_FAILED`, method trả về bình thường (không throw), notification và background_jobs đã được xử lý. Covers ERR-009.

### Tests cho Suite H+I — Host Resolution + Config

- [x] T017 [FL3] Viết `describe('MeetingWarningService — resolveHost & readConflictBufferConfig')` với 7 test cases:

  - **T-P33** `[FR-034]` `meeting.hostId != null` → return `hostId` trực tiếp, KHÔNG query `meeting_participants`. Covers FR-034.

  - **T-P34** `[FR-034]` `meeting.hostId = null`, `meeting_participants` có 1 record với `participantRole = 'host'` → return `participant.userId`. Assert `meeting_participants` query được gọi. Covers FR-034.

  - **T-P35** `[FR-034]` `meeting.hostId = null`, `meeting_participants` không có `participant_role = 'host'` → return `null`. Covers FR-034.

  - **T-P36** `[FR-035]` `system_configs` có `meeting_warning_conflict_buffer_minutes = '5'` → return `5`. Covers FR-035.

  - **T-P37** `[FR-035]` Key không tồn tại (`findOne` trả `null`) → return `0`, log WARN. Covers FR-035, ERR-004c.

  - **T-P38** `[FR-035, ERR-004c]` Config value `= 'abc'` (không parse được) → return `0`, log WARN. Covers FR-035, ERR-004c.

  - **T-P39** `[FR-035, ERR-004c]` Config value `= '-3'` (số âm) → return `0`, log WARN. Covers FR-035, ERR-004c.

**Checkpoint Phase 7**: Tất cả 39 test cases T-P01 → T-P39 pass. Coverage report cho `meeting-warning.service.ts` phủ đủ paths. Chạy `npm run test` (hoặc `pnpm test`).

---

## Phase N: Polish & Cross-Cutting Concerns

- [x] T018 [P] Verify seed end-to-end: chạy seed trên DB dev, confirm `SELECT config_value FROM system_configs WHERE config_key = 'meeting_warning_conflict_buffer_minutes'` trả `'0'`. Ghi kết quả vào PR description.

- [x] T019 [P] Verify `NotificationType` enum change idempotent: confirm `notifications.notification_type` column `SELECT character_maximum_length FROM information_schema.columns WHERE table_name = 'notifications' AND column_name = 'notification_type'` trả >= 30 (đủ chứa `meeting_time_conflict_warning` = 29 chars). Nếu < 30 → cần thêm migration VARCHAR resize.

- [x] T020 [P] Review toàn bộ log statements trong `MeetingWarningService`: đảm bảo (1) ERROR khi meeting not found, (2) WARN khi meeting not in_progress, (3) INFO khi idempotency skip, (4) WARN khi host not resolved, (5) ERROR khi conflict query fail, (6) WARN khi late job với delay minutes, (7) WARN khi WebSocket fail, (8) ERROR khi notification fail, (9) INFO summary DONE. Không log `meetingId` kèm nội dung nhạy cảm.

- [x] T021 Chạy full regression test: `npm run test` (hoặc `pnpm test`) sau tất cả phases hoàn thành. Đảm bảo không có regression trong UC-IMM-12 tests (`live-meeting-warning.service.spec.ts` cũ) sau khi thêm test suites mới. Verify existing UC-IMM-01, UC-IMM-05 tests vẫn pass (không ảnh hưởng LiveMeetingService).

---

## Dependencies & Execution Order

### Phase Dependencies

```
Phase 1 (T001–T002) — Enum & Seed: Không phụ thuộc, bắt đầu ngay
    ↓ T001 (NotificationType enum) BLOCKING cho Phase 3+ (service dùng enum values)
Phase 2 (T003–T004) — Constants & Types: Không phụ thuộc Phase 1; có thể song song
    ↓ T003, T004 BLOCKING cho Phase 3 (service dùng error codes + result type)
Phase 3 (T005–T009) — Core Helpers: Phụ thuộc T001 + T003 + T004
    ↓ T005-T009 BLOCKING (processWarningJob gọi tất cả helpers)
Phase 4 (T010) — Main Workflow: Phụ thuộc Phase 3 hoàn thành
    ↓ T010 BLOCKING cho Phase 5+6
Phase 5 (T011) — Processor: Phụ thuộc T010 (delegate sang service)
Phase 6 (T012) — Module Registration: Phụ thuộc T010 + T011
Phase 7 (T013–T017) — Testing: T013+T014+T015+T016 sau T010; T017 sau T005+T006
Phase N (T018–T021) — Polish: Sau Phase 7
```

### Task Dependencies Chi Tiết

| Task | Phụ thuộc | Lý do |
|---|---|---|
| T001 | — | Entity file độc lập |
| T002 | — | Seed file độc lập |
| T003 | — | Constants file (thêm vào file có sẵn) |
| T004 | — | Types file mới độc lập |
| T005 | T001, T003, T004 | Service dùng NotificationType enum, error codes, WarningProcessorResult |
| T006 | T005 | Cùng file, thêm method sau T005 |
| T007 | T005 | Cùng file, thêm method sau T006 |
| T008 | T005, T001 | Cùng file, dùng NotificationType values |
| T009 | T005 | Cùng file, thêm method sau T008 |
| T010 | T003, T004, T005, T006, T007, T008, T009 | processWarningJob gọi tất cả helpers |
| T011 | T010 | Processor delegate sang service đã có |
| T012 | T010, T011 | Module registration sau service + processor tồn tại |
| T013 | T010 | Test processWarningJob guard + remainingMinutes |
| T014 | T007, T010 | Test detectConflict (helper + integration qua processWarningJob) |
| T015 | T008, T010 | Test warningLevel + notification payload |
| T016 | T009, T010 | Test WebSocket + post-notification writes |
| T017 | T005, T006 | Test helpers độc lập (resolveHost + readConflictBufferConfig) |
| T018 | T002 | Verify seed |
| T019 | T001 | Verify VARCHAR(60) đủ chứa enum values mới |
| T020 | T005-T010 | Verify log statements |
| T021 | T013-T017 | Full regression |

### Parallel Opportunities

| Nhóm song song | Tasks | Điều kiện |
|---|---|---|
| Nhóm 1 | T001 + T002 + T003 + T004 | Tất cả file khác nhau, không phụ thuộc |
| Nhóm 2 | T013 + T014 + T015 + T016 (một phần) | Sau T010, test suites khác nhau — tuy nhiên cùng file `spec.ts`, implement tuần tự để tránh merge conflict |
| Nhóm 3 | T018 + T019 + T020 | Phase N, khác file |

**Lưu ý**: T005→T009 và T010 cùng file `meeting-warning.service.ts` → **không chạy song song**. Implement tuần tự theo thứ tự để tránh conflict.

---

## Requirements Coverage

### Functional Requirements → Tasks

| FR | Mô tả rút gọn | Tasks chính | Test coverage |
|---|---|---|---|
| FR-002 | Tính `remainingMinutes` từ `meetings.end_time` tại thời điểm job fired | T010 | T-P06, T-P07, T-P08 |
| FR-003 | Conflict buffer logic — Branch A/B phân nhánh | T007, T010 | T-P09 → T-P15 |
| FR-006 | Tạo `notifications` record với đúng payload theo branch | T008, T010 | T-P20 → T-P23 |
| FR-007 | Update `background_jobs.status = completed` sau thành công | T010 | T-P27 |
| FR-008 | Ghi `meeting_events.warning_sent` sau thành công | T010 | T-P28, T-P29 |
| FR-009 | `background_jobs.completed_at` được set | T010 | T-P27 |
| FR-010 | Branch A: `extensionAllowed=true`, `warningLevel=standard` | T007, T008, T010 | T-P09, T-P16, T-P20 |
| FR-011 | Branch B: `extensionAllowed=false`, `warningLevel=strict`, `nextBooking` có giá trị | T007, T008, T010 | T-P10, T-P18, T-P21 |
| FR-012 | WebSocket `meeting.time.warning` emit — Host payload + safe payload tách biệt | T009, T010 | T-P24, T-P25 |
| FR-015 | `room_id = null` → Branch A, skip conflict query | T007, T010 | T-P13 |
| FR-017 | Guard: meeting không tồn tại → ACK, không tạo notification | T010 | T-P01 |
| FR-018 | Guard: meeting không `in_progress` → ACK, không tạo notification | T010 | T-P02, T-P03 |
| FR-019 | Conflict query fail → fallback Branch A, log ERROR | T007, T010 | T-P14 |
| FR-020 | Notification CREATE fail → NACK (throw), `background_jobs = failed` | T010 | T-P30 |
| FR-021 | WebSocket fail → non-critical (log WARN, tiếp tục) | T010 | T-P26 |
| FR-023 | Full 13-step `processWarningJob` workflow | T010 | T-P01 → T-P32 |
| FR-025 | `priority = high` cho Branch B | T008 | T-P22 |
| FR-026 | `deliveryStatus = sent`, `sentAt` được set | T008, T010 | T-P23 |
| FR-027 | `meeting_events.metadata_json` đầy đủ fields | T010 | T-P29 |
| FR-029 | `meeting_events.source_type = scheduler`, `actor_user_id = null` | T010 | T-P28 |
| FR-031 | Late job: `remainingMinutes` clamp về 0, log WARN | T010 | T-P07, T-P08 |
| FR-032 | `warningLevel` matrix: standard/overdue/strict/urgent | T010 | T-P16 → T-P19 |
| FR-033 | Idempotency: `warning_sent` đã có → skip | T010 | T-P04 |
| FR-034 | Host resolve: `host_id` → fallback `meeting_participants` → null skip | T006, T010 | T-P05, T-P33 → T-P35 |
| FR-035 | `readConflictBufferConfig`: parse integer, default 0 | T005, T010 | T-P36 → T-P39 |

### Non-Functional Requirements → Tasks

| NFR | Mô tả rút gọn | Tasks chính | Test coverage |
|---|---|---|---|
| NFR-004 | Log INFO summary khi DONE | T010 | Verify trong T-P27 bằng spy |
| NFR-005 | Log WARN khi late job với delay info | T010 | T-P07 |
| NFR-006 | Không expose HTTP endpoint | T011, T012 | Architecture verification (không có controller) |
| NFR-007 | Idempotency guard | T010 | T-P04 |
| NFR-008 | `background_jobs.output_json` có `notificationId`, `warningType`, `remainingMinutes` | T010 | T-P27 |

### Acceptance Criteria → Tasks

| AC ID | Tasks | Unit Tests |
|---|---|---|
| AC-001 (Branch A happy path) | T007, T008, T009, T010 | T-P09, T-P16, T-P20, T-P24, T-P27, T-P28 |
| AC-002 (Branch B happy path) | T007, T008, T009, T010 | T-P10, T-P18, T-P21, T-P24, T-P25, T-P27 |
| AC-003 (Guard: meeting completed) | T010 | T-P02 |
| AC-004 (Online meeting: room_id=null) | T007, T010 | T-P13 |
| AC-005 (Degraded: conflict query fail → fallback A) | T007, T010 | T-P14 |
| AC-006 (Notification fail → NACK) | T010 | T-P30 |
| AC-007 (WebSocket fail → non-critical) | T009, T010 | T-P26 |
| AC-008 (Idempotency) | T010 | T-P04 |
| AC-009 (Late job: clamp=0, warningLevel overdue/urgent) | T010 | T-P07, T-P17, T-P19 |
| AC-010 (WebSocket payload split) | T009, T010 | T-P24, T-P25 |
| AC-011 (Conflict buffer window) | T007, T010 | T-P11, T-P12 |

### Error Handling → Tasks

| ERR | Tasks | Test |
|---|---|---|
| ERR-001 (Meeting not found) | T010 | T-P01 |
| ERR-002 (Meeting not in_progress) | T010 | T-P02, T-P03 |
| ERR-003 (Conflict query fail → fallback A) | T007, T010 | T-P14 |
| ERR-004b (remainingMinutes < 0 → clamp) | T010 | T-P07 |
| ERR-004c (Buffer config invalid → default 0) | T005 | T-P37, T-P38, T-P39 |
| ERR-005 (Notification fail → NACK) | T010 | T-P30 |
| ERR-007 (WebSocket fail → non-critical) | T009, T010 | T-P26 |
| ERR-008 (background_jobs update fail → non-critical) | T010 | T-P31 |
| ERR-009 (meeting_events create fail → non-critical) | T010 | T-P32 |

### Business Rules → Tasks

| BR | Mô tả rút gọn | Tasks |
|---|---|---|
| BR-03 | Conflict buffer window = `end_time + bufferMinutes` | T007, T010 |
| BR-11 | `remainingMinutes = floor((end_time - now()) / 60_000)`, clamp >= 0 | T010 |
| BR-13 | Late job: raw < 0 → log WARN với delay info | T010 |
| BR-14 | Branch A + late → `warningLevel = 'overdue'` | T010 |
| BR-15 | Branch B + late → `warningLevel = 'urgent'` | T010 |
| BR-17 | WebSocket payload tách: Host nhận full; Participant nhận safe | T009, T010 |

---

## Notes

- **[P]** tasks = file khác nhau, không phụ thuộc
- **[FL1-FL6]** label maps task đến flow kỹ thuật cụ thể
- **Cùng file**: T005-T009 và T010 cùng `meeting-warning.service.ts` — implement tuần tự
- **Không migration mới**: Phase 1 chỉ thay đổi TypeScript enum (VARCHAR(60) column)
- **BullMQ version**: Kiểm tra `package.json` trước T011 — `WorkerHost` chỉ có từ `@nestjs/bullmq` v2+
- **Verify register**: T012 phải verify processor consume job qua local Redis test — silent failure nếu queue token sai
- **Idempotency gap risk**: Nếu `notifications` INSERT thành công nhưng `meeting_events` INSERT thất bại → retry sẽ vẫn qua idempotency check (idempotency dựa trên `meeting_events.warning_sent`). Đây là known limitation — xem plan.md §12 risk table
- Commit sau mỗi phase hoặc nhóm task logic
- Stop tại mỗi Checkpoint để verify trước khi tiến sang phase tiếp theo
