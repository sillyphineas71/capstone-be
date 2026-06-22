# Tasks: Lập lịch cảnh báo thời gian còn lại (UC-IMM-12)

**Input**: Design documents từ `spec/features/live-meeting/feat-schedule-meeting-time-warning/`
**Prerequisites**: [plan.md](plan.md) ✅ | [spec.md](spec.md) ✅ | [research.md](research.md) ✅ | [data-model.md](data-model.md) ✅ | [contracts/](contracts/) ✅

**Tests**: Tests được yêu cầu rõ ràng trong spec (NFR + Acceptance Criteria coverage).

**Lưu ý quan trọng**: UC-IMM-12 là **internal process** — không có HTTP endpoint, không có User Story theo nghĩa người dùng thao tác. Các "User Story" dưới đây là các **flows kỹ thuật** tương ứng với 3 methods chính và integration wiring. Mỗi flow có thể implement và test độc lập.

---

## 📝 CHANGELOG & REVISION HISTORY

| Ngày cập nhật | Tóm tắt thay đổi | Các dòng thay đổi |
| :--- | :--- | :--- |
| 2026-06-19 | Tạo tasks.md lần đầu cho UC-IMM-12 | Toàn bộ file |
| 2026-06-19 | T003: bổ sung `public transaction = false` + skeleton migration với IF NOT EXISTS; T007: bắt buộc inject ConfigService thay vì process.env | T003, T007 |

---

## Format: `[ID] [P?] [Flow?] Description`

- **[P]**: Có thể chạy song song (file khác nhau, không phụ thuộc nhau)
- **[F1]**: Thuộc Flow 1 — Normal Warning Schedule (`scheduleWarningJob`)
- **[F2]**: Thuộc Flow 2 — AF1 Reschedule (`rescheduleWarningJob`)
- **[F3]**: Thuộc Flow 3 — AF3 Cancel (`cancelWarningJob`)
- **[F4]**: Thuộc Flow 4 — Integration Wiring (trigger hooks)

---

## Path Conventions

- Entity: `src/modules/<module>/entities/<entity>.entity.ts`
- Service: `src/modules/<module>/services/<service>.service.ts`
- DTO: `src/modules/<module>/dto/<dto>.dto.ts`
- Constants: `src/modules/<module>/constants/<name>.constant.ts`
- Types: `src/modules/<module>/types/<name>.type.ts`
- Migration: `src/database/migrations/<timestamp>-<Name>.ts`
- Seed: `src/database/seeds/<timestamp>-<Name>.ts`
- Test: `src/modules/<module>/tests/<service>.service.spec.ts`

---

## Phase 1: Setup — Schema & Enum (Blocking Prerequisites)

**Mục đích**: Cập nhật entity enums và tạo migration/seed trước khi viết bất kỳ service logic nào. Migration **bắt buộc** chạy trước deploy code mới (TypeORM enum mismatch blocking).

**⚠️ CRITICAL**: Không có task nào ở Phase 2+ được phép merge/deploy nếu T003 (migration) chưa được chạy.

- [x] T001 [P] Thêm `WARNING_SCHEDULED = 'warning_scheduled'` và `WARNING_SCHEDULING_SKIPPED = 'warning_scheduling_skipped'` vào `MeetingEventType` enum trong `src/modules/meetings/entities/meeting-event.entity.ts`. Giữ nguyên `WARNING_SENT = 'warning_sent'` đã có — đây là giá trị khác về semantic (UC-IMM-13 dùng).

- [x] T002 [P] Thêm `MEETING_TIME_WARNING = 'meeting_time_warning'` vào `BackgroundJobType` và thêm `SCHEDULED = 'scheduled'` vào `BackgroundJobStatus` trong `src/modules/administration/entities/background-job.entity.ts`. Ghi comment inline để phân biệt `SCHEDULED` (delayed job chờ fired) với `QUEUED` (job chạy ngay).

- [x] T003 Tạo TypeORM migration `src/database/migrations/20260619000001-AddWarningScheduledEventTypes.ts` cập nhật 3 PostgreSQL enum types. **Bắt buộc khai báo `public transaction = false;`** ở đầu class — PostgreSQL không cho phép `ALTER TYPE ... ADD VALUE` chạy bên trong transaction block; nếu thiếu khai báo này TypeORM sẽ bọc migration trong transaction và lệnh sẽ fail. Migration class skeleton:
  ```typescript
  export class AddWarningScheduledEventTypes1719000000001 implements MigrationInterface {
    public transaction = false; // BẮT BUỘC: ALTER TYPE ADD VALUE không chạy được trong transaction

    public async up(queryRunner: QueryRunner): Promise<void> {
      await queryRunner.query(`ALTER TYPE meeting_event_type ADD VALUE IF NOT EXISTS 'warning_scheduled'`);
      await queryRunner.query(`ALTER TYPE meeting_event_type ADD VALUE IF NOT EXISTS 'warning_scheduling_skipped'`);
      await queryRunner.query(`ALTER TYPE background_job_type ADD VALUE IF NOT EXISTS 'meeting_time_warning'`);
      await queryRunner.query(`ALTER TYPE background_job_status ADD VALUE IF NOT EXISTS 'scheduled'`);
    }

    public async down(queryRunner: QueryRunner): Promise<void> {
      // PostgreSQL không hỗ trợ DROP VALUE từ enum type.
      // Để rollback: cần recreate enum type và migrate tất cả columns đang dùng.
      // Không implement down() tự động — thực hiện thủ công nếu cần rollback.
    }
  }
  ```
  Dùng `IF NOT EXISTS` để migration idempotent (an toàn khi chạy lại).
  > Phụ thuộc: T001, T002 phải hoàn thành trước.

