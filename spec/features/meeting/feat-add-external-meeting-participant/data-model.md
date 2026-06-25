# Data Model: Add External Meeting Participant

- **Feature ID**: MEET-ADD-EXTERNAL-PARTICIPANT-001
- **Created**: 2026-06-25

---

## Entities

### MeetingExternalParticipantEntity (INSERT)

| Field | Type | Constraint | Usage |
|---|---|---|---|
| id | uuid | PK, `gen_random_uuid()` | Sinh mới |
| meeting_id | uuid | FK → meetings.id, NOT NULL | Từ path param |
| full_name | varchar(255) | NOT NULL | Từ request body |
| email | varchar(255) | nullable (DB) nhưng **required ở DTO** | Từ request body |
| phone_number | varchar(30) | nullable | Từ request body (optional) |
| organization_name | varchar(255) | nullable | Từ request body (optional) |
| participant_role | varchar(40) | default `'attendee'` | Luôn set cứng `'attendee'`, không cho client chọn |
| invitation_status | varchar(30) | default `'pending'` | Luôn set cứng `'pending'` |
| response_at | timestamptz | nullable | Không set ở feature này |
| notes | text | nullable | Không set ở feature này |
| metadata_json | jsonb | nullable | Không set ở feature này |
| created_at | timestamptz | default `now()` | Tự sinh |

**Operation**: `INSERT INTO meeting_external_participants (meeting_id, full_name, email, phone_number, organization_name, participant_role, invitation_status) VALUES (...)`

**Pre-check (application-level, không có DB constraint)**:
```sql
SELECT id FROM meeting_external_participants
WHERE meeting_id = :meetingId AND LOWER(email) = LOWER(:email)
```
Nếu có kết quả → 409 `EXTERNAL_PARTICIPANT_ALREADY_EXISTS`. Re-check lại đúng câu query này bên trong transaction (sau khi lock `meetings` row) để giảm race window.

### MeetingEntity (READ ONLY, lock trong transaction)

| Field | Type | Usage |
|---|---|---|
| id | uuid | Lookup |
| status | enum (`MeetingStatus`) | Phải thuộc `{scheduled, in_progress}` |
| organizer_id | uuid | Authorization check |
| host_id | uuid (nullable) | Authorization check |
| visibility_level | enum (`MeetingVisibilityLevel`) | Nếu `private` → giới hạn actor |
| room_id | uuid (nullable) | Nếu có → kích hoạt capacity check |
| deleted_at | timestamptz (nullable) | Nếu không null → coi như not found |

**Lock query trong transaction**: `SELECT ... FOR UPDATE` qua `em.findOne(MeetingEntity, { where: { id: meetingId }, lock: { mode: 'pessimistic_write' } })`.

### MeetingParticipantEntity (READ ONLY — chỉ COUNT)

| Field | Usage |
|---|---|
| meeting_id | `COUNT(*) WHERE meeting_id = :meetingId` — số internal participant hiện có |

### RoomEntity (READ ONLY)

| Field | Usage |
|---|---|
| id | Lookup theo `meeting.room_id` |
| capacity | So sánh với `attendeeCount + 1` |

### SystemConfigEntity (READ ONLY)

| Field | Value |
|---|---|
| config_key | `'meeting.capacity_policy'` |
| config_value | `'block'` \| `'warning'` (default `'warning'` nếu không có config / `is_active=false`) |

### MeetingEventEntity (INSERT)

| Field | Value |
|---|---|
| meeting_id | meetingId |
| event_type | `'external_participant_added'` (giá trị mới trong `MeetingEventType`) |
| actor_user_id | requesterId |
| source_type | `'manual'` |
| metadata_json | `{ "email": "string", "fullName": "string" }` |

### AuditLogEntity (INSERT)

| Field | Value |
|---|---|
| user_id | requesterId |
| action_type | `'add_external_participant'` |
| entity_type | `'meeting_external_participant'` |
| entity_id | id của bản ghi external participant mới |
| new_value_json | `{ "meetingId": "uuid", "email": "string", "fullName": "string" }` |
| ip_address / user_agent | từ `ClientContext` |
| severity | `'info'` |

### NotificationEntity (INSERT, post-transaction, best-effort)

| Field | Value |
|---|---|
| notification_type | `'meeting_invite'` (enum `NotificationType.MEETING_INVITE` đã có) |
| channel | `'email'` (enum `NotificationChannel.EMAIL` đã có) |
| recipient_scope | `'user_list'` (mirror cách dùng hiện tại — không có recipient_user_ids vì không có user_id) |
| to_emails | `[email]` |
| related_entity_type | `'meeting'` |
| related_entity_id | meetingId |
| payload_json | `{ "invitedBy": "uuid" }` |

**Không tạo** notification nào với `channel='in_app'` cho external participant.

### BackgroundJobEntity (INSERT, post-transaction, best-effort)

| Field | Value |
|---|---|
| job_type | email job (theo `notificationsService.enqueueEmailNotification()` tự tạo) |
| payload | chứa `notificationId`, `toEmails`, template content |

## State Transitions

Meeting status flow cho feature này:
```
scheduled     → (add external participant) → scheduled (không đổi status)
in_progress   → (add external participant) → in_progress (không đổi status)
```

External participant lifecycle (chỉ phần liên quan đến feature này):
```
(không tồn tại) → created với invitation_status='pending' (feature khác sẽ xử lý transition pending→accepted/declined nếu có)
```

## No Schema Changes

- Không thêm bảng mới
- Không thêm cột mới
- Chỉ thêm:
  - 1 giá trị enum ứng dụng: `MeetingEventType.EXTERNAL_PARTICIPANT_ADDED = 'external_participant_added'`
  - 1 permission mới (qua seed, không qua schema migration): `meeting.participant.add.external`
