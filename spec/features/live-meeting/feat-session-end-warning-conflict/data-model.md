# Data Model — Gửi cảnh báo kết thúc phiên họp và xung đột lịch (UC-IMM-13)

## 📝 CHANGELOG & REVISION HISTORY

| Ngày cập nhật | Tóm tắt thay đổi | Các dòng thay đổi |
| :--- | :--- | :--- |
| 2026-06-19 | Tạo data-model lần đầu cho UC-IMM-13 | Toàn bộ file |

---

## Tổng quan

UC-IMM-13 **không tạo bảng mới**. Toàn bộ thay đổi là:
- 2 TypeScript enum values mới trong `NotificationType` (không cần DB migration — column là VARCHAR(60)).
- READ từ: `meetings`, `meeting_participants`, `room_bookings`, `system_configs`, `meeting_events`.
- INSERT vào: `notifications`.
- INSERT vào: `meeting_events` (sau khi notification thành công).
- UPDATE vào: `background_jobs`.

---

## Entities Impacted

### 1. `notifications` — INSERT

**Vai trò**: Lưu bản ghi cảnh báo gửi đến Host của meeting.

#### Branch A — Standard Warning (`meeting_time_warning`)

`warningLevel = standard` khi `remainingMinutes > 0`. `warningLevel = overdue` khi `remainingMinutes = 0`.

| Column | Value |
|---|---|
| `id` | `gen_random_uuid()` |
| `notification_type` | `meeting_time_warning` |
| `channel` | `in_app` |
| `priority` | `normal` |
| `subject` | `"Cuộc họp sắp kết thúc — còn {N} phút"` (N=0: `"Cuộc họp đã quá giờ kết thúc"`) |
| `content` | Message Branch A tương ứng (xem spec.md §6.3) |
| `related_entity_type` | `meeting` |
| `related_entity_id` | `meetingId` |
| `recipient_scope` | `user_list` |
| `recipient_user_ids_json` | `["{hostId}"]` |
| `priority` | `NotificationPriority.NORMAL` |
| `payload_json` | Object Branch A (xem §Payload schemas bên dưới) |
| `delivery_status` | `sent` |
| `sent_at` | `now()` |
| `created_by` | `null` (system/scheduler) |
| `sent_by` | `null` |

#### Branch B — Conflict Warning (`meeting_time_conflict_warning`)

`warningLevel = strict` khi `remainingMinutes > 0`. `warningLevel = urgent` khi `remainingMinutes = 0`.

| Column | Value |
|---|---|
| `id` | `gen_random_uuid()` |
| `notification_type` | `meeting_time_conflict_warning` |
| `channel` | `in_app` |
| `priority` | `high` |
| `subject` | `"Cảnh báo: Phòng họp sắp bị xung đột — còn {N} phút"` (N=0: `"Cuộc họp đã quá giờ và có xung đột phòng"`) |
| `content` | Message Branch B tương ứng (xem spec.md §6.3) |
| `related_entity_type` | `meeting` |
| `related_entity_id` | `meetingId` |
| `recipient_scope` | `user_list` |
| `recipient_user_ids_json` | `["{hostId}"]` |
| `priority` | `NotificationPriority.HIGH` |
| `payload_json` | Object Branch B (xem §Payload schemas bên dưới) |
| `delivery_status` | `sent` |
| `sent_at` | `now()` |
| `created_by` | `null` |
| `sent_by` | `null` |

**Entity reference**: `NotificationEntity`

---

### 2. `meeting_events` — INSERT

**Vai trò**: Timeline event ghi nhận warning đã được gửi — dùng cho idempotency guard trong BullMQ retry.

| Column | Value |
|---|---|
| `meeting_id` | `meetingId` |
| `event_type` | `warning_sent` |
| `event_time` | `now()` |
| `actor_user_id` | `null` (system scheduler) |
| `source_type` | `scheduler` |
| `description` | `"Time warning sent: {warningType}, {N} min remaining"` |
| `old_value_json` | `null` |
| `new_value_json` | `null` |
| `metadata_json` | Object — xem §Metadata schema bên dưới |

**Entity reference**: `MeetingEventEntity` — `MeetingEventType.WARNING_SENT` đã có sẵn.

---

### 3. `background_jobs` — UPDATE