- [x] T004 [P] Tạo seed `src/database/seeds/20260619000001-SeedMeetingWarningConfig.ts`: INSERT INTO `system_configs` `(config_key, config_value, description)` VALUES `('meeting_warning_before_minutes', '10', 'Minutes before meeting end_time to schedule warning notification')` ON CONFLICT (config_key) DO NOTHING. Đảm bảo seed chạy idempotent.
  > Có thể chạy song song với T003 (file khác nhau).

**Checkpoint Phase 1**: Migration T003 chạy thành công, 4 enum values mới tồn tại trong DB, seed T004 tạo row config. Kiểm tra bằng `\dT+ meeting_event_type` và `\dT+ background_job_status` trong psql.

---

## Phase 2: Foundational — Infrastructure Service (Blocking cho Phases 3–5)

**Mục đích**: Chuẩn bị constants, types và inject dependencies vào `LiveMeetingService` trước khi viết core methods. Các task ở phase này là điều kiện tiên quyết cho tất cả service methods.

**⚠️ CRITICAL**: Phase 3, 4, 5 không thể bắt đầu nếu T007 (injection) chưa xong.

- [x] T005 [P] Tạo file `src/modules/live-meeting/constants/meeting-warning-error.constant.ts` với object `MEETING_WARNING_ERRORS`:
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

- [x] T006 [P] Tạo file `src/modules/live-meeting/types/schedule-warning-result.type.ts` với interface:
  ```typescript
  export interface ScheduleWarningResult {
    skipped: boolean;
    reason?: 'guard_failed' | 'too_close' | 'error';
    warningScheduledAt?: Date;
  }
  ```
  Đây là return type của `scheduleWarningJob()` và `rescheduleWarningJob()`.

- [x] T007 Inject `QueueService`, `BackgroundJobsService` và **`ConfigService`** (từ `@nestjs/config`) vào constructor của `LiveMeetingService` (`src/modules/live-meeting/services/live-meeting.service.ts`). `QueueService` và `BackgroundJobsService` từ `@Global` modules — không cần import thêm vào `LiveMeetingModule`. `ConfigService` từ `ConfigModule` (đã `@Global` qua `AppModule`) — cũng không cần import thêm. **Bắt buộc dùng `ConfigService` để đọc tên queue**, không dùng `process.env` trực tiếp (vi phạm NestJS DI pattern và khó mock trong test). Khởi tạo queue name trong constructor:
  ```typescript
  constructor(
    private readonly dataSource: DataSource,
    private readonly websocketService: WebsocketService,
    private readonly queueService: QueueService,
    private readonly backgroundJobsService: BackgroundJobsService,
    private readonly configService: ConfigService,
  ) {
    this.schedulerQueueName = this.configService.get<string>('QUEUE_SCHEDULER', 'scheduler');
  }

  private readonly schedulerQueueName: string;
  ```
  Verify constructor compiles và `schedulerQueueName` có giá trị đúng từ env `QUEUE_SCHEDULER` (fallback `'scheduler'`).
  > Phụ thuộc: T002 (BackgroundJobType enum phải tồn tại trước khi dùng trong service).

- [x] T008 Thêm private method `readWarningConfig(): Promise<number>` vào `LiveMeetingService`. Logic: (1) `this.dataSource.getRepository(SystemConfigEntity).findOne({ where: { configKey: 'meeting_warning_before_minutes' } })`; (2) Parse `configValue` sang integer bằng `parseInt()`; (3) Nếu không tìm thấy → log WARN + return `DEFAULT_WARNING_MINUTES = 10`; (4) Nếu `isNaN(parsed) || parsed <= 0` → log ERROR + return `10`. Thêm constant `private readonly DEFAULT_WARNING_MINUTES = 10` vào class.
  > Phụ thuộc: T007 (DataSource đã inject). Covers FR-01, FR-14, ERR-01, ERR-02.

