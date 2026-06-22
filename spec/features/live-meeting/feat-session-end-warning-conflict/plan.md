# Implementation Plan: Gửi cảnh báo kết thúc phiên họp và xung đột lịch (UC-IMM-13)

**Feature Directory**: `spec/features/live-meeting/feat-session-end-warning-conflict`
**Date**: 2026-06-19
**Spec**: [spec.md](spec.md)
**Checklist**: [checklists/requirements.md](checklists/requirements.md)
**Upstream**: [UC-IMM-12 plan](../feat-schedule-meeting-time-warning/plan.md)

---

## 📝 CHANGELOG & REVISION HISTORY

| Ngày cập nhật | Tóm tắt thay đổi | Các dòng thay đổi |
| :--- | :--- | :--- |
| 2026-06-19 | Tạo plan lần đầu cho UC-IMM-13 Gửi cảnh báo kết thúc phiên họp và xung đột lịch | Toàn bộ file |

---

## Summary

UC-IMM-13 là **BullMQ job processor** — không có HTTP endpoint, không có actor người dùng trực tiếp.

Khi BullMQ delayed job `meeting-time-warning:{meetingId}` fired từ queue `QUEUE_SCHEDULER` (được enqueue bởi UC-IMM-12), processor UC-IMM-13 thực hiện:

1. Guard check: meeting còn `in_progress` không?
2. Idempotency check: `meeting_events.warning_sent` đã tồn tại chưa?
3. Tính `remainingMinutes` thực tế tại thời điểm job fired (clamp về 0 nếu âm — late job).
4. Đọc `conflictBufferMinutes` từ `system_configs`.
5. Resolve Host từ `meetings.host_id`.
6. Conflict detection: query `room_bookings` cùng `room_id`, `reserved_start_time >= meeting.end_time`, `status IN ('pending', 'approved', 'active')` — so sánh với buffer window.
7. Xác định **Branch A** (Standard Warning) hoặc **Branch B** (Escalated Conflict Warning) và `warningLevel` (standard / overdue / strict / urgent).
8. Tạo `notifications` record qua `NotificationsService` với payload đúng branch.
9. Push WebSocket `meeting.time.warning` với payload tách theo đối tượng (Host payload đầy đủ / Participant payload an toàn).
10. Update `background_jobs.status = completed`.
11. Ghi `meeting_events.event_type = warning_sent`.

UC-IMM-13 **chỉ gửi cảnh báo** — không kết thúc meeting, không cancel booking, không approve/reject extension.

---

## 2. Technical Context

| Aspect | Detail |
|---|---|
| **Framework** | NestJS (TypeScript) |
| **ORM** | TypeORM, `DataSource` — không dùng global transaction (best-effort writes) |
| **Database** | PostgreSQL, DB v3.2 Compact (39 bảng) |
| **Queue** | BullMQ `@nestjs/bullmq` — job processor dạng `@Processor()` decorator hoặc `WorkerHost` |
| **Queue name** | `QUEUE_SCHEDULER` (env `QUEUE_SCHEDULER`, default `'scheduler'`) — cùng queue với UC-IMM-12 |
| **Job name** | `'meeting-time-warning'` — khớp với `SCHEDULER_JOB_NAME` trong `LiveMeetingService` |
| **Config** | `SystemConfigEntity`, key = `meeting_warning_conflict_buffer_minutes`, default = `0` |
| **Auth** | Không có — internal BullMQ job processor, không expose HTTP |
| **Target Module** | `live-meeting` — thêm `MeetingWarningProcessor` service mới trong module hiện có |
| **WebSocket** | `WebsocketService.emitToRoom()` + `WebsocketService.emitToUser()` — đã có sẵn |
| **Notification** | `NotificationsService` hoặc ghi trực tiếp qua `DataSource.getRepository(NotificationEntity)` |
| **Module phụ thuộc** | `QueueModule` (@Global, đã có), `AdministrationModule` (@Global, đã có), `WebsocketModule` (đã import trong `LiveMeetingModule`) |

### Infrastructure hiện có (đã sẵn sàng dùng)

| Component | Path / Tên |
|---|---|
| `QueueService` | `src/modules/queue/queue.service.ts` |
| `QueueModule` | `src/modules/queue/queue.module.ts` — queue `QUEUE_SCHEDULER` đã đăng ký |
| `WebsocketService` | `src/modules/websocket/websocket.service.ts` — `emitToRoom()`, `emitToUser()` |
| `BackgroundJobEntity` | `src/modules/administration/entities/background-job.entity.ts` |
| `MeetingEventEntity` | `src/modules/meetings/entities/meeting-event.entity.ts` — `WARNING_SENT` đã có |
| `NotificationEntity` | `src/modules/notifications/entities/notification.entity.ts` — `NotificationType` cần bổ sung 2 giá trị |
| `RoomBookingEntity` | `src/modules/rooms/entities/room-booking.entity.ts` — cột `reservedStartTime`, `reservedEndTime`, `status` đã xác nhận |
| `MeetingParticipantEntity` | `src/modules/meetings/entities/meeting-participant.entity.ts` — `participantRole`, `invitationStatus` đã xác nhận |
| `SystemConfigEntity` | `src/modules/administration/entities/system-config.entity.ts` |
| `LiveMeetingModule` | `src/modules/live-meeting/live-meeting.module.ts` — import `WebsocketModule`, có `LiveMeetingService` |

### Confirmed DB column names (từ entity inspection)

| Entity | TypeScript field | DB column | Ghi chú |
|---|---|---|---|
| `RoomBookingEntity` | `reservedStartTime` | `reserved_start_time` | ✅ Xác nhận — khớp với spec |
| `RoomBookingEntity` | `reservedEndTime` | `reserved_end_time` | ✅ Xác nhận |
| `RoomBookingEntity` | `status` | `status` | ✅ `RoomBookingStatus` enum có `pending`, `approved`, `active` |
| `MeetingParticipantEntity` | `invitationStatus` | `invitation_status` | ✅ `InvitationStatus` enum có `pending`, `accepted`, `declined`, `tentative` |
| `MeetingParticipantEntity` | `participantRole` | `participant_role` | ✅ `ParticipantRole.HOST = 'host'` |
| `NotificationEntity` | `notificationType` | `notification_type` | VARCHAR(60) — TypeScript enum thay đổi, không cần migration |

---

## Constitution Check

*GATE: Phải pass trước Phase 1 (Enum & Seed). Re-check sau Phase 4 (Core Processor).*

