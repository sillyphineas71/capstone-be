# Data Model - Yeu cau gia han phien hop (UC-IMM-02)

## Entities Impacted

### 1. meetings - UPDATE
**Vai tro**: Cap nhat end_time khi extension duoc auto-apply.

| Column | Change | Value | Dieu kien |
|---|---|---|---|
| end_time | UPDATE | requestedNewEndTime | WHERE status = in_progress AND id = meetingId |
| updated_by | UPDATE | currentUserId | - |
| updated_at | UPDATE | now() | - |

### 2. meeting_requests - INSERT
**Vai tro**: Ghi nhan moi request extension (ca auto-apply va pending).

| Column | Auto-apply (no conflict) | Pending (conflict) |
|---|---|---|
| request_type | extend_meeting | extend_meeting |
| meeting_id | meetingId | meetingId |
| requested_by | currentUserId | currentUserId |
| requested_end_time | requestedNewEndTime | requestedNewEndTime |
| approval_mode | auto | manual |
| approval_status | applied | pending |
| conflict_check_status | clear | blocked |
| conflict_summary_json | null | { conflicts: [...] } |
| request_payload_json | { extensionMinutes, reason, ... } | { extensionMinutes, reason, ... } |
| rule_snapshot_json | null | { approverIds: [...], approvalExpiresAt: oldEndTime } |
| applied_at | now() | null |
| notes | 'Auto-approved: room available' | 'Pending: room conflict, waiting manager' |

### 3. room_bookings - UPDATE (auto-apply path only)
**Vai tro**: Cap nhat reserved_end_time khi extension duoc auto-apply.

| Column | Change | Value | Dieu kien |
|---|---|---|---|
| reserved_end_time | UPDATE | requestedNewEndTime | WHERE meeting_id = meetingId AND status IN (active, approved) |

### 4. room_booking_usages - UPDATE (auto-apply path only)
**Vai tro**: Cap nhat reserved_end_time neu usage record ton tai.

| Column | Change | Value | Dieu kien |
|---|---|---|---|
| reserved_end_time | UPDATE | requestedNewEndTime | WHERE meeting_id = meetingId AND usage_status IN (in_use, not_started) |

### 5. meeting_events - INSERT (auto-apply path only)
**Vai tro**: Timeline event extension_requested.

| Column | Value |
|---|---|
| meeting_id | meetingId |
| event_type | extension_requested (can them enum) |
| event_time | now() |
| actor_user_id | currentUserId |
| source_type | manual |
| old_value_json | { endTime: oldEndTime } |
| new_value_json | { endTime: newEndTime, extensionMinutes: N } |
| metadata_json | { requestId, conflictCheckStatus: clear } |

### 6. audit_logs - INSERT (auto-apply path only)
**Vai tro**: Audit trail cho hanh dong gia han.

| Column | Value |
|---|---|
| user_id | currentUserId |
| action_type | extend_meeting |
| entity_type | meeting |
| entity_id | meetingId |
| old_value_json | { endTime: oldEndTime } |
| new_value_json | { endTime: newEndTime, extensionMinutes: N } |
| severity | info |

### 7. notifications - INSERT (pending/conflict path only)
**Vai tro**: Thong bao cho Manager/Approver khi co room conflict.

| Column | Value |
|---|---|
| notification_type | meeting_extension_request |
| channel | in_app (hoac websocket) |
| related_entity_type | meeting_request |
| related_entity_id | requestId |
| recipient_scope | user_list |
| recipient_user_ids_json | [managerUserId] |
| priority | high |
| payload_json | Xem spec muc 6.2 |
| created_by | system (null) |

### 8. system_configs - READ
**Vai tro**: Doc extension policy.

| Column | Value |
|---|---|
| config_key | meeting.extension.policy |
| config_group | scheduling |
| value_type | json |
| config_json | { allowedExtensionMinutes: [...], maxExtensionCountPerMeeting: 2, maxTotalExtensionMinutesPerMeeting: 60, ... } |

## State Transitions

### Meeting Request Status (meeting_requests.approval_status)
`
pending (tao khi conflict)
  |
  +--> applied (auto-approve khi khong conflict)
  |
  +--> rejected (future UC)
  +--> cancelled (future UC)
`

### Room Booking reserved_end_time (auto-apply path only)
`
reserved_end_time: old ---> new (extended)
`

## TypeORM Entity Changes Required

### 1. MeetingEventType - Them enum value
**File**: src/modules/meetings/entities/meeting-event.entity.ts
`
EXTENSION_REQUESTED = 'extension_requested'
`

### 2. Can kiem tra permission meeting.extension.request.own
- Neu chua ton tai, tao seed: SeedMeetingExtensionRequestPermission

## Data Constraints Summary

| Entity | Constraint | Type |
|---|---|---|
| meetings | status must be in_progress | Business |
| meetings | Must have room_id | Business |
| room_bookings | Must have active booking for this meeting | Business |
| meeting_requests | request_type = extend_meeting | Business |
| meeting_requests | approval_mode = auto OR manual | Business |
| meeting_requests | approval_status = applied OR pending | Business |
| meeting_requests | conflict_check_status = clear OR blocked | Business |
| extension_minutes | Must be in allowed set [15,30,60] or from config | Validation |
| extension_count | Max 2 applied requests per meeting | Business |
| extension_total | Max 60 total extension minutes applied | Business |
| room conflict | No overlap booking created in UC-IMM-02 | Business |
| notification | CTA must be view_extension_request only | Business |