**Checkpoint Phase 2**: `LiveMeetingService` compiles với `QueueService`, `BackgroundJobsService` được inject. `readWarningConfig()` trả đúng integer hoặc fallback 10.

---

## Phase 3: Flow 1 — Normal Warning Schedule (scheduleWarningJob)

**Goal**: Implement `scheduleWarningJob()` — method chính của UC-IMM-12, xử lý Normal Flow + AF2 + skip guard.

**Independent Test**: Unit test T017 có thể verify flow này hoàn toàn độc lập với mock `QueueService`, `dataSource`, `BackgroundJobsService`.

- [x] T009 [F1] Thêm public method `scheduleWarningJob(meetingId: string): Promise<ScheduleWarningResult>` vào `LiveMeetingService`. Implement đầy đủ các bước:
  1. **Guard check** (ERR-03, ERR-04, ERR-05): Đọc meeting từ DB (`end_time`, `status`). Nếu không tồn tại → log ERROR `MEETING_NOT_FOUND_FOR_SCHEDULING` + return `{ skipped: true, reason: 'guard_failed' }`. Nếu `status !== 'in_progress'` → log WARN `MEETING_NOT_IN_PROGRESS_FOR_SCHEDULING` + return skipped. Nếu `end_time == null` → log WARN `MEETING_END_TIME_NULL` + return skipped.
  2. **Đọc config** (FR-01): Gọi `this.readWarningConfig()` lấy `configMinutes`.
  3. **Tính warningScheduledAt Normal** (FR-02): `warningScheduledAt = new Date(endTime.getTime() - configMinutes * 60000)`.
  4. **Kiểm tra AF2** (FR-10, FR-12, BR6): `remainingMinutes = (endTime.getTime() - Date.now()) / 60000`. Nếu `remainingMinutes <= configMinutes`: `adjustedWarningMinutes = Math.floor(remainingMinutes / 2)`, `warningScheduledAt = new Date(Date.now() + adjustedWarningMinutes * 60000)`. Log WARN ghi `originalConfigMinutes`, `remainingMinutes`, `usedMinutes` (NFR-09).
  5. **Skip guard** (FR-17, BR4, ERR-06): Nếu `warningScheduledAt.getTime() <= Date.now() + 60000`: INSERT `meeting_events` type `WARNING_SCHEDULING_SKIPPED` via `dataSource.getRepository(MeetingEventEntity).save(...)`, log WARN `WARNING_SCHEDULING_SKIPPED` với meetingId + reason, return `{ skipped: true, reason: 'too_close', warningScheduledAt }`.
  6. **Enqueue BullMQ** (FR-03, NFR-03, BR3): Gọi `this.queueService.addJob(SCHEDULER_QUEUE_NAME, 'meeting-time-warning', { meetingId, warningScheduledAt: warningScheduledAt.toISOString(), endTime: endTime.toISOString() }, { jobId: \`meeting-time-warning:${meetingId}\`, delay: warningScheduledAt.getTime() - Date.now() })`. Nếu throw "job already exists" → catch, log INFO (idempotent duplicate trigger), continue. Nếu throw khác → log ERROR `WARNING_ENQUEUE_FAILED` + return `{ skipped: true, reason: 'error' }` (FR-15, NFR-05, ERR-07). Không throw ra caller.
  7. **Upsert background_jobs** (FR-04, FR-21): Tìm record `{ relatedEntityId: meetingId, jobType: BackgroundJobType.MEETING_TIME_WARNING }`. Nếu có → UPDATE `status=SCHEDULED`, `scheduledAt`, `inputJson`. Nếu không → INSERT mới. Lỗi → log ERROR + continue best-effort (ERR-08).
  8. **Ghi meeting_events** (FR-05, NFR-07): INSERT `event_type = WARNING_SCHEDULED`, `source_type = SCHEDULER`, `actor_user_id = null`, `metadata_json = { warningScheduledAt, endTime, jobId, adjustedWarning?, remainingMinutes? }`. Lỗi → log ERROR + continue (ERR-09).
  9. **Log INFO** (NFR-08): Ghi `[scheduleWarningJob] Scheduled — meetingId, warningScheduledAt, jobId, adjustedWarning: true/false`.
  10. Return `{ skipped: false, warningScheduledAt }`.
  > Toàn bộ nằm trong top-level `try/catch`. Lỗi ngoài expected → log ERROR + return `{ skipped: true, reason: 'error' }`.
  > Phụ thuộc: T008 (readWarningConfig), T005 (MEETING_WARNING_ERRORS), T006 (ScheduleWarningResult), T001 (WARNING_SCHEDULED enum), T002 (MEETING_TIME_WARNING, SCHEDULED enum).