| Gate | Điều kiện PASS | Trạng thái |
|---|---|---|
| **DB Gate** | Không thêm bảng mới. Chỉ thêm 2 enum values vào `NotificationType` TypeScript enum (column VARCHAR(60), không cần ALTER TYPE). Không thêm bảng mới ngoài DB v3.2 Compact. | ✅ PASS |
| **Security Gate** | Internal BullMQ processor — không expose HTTP endpoint. Không log nội dung payload nhạy cảm. Không log token/secret. | ✅ PASS |
| **Scope Gate** | UC-IMM-13 chỉ gửi cảnh báo. Không kết thúc meeting, không cancel booking, không tạo/hủy extension request. Không expose HTTP endpoint. | ✅ PASS |
| **Module Gate** | Logic mới nằm trong `live-meeting` module (thêm `MeetingWarningProcessor`). Tất cả phụ thuộc đã @Global hoặc đã import sẵn. | ✅ PASS |
| **API Gate** | Không có HTTP endpoint mới. BullMQ processor handler không phải HTTP handler. | ✅ PASS |
| **Auth Gate** | Không cần JWT guard. Job processor chạy nội bộ. `actor_user_id = null` trong `meeting_events`. | ✅ PASS |
| **ORM Gate** | TypeORM — không dùng Prisma. Không dùng `synchronize: true`. Seed và enum change đúng chuẩn. | ✅ PASS |
| **Test Gate** | Unit test cases bao phủ: guard check, idempotency, conflict detection (2 branches), 4 warningLevel, error paths (ERR-001 → ERR-009), WebSocket failure non-critical. | ✅ PASS |

**Complexity Justification**: Không có vi phạm. Không cần `## Complexity Tracking`.

---

## Project Structure

### Documentation (this feature)

```text
spec/features/live-meeting/feat-session-end-warning-conflict/
├── plan.md                              # This file
├── spec.md                              # Feature specification (đã hoàn thành)
└── checklists/
    └── requirements.md                 # Spec quality checklist (đã hoàn thành)
```

> `tasks.md` sẽ được tạo bởi `/speckit.tasks` (bước tiếp theo), không phải bởi `/speckit.plan`.

### Source Code (repository root)

```text
src/
├── database/
│   └── seeds/
│       └── 20260619000002-SeedMeetingWarningConflictConfig.ts   # NEW — meeting_warning_conflict_buffer_minutes = '0'
│
├── modules/
│   ├── notifications/
│   │   └── entities/
│   │       └── notification.entity.ts                           # MODIFY — thêm 2 giá trị vào NotificationType enum
│   │
│   └── live-meeting/
│       ├── constants/
│       │   └── meeting-warning-error.constant.ts                # MODIFY — thêm error codes cho UC-IMM-13
│       ├── types/
│       │   └── warning-processor-result.type.ts                 # NEW — WarningProcessorResult interface
│       ├── processors/
│       │   └── meeting-warning.processor.ts                     # NEW — BullMQ job processor chính
│       ├── services/
│       │   └── meeting-warning.service.ts                       # NEW — business logic tách riêng khỏi processor
│       └── tests/
│           └── live-meeting-warning.service.spec.ts             # MODIFY — thêm test suites cho UC-IMM-13
```

**Structure Decision**: Tách processor (`meeting-warning.processor.ts`) và business logic (`meeting-warning.service.ts`) theo pattern Single Responsibility:
- **Processor**: chỉ nhận job, gọi service, handle BullMQ ACK/NACK.
- **Service**: chứa toàn bộ business logic UC-IMM-13 — testable độc lập không cần BullMQ.

Không tạo module mới — tất cả nằm trong `live-meeting` module hiện có.

---

## 3. Scope Confirmation

### IN SCOPE

- Thêm `MEETING_TIME_WARNING = 'meeting_time_warning'` và `MEETING_TIME_CONFLICT_WARNING = 'meeting_time_conflict_warning'` vào `NotificationType` enum (TypeScript only, không cần DB migration vì column là VARCHAR(60)).
- Seed `system_configs`: INSERT `meeting_warning_conflict_buffer_minutes = '0'` (ON CONFLICT DO NOTHING).
- Thêm error codes UC-IMM-13 vào `meeting-warning-error.constant.ts` hiện có.
- Tạo `WarningProcessorResult` interface.
- Tạo `MeetingWarningService` với toàn bộ business logic UC-IMM-13 (13 bước workflow FR-023).
- Tạo `MeetingWarningProcessor` BullMQ processor lắng nghe job `meeting-time-warning` trên queue `QUEUE_SCHEDULER`.
- Đăng ký `MeetingWarningProcessor` và `MeetingWarningService` vào `LiveMeetingModule`.
- Guard check: meeting tồn tại và `in_progress`.
- Idempotency check: `meeting_events.warning_sent` đã có chưa.
- Tính `remainingMinutes` tại thời điểm job fired — clamp về 0 nếu âm.
- Đọc `conflictBufferMinutes` từ `system_configs`.
- Resolve Host từ `meetings.host_id` với fallback `meeting_participants.participant_role = 'host'`.
- Conflict detection: query `room_bookings` theo `room_id`, `reservedStartTime >= meeting.end_time`, `status IN ('pending', 'approved', 'active')`, ORDER BY `reservedStartTime ASC` LIMIT 1.
- Xác định Branch A / Branch B và `warningLevel` (standard / overdue / strict / urgent).
- Tạo `notifications` record qua `DataSource.getRepository(NotificationEntity)` với đầy đủ fields.
- Push WebSocket event `meeting.time.warning` với payload tách theo đối tượng: Host payload đầy đủ; Participant/Room Display payload an toàn.
- Update `background_jobs.status = completed/failed`.
- Ghi `meeting_events.event_type = warning_sent` với `metadata_json` đầy đủ.
- Error handling cho 9 loại error (ERR-001 → ERR-009): guard, conflict query fallback, notification failure → NACK, WebSocket failure non-critical.
- Unit tests đầy đủ cho `MeetingWarningService` — bao phủ tất cả AC-001 → AC-011.

### OUT OF SCOPE

- HTTP endpoint nào — UC-IMM-13 là internal BullMQ processor.
- Gửi email notification.
- Kết thúc meeting, cancel booking, approve/reject extension request.
- Thêm bảng mới vào database.
- Thay đổi logic trong UC-IMM-12, UC-IMM-01, UC-IMM-02, UC-IMM-03, UC-IMM-05.
- Multiple warning levels (cảnh báo 30 phút + 10 phút) — ngoài scope MVP.
- Auto-release phòng khi phát hiện conflict — đây là `utilization` module.
- WebSocket phân quyền / connection authentication (phụ thuộc WebSocket Gateway đã có).
- Push notification sang Participant (chỉ gửi Host trong v1 — mở rộng sau).

