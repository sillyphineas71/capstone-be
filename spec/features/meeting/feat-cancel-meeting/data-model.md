# Data Model: Cancel Scheduled Meeting (UC-MM-04)

## 📝 CHANGELOG & REVISION HISTORY
| Ngày cập nhật | Tóm tắt thay đổi | Các dòng thay đổi |
| :--- | :--- | :--- |
| 2026-06-09 | Data model cho UC-MM-04 | Toàn bộ file |

---

## Entity Relationships

```
meetings (1) ──── (0..1) room_bookings (1) ──── (0..1) room_booking_usages
    │                      │
    │                      └── room_events (0..1)
    │
    ├── meeting_events (1)
    ├── meeting_participants (1..N)
    └── meeting_external_participants (0..N)

notifications ──── background_jobs (0..1)
audit_logs
```

## Entity Field Mapping

### meetings (UPDATE)

| Field | Current Value | New Value | Ghi chú |
|---|---|---|---|
| `status` | `'scheduled'` | `'cancelled'` | Dùng `MeetingStatus.CANCELLED` |
| `cancellation_reason` | `null` | Request body value (trimmed, max 1000) | Optional, nullable text |
| `updated_by` | previous | `currentUser.userId` | UUID |
| `updated_at` | previous | `now()` | Auto-set by UpdateDateColumn |

### room_bookings (UPDATE — conditional)

| Field | Current Value | New Value | Ghi chú |
|---|---|---|---|
| `status` | `'pending'` or `'approved'` | `'cancelled'` | Dùng `RoomBookingStatus.CANCELLED`. Không dùng `'released'`. |
| `cancellation_reason` | `null` | Same as `meetings.cancellation_reason` | Lấy từ request body |
| `updated_at` | previous | `now()` | |

**Condition**: Only if booking exists AND `status IN ('pending', 'approved')`. Không update nếu booking đã `cancelled` hoặc `released`.

### room_booking_usages (UPDATE — conditional)

| Field | Current Value | New Value | Ghi chú |
|---|---|---|---|
| `usage_status` | `'not_started'` | `'released'` | Dùng enum value `UsageStatus.RELEASED` |
| `released_at` | `null` | `now()` | |
| `released_by` | `null` | `currentUser.userId` | |
| `release_reason` | `null` | Same as `cancellationReason` | |

**Conditions**:
1. Usage record tồn tại AND `usage_status = 'not_started'` → update
2. Usage record chưa tồn tại → NOT create
3. Usage record tồn tại nhưng status `in_use`, `completed`, `no_show` → không update

### meeting_events (INSERT)

| Field | Value |
|---|---|
| `meeting_id` | `meeting.id` |
| `event_type` | `'status_changed'` (MeetingEventType.STATUS_CHANGED) |
| `event_time` | `now()` |
| `actor_user_id` | `currentUser.userId` |
| `source_type` | `'manual'` |
| `description` | `"Cuộc họp \"{title}\" đã bị hủy."` (thêm reason nếu có) |
| `old_value_json` | `{ "status": "scheduled" }` |
| `new_value_json` | `{ "status": "cancelled" }` |
| `metadata_json` | `{ "action": "cancel_meeting", "reason": "<cancellationReason or null>" }` |

### room_events (INSERT — conditional)

| Field | Value |
|---|---|
| `room_id` | `booking.roomId` |
| `booking_id` | `booking.id` |
| `event_type` | `'room_released'` |
| `old_status` | Booking's previous status (e.g., `'approved'`) |
| `new_status` | `'cancelled'` |
| `description` | `"Phòng đã được giải phóng do cuộc họp \"{title}\" bị hủy."` |

**Condition**: Only if room booking was released by this cancellation.

### audit_logs (INSERT — 1 or 2 records)

**Record 1: Cancel meeting**
| Field | Value |
|---|---|
| `user_id` | `currentUser.userId` |
| `action_type` | `'cancel_meeting'` |
| `entity_type` | `'meeting'` |
| `entity_id` | `meeting.id` |
| `old_value_json` | `{ "status": "scheduled" }` |
| `new_value_json` | `{ "status": "cancelled" }` |
| `metadata_json` | `{ "reason": "<cancellationReason>" }` |
| `severity` | `'info'` |
| `ip_address` | Từ request |
| `user_agent` | Từ request |

**Record 2: Release room** (conditional — only if booking released)
| Field | Value |
|---|---|
| `user_id` | `currentUser.userId` |
| `action_type` | `'release_room'` |
| `entity_type` | `'room_booking'` |
| `entity_id` | `booking.id` |
| `old_value_json` | `{ "status": "<previous booking status>" }` |
| `new_value_json` | `{ "status": "cancelled" }` |
| `metadata_json` | `{ "reason": "<cancellationReason>", "meetingId": "<meeting.id>" }` |

### notifications (INSERT — after transaction)

| Field | Value |
|---|---|
| `notification_type` | `'cancellation'` |
| `channel` | `'in_app'` / `'email'` (có thể tạo 1 record với channel phù hợp hoặc 2 records) |
| `subject` | `"[CANCELLED] {meeting.title}"` hoặc `"[ĐÃ HỦY] {meeting.title}"` |
| `content` | Bao gồm cancellation reason nếu có |
| `related_entity_type` | `'meeting'` |
| `related_entity_id` | `meeting.id` |
| `recipient_scope` | `'user_list'` |
| `recipient_user_ids_json` | Danh sách user IDs của internal participants |
| `recipient_emails_json` | Danh sách emails của internal + external participants |
| `delivery_status` | `'queued'` |
| `payload_json` | `{ "action": "cancel_meeting", "meetingId": "<id>", "reason": "<reason>" }` |

### background_jobs (INSERT — after transaction)

| Field | Value |
|---|---|
| `job_type` | `'send_email'` |
| `status` | `'pending'` |
| `payload_json` | `{ "notificationId": "<notification.id>", "type": "cancellation" }` |

## State Transition Matrix

### meetings
```
┌────────────┐    cancel     ┌────────────┐
│  scheduled │ ───────────────►  cancelled │ (terminal)
└────────────┘               └────────────┘
```

### room_bookings
```
┌─────────┐    cancel     ┌────────────┐
│ pending │ ───────────────►  cancelled │ (terminal)
└─────────┘               └────────────┘
┌──────────┐    cancel     ┌────────────┐
│ approved │ ───────────────►  cancelled │ (terminal)
└──────────┘               └────────────┘
```

### room_booking_usages
```
┌──────────────┐    cancel     ┌────────────┐
│  not_started │ ───────────────►  released  │ (terminal)
└──────────────┘               └────────────┘
```

## SQL Queries (Reference)

### Update meeting
```sql
UPDATE meetings
SET status = 'cancelled',
    cancellation_reason = :reason,
    updated_by = :userId,
    updated_at = NOW()
WHERE id = :meetingId AND deleted_at IS NULL;
```

### Update room booking
```sql
UPDATE room_bookings
SET status = 'cancelled',
    cancellation_reason = :reason,
    updated_at = NOW()
WHERE meeting_id = :meetingId AND status IN ('pending', 'approved');
```

### Update usage
```sql
UPDATE room_booking_usages
SET usage_status = 'released',
    released_at = NOW(),
    released_by = :userId,
    release_reason = :reason
WHERE booking_id = :bookingId AND usage_status = 'not_started';
```
