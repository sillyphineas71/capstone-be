# Data Model: Remove Internal Meeting Participant

- **Feature ID**: UC-MM-08
- **Created**: 2026-06-11

---

## Entities

### MeetingParticipantEntity

| Field | Type | Constraint | Usage |
|---|---|---|---|
| id | uuid | PK | |
| meeting_id | uuid | FK → meetings.id, NOT NULL | Target meeting |
| user_id | uuid | FK → users.id, NOT NULL | Target participant |
| participant_role | enum | 'host', 'attendee', 'observer' | Role check |
| invitation_status | enum | 'pending', 'accepted', 'declined', 'tentative' | Not checked — any status removable |
| created_at | timestamptz | | |
| updated_at | timestamptz | | |

**Operation**: DELETE row WHERE meeting_id = :meetingId AND user_id = :participantUserId

### MeetingEntity (READ ONLY)

| Field | Type | Usage |
|---|---|---|
| id | uuid | Lookup |
| status | enum | Must be 'scheduled' |
| organizer_id | uuid | Authorization check |
| host_id | uuid (nullable) | Authorization check |

### MeetingAgendaEntity (READ ONLY)

| Field | Type | Usage |
|---|---|---|
| id | uuid | Lookup |
| meeting_id | uuid | Filter by meeting |
| owner_id | uuid | Check if participant owns any agenda item |
| title | varchar | |
| status | enum | |

**Query**: SELECT id FROM meeting_agendas WHERE meeting_id = :meetingId AND owner_id = :participantUserId

If any row exists → 409 PARTICIPANT_OWNS_AGENDA_ITEMS

### MeetingEventEntity (INSERT)

| Field | Value |
|---|---|
| meeting_id | meetingId |
| event_type | 'participant_removed' |
| metadata | `{ "removedUserId": "uuid", "removedByUserId": "uuid", "reason": "string?" }` |
| created_by | requesterId |

### AuditLogEntity (INSERT)

| Field | Value |
|---|---|
| action | 'remove_participant' |
| actor_id | requesterId |
| target_type | 'meeting' |
| target_id | meetingId |
| details | `{ "removedUserId": "uuid", "reason": "string?" }` |
| severity | 'info' |

### NotificationEntity (INSERT)

| Field | Value |
|---|---|
| notification_type | 'meeting_participant_removed' |
| recipient_id | participantUserId |
| title | 'Bạn đã bị gỡ khỏi cuộc họp' |
| body | `{ "meetingId": "uuid", "meetingTitle": "string", "reason": "string?" }` |
| status | 'pending' |

### BackgroundJobEntity (INSERT)

| Field | Value |
|---|---|
| job_type | 'send_email' |
| status | 'pending' |
| payload | `{ "notificationId": "uuid", "recipientId": "uuid", "template": "meeting_participant_removed" }` |

## State Transitions

Meeting status flow for this feature:
```
scheduled → (remove participant) → scheduled (no status change)
```

Participant lifecycle:
```
invited → removed (hard delete, no status)
```

## No Schema Changes

- Không thêm bảng mới
- Không thêm cột mới
- Chỉ thêm enum values:
  - `MeetingEventType.participant_removed`
  - `NotificationType.meeting_participant_removed`