---

## 4. Data Model Impact

### Không thêm bảng mới. Thay đổi chỉ ở TypeScript enum values và data writes.

#### 4.1 Enum additions — chỉ TypeScript, KHÔNG cần DB migration

| Entity / File | Enum | Giá trị mới |
|---|---|---|
| `NotificationEntity` | `NotificationType` | `MEETING_TIME_WARNING = 'meeting_time_warning'` |
| `NotificationEntity` | `NotificationType` | `MEETING_TIME_CONFLICT_WARNING = 'meeting_time_conflict_warning'` |

> **Lý do không cần migration**: Column `notification_type` là `VARCHAR(60)`, không phải PostgreSQL native ENUM type. TypeORM lưu string — thay đổi TypeScript enum không yêu cầu `ALTER TYPE`.
> So sánh với UC-IMM-12: `MeetingEventType` và `BackgroundJobType` dùng PostgreSQL ENUM nên cần migration. `NotificationType` không cần.

> **Enum values đã có sẵn (không cần thêm)**:
> - `MeetingEventType.WARNING_SENT` ✅ — dùng cho `meeting_events` write
> - `BackgroundJobType.MEETING_TIME_WARNING` ✅ — dùng để query `background_jobs`
> - `BackgroundJobStatus.COMPLETED / FAILED` ✅ — dùng để update `background_jobs`
> - `RoomBookingStatus.PENDING / APPROVED / ACTIVE` ✅ — dùng cho conflict detection query
> - `InvitationStatus.ACCEPTED / TENTATIVE / PENDING / DECLINED` ✅ — dùng khi mở rộng recipients
> - `ParticipantRole.HOST` ✅ — dùng cho Host fallback resolve

#### 4.2 Seed — đảm bảo system_configs có conflict buffer key

| Table | Operation | Điều kiện | Giá trị |
|---|---|---|---|
| `system_configs` | INSERT ON CONFLICT DO NOTHING | Key chưa tồn tại | `meeting_warning_conflict_buffer_minutes = '0'` |

#### 4.3 WRITE — khi xử lý job thành công

| Table | Operation | Điều kiện |
|---|---|---|
| `notifications` | INSERT | Branch A hoặc Branch B notification |
| `meeting_events` | INSERT `event_type = warning_sent` | Sau khi notification tạo thành công |
| `background_jobs` | UPDATE `status = completed`, `completed_at`, `output_json` | Sau khi notification + meeting_events thành công |

#### 4.4 WRITE — khi xử lý job thất bại (notification tạo lỗi)

| Table | Operation | Điều kiện |
|---|---|---|
| `background_jobs` | UPDATE `status = failed`, `error_message` | Khi `NotificationEntity` INSERT thất bại |
| `meeting_events` | KHÔNG tạo | Không tạo nếu notification thất bại |

#### 4.5 NO WRITE — các skip/guard cases

| Case | Hành động | Ghi thêm |
|---|---|---|
| Meeting không tồn tại (ERR-001) | ACK job, không write | Log ERROR |
| Meeting không `in_progress` (ERR-002) | ACK job, không write | Log WARN |
| Idempotency: `warning_sent` đã có (FR-033) | ACK job, không write | Log INFO |
| Host không tìm được (FR-034) | Bỏ qua gửi notification, vẫn ACK | Log WARN |

#### 4.6 READ — các bảng đọc trong job processing

| Table | Fields đọc | Mục đích |
|---|---|---|
| `meetings` | `id`, `status`, `end_time`, `room_id`, `host_id`, `title` | Guard check, tính remainingMinutes, resolve Host, notification content |
| `meeting_participants` | `user_id`, `participant_role`, `invitation_status` | Fallback Host resolve; mở rộng recipients sau |
| `room_bookings` | `id`, `room_id`, `meeting_id`, `reserved_start_time`, `status` | Conflict detection query |
| `system_configs` | `config_key`, `config_value` | Đọc `meeting_warning_conflict_buffer_minutes` |
| `meeting_events` | `meeting_id`, `event_type` | Idempotency check trước khi tạo notification |
| `background_jobs` | `related_entity_id`, `job_type` | Tìm record để update status |

#### 4.7 Notification record fields mapping

| NotificationEntity field | Branch A | Branch B |
|---|---|---|
| `notificationType` | `NotificationType.MEETING_TIME_WARNING` | `NotificationType.MEETING_TIME_CONFLICT_WARNING` |
| `channel` | `NotificationChannel.IN_APP` | `NotificationChannel.IN_APP` |
| `priority` | `NotificationPriority.NORMAL` | `NotificationPriority.HIGH` |
| `subject` | `"Cuộc họp sắp kết thúc — còn {N} phút"` | `"Cảnh báo: Phòng họp sắp bị xung đột — còn {N} phút"` |
| `content` | Message Branch A (hoặc overdue nếu N=0) | Message Branch B (hoặc urgent nếu N=0) |
| `relatedEntityType` | `'meeting'` | `'meeting'` |
| `relatedEntityId` | `meetingId` | `meetingId` |
| `recipientScope` | `'user_list'` | `'user_list'` |
| `recipientUserIdsJson` | `[hostId]` | `[hostId]` |
| `payloadJson` | Xem spec.md §6.3 Branch A | Xem spec.md §6.3 Branch B |
| `deliveryStatus` | `NotificationDeliveryStatus.SENT` | `NotificationDeliveryStatus.SENT` |
| `sentAt` | `now()` | `now()` |

---

## 5. API / Contract Plan

**Không có HTTP endpoint mới.** UC-IMM-13 là internal BullMQ job processor.

### BullMQ Job Contract

| Field | Giá trị |
|---|---|
| **Queue** | `QUEUE_SCHEDULER` (env default: `'scheduler'`) |
| **Job name** | `'meeting-time-warning'` |
| **Job payload** | `{ meetingId: string, warningScheduledAt: string (ISO-8601), endTime: string (ISO-8601) }` |
| **jobId** | `meeting-time-warning:{meetingId}` — dedupe từ UC-IMM-12 |
| **Processor** | `MeetingWarningProcessor` trong `live-meeting` module |
| **Handler method** | `@Process('meeting-time-warning')` hoặc equivalent |

> **Lưu ý về `endTime` trong payload**: Job payload chứa `endTime` là snapshot từ lúc UC-IMM-12 enqueue. `MeetingWarningService` phải đọc lại `meetings.end_time` mới nhất từ DB khi xử lý — vì meeting có thể đã được extend sau khi job enqueue.

