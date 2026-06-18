# Data Model: Phê duyệt hoặc từ chối yêu cầu gia hạn phiên họp (UC-IMM-03)

**Feature Directory**: spec/features/live-meeting/feat-process-meeting-extension-request
**Date**: 2026-06-16

---

## Entities Impacted

### 1. meeting_requests — UPDATE (approve path + reject path)

**Vai trò**: Cập nhật trạng thái request khi được approve/reject.

| Column | Approve | Reject (Manager/Admin) | Reject (Re-validation conflict) |
|---|---|---|---|
| `approval_status` | `applied` | `rejected` | `rejected` |
| `decision_by` | UUID (userId của Manager/Admin) | UUID (userId của Manager/Admin) | UUID (userId của Manager/Admin) |
| `decision_at` | now() | now() | now() |
| `rejection_reason` | null | reason từ request body hoặc null | `"Phòng đã có lịch đặt trong khoảng thời gian gia hạn"` |
| `conflict_summary_json` | null | null (hoặc giữ nguyên nếu có từ UC-IMM-02) | `[{ conflictingMeetingId, conflictingBookingId, conflictStart, conflictEnd }]` |
| `notes` | "Approved by {userName}" | "Rejected by {userName}" | "Rejected due to room conflict re-validation at approve time" |

### 2. meetings — UPDATE (approve path only)

**Vai trò**: Cập nhật end_time khi extension được approve.

| Column | Change | Value | Điều kiện |
|---|---|---|---|
| `end_time` | UPDATE | `requestedNewEndTime` | WHERE id = meetingId AND status = in_progress |
| `updated_by` | UPDATE | currentUserId | — |
| `updated_at` | UPDATE | now() | — |

**Lưu ý**: Không thay đổi `start_time`, `actual_start_time`, `actual_end_time`.

### 3. room_bookings — UPDATE (approve path only)

**Vai trò**: Cập nhật reserved_end_time khi extension được approve.

| Column | Change | Value | Điều kiện |
|---|---|---|---|
| `reserved_end_time` | UPDATE | `requestedNewEndTime` | WHERE meeting_id = meetingId AND status IN (active, approved) |

### 4. room_booking_usages — UPDATE (approve path only)

**Vai trò**: Cập nhật reserved_end_time nếu usage record tồn tại.

| Column | Change | Value | Điều kiện |
|---|---|---|---|
| `reserved_end_time` | UPDATE | `requestedNewEndTime` | WHERE meeting_id = meetingId AND usage_status IN (in_use, not_started) |

### 5. meeting_events — INSERT (approve path + reject path)

**Vai trò**: Timeline event cho approve/reject.

| Column | Approve | Reject |
|---|---|---|
| `meeting_id` | meetingId | meetingId |
| `event_type` | `extension_approved` | `extension_rejected` |
| `event_time` | now() | now() |
| `actor_user_id` | currentUserId (Manager/Admin) | currentUserId (Manager/Admin) |
| `source_type` | `manual` | `manual` |
| `old_value_json` | `{ endTime: oldEndTime }` | `{ endTime: oldEndTime }` |
| `new_value_json` | `{ endTime: newEndTime, extensionMinutes: N }` | `{ rejectionReason: string }` |
| `metadata_json` | `{ requestId, decisionBy }` | `{ requestId, decisionBy }` |

### 6. audit_logs — INSERT (approve path + reject path)

**Vai trò**: Audit trail.

| Column | Approve | Reject |
|---|---|---|
| `user_id` | currentUserId | currentUserId |
| `action_type` | `extend_meeting` | `extend_meeting_reject` |
| `entity_type` | `meeting_request` | `meeting_request` |
| `entity_id` | requestId | requestId |
| `old_value_json` | `{ approvalStatus: 'pending' }` | `{ approvalStatus: 'pending' }` |
| `new_value_json` | `{ approvalStatus: 'applied', newEndTime }` | `{ approvalStatus: 'rejected', rejectionReason }` |
| `severity` | `info` | `info` |

### 7. notifications — INSERT (approve path + reject path)

**Vai trò**: Thông báo cho Host.

| Column | Approve | Reject |
|---|---|---|
| `notification_type` | `meeting_extension_approved` | `meeting_extension_rejected` |
| `channel` | `in_app` | `in_app` |
| `related_entity_type` | `meeting_request` | `meeting_request` |
| `related_entity_id` | requestId | requestId |
| `recipient_scope` | `user_list` | `user_list` |
| `recipient_user_ids_json` | `[hostUserId]` | `[hostUserId]` |
| `priority` | `high` | `high` |
| `payload_json` | `{ type: "meeting_extension_approved", meetingId, meetingTitle, roomName, oldEndTime, newEndTime, extensionMinutes }` | `{ type: "meeting_extension_rejected", meetingId, meetingTitle, rejectionReason }` |

---

## 5. Conflict Re-validation Query

### Logic

Re-validation conflict check được thực hiện sau khi Manager gửi approve, kiểm tra xem còn booking nào khác trong khoảng `[oldEndTime, requestedNewEndTime)` không.

### Query Pattern

```sql
SELECT rb.*
FROM room_bookings rb
JOIN meetings m ON m.id = rb.meeting_id
WHERE rb.room_id = :roomId
  AND rb.id != :currentBookingId
  AND rb.status IN ('pending', 'approved', 'active')
  AND rb.deleted_at IS NULL
  AND rb.reserved_start_time < :requestedNewEndTime
  AND rb.reserved_end_time > :oldEndTime
```

**Overlap logic**: `existing.start_at < new.end_at AND existing.end_at > new.start_at`

### Include/Exclude Rules

| Booking status | Blocking? | Ghi chú |
|---|---|---|
| `pending` | Có | Bảo toàn booking đang pending của người khác |
| `approved` | Có | Booking đã approved |
| `active` | Có | Booking đang active |
| `cancelled` | Không | Đã hủy |
| `released` | Không | Đã giải phóng |
| `completed` | Không | Đã hoàn thành |

---

## State Transitions

### meeting_requests.approval_status

```
pending ──(Manager approve + no conflict)──> applied
pending ──(Manager reject)─────────────────> rejected
pending ──(Re-validation conflict)─────────> rejected
applied ──(terminal)───────────────────────> (no transition)
rejected ──(terminal)──────────────────────> (no transition)
```

### meetings.status (không thay đổi, chỉ reference)

UC-IMM-03 không thay đổi `meetings.status`. Chỉ check `status = in_progress` tại thời điểm approve.
