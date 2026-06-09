# Data Model: UC-MM-02 — Cập nhật thời gian họp

## CHANGELOG & REVISION HISTORY
| Ngày cập nhật | Tóm tắt thay đổi | Các dòng thay đổi |
| :--- | :--- | :--- |
| 2026-06-09 | Initial data model aligned with spec and DB v3.2 Compact | All |

---

## 1. Entities Impacted

### 1.1 `meetings` — UPDATE

| Field | Thao tác | Giá trị | Ghi chú |
|---|---|---|---|
| `start_time` | Cập nhật | `startTime` từ request | DTO validated |
| `end_time` | Cập nhật | `endTime` từ request | |
| `room_id` | Cập nhật (optional) | `newRoomId` nếu có, giữ nguyên nếu không | |
| `updated_by` | Cập nhật | User ID từ JWT | |
| `updated_at` | Cập nhật | `new Date()` | `@UpdateDateColumn` tự động |
| Các field khác | Giữ nguyên | title, description, status, ... | FR-004, BR-07 |

**Không thay đổi:** title, description, meeting_type, meeting_mode, priority, status (vẫn `scheduled`), organizer_id, host_id, expected_attendee_count, recurrence_rule_id, parent_meeting_id

### 1.2 `room_bookings` — UPDATE

| Field | Thao tác | Giá trị | Ghi chú |
|---|---|---|---|
| `room_id` | Cập nhật (optional) | `newRoomId` nếu có, giữ nguyên nếu không | |
| `reserved_start_time` | Cập nhật | `startTime` từ request | |
| `reserved_end_time` | Cập nhật | `endTime` từ request | |
| `booking_type` | Cập nhật (optional) | `'relocated'` nếu đổi phòng | `BookingType.RELOCATED` đã tồn tại |
| `updated_at` | Cập nhật | `new Date()` | |

**Tìm kiếm:** Active booking theo `meeting_id` với `status IN (PENDING, APPROVED, ACTIVE)`

**Edge case (FR-029):** Nếu không tìm thấy active booking, vẫn cho phép update + tạo booking mới.

### 1.3 `meeting_requests` — CREATE

| Field | Giá trị | Ghi chú |
|---|---|---|
| `request_type` | `'update_time'` | `MeetingRequestType.UPDATE_TIME` đã tồn tại |
| `approval_mode` | `'auto'` | `ApprovalMode.AUTO` đã tồn tại |
| `approval_status` | `'applied'` | `ApprovalStatus.APPLIED` đã tồn tại |
| `requested_start_time` | `startTime` từ request | |
| `requested_end_time` | `endTime` từ request | |
| `target_room_id` | `newRoomId` nếu có | |
| `conflict_check_status` | `'completed'` | `ConflictCheckStatus.COMPLETED` (hoặc dùng `ConflictCheckStatus.CLEAR`) |
| `conflict_summary_json` | JSON conflict check results | |
| `request_payload_json` | JSON toàn bộ request body | |
| `requested_by` | User ID từ JWT | |
| `applied_at` | `new Date()` | |

### 1.4 `meeting_events` — CREATE

| Field | Giá trị |
|---|---|
| `event_type` | `'meeting_time_updated'` **→ Cần thêm enum value** |
| `event_time` | `new Date()` |
| `actor_user_id` | User ID từ JWT |
| `source_type` | `'manual'` |
| `old_value_json` | `{ startTime, endTime, roomId }` (giá trị cũ) |
| `new_value_json` | `{ startTime, endTime, roomId, changeReason }` (giá trị mới) |
| `meeting_id` | meetingId |

### 1.5 `notifications` — CREATE

| Field | Giá trị |
|---|---|
| `notification_type` | `'meeting_time_updated'` **→ Cần thêm enum value** |
| `channel` | `'email'` hoặc `'in_app'` |
| `subject` | "Cập nhật thời gian cuộc họp: {meetingTitle}" |
| `content` | HTML/text với old/new time display |
| `related_entity_type` | `'meeting'` |
| `related_entity_id` | meetingId |
| `recipient_scope` | `'user_list'` |
| `recipient_user_ids_json` | Array user IDs của tất cả participants |
| `recipient_emails_json` | Array emails (internal + external) |
| `delivery_status` | `'queued'` |
| `payload_json` | `{ oldStartTime, oldEndTime, newStartTime, newEndTime, oldRoomId, newRoomId, changeReason }` |
| `created_by` | User ID từ JWT |

### 1.6 `background_jobs` — CREATE

| Field | Giá trị |
|---|---|
| `job_type` | `'send_email'` |
| `related_entity_type` | `'meeting'` |
| `related_entity_id` | meetingId |
| `status` | `'queued'` |
| `input_json` | `{ notificationId, template }` |

### 1.7 `audit_logs` — CREATE

| Field | Giá trị |
|---|---|
| `user_id` | User ID từ JWT |
| `action_type` | `'update'` |
| `entity_type` | `'meeting'` |
| `entity_id` | meetingId |
| `old_value_json` | `{ startTime, endTime, roomId }` |
| `new_value_json` | `{ startTime, endTime, roomId, changeReason }` |
| `metadata_json` | `{ reason, requestId }` |
| `ip_address` | Từ request |
| `user_agent` | Từ request |
| `severity` | `'info'` |

