# 📝 CHANGELOG & REVISION HISTORY
| Ngày cập nhật | Tóm tắt thay đổi | Các dòng thay đổi |
| :--- | :--- | :--- |
| 2026-06-08 | Tạo data-model lần đầu | Toàn bộ file |
| 2026-06-08 | Consistency fixes: fix notification TS field names (notificationType, deliveryStatus), fix audit log TS field names (actionType, metadataJson, severity), add isActive room check SQL | Các dòng 1.7 Notifications, 1.8 Audit Logs, 2.2 Room Active Query |

# Data Model: Tạo cuộc họp mới thủ công

**Feature**: MEETING-CREATE-MANUAL-001
**Date**: 2026-06-08

---

## 1. Entities Impacted

### 1.1 `meetings` (Existing — meetings/entities/meeting.entity.ts)

| Field | Type | Required | Default | Notes |
|-------|------|----------|---------|-------|
| `id` | uuid (PK) | Auto | `gen_random_uuid()` | |
| `meeting_code` | varchar(50) | Auto-generated | — | FR-041: Format MT-YYYYMMDD-XXX |
| `title` | varchar(255) | ✅ | — | Validated 1-255 chars |
| `description` | text | ❌ | null | Max 2000 chars |
| `organizer_id` | uuid (FK→users) | ✅ | — | = authenticated user |
| `host_id` | uuid (FK→users) | ✅ | organizer_id if not provided | FR-004: default to creator |
| `room_id` | uuid (FK→rooms) | ✅ | — | Must be active room |
| `start_time` | timestamptz | ✅ | — | Must be in future |
| `end_time` | timestamptz | ✅ | — | Must be > start_time |
| `meeting_type` | enum | ❌ | `normal` | |
| `meeting_mode` | enum | ❌ | `offline` | |
| `priority` | enum | ❌ | `normal` | |
| `visibility_level` | enum | ❌ | `internal` | |
| `expected_attendee_count` | int | ❌ | null | |
| `status` | enum | ✅ | `pending_approval` | FR-002 |
| `recurrence_rule_id` | uuid (FK) | ❌ | null | Not used in this feature |
| `parent_meeting_id` | uuid (FK) | ❌ | null | Not used |
| `cancellation_reason` | text | ❌ | null | Not used |
| `created_by` | uuid | ✅ | auth user | |
| `updated_by` | uuid | ❌ | null | |
| `created_at` | timestamptz | Auto | | |
| `updated_at` | timestamptz | Auto | | |
| `deleted_at` | timestamptz | ❌ | null | Soft delete |

**State transition (this feature only):**
```
[new] → pending_approval
```

### 1.2 `meeting_requests` (Existing — meetings/entities/meeting-request.entity.ts)

| Field | Type | Required | Default | Notes |
|-------|------|----------|---------|-------|
| `id` | uuid (PK) | Auto | | |
| `request_code` | varchar(50) | Auto-generated | — | Optional for this feature |
| `meeting_id` | uuid (FK→meetings) | ✅ | | |
| `request_type` | enum | ✅ | `create_meeting` | Fixed for this feature |
| `requested_by` | uuid (FK→users) | ✅ | auth user | |
| `requested_at` | timestamptz | Auto | `now()` | |
| `target_room_id` | uuid (FK→rooms) | ✅ | = meeting.room_id | |
| `requested_start_time` | timestamptz | ✅ | = meeting.start_time | |
| `requested_end_time` | timestamptz | ✅ | = meeting.end_time | |
| `approval_mode` | enum | ❌ | `manual` | |
| `approval_status` | enum | ✅ | `pending` | FR-031b |
| `conflict_check_status` | enum | ❌ | `not_checked` | Updated after check |
| `conflict_summary_json` | jsonb | ❌ | null | FR-005: conflict check result |
| `request_payload_json` | jsonb | ❌ | null | FR-031b: snapshot of input |
| `decision_by` | uuid (FK) | ❌ | null | Not used in this feature |
| `decision_at` | timestamptz | ❌ | null | Not used |
| `rejection_reason` | text | ❌ | null | Not used |
| `rule_snapshot_json` | jsonb | ❌ | null | |
| `applied_at` | timestamptz | ❌ | null | Not used |
| `notes` | text | ❌ | null | |
| `created_at` | timestamptz | Auto | | |
| `updated_at` | timestamptz | Auto | | |

**State transition (this feature only):**
```
[new] → pending
```

### 1.3 `room_bookings` (Existing — rooms/entities/room-booking.entity.ts)

| Field | Type | Required | Default | Notes |
|-------|------|----------|---------|-------|
| `id` | uuid (PK) | Auto | | |
| `booking_code` | varchar(50) | Auto-generated | — | FR-042: Format BK-YYYYMMDD-XXX |
| `meeting_id` | uuid (FK→meetings) | ✅ | | |
| `room_id` | uuid (FK→rooms) | ✅ | | |
| `reserved_start_time` | timestamptz | ✅ | = meeting.start_time | |
| `reserved_end_time` | timestamptz | ✅ | = meeting.end_time | |
| `status` | enum | ✅ | `pending` | FR-003 |
| `booking_type` | enum | ❌ | `scheduled` | |
| `release_reason` | text | ❌ | null | Not used |
| `released_by_id` | uuid | ❌ | null | Not used |
| `created_at` | timestamptz | Auto | | |
| `updated_at` | timestamptz | Auto | | |
| `deleted_at` | timestamptz | ❌ | null | |

**State transition (this feature only):**
```
[new] → pending
```