**Vai trò**: Tracking trạng thái xử lý job UC-IMM-13.

> **Lưu ý**: Record `background_jobs` đã được INSERT bởi UC-IMM-12 khi enqueue. UC-IMM-13 chỉ UPDATE.

#### UPDATE khi xử lý thành công

| Column | Change | Value |
|---|---|---|
| `status` | UPDATE | `completed` |
| `completed_at` | UPDATE | `now()` |
| `output_json` | UPDATE | `{ "notificationId": "uuid", "warningType": "standard\|conflict", "remainingMinutes": N }` |

**Query tham chiếu:**
```sql
UPDATE background_jobs
SET status = 'completed',
    completed_at = now(),
    output_json = $1
WHERE related_entity_id = $2
  AND job_type = 'meeting_time_warning';
```

#### UPDATE khi notification tạo thất bại (NACK)

| Column | Change | Value |
|---|---|---|
| `status` | UPDATE | `failed` |
| `error_message` | UPDATE | Mô tả lỗi ngắn (max ~500 chars) |

**Không cập nhật `background_jobs`** trong các skip/guard cases (meeting not found, not in_progress, idempotency) — đây là ACK thành công, trạng thái job không thay đổi.

---

### 4. `meetings` — READ ONLY

**Vai trò**: Guard check, tính remainingMinutes, xác định room_id, lấy thông tin notification content.

| Column | Read | Mục đích |
|---|---|---|
| `id` | READ | Lookup |
| `status` | READ | Guard check: phải là `in_progress` |
| `end_time` | READ | Tính `remainingMinutes = max(0, floor((end_time - now()) / 60000))` |
| `room_id` | READ | Xác định có conflict detection hay không (null → Branch A) |
| `host_id` | READ | Resolve Host (primary source) |
| `title` | READ | Nội dung notification |

**Query tham chiếu:**
```sql
SELECT id, status, end_time, room_id, host_id, title
FROM meetings
WHERE id = $1
  AND deleted_at IS NULL;
```

---

### 5. `meeting_participants` — READ ONLY

**Vai trò**: Fallback resolve Host khi `meetings.host_id = null`.

| Column | Read | Mục đích |
|---|---|---|
| `meeting_id` | WHERE | Filter theo meeting hiện tại |
| `participant_role` | WHERE | Filter `= 'host'` |
| `user_id` | READ | Lấy userId của Host |

**Query tham chiếu:**
```sql
SELECT user_id
FROM meeting_participants
WHERE meeting_id = $1
  AND participant_role = 'host'
LIMIT 1;
```

> **Không filter theo `status`** (field này không tồn tại trong `meeting_participants`).
> **Không filter theo `attendance_status`** (trạng thái điểm danh runtime, không dùng để quyết định recipient).

---

### 6. `room_bookings` — READ ONLY

**Vai trò**: Conflict detection — tìm booking kế tiếp gần nhất của nhóm khác sau `meeting.end_time`.

| Column | Read | Mục đích |
|---|---|---|
| `id` | READ | Lưu vào `nextBooking.bookingId` trong payload |
| `room_id` | WHERE | Cùng phòng với meeting hiện tại |
| `meeting_id` | WHERE (!=) | Loại trừ booking của chính meeting đang xử lý |
| `reserved_start_time` | WHERE (>=), ORDER BY | `>= meeting.end_time`, sắp xếp ASC |
| `status` | WHERE (IN) | `IN ('pending', 'approved', 'active')` |

**Query tham chiếu:**
```sql
SELECT id, room_id, meeting_id, reserved_start_time, reserved_end_time, status
FROM room_bookings
WHERE room_id = $1
  AND meeting_id != $2
  AND reserved_start_time >= $3
  AND status IN ('pending', 'approved', 'active')
ORDER BY reserved_start_time ASC
LIMIT 1;
```

**TypeORM tương đương:**
```typescript
const nextBooking = await this.dataSource.getRepository(RoomBookingEntity).findOne({
  where: {
    roomId: meeting.roomId,
    status: In([RoomBookingStatus.PENDING, RoomBookingStatus.APPROVED, RoomBookingStatus.ACTIVE]),
  },
  order: { reservedStartTime: 'ASC' },
});
// Sau đó filter thủ công: nextBooking.meetingId !== meetingId
// Và compare: nextBooking.reservedStartTime <= meeting.end_time + bufferMs
```