---

## 2. State Transitions

### 2.1 Meeting Status Transition

```
scheduled ──[update time]──> scheduled  (stays scheduled)
in_progress ──[update time]──> ❌ REJECTED (E2)
completed ──[update time]──> ❌ REJECTED (E2)
cancelled ──[update time]──> ❌ REJECTED (E2)
draft ──[update time]──> ❌ REJECTED (draft không có booking)
pending_approval ──[update time]──> ❌ REJECTED (chưa được duyệt)
```

### 2.2 Room Booking Status Transition

```
pending   → pending    (giữ nguyên status, chỉ update time/room)
approved  → approved   (giữ nguyên status, chỉ update time/room)
active    → active     (giữ nguyên status, chỉ update time/room)
```

### 2.3 MeetingRequest Status

```
No existing request → tạo mới với status 'applied'
```

---

## 3. Validation Rules (per field)

| Field | Rule | Error Code | HTTP |
|---|---|---|---|
| `meetingId` (path) | UUID hợp lệ | `INVALID_UUID` | 400 |
| `meetingId` (path) | Meeting tồn tại, chưa soft delete | `MEETING_NOT_FOUND` | 404 |
| `meeting` | Status = `scheduled` | `MEETING_STATUS_NOT_EDITABLE` | 409 |
| `startTime` | ISO-8601 with timezone | `INVALID_DATE_FORMAT` | 422 |
| `endTime` | ISO-8601 with timezone | `INVALID_DATE_FORMAT` | 422 |
| `startTime` | < `endTime` | `INVALID_TIME_RANGE` | 422 |
| `startTime` | Không trong quá khứ | `MEETING_TIME_IN_PAST` | 422 |
| `endTime` | Không trong quá khứ | `MEETING_TIME_IN_PAST` | 422 |
| Duration | 15 phút ≤ duration ≤ 8 giờ | `MEETING_DURATION_OUT_OF_RANGE` | 422 |
| `newRoomId` (optional) | UUID hợp lệ | `INVALID_UUID` | 400 |
| `newRoomId` (optional) | Room tồn tại | `ROOM_NOT_FOUND` | 404 |
| `newRoomId` (optional) | Room active | `ROOM_NOT_AVAILABLE` | 409 |
| `newRoomId` (optional) | Capacity ≥ attendee count | `ROOM_CAPACITY_INSUFFICIENT` | 409 |
| `overrideParticipantConflict` | Boolean | `INVALID_BOOLEAN` | 400 |
| `changeReason` | Max 500 ký tự | `FIELD_TOO_LONG` | 422 |

---

## 4. Conflict Detection Queries

### 4.1 Room Conflict Check

```sql
SELECT rb.* FROM room_bookings rb
WHERE rb.room_id = :roomId
  AND rb.id != :excludeBookingId  -- Loại trừ booking hiện tại
  AND rb.status IN ('pending', 'approved', 'active')  -- Chỉ check active bookings
  AND rb.reserved_start_time < :newEndTime
  AND rb.reserved_end_time > :newStartTime
  AND rb.deleted_at IS NULL
```

### 4.2 Participant Conflict Check

```sql
SELECT mp.* FROM meeting_participants mp
INNER JOIN meetings m ON m.id = mp.meeting_id
WHERE mp.user_id IN (:userIds)
  AND m.id != :excludeMeetingId  -- Loại trừ meeting hiện tại
  AND m.status NOT IN ('cancelled', 'completed')
  AND m.start_time < :newEndTime
  AND m.end_time > :newStartTime
  AND m.deleted_at IS NULL
```

---

## 5. New/Modified Enum Values

### 5.1 `MeetingEventType` (thêm value)

```typescript
// File: src/modules/meetings/entities/meeting-event.entity.ts
meeting_time_updated = 'meeting_time_updated',
```

### 5.2 `NotificationType` (thêm value)

```typescript
// File: src/modules/notifications/entities/notification.entity.ts
meeting_time_updated = 'meeting_time_updated',
```

---

## 6. New DTO

### `UpdateMeetingTimeDto`

```typescript
class UpdateMeetingTimeDto {
  @IsNotEmpty()
  @IsISO8601({ strict: true })
  startTime: string;

  @IsNotEmpty()
  @IsISO8601({ strict: true })
  endTime: string;

  @IsOptional()
  @IsUUID()
  newRoomId?: string;

  @IsOptional()
  @IsBoolean()
  overrideParticipantConflict?: boolean;  // default false

  @IsOptional()
  @MaxLength(500)
  changeReason?: string;
}
```

---

## 7. Transaction Boundary

```
Transaction {
  1. Re-check room conflict (pessimistic lock)
  2. Update meetings
  3. Update room_bookings (or create if missing)
  4. Create meeting_requests (audit snapshot)
  5. Create meeting_events
  6. Create audit_logs
}  // Commit — nếu bất kỳ step nào fail, rollback toàn bộ

// Outside transaction:
7. Create notifications
8. Create background_jobs (send_email)
// Nếu 7 hoặc 8 fail → không rollback transaction, ghi log error
// Response: notificationStatus = 'failed'
```