- [x] T010 [P] [F1] Cập nhật `src/modules/live-meeting/dto/start-meeting-response.dto.ts`: thêm 2 optional fields:
  ```typescript
  @IsOptional()
  @IsISO8601()
  warningScheduledAt?: string;

  @IsOptional()
  @IsBoolean()
  warningSkipped?: boolean;
  ```
  File này khác `live-meeting.service.ts` nên có thể làm song song với T009.
  > Covers FR-03 (response), Spec 6.6, Plan Section 5.

**Checkpoint Flow 1**: `scheduleWarningJob()` đã có trong service, `StartMeetingResponseDto` có 2 fields mới. Flow có thể verify bằng unit test T017 trước khi wire vào `startMeeting()`.

---

## Phase 4: Flow 2 — AF1 Reschedule Warning (rescheduleWarningJob)

**Goal**: Implement `rescheduleWarningJob()` — method xử lý AF1 khi extension được approved hoặc auto-applied.

**Independent Test**: Unit test T018 verify flow này độc lập với mock `QueueService.getQueue()`.

- [x] T011 [F2] Thêm public method `rescheduleWarningJob(meetingId: string): Promise<ScheduleWarningResult>` vào `LiveMeetingService`. Logic:
  1. **Guard check** (ERR-03, ERR-04, ERR-05): Giống `scheduleWarningJob()` bước 1.
  2. **Cancel BullMQ job cũ** (FR-11, FR-16, ERR-10): `const queue = this.queueService.getQueue(SCHEDULER_QUEUE_NAME)`. Nếu `queue === undefined` → log ERROR + return skipped. `const oldJob = await queue.getJob(\`meeting-time-warning:${meetingId}\`)`. Nếu tồn tại → `await oldJob.remove()`, log INFO "cancelled old job". Nếu không tồn tại → log INFO "old job not found, skipping cancel" (idempotent per FR-16).
  3. **Đọc config** (FR-01): `this.readWarningConfig()`.
  4. **Tính warningScheduledAt mới** (FR-11 bước 2): Từ `end_time` đã được cập nhật (đọc lại từ DB tại bước 1).
  5. **Kiểm tra AF2** (FR-10, FR-12): Logic giống `scheduleWarningJob()` bước 4.
  6. **Skip guard** (FR-11 bước 3, BR4): Logic giống `scheduleWarningJob()` bước 5 — ghi `WARNING_SCHEDULING_SKIPPED` event + return.
  7. **Enqueue BullMQ job mới** (FR-11 bước 4): Gọi `addJob()` với `jobId = meeting-time-warning:{meetingId}` và delay mới.
  8. **Upsert background_jobs** (FR-23): UPDATE nếu record tồn tại; INSERT nếu không. Cập nhật `scheduled_at`, `status = SCHEDULED`, `input_json` với `end_time` mới.
  9. **Ghi meeting_events** (FR-11 bước 6): INSERT `event_type = WARNING_SCHEDULED` mới (không update record cũ).
  10. Return `{ skipped: false, warningScheduledAt }`.
  > Phụ thuộc: T008, T005, T006, T001, T002. Cùng file với T009 — implement sau T009 để tránh conflict.

**Checkpoint Flow 2**: `rescheduleWarningJob()` compile và logic cancel + re-enqueue đúng. Verify bằng T018 trước khi wire.

---

## Phase 5: Flow 3 — AF3 Cancel Warning (cancelWarningJob)

**Goal**: Implement `cancelWarningJob()` — method xử lý AF3 khi meeting kết thúc thủ công.

**Independent Test**: Unit test T019 verify flow này độc lập. Cần mock `QueueService.getQueue()`.

- [x] T012 [F3] Thêm public method `cancelWarningJob(meetingId: string): Promise<void>` vào `LiveMeetingService`. Logic:
  1. **Cancel BullMQ job** (FR-13, ERR-10): `const queue = this.queueService.getQueue(SCHEDULER_QUEUE_NAME)`. Nếu `undefined` → log ERROR + return. `const job = await queue.getJob(\`meeting-time-warning:${meetingId}\`)`. Nếu tồn tại → `await job.remove()`, log INFO "cancelled warning job for meeting". Nếu không tồn tại → log INFO "warning job not found, already fired or never scheduled" (idempotent per ERR-10).
  2. **UPDATE background_jobs** (FR-22, ERR-11): Tìm record `{ relatedEntityId: meetingId, jobType: MEETING_TIME_WARNING }`. Nếu tồn tại → UPDATE `status = CANCELLED`. Nếu không tồn tại → bỏ qua. Lỗi → log ERROR + continue (ERR-11, non-blocking).
  3. **KHÔNG ghi meeting_events** (FR-13 bước 3): AF3 không tạo event.
  > Toàn bộ nằm trong top-level `try/catch`. Lỗi → log ERROR `WARNING_CANCEL_FAILED` + return void (non-blocking).
  > Phụ thuộc: T007. Cùng file với T009, T011 — implement sau T011.

