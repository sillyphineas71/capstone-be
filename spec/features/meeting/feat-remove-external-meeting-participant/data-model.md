# Data Model: Remove External Meeting Participant

- **Feature ID**: MEET-REMOVE-EXTERNAL-PARTICIPANT-001
- **Created**: 2026-06-25

---

## Entities

### MeetingExternalParticipantEntity (DELETE)

| Field | Type | Constraint | Usage |
|---|---|---|---|
| id | uuid | PK | Target — `externalParticipantId` từ path param |
| meeting_id | uuid | FK → meetings.id, NOT NULL | Phải khớp với `meetingId` từ path param |
| email | varchar(255) | nullable | Đọc trước khi xóa để quyết định có gửi notification hay không |
| full_name | varchar(255) | NOT NULL | Đọc để đưa vào audit_log/meeting_event metadata (tham khảo) |

**Lookup query**:
```sql
SELECT * FROM meeting_external_participants
WHERE id = :externalParticipantId AND meeting_id = :meetingId
```
Không tìm thấy → 404 `EXTERNAL_PARTICIPANT_NOT_IN_MEETING` (áp dụng cả khi `id` tồn tại nhưng `meeting_id` không khớp — không tiết lộ thông tin).

**Operation**: `DELETE FROM meeting_external_participants WHERE id = :externalParticipantId AND meeting_id = :meetingId`

### MeetingEntity (READ ONLY, lock trong transaction)

| Field | Type | Usage |
|---|---|---|
| id | uuid | Lookup |
| status | enum (`MeetingStatus`) | Phải là `scheduled` |
| organizer_id | uuid | Authorization check |
| host_id | uuid (nullable) | Authorization check |
| deleted_at | timestamptz (nullable) | Nếu không null → 404 MEETING_NOT_FOUND |

**Lock query trong transaction**: `em.findOne(MeetingEntity, { where: { id: meetingId }, lock: { mode: 'pessimistic_write' } })`.

**Không cần đọc**: `visibility_level` (không áp dụng rule private cho remove, mirror đúng `removeParticipant()` hiện có).

### MeetingAgendaEntity — KHÔNG sử dụng trong feature này

Khác với `removeParticipant()` (internal), feature này **không** query `meeting_agendas` vì `owner_id` chỉ tham chiếu `users.id`, không bao giờ khớp với `meeting_external_participants.id`. Bỏ hẳn bước này khỏi implementation.

### MeetingEventEntity (INSERT)

| Field | Value |
|---|---|
| meeting_id | meetingId |
| event_type | `'external_participant_removed'` (giá trị mới trong `MeetingEventType`) |
| actor_user_id | requesterId |
| source_type | `'manual'` |
| metadata_json | `{ "removedExternalParticipantId": "uuid", "removedByUserId": "uuid", "reason": "string?" }` |

### AuditLogEntity (INSERT)

| Field | Value |
|---|---|
| user_id | requesterId |
| action_type | `'remove_external_participant'` |
| entity_type | `'meeting_external_participant'` |
| entity_id | externalParticipantId |
| old_value_json | `{ "meetingId": "uuid", "fullName": "string", "email": "string\|null" }` |
| new_value_json | `{ "removed": true, "removedAt": "ISO-8601", "reason": "string?" }` |
| severity | `'info'` |

### NotificationEntity (INSERT, post-transaction, có điều kiện)

| Field | Value |
|---|---|
| notification_type | `'meeting_participant_removed'` (enum `NotificationType.MEETING_PARTICIPANT_REMOVED` đã có) |
| channel | `'email'` |
| to_emails | `[target.email]` — **chỉ tạo nếu `target.email IS NOT NULL`** |
| related_entity_type | `'meeting'` |
| related_entity_id | meetingId |
| payload_json | `{ "removedBy": "uuid", "reason": "string?" }` |

Nếu `target.email IS NULL`: KHÔNG insert row này, response trả `notificationQueued=false`, `notificationId=null`.

### BackgroundJobEntity (INSERT, post-transaction, có điều kiện)

| Field | Value |
|---|---|
| job_type | email job (tự tạo bởi `notificationsService.enqueueEmailNotification()`) |
| payload | chứa `notificationId`, `toEmails` |

Tương tự, chỉ tạo nếu có email.

## State Transitions

Meeting status flow cho feature này:
```
scheduled → (remove external participant) → scheduled (không đổi status)
```

External participant lifecycle:
```
pending/accepted/declined (bất kỳ invitation_status) → removed (hard delete, không có status trung gian)
```

Lưu ý: không cần kiểm tra `invitation_status` trước khi xóa — mọi giá trị status đều có thể bị remove (mirror EC-10 của luồng remove internal participant).

## No Schema Changes

- Không thêm bảng mới
- Không thêm cột mới
- Chỉ thêm:
  - 1 giá trị enum ứng dụng: `MeetingEventType.EXTERNAL_PARTICIPANT_REMOVED = 'external_participant_removed'`
  - 1 permission mới (qua seed): `meeting.participant.remove.external`
- Tái sử dụng enum đã có: `NotificationType.MEETING_PARTICIPANT_REMOVED`, `NotificationChannel.EMAIL`