### WebSocket Event Contract

| Field | Giá trị |
|---|---|
| **Event name** | `meeting.time.warning` |
| **Room** | `meeting:{meetingId}` (broadcast toàn meeting room) |
| **Host payload** | `{ meetingId, warningType, warningLevel, remainingMinutes, extensionAllowed, disableExtensionReason?, nextBooking?, endTime, timestamp }` |
| **Participant/Room Display payload** | `{ meetingId, warningType, remainingMinutes, endTime, timestamp }` |

> **Cách tách payload WebSocket cho Host**: Do `WebsocketService.emitToRoom()` broadcast đến toàn bộ meeting room, cần emit 2 lần với payload khác nhau:
> 1. `emitToUser(hostId, 'meeting.time.warning', hostPayload)` — chỉ đến Host user room.
> 2. `emitToRoom('meeting:{meetingId}', 'meeting.time.warning', participantPayload)` — broadcast meeting room (nhận bởi tất cả participants + room display; Host cũng nhận nhưng cần frontend filter).
>
> **Hoặc cách alternative**: Emit riêng cho Host qua `user:{hostId}` room (full payload), và broadcast meeting room với safe payload. Frontend Host subscribe cả 2 rooms và ưu tiên user-room payload.

---

## 6. Authorization Plan

**Không có authorization HTTP** — UC-IMM-13 là internal BullMQ processor.

Bảo vệ duy nhất (internal guards):

| Guard | Layer | Hành động khi fail |
|---|---|---|
| Meeting tồn tại | `MeetingWarningService.processWarningJob()` | ACK job, log ERROR, no notification |
| `meeting.status = in_progress` | `MeetingWarningService.processWarningJob()` | ACK job, log WARN, no notification |
| Idempotency: `warning_sent` event chưa tồn tại | `MeetingWarningService.processWarningJob()` | ACK job, log INFO, no notification |
| Host resolve không được null (best-effort) | `MeetingWarningService.resolveHost()` | ACK job, log WARN, skip notification |
| Queue isolation | BullMQ worker chỉ xử lý jobs từ `QUEUE_SCHEDULER` | BullMQ xử lý tự động |

---

## 7. Business Logic Plan

### 7.1 Method chính: `MeetingWarningService.processWarningJob(jobPayload)`

```
INPUT: { meetingId: string, warningScheduledAt: string, endTime: string }

STEP 1 — Guard: Tìm meeting theo meetingId.
   Nếu không tồn tại → log ERROR + return { skipped: true, reason: 'meeting_not_found' }

STEP 2 — Guard: Kiểm tra meeting.status = in_progress.
   Nếu không → log WARN + return { skipped: true, reason: 'meeting_not_in_progress' }

STEP 3 — Idempotency check: Query meeting_events với meeting_id = meetingId
   AND event_type = WARNING_SENT.
   Nếu đã tồn tại → log INFO + return { skipped: true, reason: 'already_sent' }

STEP 4 — Tính remainingMinutes:
   raw = floor((meeting.end_time.getTime() - Date.now()) / 60_000)
   remainingMinutes = Math.max(0, raw)
   Nếu raw < 0 → log WARN '[late-job] meetingId={X}, delay={abs(raw)}min'

STEP 5 — Đọc conflictBufferMinutes:
   Query system_configs với config_key = 'meeting_warning_conflict_buffer_minutes'
   Parse sang integer không âm. Nếu lỗi hoặc không có → default 0, log WARN.

STEP 6 — Resolve Host:
   Thử meeting.host_id → nếu null hoặc undefined:
     fallback: query meeting_participants WHERE participant_role = 'host', meeting_id = meetingId, LIMIT 1
   Nếu vẫn null → log WARN + return { skipped: true, reason: 'host_not_found' }

STEP 7 — Conflict detection:
   Nếu meeting.room_id = null → Branch A (không query room_bookings)
   Ngược lại: query room_bookings WHERE:
     room_id = meeting.room_id
     AND meeting_id != meetingId (loại trừ booking của chính meeting hiện tại)
     AND reserved_start_time >= meeting.end_time (Tham số: meeting.end_time)
     AND status IN ('pending', 'approved', 'active')
     ORDER BY reserved_start_time ASC LIMIT 1
   
   Nếu query thất bại → ERR-003: log ERROR, fallback Branch A, tiếp tục.
   Nếu có kết quả: kiểm tra nextBooking.reserved_start_time <= meeting.end_time + conflictBufferMinutes (phút → ms).
     True → Branch B (conflict), nextBooking = record tìm được.
     False → Branch A (no conflict).
   Không có kết quả → Branch A.

STEP 8 — Xác định warningLevel:
   Branch A + remainingMinutes > 0 → warningLevel = 'standard'
   Branch A + remainingMinutes = 0 → warningLevel = 'overdue'
   Branch B + remainingMinutes > 0 → warningLevel = 'strict'
   Branch B + remainingMinutes = 0 → warningLevel = 'urgent'

STEP 9 — Build notification payload:
   Branch A → buildBranchAPayload(meeting, remainingMinutes, warningLevel, hostId)
   Branch B → buildBranchBPayload(meeting, remainingMinutes, warningLevel, hostId, nextBooking)

STEP 10 — Tạo notifications record:
   INSERT vào notifications qua DataSource.getRepository(NotificationEntity)
   Nếu thất bại → ERR-005: log ERROR, update background_jobs.status = failed, NACK (throw error)

STEP 11 — Push WebSocket (non-critical):
   try:
     emitToUser(hostId, 'meeting.time.warning', hostWsPayload)
     emitToRoom('meeting:{meetingId}', 'meeting.time.warning', safeWsPayload)
   catch → ERR-007: log WARN, tiếp tục

STEP 12 — Update background_jobs (best-effort):
   Query background_jobs: related_entity_id = meetingId AND job_type = MEETING_TIME_WARNING
   Nếu tìm thấy → UPDATE status = completed, completed_at = now(), output_json = { notificationId, warningType, remainingMinutes }
   Nếu không tìm thấy → log WARN, tiếp tục
   Nếu update thất bại → ERR-008: log ERROR, tiếp tục (non-critical)

STEP 13 — Ghi meeting_events (best-effort):
   INSERT meeting_events:
     meeting_id = meetingId, event_type = WARNING_SENT, source_type = scheduler,
     actor_user_id = null,
     description = "Time warning sent: {warningType}, {remainingMinutes} min remaining"
     metadata_json = { warningType, warningLevel, remainingMinutes, notificationId,
                       extensionAllowed, conflictBufferMinutes, conflictBookingId? }
   Nếu thất bại → ERR-009: log ERROR, tiếp tục (non-critical)

STEP 14 — Log INFO tổng kết:
   '[processWarningJob] DONE — meetingId={X}, branch={A|B}, warningLevel={Y},
    remainingMinutes={Z}, notificationId={W}'

RETURN { skipped: false, branch: 'A'|'B', warningLevel, notificationId, remainingMinutes }
```