**Checkpoint Flow 3**: `cancelWarningJob()` compile. Verify bằng T019 — đặc biệt check KHÔNG có `meeting_events` mới và background_jobs status = CANCELLED.

---

## Phase 6: Flow 4 — Integration Wiring (Trigger Hooks)

**Goal**: Wire 3 methods vừa implement vào các caller UC (UC-IMM-01, UC-IMM-02, UC-IMM-03, UC-IMM-05) theo pattern post-commit best-effort.

**Independent Test**: Unit test T020 verify trigger hooks được gọi đúng sau commit, và failure của UC-IMM-12 không ảnh hưởng caller response.

- [x] T013 [F4] Wire `scheduleWarningJob()` vào `startMeeting()` trong `LiveMeetingService`. Sau khi `executeStartMeetingInTransaction()` commit thành công, thêm:
  ```typescript
  const warningResult = await this.scheduleWarningJob(meetingId);
  ```
  Map result vào response: nếu `warningResult.skipped === false` → set `response.warningScheduledAt = warningResult.warningScheduledAt.toISOString()`. Nếu `skipped === true` → set `response.warningSkipped = true`. Wrap trong `try/catch` — lỗi → log ERROR + tiếp tục trả response bình thường (NFR-02, FR-06).
  > Phụ thuộc: T009, T010. Covers FR-06, FR-19, NFR-02, Scenario 1.

- [x] T014 [F4] Wire `rescheduleWarningJob()` vào `decideExtension()` approve path trong `LiveMeetingService`. Sau khi transaction approve commit thành công (cuối block approve), thêm post-commit call:
  ```typescript
  await this.rescheduleWarningJob(meetingId); // best-effort, non-blocking
  ```
  Wrap trong `try/catch` — lỗi → log ERROR + tiếp tục (FR-07, FR-20, BR1). Không ảnh hưởng response của `decideExtension()`.
  > Phụ thuộc: T011. Cùng file, implement sau T013. Covers FR-07, Scenario 2.

- [x] T015 [F4] Wire `rescheduleWarningJob()` vào `requestExtension()` auto-apply path trong `LiveMeetingService`. Tìm đúng vị trí auto-apply branch — sau khi auto-apply transaction commit, thêm:
  ```typescript
  await this.rescheduleWarningJob(meetingId); // post-commit best-effort
  ```
  Nếu `requestExtension()` chưa có auto-apply path, kiểm tra lại spec UC-IMM-02 trước khi thêm.
  > Phụ thuộc: T011. Cùng file, implement sau T014. Covers FR-07 (UC-IMM-02 auto-apply path), BR1.

- [x] T016 [F4] Wire `cancelWarningJob()` vào `endMeeting()` trong `LiveMeetingService`. Sau khi `executeEndMeetingInTransaction()` commit thành công, thêm:
  ```typescript
  await this.cancelWarningJob(meetingId); // best-effort, non-blocking
  ```
  Wrap trong `try/catch` — lỗi → log ERROR + tiếp tục (FR-08, FR-13, BR2, NFR-04). Không ảnh hưởng response của `endMeeting()`.
  > Phụ thuộc: T012. Cùng file, implement sau T015. Covers FR-08, FR-13, Scenario 4.

**Checkpoint Phase 6**: Tất cả 4 trigger hooks đã được wire. Chạy lint. Chạy existing tests để đảm bảo không có regression trong `startMeeting()`, `endMeeting()`, `decideExtension()`, `requestExtension()`.

---

## Phase 7: Testing

**Mục đích**: Viết unit tests cho tất cả service methods và trigger hooks. Tests phải fail trước khi viết code (nếu dùng TDD), hoặc viết sau khi code đã có.

**Cấu trúc**: Tất cả trong `src/modules/live-meeting/tests/live-meeting.service.spec.ts` (hoặc tạo file riêng nếu file gốc quá lớn).

### Tests cho Flow 1 — scheduleWarningJob()

