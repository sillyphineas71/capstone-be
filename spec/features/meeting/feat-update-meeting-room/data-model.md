# Data Model — UC-MM-03 Cập nhật phòng họp

## Entities & Impact

### 1. meetings (UPDATE)

| Column | Action | Value |
|--------|--------|-------|
| `room_id` | UPDATE | ID phòng mới |
| `updated_by` | UPDATE | ID người thực hiện |
| `updated_at` | UPDATE | Timestamp hiện tại (auto) |
| Các trường khác | NO CHANGE | title, description, start_time, end_time, participants, etc. |

### 2. room_bookings — Booking cũ (UPDATE)

| Column | Action | Value |
|--------|--------|-------|
| `status` | UPDATE | `released` |
| Các trường khác | NO CHANGE | — |

### 3. room_bookings — Booking mới (INSERT)

| Column | Value |
|--------|-------|
| `booking_code` | Auto-generated (`BK-YYYYMMDD-NNN`) |
| `meeting_id` | Meeting ID |
| `room_id` | ID phòng mới |
| `booking_type` | `relocated` |
| `reserved_start_time` | `meetings.start_time` |
| `reserved_end_time` | `meetings.end_time` |
| `status` | `approved` |
| `booked_by` | ID người thực hiện |
| `created_at` | auto |
| `updated_at` | auto |

### 4. meeting_requests (INSERT — optional audit snapshot)

| Column | Value |
|--------|-------|
| `request_code` | Auto-generated |
| `meeting_id` | Meeting ID |
| `request_type` | `update_room` |
| `requested_by` | ID người thực hiện |
| `target_room_id` | ID phòng mới |
| `requested_start_time` | `meetings.start_time` |
| `requested_end_time` | `meetings.end_time` |
| `approval_mode` | `auto` |
| `approval_status` | `applied` |
| `conflict_check_status` | `clear` |
| `request_payload_json` | `{ changeReason, confirmCapacityOverride, oldRoomId }` |
| `applied_at` | Timestamp hiện tại |

### 5. meeting_events (INSERT)

| Column | Value |
|--------|-------|
| `meeting_id` | Meeting ID |
| `event_type` | `room_changed` (thêm enum) |
| `event_time` | auto |
| `actor_user_id` | ID người thực hiện |
| `source_type` | `manual` |
| `description` | `Đổi phòng từ X sang Y` |
| `old_value_json` | `{ roomId, roomName, roomCode }` |
| `new_value_json` | `{ roomId, roomName, roomCode }` |
| `metadata_json` | `{ changeReason, confirmCapacityOverride }` |

### 6. room_events (INSERT — 2 records)

**Phòng cũ:**

| Column | Value |
|--------|-------|
| `room_id` | ID phòng cũ |
| `meeting_id` | Meeting ID |
| `event_type` | `room_released` |
| `old_status` | `approved` |
| `new_status` | `released` |
| `actor_user_id` | ID người thực hiện |

**Phòng mới:**

| Column | Value |
|--------|-------|
| `room_id` | ID phòng mới |
| `meeting_id` | Meeting ID |
| `event_type` | `room_reserved` |

### 7. notifications (INSERT)

| Column | Value |
|--------|-------|
| `notification_type` | `meeting_room_updated` (thêm enum) |
| `channel` | `in_app` |
| `subject` | `Phòng họp đã thay đổi cho: {meeting.title}` |
| `content` | Nội dung notification |
| `related_entity_type` | `meeting` |
| `related_entity_id` | Meeting ID |
| `recipient_user_ids_json` | `[userId1, userId2, ...]` (đã deduplicate) |
| `delivery_status` | `queued` |
| `payload_json` | `{ oldRoom, newRoom, changeReason, changedBy }` |

### 8. background_jobs (INSERT)

| Column | Value |
|--------|-------|
| `job_type` | `send_notification` |
| `status` | `pending` |
| `payload` | `{ notificationIds, meetingId }` |
| `max_retries` | 3 |

### 9. audit_logs (INSERT)

| Column | Value |
|--------|-------|
| `user_id` | ID người thực hiện |
| `action_type` | `update_room` |
| `entity_type` | `meeting` |
| `entity_id` | Meeting ID |
| `old_value_json` | `{ roomId, roomName, roomCode }` |
| `new_value_json` | `{ roomId, roomName, roomCode, changeReason, confirmCapacityOverride }` |
| `ip_address` | từ request |
| `user_agent` | từ request |
| `severity` | `info` |

## Enum Changes

### MeetingEventType (thêm)
```typescript
ROOM_CHANGED = 'room_changed'
```

### NotificationType (thêm)
```typescript
MEETING_ROOM_UPDATED = 'meeting_room_updated'
```

## State Transitions

### Meeting status (read-only check)
```
scheduled → (no change — chỉ cập nhật room_id)
```

### RoomBooking status — booking cũ
```
approved → released
```

### RoomBooking status — booking mới
```
(created) → approved
```

## Validation Rules

| Field | Rule |
|-------|------|
| `newRoomId` | Required, valid UUID |
| `confirmCapacityOverride` | Optional boolean, default false |
| `changeReason` | Optional string, max 500 chars |
| `meeting.status` | Must be `scheduled` |
| `meeting.start_time` | Must be in future (`now < start_time`) |
| `newRoom` | Must exist, `is_active = true`, `current_status != maintenance/inactive` |
| `newRoom.capacity` | Must not be null (if null → `ROOM_CAPACITY_NOT_CONFIGURED`) |
| `newRoom` vs current room | Must be different |
| `newRoom` availability | No overlapping booking with status `pending`, `approved`, `active` |

## SQL Queries

### Check room conflict
```sql
SELECT id FROM room_bookings
WHERE room_id = :newRoomId
  AND meeting_id != :currentMeetingId
  AND status IN ('pending', 'approved', 'active')
  AND reserved_start_time < :endTime
  AND reserved_end_time > :startTime
LIMIT 1;
```

### Get available rooms
```sql
SELECT * FROM rooms
WHERE is_active = true
  AND current_status NOT IN ('maintenance', 'inactive')
  AND capacity IS NOT NULL
  AND (capacity >= :minCapacity OR :minCapacity IS NULL)
  AND id NOT IN (
    SELECT room_id FROM room_bookings
    WHERE status IN ('pending', 'approved', 'active')
      AND reserved_start_time < :endTime
      AND reserved_end_time > :startTime
  );
```

### Count attendees
```sql
-- Internal participants
SELECT COUNT(*) FROM meeting_participants WHERE meeting_id = :meetingId;

-- External participants
SELECT COUNT(*) FROM meeting_external_participants WHERE meeting_id = :meetingId;
```