> **Cột đúng là `reserved_start_time`** (không phải `reserved_start_at`). Xác nhận từ `RoomBookingEntity.reservedStartTime`.

---

### 7. `system_configs` — READ ONLY

**Vai trò**: Đọc `conflictBufferMinutes` trước bước conflict detection.

| Column | Read | Mục đích |
|---|---|---|
| `config_key` | WHERE | `= 'meeting_warning_conflict_buffer_minutes'` |
| `config_value` | READ | Parse thành integer không âm, fallback = 0 |

---

### 8. `meeting_events` — READ (idempotency check)

**Vai trò**: Kiểm tra xem `warning_sent` đã được ghi hay chưa trước khi tạo notification.

| Column | Read | Mục đích |
|---|---|---|
| `meeting_id` | WHERE | `= meetingId` |
| `event_type` | WHERE | `= 'warning_sent'` |

**Query tham chiếu:**
```sql
SELECT id
FROM meeting_events
WHERE meeting_id = $1
  AND event_type = 'warning_sent'
LIMIT 1;
```

---

## TypeORM Entity Changes Required

### 1. `NotificationType` — Thêm 2 enum values

**File**: `src/modules/notifications/entities/notification.entity.ts`

```typescript
export enum NotificationType {
  // ... existing 14 values ...
  MEETING_TIME_WARNING = 'meeting_time_warning',                 // UC-IMM-13 Branch A — THÊM MỚI
  MEETING_TIME_CONFLICT_WARNING = 'meeting_time_conflict_warning', // UC-IMM-13 Branch B — THÊM MỚI
}
```

> **KHÔNG cần DB migration**: Column `notification_type` là `VARCHAR(60)`, không phải PostgreSQL native ENUM.
> Xác nhận từ entity: `@Column({ name: 'notification_type', type: 'varchar', length: 60 })`.
> String value `'meeting_time_warning'` (22 chars) và `'meeting_time_conflict_warning'` (29 chars) đều < 60 chars ✅.

---

## Payload Schemas

### `notifications.payload_json` — Branch A

```json
{
  "type": "meeting_time_warning",
  "warningType": "standard",
  "warningLevel": "standard | overdue",
  "title": "Cuộc họp sắp kết thúc",
  "message": "Cuộc họp \"{meetingTitle}\" tại phòng \"{roomName}\" còn {N} phút. Phòng trống sau cuộc họp.",
  "meetingId": "uuid",
  "meetingTitle": "string",
  "roomId": "uuid | null",
  "roomName": "string | null",
  "endTime": "ISO-8601",
  "remainingMinutes": 10,
  "conflictWithNextBooking": false,
  "extensionAllowed": true,
  "disableExtensionReason": null,
  "cta": {
    "type": "request_extension",
    "label": "Yêu cầu gia hạn",
    "target": "/meetings/{meetingId}/extension-requests"
  }
}
```

> Khi `warningLevel = overdue`: `message` = `"Cuộc họp \"{meetingTitle}\" đã quá giờ kết thúc. Phòng trống sau cuộc họp."`

### `notifications.payload_json` — Branch B

```json
{
  "type": "meeting_time_conflict_warning",
  "warningType": "conflict",
  "warningLevel": "strict | urgent",
  "title": "Cảnh báo: Phòng họp có lịch kế tiếp",
  "message": "Cuộc họp \"{meetingTitle}\" tại phòng \"{roomName}\" còn {N} phút. Phòng đã có lịch cuộc họp tiếp theo lúc {nextBookingStartTime}. Không thể gia hạn.",
  "meetingId": "uuid",
  "meetingTitle": "string",
  "roomId": "uuid",
  "roomName": "string",
  "endTime": "ISO-8601",
  "remainingMinutes": 10,
  "conflictWithNextBooking": true,
  "extensionAllowed": false,
  "disableExtensionReason": "Phòng đã có lịch cuộc họp kế tiếp. Không thể gia hạn.",
  "nextBooking": {
    "bookingId": "uuid",
    "reservedStartTime": "ISO-8601",
    "meetingId": "uuid | null",
    "meetingTitle": "string | null"
  },
  "cta": null
}
```