- [x] T017 [F1] Viết test suite `describe('scheduleWarningJob')` trong `live-meeting.service.spec.ts` với 11 test cases:
  - **T-W01** `[Scenario 1]` Happy path Normal Flow: mock `end_time = T+50m`, `config = 10`, assert `warningScheduledAt = T+40m`, `background_jobs` INSERT call, `meeting_events` INSERT `warning_scheduled`, return `{ skipped: false }`. Covers FR-01, FR-02, FR-03, FR-04, FR-05.
  - **T-W02** `[Scenario 3]` AF2 trigger: mock `end_time = T+8m`, `config = 10`, assert `adjustedWarningMinutes = 4`, `warningScheduledAt ≈ now+4m`, `background_jobs.inputJson.adjustedWarning = true`. Covers FR-10, FR-12, BR6, NFR-09.
  - **T-W03** `[Scenario 5]` Skip guard: mock `end_time = T+2m`, `config = 10`, assert `addJob` NOT called, `background_jobs` NOT created, `meeting_events` INSERT `warning_scheduling_skipped`. Covers FR-17, BR4, ERR-06.
  - **T-W04** `[ERR-01]` Config key missing: mock `findOne` trả `null`, assert fallback `10`, log WARN. Covers FR-14, ERR-01.
  - **T-W05** `[ERR-02]` Config value `'abc'` không parse được: assert fallback `10`, log ERROR. Covers ERR-02.
  - **T-W06** `[ERR-04]` Meeting status = `completed`: assert return `{ skipped: true, reason: 'guard_failed' }`, NO `addJob` call. Covers FR-18, ERR-04.
  - **T-W07** `[ERR-05]` `end_time = null`: assert return skipped, log WARN. Covers ERR-05.
  - **T-W08** `[ERR-03]` Meeting không tồn tại (`findOne` trả `null`): assert return skipped, log ERROR. Covers ERR-03.
  - **T-W09** `[NFR-05]` BullMQ `addJob` throw non-"already exists" error: assert return skipped, NO `meeting_events` INSERT, NO `background_jobs` INSERT, log ERROR `WARNING_ENQUEUE_FAILED`. Covers FR-15, NFR-07, ERR-07.
  - **T-W10** `[ERR-08]` `background_jobs` upsert throw: assert BullMQ job đã enqueued (addJob called), log ERROR, return `{ skipped: false }` (BullMQ thành công). Covers ERR-08.
  - **T-W11** `[NFR-03]` Idempotent: `addJob` throw "Job already exists" error: catch silently, assert NO double-enqueue, return bình thường. Covers NFR-03, BR3.

### Tests cho Flow 2 — rescheduleWarningJob()

- [x] T018 [F2] Viết test suite `describe('rescheduleWarningJob')` với 3 test cases:
  - **T-W12** `[Scenario 2]` Happy path AF1: mock old job exists → `job.remove()` called, new `addJob` called với `end_time` mới, `background_jobs` UPDATE, `meeting_events` INSERT `warning_scheduled`. Covers FR-11, FR-20, FR-23, BR1.
  - **T-W13** `[ERR-10]` Old job không tìm thấy (`getJob` trả `null`): assert `remove()` NOT called, enqueue vẫn thực hiện bình thường, log INFO. Covers FR-16, ERR-10.
  - **T-W14** AF1 + skip guard: mock `end_time_new = T+1m`, assert skip guard kích hoạt, `addJob` NOT called, `warning_scheduling_skipped` event ghi. Covers FR-11 bước 3.

### Tests cho Flow 3 — cancelWarningJob()

- [x] T019 [F3] Viết test suite `describe('cancelWarningJob')` với 4 test cases:
  - **T-W15** `[Scenario 4]` Happy path AF3: mock job exists → `job.remove()` called, `background_jobs` UPDATE `status = CANCELLED`. Covers FR-13, FR-22, BR2.
  - **T-W16** `[ERR-10]` Job không tồn tại trong queue: assert `remove()` NOT called, `background_jobs` UPDATE vẫn thực hiện nếu record tồn tại, log INFO. Covers ERR-10.
  - **T-W17** `[ERR-11]` `background_jobs` UPDATE throw: assert log ERROR, return void bình thường (non-blocking). Covers ERR-11.
  - **T-W18** `[FR-13]` Không tạo `meeting_events`: assert `meeting_events` INSERT NOT called trong bất kỳ case nào. Covers FR-13 bước 3, Scenario 4.

### Tests cho Trigger Hooks

- [x] T020 Viết test suite `describe('trigger hooks')` trong spec file với 4 test cases:
  - **T-W19** `startMeeting()` gọi `scheduleWarningJob()` sau commit: mock `scheduleWarningJob`, assert được gọi 1 lần với đúng `meetingId`. Response chứa `warningScheduledAt` nếu scheduleWarningJob return `{ skipped: false }`. Covers FR-06, Scenario 1.
  - **T-W20** `endMeeting()` gọi `cancelWarningJob()` sau commit: mock `cancelWarningJob`, assert được gọi 1 lần. Covers FR-08, Scenario 4.
  - **T-W21** `decideExtension()` approve path gọi `rescheduleWarningJob()` sau commit: mock `rescheduleWarningJob`, assert được gọi. Covers FR-07, Scenario 2.
  - **T-W22** `scheduleWarningJob()` throw → `startMeeting()` vẫn trả 200 response bình thường: mock scheduleWarningJob throw → assert caller response không bị ảnh hưởng, response trả về `warningSkipped: true`. Covers NFR-02, NFR-05.

**Checkpoint Phase 7**: Tất cả 22 test cases pass. Coverage report cho `live-meeting.service.ts` phủ đủ paths. Chạy `npm run test` (hoặc `pnpm test`).

---

## Phase N: Polish & Cross-Cutting Concerns

