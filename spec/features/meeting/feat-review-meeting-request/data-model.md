# Data Model — Duyệt hoặc từ chối yêu cầu cuộc họp

## Entities Liên Quan

### 1. meeting_requests (MeetingRequestEntity)

**Bảng chính** — fields cần đọc/cập nhật:

| Field | Action | Notes |
|-------|--------|-------|
| `id` | READ | PK, UUID |
| `meeting_id` | READ | FK → meetings |
| `request_type` | READ + VALIDATE | Chỉ support `create_meeting` |
| `approval_status` | READ + UPDATE | `pending` → `approved` / `rejected` |
| `conflict_check_status` | UPDATE | Ghi `blocked` nếu conflict |
| `conflict_checked_at` | UPDATE | Timestamp khi check conflict |
| `conflict_summary_json` | UPDATE | JSON conflict detail |
| `decision_by` | UPDATE | FK → users (approver) |
| `decision_at` | UPDATE | Timestamp quyết định |
| `rejection_reason` | UPDATE | Chỉ khi reject |
| `applied_at` | UPDATE | Chỉ khi approve |
| `requested_by` | READ | Để check self-approval |
| `notes` | UPDATE | Optional decision note |

### 2. meetings (MeetingEntity)

| Field | Action | Notes |
|-------|--------|-------|
| `id` | READ | PK |
| `status` | READ + UPDATE | `pending_approval` → `scheduled` / `cancelled` |
| `cancellation_reason` | UPDATE | Chỉ khi reject |
| `organizer_id` | READ | Để check self-approval |
| `updated_by` | UPDATE | Approver ID |
| `updated_at` | UPDATE | Timestamp |

### 3. room_bookings (RoomBookingEntity)

| Field | Action | Notes |
|-------|--------|-------|
| `id` | READ | PK |
| `meeting_id` | READ | FK → meetings |
| `room_id` | READ | FK → rooms (cho conflict check) |
| `reserved_start_time` | READ | Cho conflict check |
| `reserved_end_time` | READ | Cho conflict check |
| `status` | READ + UPDATE | `pending` → `approved` / `cancelled` |
| `approved_by` | UPDATE | Chỉ khi approve |
| `approved_at` | UPDATE | Chỉ khi approve |
| `cancellation_reason` | UPDATE | Chỉ khi reject |

### 4. meeting_participants (MeetingParticipantEntity)

| Field | Action | Notes |
|-------|--------|-------|
| `user_id` | READ | Lấy danh sách participant IDs cho notification |

### 5. meeting_external_participants (MeetingExternalParticipantEntity)

| Field | Action | Notes |
|-------|--------|-------|
| `email` | READ | Lấy danh sách email cho notification |

### 6. meeting_events (MeetingEventEntity)

| Field | Action | Notes |
|-------|--------|-------|
| `meeting_id` | CREATE | FK |
| `event_type` | CREATE | `meeting_request_approved` / `meeting_request_rejected` |
| `description` | CREATE | Optional |
| `created_by` | CREATE | Approver ID |

### 7. notifications (NotificationEntity)

| Field | Action | Notes |
|-------|--------|-------|
| `notification_type` | CREATE | MEETING_INVITE / MEETING_REQUEST_APPROVED / MEETING_REQUEST_REJECTED |
| `channel` | CREATE | EMAIL + IN_APP |
| `related_entity_type` | CREATE | `meeting_request` |
| `related_entity_id` | CREATE | requestId |
| `recipient_scope` | CREATE | `user_list` / `participant_list` |
| `recipient_user_ids_json` | CREATE | Array of user IDs |
| `recipient_emails_json` | CREATE | Array of emails (external) |
| `delivery_status` | CREATE | `QUEUED` |
| `created_by` | CREATE | Approver ID |
| `payload_json` | CREATE | Optional meeting info |

### 8. audit_logs (AuditLogEntity)

| Field | Action | Notes |
|-------|--------|-------|
| `user_id` | CREATE | Approver ID |
| `action_type` | CREATE | `approve` / `reject` |
| `entity_type` | CREATE | `meeting_request` |
| `entity_id` | CREATE | requestId |
| `old_value_json` | CREATE | Status trước khi thay đổi |
| `new_value_json` | CREATE | Status sau khi thay đổi |
| `metadata_json` | CREATE | meeting_id, booking_id, decision_note, rejection_reason |
| `ip_address` | CREATE | Từ request |
| `user_agent` | CREATE | Từ request |
| `severity` | CREATE | `info` |

---

## State Machine

### meeting_requests.approval_status

```
                    ┌─────────┐
                    │ pending │ ◄── Khởi tạo (feature khác)
                    └────┬────┘
                    ┌────┴────┐
                    │         │
               ┌────▼──┐  ┌──▼─────┐
               │approved│  │rejected│  (terminal states)
               └────────┘  └────────┘
```

### meetings.status

```
                          ┌──────────────────┐
                          │ pending_approval │ ◄── Khởi tạo
                          └────────┬─────────┘
                    ┌──────────────┴──────────────┐
                    │                             │
               ┌────▼────┐                  ┌────▼────┐
               │scheduled│                  │cancelled│
               └─────────┘                  └─────────┘
```

### room_bookings.status

```
                    ┌─────────┐
                    │ pending │ ◄── Khởi tạo
                    └────┬────┘
                    ┌────┴────┐
                    │         │
               ┌────▼──┐  ┌──▼─────┐
               │approved│  │cancelled│
               └────────┘  └────────┘
```

---

## SQL / TypeORM Reference

### Conflict Check Query (overlap logic)

```
overlap: existing.start_time < new.end_time AND existing.end_time > new.start_time
```

TypeORM:
```typescript
const conflicting = await em.getRepository(RoomBookingEntity).find({
  where: {
    room_id: booking.room_id,
    status: In(['pending', 'approved', 'active']),
    // Loại trừ booking hiện tại
    id: Not(booking.id),
  },
});
// Filter overlap in-memory hoặc dùng query builder
```

### Pessimistic Lock (SELECT FOR UPDATE)

```typescript
const request = await em.findOne(MeetingRequestEntity, {
  where: { id: requestId },
  lock: { mode: 'pessimistic_write' },
});
```

### Batch Notification Creation

```typescript
const notifications = [
  // meeting_invite for each participant
  ...participantIds.map(uid => em.create(NotificationEntity, {
    notificationType: NotificationType.MEETING_INVITE,
    channel: NotificationChannel.IN_APP,
    relatedEntityType: 'meeting_request',
    relatedEntityId: requestId,
    recipientScope: 'user_list',
    recipientUserIdsJson: [uid],
    deliveryStatus: NotificationDeliveryStatus.QUEUED,
    createdBy: approverId,
  })),
  // meeting_request_approved for creator
  em.create(NotificationEntity, { ... }),
];
await em.save(NotificationEntity, notifications);
```

### Audit Log Creation

```typescript
await em.save(AuditLogEntity, {
  userId: approverId,
  actionType: 'approve', // hoặc 'reject'
  entityType: 'meeting_request',
  entityId: requestId,
  oldValueJson: { approvalStatus: 'pending', meetingStatus: 'pending_approval', bookingStatus: 'pending' },
  newValueJson: { approvalStatus: 'approved', meetingStatus: 'scheduled', bookingStatus: 'approved' },
  metadataJson: { meetingId, bookingId, decisionNote, requestId },
  ipAddress: clientContext.ip,
  userAgent: clientContext.userAgent,
  severity: 'info',
});
```