> Khi `warningLevel = urgent`: `message` = `"Cuộc họp \"{meetingTitle}\" đã quá giờ kết thúc và phòng có lịch cuộc họp kế tiếp. Cần kết thúc ngay."`

### `meeting_events.metadata_json` — warning_sent

```json
{
  "warningType": "standard | conflict",
  "warningLevel": "standard | overdue | strict | urgent",
  "remainingMinutes": 10,
  "notificationId": "uuid",
  "extensionAllowed": true,
  "conflictBufferMinutes": 0,
  "conflictBookingId": "uuid | undefined"
}
```

### `background_jobs.output_json` — khi completed

```json
{
  "notificationId": "uuid",
  "warningType": "standard | conflict",
  "remainingMinutes": 10
}
```

---

## State Transitions

### Background Job Status (UC-IMM-12 → UC-IMM-13)

```
[scheduleWarningJob — UC-IMM-12]
    ↓ BullMQ enqueue
  SCHEDULED ──────────────────────────────> CANCELLED  (endMeeting / UC-IMM-05)
     │
     │ [warningScheduledAt reached — UC-IMM-13 fires]
     ↓
  RUNNING   (MeetingWarningProcessor handles)
     │
     ├──> COMPLETED  (notification sent, meeting_events written)
     └──> FAILED     (notification INSERT thất bại → BullMQ retry → tối đa 3 lần)
```

### Meeting Events (UC-IMM-13)

```
[processWarningJob called — job fired]
    ├── meeting not found       → ACK (no event)
    ├── meeting not in_progress → ACK (no event)
    ├── idempotency: warning_sent exists → ACK (no event)
    ├── host not found          → ACK (no event)
    └── processing OK           → INSERT meeting_events: warning_sent
```

---

## Data Constraints Summary

| Entity | Constraint | Type |
|---|---|---|
| `meetings` | `status = in_progress` khi job fired | Business (guard) |
| `meetings` | `end_time IS NOT NULL` | Business |
| `meetings` | `deleted_at IS NULL` | Soft-delete |
| `meeting_events` | Không tạo nếu notification INSERT thất bại | Business |
| `background_jobs` | Update (không insert) — record đã tạo bởi UC-IMM-12 | Business |
| `notifications` | `recipient_user_ids_json` phải có ít nhất 1 hostId | Business |
| `notifications.notification_type` | `VARCHAR(60)` — giá trị mới tối đa 29 chars | DB constraint ✅ |
| `room_bookings` | Loại trừ `status IN ('cancelled', 'released', 'completed')` | Business |
| `room_bookings` | Loại trừ booking của chính meeting hiện tại (`meeting_id != meetingId`) | Business (tránh self-conflict) |

---

## Migration Required

**Không có TypeORM migration cho UC-IMM-13.**

| Thay đổi | Migration cần? | Lý do |
|---|---|---|
| `NotificationType` enum thêm 2 values | ❌ Không | Column là `VARCHAR(60)`, không phải native ENUM |
| Seed `meeting_warning_conflict_buffer_minutes` | ❌ Không (là seed) | Chạy seed riêng, không phải migration |
| Không thêm bảng mới | ❌ Không | Scope OUT |

> So sánh với UC-IMM-12: UC-IMM-12 cần migration `20260619000001-AddWarningScheduledEventTypes.ts` vì `MeetingEventType` và `BackgroundJobType` dùng PostgreSQL native ENUM. UC-IMM-13 không cần vì chỉ thêm vào `NotificationType` là VARCHAR.

---

## Seed Required

**File mới**: `src/database/seeds/20260619000002-SeedMeetingWarningConflictConfig.ts`

```sql
INSERT INTO system_configs (config_key, config_value, description, is_public, created_at, updated_at)
VALUES (
  'meeting_warning_conflict_buffer_minutes',
  '0',
  'Buffer minutes để xác định xung đột booking: Branch B kích hoạt khi nextBooking.reserved_start_time <= meeting.end_time + buffer. Default = 0 (không có buffer).',
  false,
  now(),
  now()
)
ON CONFLICT (config_key) DO NOTHING;
```

---

## Redis / Cache

UC-IMM-13 không dùng Redis trực tiếp. BullMQ dùng Redis nội bộ (đã setup bởi `QueueModule`) để quản lý delayed jobs. UC-IMM-13 chỉ consume job khi fired.