- [x] T021 [P] Verify migration end-to-end: chạy migration trên DB dev, confirm `\dT+ meeting_event_type` có `warning_scheduled` và `warning_scheduling_skipped`; `\dT+ background_job_type` có `meeting_time_warning`; `\dT+ background_job_status` có `scheduled`. Ghi kết quả vào PR description.

- [x] T022 [P] Review toàn bộ log statements: đảm bảo (1) WARN khi skip guard, (2) WARN khi config missing, (3) ERROR khi enqueue fail, (4) INFO khi cancel success, (5) INFO khi AF2 applied với `originalConfigMinutes`/`remainingMinutes`/`usedMinutes` (NFR-08, NFR-09). Không log meetingId với sensitive data xung quanh.

- [x] T023 Chạy full regression test: `npm run test` (hoặc `pnpm test`) sau tất cả phases hoàn thành. Đảm bảo không có regression trong các UC caller (UC-IMM-01, UC-IMM-02, UC-IMM-03, UC-IMM-05). Đặc biệt verify existing tests cho `startMeeting()`, `endMeeting()`, `decideExtension()` vẫn pass sau khi thêm trigger hooks.

---

## Dependencies & Execution Order

### Phase Dependencies

```
Phase 1 (T001–T004) — Setup: Không phụ thuộc, bắt đầu ngay
    ↓ T003 migration BLOCKING (chạy migration trước deploy)
Phase 2 (T005–T008) — Foundational: Phụ thuộc T001+T002 (entity enums)
    ↓ T007, T008 BLOCKING (inject + readWarningConfig)
Phase 3 (T009, T010) — Flow 1: Phụ thuộc Phase 2 hoàn thành
Phase 4 (T011) — Flow 2: Phụ thuộc Phase 2 hoàn thành, sau Phase 3
Phase 5 (T012) — Flow 3: Phụ thuộc Phase 2 hoàn thành, sau Phase 4
Phase 6 (T013–T016) — Wiring: Phụ thuộc Phase 3+4+5 hoàn thành
Phase 7 (T017–T020) — Testing: T017 sau Phase 3; T018 sau Phase 4; T019 sau Phase 5; T020 sau Phase 6
Phase N (T021–T023) — Polish: Sau Phase 7
```

### Task Dependencies Chi Tiết

| Task | Phụ thuộc | Lý do |
|---|---|---|
| T001 | — | Entity file độc lập |
| T002 | — | Entity file độc lập |
| T003 | T001, T002 | Migration phải ref đúng enum values |
| T004 | — | Seed file độc lập |
| T005 | — | Constants file độc lập |
| T006 | — | Types file độc lập |
| T007 | T002 | Cần BackgroundJobType enum compile |
| T008 | T007 | Cần DataSource injection từ T007 |
| T009 | T005, T006, T008 | Dùng ScheduleWarningResult, MEETING_WARNING_ERRORS, readWarningConfig |
| T010 | T009 (logic), — (file) | DTO file khác → [P] với T009 |
| T011 | T008 | Cùng file với T009 → sau T009 |
| T012 | T007 | Chỉ cần QueueService inject |
| T013 | T009, T010 | Wire startMeeting sau scheduleWarningJob + DTO sẵn sàng |
| T014 | T011 | Wire decideExtension sau rescheduleWarningJob |
| T015 | T011 | Wire requestExtension sau rescheduleWarningJob |
| T016 | T012 | Wire endMeeting sau cancelWarningJob |
| T017 | T009 | Test scheduleWarningJob |
| T018 | T011 | Test rescheduleWarningJob |
| T019 | T012 | Test cancelWarningJob |
| T020 | T013, T014, T015, T016 | Test trigger hooks |
| T021 | T003 | Verify migration |
| T022 | T009, T011, T012 | Verify logs |
| T023 | T017–T020 | Full regression |

### Parallel Opportunities

| Nhóm song song | Tasks | Điều kiện |
|---|---|---|
| Nhóm 1 | T001 + T002 | Khác file, không phụ thuộc |
| Nhóm 2 | T003 + T004 + T005 + T006 | T003 phụ thuộc T001+T002 xong; T004/T005/T006 độc lập |
| Nhóm 3 | T009 + T010 | T010 khác file → [P] với T009 |
| Nhóm 4 | T021 + T022 | Khác file, phase N |

---

## Requirements Coverage

### Functional Requirements → Tasks

