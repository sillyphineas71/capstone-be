# Data Model — Bắt đầu phiên họp (UC-IMM-01)

## Entities Impacted

### 1. `meetings` — UPDATE
**Vai trò**: Bảng lõi, cập nhật trạng thái và thời gian bắt đầu thực tế.

| Column | Change | Value |
|---|---|---|
| `status` | UPDATE | `in_progress` |
| `actual_start_time` | UPDATE | `now()` (server time) |
| `updated_by` | UPDATE | `currentUserId` |
| `updated_at` | UPDATE | `now()` |

**Query tham chiếu**:
```sql
UPDATE meetings
SET status = 'in_progress',
    actual_start_time = NOW(),
    updated_by = $1,
    updated_at = NOW()
WHERE id = $2
  AND status = 'scheduled'
  AND deleted_at IS NULL
  AND actual_start_time IS NULL
  AND NOW() >= (start_time - INTERVAL '15 minutes')
  AND NOW() < end_time;
```

### 2. `meeting_events` — INSERT
**Vai trò**: Timeline event ghi nhận mốc bắt đầu phiên họp.

| Column | Value |
|---|---|
| `meeting_id` | meetingId |
| `event_type` | `meeting_started` |
| `event_time` | `now()` |
| `actor_user_id` | currentUserId (hoặc null cho system/device) |
| `source_type` | `manual` (hoặc `system`/`device`) |
| `description` | `"Phiên họp bắt đầu"` |
| `old_value_json` | `{ "status": "scheduled", "actualStartTime": null }` |
| `new_value_json` | `{ "status": "in_progress", "actualStartTime": "<ISO string>" }` |

**Entity reference**: `MeetingEventEntity` (`MeetingEventType.MEETING_STARTED`)

### 3. `room_bookings` — UPDATE
**Vai trò**: Cập nhật trạng thái booking nếu đang `approved`.

| Column | Change | Value | Điều kiện |
|---|---|---|---|
| `status` | UPDATE | `active` | WHERE status = `approved` AND meeting_id = meetingId |

### 4. `room_booking_usages` — UPDATE
**Vai trò**: Cập nhật usage thực tế nếu record tồn tại.

| Column | Change | Value |
|---|---|---|
| `usage_status` | UPDATE | `in_use` |
| `actual_start_time` | UPDATE | `now()` |
| `occupancy_source` | UPDATE | `manual` hoặc `camera` (tùy source) |

**Query tham chiếu**:
```sql
UPDATE room_booking_usages
SET usage_status = 'in_use',
    actual_start_time = NOW(),
    occupancy_source = $1
WHERE meeting_id = $2
  AND usage_status = 'not_started';
```

### 5. `audit_logs` — INSERT
**Vai trò**: Audit trail cho hành động start meeting.

| Column | Value |
|---|---|
| `user_id` | currentUserId (null for system) |
| `action_type` | `start_meeting` |
| `entity_type` | `meeting` |
| `entity_id` | meetingId |
| `old_value_json` | `{ "status": "scheduled", "actualStartTime": null }` |
| `new_value_json` | `{ "status": "in_progress", "actualStartTime": "<ISO>" }` |
| `severity` | `info` |

## State Transitions

### Meeting Status
```
scheduled ──────> in_progress
    │                  │
    │                  ├──> completed (future UC)
    │                  └──> cancelled  (future UC)
    │
    ├──> completed (nếu đã quá giờ mà chưa start)
    └──> cancelled  (nếu bị hủy trước khi start)
```

### Room Booking Status
```
approved ──────> active
```

### Room Booking Usage Status
```
not_started ──────> in_use
```

## Redis / Cache (optional)
- Không cần Redis keys mới cho use case này. JWT blacklist, OTP — không liên quan.

## TypeORM Entity Changes Required

### 1. `MeetingEventSourceType` — Thêm enum value
**File**: `src/modules/meetings/entities/meeting-event.entity.ts`
```typescript
export enum MeetingEventSourceType {
  MANUAL = 'manual',
  SYSTEM = 'system',
  WEBSOCKET = 'websocket',
  MQTT = 'mqtt',
  SCHEDULER = 'scheduler',
  DEVICE = 'device',       // <-- Thêm cho AF1
}
```

## Data Constraints Summary

| Entity | Constraint | Type |
|---|---|---|
| `meetings` | `status` must be `scheduled` before transition | Business |
| `meetings` | `actual_start_time` must be null | Business |
| `meetings` | `deleted_at` must be null | Soft-delete |
| `meetings` | Current time in `[start_time - 15m, end_time)` | Time window |
| `room_bookings` | `status` must be `approved` before transition | Business |
| `room_booking_usages` | `usage_status` must be `not_started` before transition | Business |
| `meeting_events` | NO duplicate `meeting_started` event for same meeting | Idempotent |