### 7.2 Helper: `resolveHost(meeting, meetingId): Promise<string | null>`

```
1. Nếu meeting.host_id != null → return meeting.host_id
2. Query: meeting_participants WHERE meeting_id = meetingId AND participant_role = 'host' LIMIT 1
3. Nếu tìm thấy → return participant.user_id
4. Nếu không → return null
```

### 7.3 Helper: `detectConflict(roomId, meetingEndTime, meetingId, bufferMinutes): Promise<RoomBookingEntity | null>`

```
1. Query room_bookings:
   WHERE room_id = roomId
   AND meeting_id != meetingId
   AND reserved_start_time >= meetingEndTime
   AND status IN ('pending', 'approved', 'active')
   ORDER BY reserved_start_time ASC LIMIT 1
2. Nếu không có record → return null (no conflict)
3. Nếu có record:
   bufferMs = bufferMinutes * 60_000
   conflictThreshold = new Date(meetingEndTime.getTime() + bufferMs)
   Nếu nextBooking.reserved_start_time <= conflictThreshold → return nextBooking
   Ngược lại → return null (within buffer, but outside window)
4. Catch → throw error (caller sẽ catch và fallback Branch A)
```

### 7.4 Helper: `readConflictBufferConfig(): Promise<number>`

```
1. Query system_configs WHERE config_key = 'meeting_warning_conflict_buffer_minutes'
2. Parse config_value thành integer không âm (parseInt)
3. Nếu không có hoặc parse thất bại hoặc âm → return 0 + log WARN
4. return giá trị đã parse
```

### 7.5 Helper: `buildNotificationPayload(branch, meeting, remainingMinutes, warningLevel, hostId, nextBooking?)`

```
Branch A:
  type: MEETING_TIME_WARNING, channel: IN_APP, priority: NORMAL
  subject: "Cuộc họp sắp kết thúc — còn {N} phút" (nếu N=0: "Cuộc họp đã quá giờ kết thúc")
  payload_json.extensionAllowed = true
  payload_json.cta = { type: 'request_extension', ... }
  payload_json.warningLevel = 'standard' | 'overdue'

Branch B:
  type: MEETING_TIME_CONFLICT_WARNING, channel: IN_APP, priority: HIGH
  subject: "Cảnh báo: Phòng họp sắp bị xung đột — còn {N} phút" (nếu N=0: "Cuộc họp đã quá giờ và có xung đột")
  payload_json.extensionAllowed = false
  payload_json.disableExtensionReason = 'Phòng đã có lịch cuộc họp kế tiếp. Không thể gia hạn.'
  payload_json.nextBooking = { bookingId, reservedStartTime }
  payload_json.cta = null
  payload_json.warningLevel = 'strict' | 'urgent'
```

### 7.6 BullMQ Processor: `MeetingWarningProcessor`

```typescript
// Pattern sử dụng @Processor/@Process từ @nestjs/bullmq
@Processor(QUEUE_SCHEDULER_NAME) // queue token constant
export class MeetingWarningProcessor extends WorkerHost {

  @Process('meeting-time-warning')
  async handleMeetingTimeWarning(job: Job<WarningJobPayload>): Promise<void> {
    const result = await this.meetingWarningService.processWarningJob(job.data);
    if (!result.skipped) {
      // job completed normally
    }
    // nếu service throw → BullMQ tự retry theo job options
  }
}
```

> **Lưu ý**: `MeetingWarningProcessor` inject `QUEUE_SCHEDULER` queue token để đăng ký đúng queue. Cần dùng `BullModule.registerQueue` token name `'QUEUE_SCHEDULER_NAME'` (đã đăng ký trong `QueueModule`).

---

## 8. Validation Plan

UC-IMM-13 không có HTTP input validation. Validation là guard checks nội bộ trong `MeetingWarningService`:

| Guard Check | Layer | TypeORM Query | Hành động khi fail |
|---|---|---|---|
| Meeting tồn tại | `processWarningJob` step 1 | `findOne({ where: { id: meetingId } })` | ACK + log ERROR |
| `meeting.status = in_progress` | `processWarningJob` step 2 | field check sau findOne | ACK + log WARN |
| Idempotency: `warning_sent` chưa tồn tại | `processWarningJob` step 3 | `findOne({ where: { meetingId, eventType: 'warning_sent' } })` | ACK + log INFO |
| `meeting.end_time != null` | `processWarningJob` step 4 | field check | ACK + log WARN |
| `meeting.room_id` nullable | `processWarningJob` step 7 | field check | Branch A (no room = no conflict) |
| `conflictBufferMinutes` >= 0 integer | `readConflictBufferConfig` | parseInt validation | default 0 + log WARN |
| Host resolve non-null | `resolveHost` | DB query với fallback | ACK + log WARN nếu null |
| Conflict query result | `detectConflict` | TypeORM query | Throw → caller catches → fallback Branch A |
| `remainingMinutes` non-negative | `processWarningJob` step 4 | Math.max(0, raw) | Clamp + log WARN |

---

## 9. Error Handling Plan

### Error constants mới (bổ sung vào `meeting-warning-error.constant.ts`)