| FR | Mô tả rút gọn | Tasks chính | Test coverage |
|---|---|---|---|
| FR-01 | Đọc config `meeting_warning_before_minutes` | T008 | T-W01, T-W04 |
| FR-02 | Tính `warningScheduledAt = end_time - configMinutes` | T009 | T-W01 |
| FR-03 | Enqueue BullMQ delayed job với jobId dedupe | T009 | T-W01, T-W11 |
| FR-04 | Ghi `background_jobs` chỉ khi enqueue thành công | T009 | T-W01, T-W03, T-W09 |
| FR-05 | Ghi `meeting_events` type `warning_scheduled` sau enqueue | T009 | T-W01, T-W09 |
| FR-06 | Trigger từ UC-IMM-01 sau `in_progress` | T013 | T-W19 |
| FR-07 | Trigger AF1 từ UC-IMM-03 sau extension approved | T014, T015 | T-W21 |
| FR-08 | Trigger AF3 từ UC-IMM-05 sau end meeting | T016 | T-W20 |
| FR-09 | Tối đa 1 warning job active per meeting | T009 (jobId) | T-W11 |
| FR-10 | AF2: remainingMinutes ≤ configMinutes | T009 | T-W02 |
| FR-11 | AF1: cancel + re-compute + re-enqueue | T011 | T-W12, T-W13, T-W14 |
| FR-12 | AF2: adjustedWarningMinutes = floor(R/2), warningScheduledAt = now+M | T009 | T-W02 |
| FR-13 | AF3: remove BullMQ job + cancel background_jobs, KHÔNG event | T012 | T-W15, T-W18 |
| FR-14 | Config missing → default 10 + WARN | T008 | T-W04 |
| FR-15 | Enqueue fail → non-blocking, log ERROR | T009 | T-W09 |
| FR-16 | Old job not found when AF1 cancel → bỏ qua, tiếp tục | T011 | T-W13 |
| FR-17 | Skip guard: warningScheduledAt ≤ now+60s → skip | T009 | T-W03 |
| FR-18 | Meeting không `in_progress` → bỏ qua | T009 | T-W06 |
| FR-19 | Workflow Normal Flow đầy đủ | T009, T013 | T-W01, T-W19 |
| FR-20 | Workflow AF1 đầy đủ | T011, T014, T015 | T-W12, T-W21 |
| FR-21 | `background_jobs.status = scheduled` sau enqueue | T009 | T-W01 |
| FR-22 | `background_jobs.status = cancelled` sau AF3 | T012 | T-W15 |
| FR-23 | Upsert `background_jobs` khi AF1 | T011 | T-W12 |

### Non-Functional Requirements → Tasks

| NFR | Mô tả rút gọn | Tasks chính | Test coverage |
|---|---|---|---|
| NFR-02 | Không block response UC-94 | T013 | T-W22 |
| NFR-03 | Idempotency via jobId | T009 | T-W11 |
| NFR-04 | Không cảnh báo giả sau meeting ended | T012, T016 | T-W15, T-W18 |
| NFR-05 | Non-blocking enqueue failure | T009 | T-W09 |
| NFR-07 | Không ghi `warning_scheduled` event khi enqueue fail | T009 | T-W09 |
| NFR-08 | Log đầy đủ tại mỗi bước | T009, T011, T012 | T022 |
| NFR-09 | Log WARN khi AF2 với originalConfigMinutes/remainingMinutes | T009 | T-W02 |

### Acceptance Criteria → Tasks

| Scenario | Tasks | Unit Tests |
|---|---|---|
| Scenario 1 (Happy path Normal) | T009, T013, T010 | T-W01, T-W19 |
| Scenario 2 (AF1 Reschedule) | T011, T014 | T-W12, T-W21 |
| Scenario 3 (AF2 Adjusted) | T009 | T-W02 |
| Scenario 4 (AF3 Cancel) | T012, T016 | T-W15, T-W18, T-W20 |
| Scenario 5 (Skip Guard) | T009 | T-W03 |

### Business Rules → Tasks

| BR | Mô tả rút gọn | Tasks |
|---|---|---|
| BR1 | Reset job ngay khi `end_time` thay đổi | T011, T014, T015 |
| BR2 | Cancel job khi meeting kết thúc thủ công | T012, T016 |
| BR3 | Dedupe bằng `jobId = meeting-time-warning:{meetingId}` | T009, T011, T012 |
| BR4 | Skip guard: `warningScheduledAt > now() + 60s` | T009 |
| BR5 | Đọc config mỗi lần trigger, không cache | T008, T009 |
| BR6 | AF2 dùng `remainingMinutes = end_time - now()` | T009 |

### Error Handling → Tasks

| ERR | Tasks | Test |
|---|---|---|
| ERR-01 | T008 | T-W04 |
| ERR-02 | T008 | T-W05 |
| ERR-03 | T009 | T-W08 |
| ERR-04 | T009 | T-W06 |
| ERR-05 | T009 | T-W07 |
| ERR-06 | T009 | T-W03 |
| ERR-07 | T009 | T-W09 |
| ERR-08 | T009 | T-W10 |
| ERR-09 | T009 | (best-effort, log only) |
| ERR-10 | T011, T012 | T-W13, T-W16 |
| ERR-11 | T012 | T-W17 |