### 1.4 `meeting_participants` (Existing — meetings/entities/meeting-participant.entity.ts)

| Field | Type | Required | Default | Notes |
|-------|------|----------|---------|-------|
| `id` | uuid (PK) | Auto | | |
| `meeting_id` | uuid (FK→meetings) | ✅ | | |
| `user_id` | uuid (FK→users) | ✅ | | |
| `participant_role` | enum | ✅ | `attendee` | `host` for the meeting host |
| `invitation_status` | enum | ✅ | `pending` | |
| `attendance_status` | enum | ✅ | `not_checked_in` | |
| `invited_by_user_id` | uuid (FK→users) | ❌ | auth user | |
| `created_at` | timestamptz | Auto | | |

**Key rules:**
- Host automatically added if not in `participant_user_ids` (FR-DATA-007)
- Unique constraint on (meeting_id, user_id)

### 1.5 `meeting_external_participants` (Existing)

| Field | Notes |
|-------|-------|
| `id` | uuid PK |
| `meeting_id` | FK→meetings |
| `full_name` | string |
| `email` | string (validated) |
| `organization` | string, nullable |
| `invitation_status` | `pending` |

### 1.6 `meeting_events` (Existing)

| Field | Notes |
|-------|-------|
| `id` | uuid PK |
| `meeting_id` | FK→meetings |
| `event_type` | `meeting_request_created` (FR-008) |
| `actor_id` | auth user |
| `created_at` | timestamptz |

### 1.7 `notifications` (Existing)

| Field (TS Entity) | Column (DB) | Notes |
|-------------------|-------------|-------|
| `notificationType` | `notification_type` | Cần thêm `MEETING_REQUEST_CREATED` vào enum (hiện chưa có) |
| `channel` | `channel` | `email` or `in_app` (based on config) |
| `priority` | `priority` | `normal` |
| `title` | `title` | "Yêu cầu họp mới: {title}" |
| `body` | `body` | Descriptive text |
| `senderId` | `sender_id` | System or auth user |
| `recipientUserIdsJson` | `recipient_user_ids_json` | JSON array of approver IDs |
| `referenceType` | `reference_type` | `meeting_request` |
| `referenceId` | `reference_id` | meeting_request.id |
| `deliveryStatus` | `delivery_status` | `queued` |
| `createdAt` | `created_at` | timestamptz |

### 1.8 `audit_logs` (Existing)

| Field | Actual Column | Notes |
|-------|---------------|-------|
| `id` | `id` | uuid PK |
| `actorId` | `actor_id` | auth user |
| `actionType` | `action_type` | `create` |
| `entityType` | `entity_type` | `meeting_request` |
| `entityId` | `entity_id` | meeting_request.id |
| `metadataJson` | `metadata_json` | `{ meetingId: ..., bookingId: ... }` |
| `ipAddress` | `ip_address` | From request |
| `userAgent` | `user_agent` | From request |
| `severity` | `severity` | `info` |
| `createdAt` | `created_at` | Auto timestamptz |

---

## 2. Key SQL / TypeORM Queries

### 2.1 Room Conflict Check (FR-012)
```sql
SELECT COUNT(*) FROM room_bookings
WHERE room_id = :roomId
  AND status IN ('pending', 'approved', 'active')
  AND reserved_start_time < :endTime
  AND reserved_end_time > :startTime;
```

### 2.2 Participant Conflict Check (FR-021)
```sql
SELECT COUNT(*) FROM meeting_participants mp
JOIN meetings m ON mp.meeting_id = m.id
WHERE mp.user_id IN (:userIds)
  AND m.status NOT IN ('cancelled', 'completed')
  AND m.start_time < :endTime
  AND m.end_time > :startTime;
```

### 2.3 Room Existence & Active Check
```sql
SELECT id, capacity FROM rooms
WHERE id = :roomId AND is_active = true AND current_status != 'inactive';
```

---

## 3. Code Generation Strategy

### meeting_code (FR-041)
- Format: `MT-YYYYMMDD-XXX` (e.g., `MT-20260608-001`)
- Strategy: Query `SELECT COUNT(*) FROM meetings WHERE created_at::date = CURRENT_DATE` + pad with zeros
- Fallback: Use UUID slug if sequence fails

### booking_code (FR-042)
- Format: `BK-YYYYMMDD-XXX`
- Same strategy as meeting_code
- Independent counter (per day)

---

## 4. Transaction Boundary

```
BEGIN TRANSACTION
  1. Validate all inputs (outside transaction)
  2. Check room conflict (read-only, outside transaction for performance)
  3. INSERT meetings (status = pending_approval)
  4. INSERT meeting_requests (approval_status = pending)
  5. INSERT room_bookings (status = pending)
  6. INSERT meeting_participants (for each internal user)
  7. INSERT meeting_external_participants (for each external guest)
  8. INSERT meeting_events (event_type = meeting_request_created)
  9. INSERT notifications (delivery_status = queued)
 10. INSERT audit_logs
COMMIT

AFTER COMMIT (outside transaction):
  - Enqueue notification delivery (email/in-app) via background job
  - (Optional) Emit WebSocket event
```

---

## 5. Data Constraints Summary

| Constraint | Enforcement |
|------------|-------------|
| `meeting_code` unique | DB unique index or application-level |
| Room no-double-booking | Application check + DB query |
| `meeting_participants` unique (meeting_id, user_id) | DB unique constraint (existing) |
| `meeting_requests` 1 create_meeting per meeting | Application check |
| `start_time < end_time` | DTO validation |
| `start_time > now()` | DTO validation |