```typescript
// Thêm vào MEETING_WARNING_ERRORS object hiện có:
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

### Exception policy

| Error | BullMQ Job Outcome | `background_jobs.status` | `meeting_events` | Log Level |
|---|---|---|---|---|
| Meeting không tồn tại (ERR-001) | ACK (no retry) | Không thay đổi | Không tạo | ERROR |
| Meeting không `in_progress` (ERR-002) | ACK (no retry) | Không thay đổi | Không tạo | WARN |
| Idempotency: đã gửi (FR-033) | ACK (no retry) | Không thay đổi | Không tạo | INFO |
| Host không tìm được (FR-034) | ACK (no retry) | Không thay đổi | Không tạo | WARN |
| Conflict query DB lỗi (ERR-003) | Tiếp tục → Branch A | `completed` (sau xử lý) | Tạo bình thường | ERROR |
| `remainingMinutes < 0` (ERR-004b) | Tiếp tục → clamp=0 | `completed` (sau xử lý) | Tạo bình thường | WARN |
| Config buffer invalid (ERR-004c) | Tiếp tục → default=0 | `completed` (sau xử lý) | Tạo bình thường | WARN |
| Notification tạo thất bại (ERR-005) | **NACK → BullMQ retry** | `failed` | Không tạo | ERROR |
| WebSocket push thất bại (ERR-007) | ACK | `completed` | Tạo bình thường | WARN |
| `background_jobs` update thất bại (ERR-008) | ACK | Không thay đổi (known inconsistency) | Tạo bình thường | ERROR |
| `meeting_events` tạo thất bại (ERR-009) | ACK | `completed` | Không tạo | ERROR |

### Transaction boundary

**Không có global transaction cho UC-IMM-13.** Writes là independent operations — best-effort:

| Write | Transaction scope | Failure behavior |
|---|---|---|
| `notifications` INSERT | Không (standalone) | NACK → BullMQ retry toàn bộ job |
| `meeting_events` INSERT | Không | log ERROR + continue |
| `background_jobs` UPDATE | Không | log ERROR + continue |
| WebSocket push | — (in-memory) | log WARN + continue |

> **Lý do không dùng transaction**: Notification là write quan trọng nhất. Nếu notification thành công nhưng `meeting_events` thất bại → BullMQ retry sẽ bị chặn bởi idempotency guard (bước 3 check `warning_sent` event — chưa tồn tại). Kết quả là retry an toàn sẽ tạo lại notification. Tuy nhiên nếu cả `notifications` và `meeting_events` đều thất bại trong cùng một retry → notification duplicate có thể xảy ra nếu BullMQ retry. Đây là **known limitation** với mức độ rủi ro thấp.

---

## 10. Testing Strategy

### Unit Tests — `live-meeting-warning.service.spec.ts`

> File test đã tồn tại tại `src/modules/live-meeting/tests/live-meeting-warning.service.spec.ts`. Thêm test suites cho UC-IMM-13.

#### Suite A: `processWarningJob()` — Guard & Idempotency

| Test ID | AC / FR / Scenario | Mô tả |
|---|---|---|
| T-P01 | FR-017, ERR-001 | Meeting không tồn tại → return skipped, không tạo notification |
| T-P02 | FR-018, ERR-002, AC-003 | Meeting.status = completed → skip + ACK, log WARN |
| T-P03 | FR-018, ERR-002 | Meeting.status = cancelled → skip + ACK |
| T-P04 | FR-033, NFR-007, AC-008 | `meeting_events.warning_sent` đã tồn tại → idempotency skip |
| T-P05 | FR-034 | `meetings.host_id = null`, `meeting_participants` không có role=host → skip |

#### Suite B: `processWarningJob()` — remainingMinutes & Late Job

| Test ID | AC / FR / Scenario | Mô tả |
|---|---|---|
| T-P06 | FR-002, BR-11 | `end_time - now() = 600s` → `remainingMinutes = 10` |
| T-P07 | FR-031, BR-13, AC-009 | `end_time - now() = -300s` (late job) → `remainingMinutes = 0`, log WARN |
| T-P08 | FR-031 | `end_time - now() = 0` → `remainingMinutes = 0` (biên) |

#### Suite C: `detectConflict()` — Conflict Detection

| Test ID | AC / FR / Scenario | Mô tả |
|---|---|---|
| T-P09 | FR-010, AC-001 | `room_id` có nhưng không có booking kế tiếp → return null (Branch A) |
| T-P10 | FR-011, AC-002 | Có booking kế tiếp `reserved_start_time = meeting.end_time`, buffer=0 → Branch B |
| T-P11 | FR-003, AC-011 | Buffer=5min, booking `reserved_start_time = end_time + 3min` → Branch B (trong buffer) |
| T-P12 | FR-003, AC-011 | Buffer=5min, booking `reserved_start_time = end_time + 6min` → Branch A (ngoài buffer) |
| T-P13 | FR-015, AC-004 | `meeting.room_id = null` → Branch A, không query room_bookings |
| T-P14 | FR-019, ERR-003, AC-005 | DB query throw exception → catch, fallback Branch A, log ERROR |
| T-P15 | FR-003 | Booking `status = cancelled` → không tính là conflict |

#### Suite D: `processWarningJob()` — warningLevel Matrix

| Test ID | AC / FR / Scenario | Mô tả |
|---|---|---|
| T-P16 | FR-010, AC-001 | Branch A + `remainingMinutes = 10` → `warningLevel = standard` |
| T-P17 | FR-032, BR-14, AC-009 | Branch A + `remainingMinutes = 0` → `warningLevel = overdue` |
| T-P18 | FR-011, AC-002 | Branch B + `remainingMinutes = 10` → `warningLevel = strict` |
| T-P19 | FR-032, BR-15, AC-009 | Branch B + `remainingMinutes = 0` → `warningLevel = urgent` |

#### Suite E: `processWarningJob()` — Notification Payload

| Test ID | AC / FR / Scenario | Mô tả |
|---|---|---|
| T-P20 | FR-010, AC-001 | Branch A: `extensionAllowed = true`, `cta.type = request_extension`, `conflictWithNextBooking = false` |
| T-P21 | FR-011, AC-002 | Branch B: `extensionAllowed = false`, `cta = null`, `conflictWithNextBooking = true`, `nextBooking` có `reservedStartTime` |
| T-P22 | FR-011 | Branch B: `priority = high`; Branch A: `priority = normal` |
| T-P23 | FR-026 | `deliveryStatus = sent`, `sentAt != null` |

#### Suite F: `processWarningJob()` — WebSocket Push

| Test ID | AC / FR / Scenario | Mô tả |
|---|---|---|
| T-P24 | FR-012, BR-17, AC-010 | Host nhận `emitToUser(hostId, ...)` với `extensionAllowed` field |
| T-P25 | FR-012, BR-17, AC-010 | Meeting room nhận `emitToRoom(...)` với safe payload không có `extensionAllowed` |
| T-P26 | FR-021, ERR-007, AC-007 | WebSocket throw exception → log WARN, `background_jobs.status = completed`, `meeting_events` tạo bình thường |

#### Suite G: `processWarningJob()` — Post-notification Writes

| Test ID | AC / FR / Scenario | Mô tả |
|---|---|---|
| T-P27 | FR-007, FR-009 | `background_jobs.status = completed`, `completed_at` được set |
| T-P28 | FR-008, FR-029 | `meeting_events.event_type = warning_sent`, `source_type = scheduler`, `actor_user_id = null` |
| T-P29 | FR-027 | `meeting_events.metadata_json` chứa `warningType`, `warningLevel`, `remainingMinutes`, `notificationId`, `extensionAllowed`, `conflictBufferMinutes` |
| T-P30 | ERR-005, AC-006 | `notifications` INSERT thất bại → throw error (NACK), `background_jobs.status = failed`, không có `meeting_events` |
| T-P31 | ERR-008 | `background_jobs` UPDATE thất bại → log ERROR + continue (non-critical) |
| T-P32 | ERR-009 | `meeting_events` INSERT thất bại → log ERROR + continue (non-critical) |

#### Suite H: `resolveHost()` — Host Resolution

| Test ID | AC / FR / Scenario | Mô tả |
|---|---|---|
| T-P33 | FR-034 | `meeting.host_id != null` → return `host_id` trực tiếp |
| T-P34 | FR-034 | `meeting.host_id = null`, tìm `participant_role = 'host'` → return `participant.user_id` |
| T-P35 | FR-034 | Cả hai đều null → return null |

#### Suite I: `readConflictBufferConfig()` — Config

| Test ID | AC / FR / Scenario | Mô tả |
|---|---|---|
| T-P36 | FR-035 | Key tồn tại, value = '5' → return 5 |
| T-P37 | FR-035 | Key không tồn tại → return 0 + log WARN |
| T-P38 | FR-035, ERR-004c | Value = 'abc' (không parse được) → return 0 + log WARN |
| T-P39 | FR-035, ERR-004c | Value = '-3' (số âm) → return 0 + log WARN |

### Migration Tests

- Confirm `NotificationType.MEETING_TIME_WARNING` và `MEETING_TIME_CONFLICT_WARNING` có thể lưu vào `notifications.notification_type` column (VARCHAR(60)).
- Verify seed `meeting_warning_conflict_buffer_minutes = '0'` tồn tại sau chạy seed.

---

## 11. Implementation Phases

### Phase 1: Enum & Seed

| Task ID | File | Mô tả |
|---|---|---|
| T001 | `src/modules/notifications/entities/notification.entity.ts` | Thêm `MEETING_TIME_WARNING = 'meeting_time_warning'` và `MEETING_TIME_CONFLICT_WARNING = 'meeting_time_conflict_warning'` vào `NotificationType` enum |
| T002 | `src/database/seeds/20260619000002-SeedMeetingWarningConflictConfig.ts` | Tạo seed file: INSERT ON CONFLICT DO NOTHING cho `meeting_warning_conflict_buffer_minutes = '0'` vào `system_configs` |

> **Không có TypeORM migration** cho Phase 1. Column `notification_type` là VARCHAR(60) — chỉ TypeScript enum thay đổi.

### Phase 2: Constants & Types

| Task ID | File | Mô tả |
|---|---|---|
| T003 | `src/modules/live-meeting/constants/meeting-warning-error.constant.ts` | Bổ sung 10 error codes UC-IMM-13 vào `MEETING_WARNING_ERRORS` object hiện có |
| T004 | `src/modules/live-meeting/types/warning-processor-result.type.ts` | Tạo `WarningProcessorResult` interface: `{ skipped: boolean; reason?: string; branch?: 'A'|'B'; warningLevel?: string; notificationId?: string; remainingMinutes?: number }` |

### Phase 3: Core Service — Helpers

| Task ID | File | Mô tả |
|---|---|---|
| T005 | `src/modules/live-meeting/services/meeting-warning.service.ts` | Tạo file mới. Thêm `private readConflictBufferConfig(): Promise<number>` |
| T006 | `src/modules/live-meeting/services/meeting-warning.service.ts` | Thêm `private resolveHost(meeting, meetingId): Promise<string \| null>` |
| T007 | `src/modules/live-meeting/services/meeting-warning.service.ts` | Thêm `private detectConflict(roomId, meetingEndTime, meetingId, bufferMinutes): Promise<RoomBookingEntity \| null>` |
| T008 | `src/modules/live-meeting/services/meeting-warning.service.ts` | Thêm `private buildNotificationPayload(branch, meeting, remainingMinutes, warningLevel, hostId, nextBooking?)` |
| T009 | `src/modules/live-meeting/services/meeting-warning.service.ts` | Thêm `private buildHostWsPayload(...)` và `private buildParticipantWsPayload(...)` |

### Phase 4: Core Service — Main Workflow

| Task ID | File | Mô tả |
|---|---|---|
| T010 | `src/modules/live-meeting/services/meeting-warning.service.ts` | Implement `processWarningJob(jobPayload): Promise<WarningProcessorResult>` — 13 bước workflow theo FR-023 |

### Phase 5: BullMQ Processor

| Task ID | File | Mô tả |
|---|---|---|
| T011 | `src/modules/live-meeting/processors/meeting-warning.processor.ts` | Tạo `MeetingWarningProcessor` class với `@Processor` decorator, inject `MeetingWarningService`, implement handler cho job name `'meeting-time-warning'` |

### Phase 6: Module Registration

| Task ID | File | Mô tả |
|---|---|---|
| T012 | `src/modules/live-meeting/live-meeting.module.ts` | Đăng ký `MeetingWarningProcessor` và `MeetingWarningService` vào `providers[]`. Import `BullModule.registerQueue` với token `QUEUE_SCHEDULER_NAME` nếu chưa có |

### Phase 7: Testing

| Task ID | File | Mô tả |
|---|---|---|
| T013 | `src/modules/live-meeting/tests/live-meeting-warning.service.spec.ts` | Thêm test suites A+B — Guard, Idempotency, remainingMinutes (T-P01 → T-P08) |
| T014 | `src/modules/live-meeting/tests/live-meeting-warning.service.spec.ts` | Thêm test suite C — Conflict Detection (T-P09 → T-P15) |
| T015 | `src/modules/live-meeting/tests/live-meeting-warning.service.spec.ts` | Thêm test suite D+E — warningLevel matrix + Notification Payload (T-P16 → T-P23) |
| T016 | `src/modules/live-meeting/tests/live-meeting-warning.service.spec.ts` | Thêm test suite F+G — WebSocket Push + Post-notification Writes (T-P24 → T-P32) |
| T017 | `src/modules/live-meeting/tests/live-meeting-warning.service.spec.ts` | Thêm test suites H+I — Host Resolution + Config (T-P33 → T-P39) |

---

## 12. Risks & Mitigations

| Risk | Likelihood | Impact | Mitigation |
|---|---|---|---|
| BullMQ Processor không đăng ký đúng queue token dẫn đến job không được consume | Medium | High (feature không hoạt động) | T011+T012 phải dùng đúng queue token constant từ `QueueModule`; kiểm tra local với Redis instance thật |
| `notifications.notification_type` VARCHAR(60) thực tế không chứa được string mới | Low | Medium | Confirm bằng DB inspection: `SELECT character_maximum_length FROM information_schema.columns WHERE column_name = 'notification_type'`. Nếu < 30 chars cần migration. |
| Race condition: UC-IMM-05 `endMeeting()` chạy ngay lúc UC-IMM-13 đang xử lý | Low | Low (cảnh báo được gửi cho meeting đã ended) | Guard check step 2 ở đầu job. Nếu meeting.status đã thành completed giữa chừng → notification đã gửi là acceptable behavior (warning trước moment end) |
| Idempotency gap: `notifications` INSERT thành công nhưng `meeting_events` INSERT thất bại → BullMQ retry tạo duplicate notification | Low | Medium | Clarify: nếu BullMQ retry do ACK timeout, không phải do notification failure. Idempotency guard chỉ work nếu `meeting_events.warning_sent` tồn tại. Consider: check `notifications` record thay vì chỉ check `meeting_events` |
| WebSocket payload split không đủ — Host cũng ở trong meeting room và nhận safe payload thay vì full payload | Medium | Medium | Implement: Host nhận qua `user:{hostId}` room (full payload); Participant nhận qua `meeting:{meetingId}` room (safe payload). Frontend cần ưu tiên `user:{hostId}` event |
| `MeetingWarningService` inject `DataSource` + `WebsocketService` nhưng `LiveMeetingModule` chưa đăng ký đủ providers | Medium | Blocking | T012 phải đảm bảo module imports: `AdministrationModule` (@Global đã ok), `WebsocketModule` (đã có trong module imports), `TypeOrmModule.forFeature(entities)` nếu cần |
| Seed `20260619000002` chạy trước seed `20260619000001` (thứ tự seed) | Low | Low | Seed UC-IMM-13 độc lập với seed UC-IMM-12 (khác key). Cả hai INSERT ON CONFLICT DO NOTHING → an toàn run lại |
| BullMQ default `attempts: 3` — 3 lần retry `notifications` INSERT failure → 3 bản ghi `background_jobs.status = failed` | Low | Low | Chỉ 1 `background_jobs` record per meeting (query by `related_entity_id` + `job_type`). Mỗi retry UPDATE cùng record → idempotent |

---

## 13. Acceptance Criteria Traceability

| AC ID | Mô tả | FR Coverage | Task IDs | Verification |
|---|---|---|---|---|
| **AC-001** | Branch A happy path: no conflict, `extensionAllowed=true`, notification_type=`meeting_time_warning`, `warningLevel=standard`, WebSocket pushed, `background_jobs=completed`, `meeting_events=warning_sent` | FR-003, FR-010, FR-006, FR-007, FR-008 | T005, T007, T008, T010, T011 | Unit tests T-P09, T-P16, T-P20, T-P24, T-P27, T-P28 |
| **AC-002** | Branch B happy path: có conflict, `extensionAllowed=false`, notification_type=`meeting_time_conflict_warning`, `warningLevel=strict`, Host WS có control flags, Participant WS an toàn | FR-003, FR-011, FR-006, FR-007, FR-008 | T007, T008, T009, T010, T011 | Unit tests T-P10, T-P18, T-P21, T-P24, T-P25, T-P27 |
| **AC-003** | Guard: meeting đã `completed` → skip, không tạo notification, log WARN, ACK | FR-018, ERR-002 | T010 | Unit test T-P02 |
| **AC-004** | Meeting online (`room_id=null`) → Branch A không query room_bookings | FR-015 | T007, T010 | Unit test T-P13 |
| **AC-005** | Degraded mode: conflict query DB lỗi → fallback Branch A, log ERROR, notification vẫn gửi | FR-019, ERR-003 | T007, T010 | Unit test T-P14 |
| **AC-006** | Notification tạo thất bại → `background_jobs=failed`, không tạo `meeting_events`, job NACK (retry) | FR-020, ERR-005 | T010 | Unit test T-P30 |
| **AC-007** | WebSocket push thất bại → log WARN, `background_jobs=completed`, `meeting_events` vẫn tạo, notification không rollback | FR-021, ERR-007 | T010 | Unit test T-P26 |
| **AC-008** | Idempotency: `warning_sent` event đã có → skip, không tạo duplicate | NFR-007, FR-033 | T010 | Unit test T-P04 |
| **AC-009** | Late job: `remainingMinutes` tính ra -5 → clamp=0, `warningLevel=urgent` (Branch B) hoặc `overdue` (Branch A), log WARN | FR-031, FR-032, BR-13, BR-14, BR-15 | T010 | Unit tests T-P07, T-P17, T-P19 |
| **AC-010** | WebSocket payload split: Host nhận `extensionAllowed`+`nextBooking`; Participant không nhận control flags | FR-012, BR-17 | T009, T010, T011 | Unit tests T-P24, T-P25 |
| **AC-011** | Conflict buffer: buffer=5min, booking tại end+3min → Branch B; booking tại end+6min → Branch A | FR-003, FR-035, BR-03 | T007, T010 | Unit tests T-P11, T-P12 |

---

## Appendix: File Inventory

### Files to CREATE

| File | Phase | Mô tả |
|---|---|---|
| `src/database/seeds/20260619000002-SeedMeetingWarningConflictConfig.ts` | P1 / T002 | Seed: `meeting_warning_conflict_buffer_minutes = '0'` |
| `src/modules/live-meeting/types/warning-processor-result.type.ts` | P2 / T004 | `WarningProcessorResult` interface |
| `src/modules/live-meeting/services/meeting-warning.service.ts` | P3-P4 / T005-T010 | Business logic service UC-IMM-13 |
| `src/modules/live-meeting/processors/meeting-warning.processor.ts` | P5 / T011 | BullMQ job processor |

### Files to MODIFY

| File | Phase | Thay đổi |
|---|---|---|
| `src/modules/notifications/entities/notification.entity.ts` | P1 / T001 | Thêm `MEETING_TIME_WARNING`, `MEETING_TIME_CONFLICT_WARNING` vào `NotificationType` |
| `src/modules/live-meeting/constants/meeting-warning-error.constant.ts` | P2 / T003 | Bổ sung 10 error codes UC-IMM-13 |
| `src/modules/live-meeting/live-meeting.module.ts` | P6 / T012 | Đăng ký `MeetingWarningProcessor`, `MeetingWarningService` vào `providers[]`; đảm bảo BullMQ queue token |
| `src/modules/live-meeting/tests/live-meeting-warning.service.spec.ts` | P7 / T013-T017 | Thêm 9 test suites (39 test cases T-P01 → T-P39) |
