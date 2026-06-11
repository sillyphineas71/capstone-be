# Research: Remove Internal Meeting Participant

- **Feature ID**: UC-MM-08
- **Created**: 2026-06-11
- **Status**: Complete

---

## Codebase Analysis

### Entity Patterns (TypeORM)

All entities follow the same convention:
- `PrimaryGeneratedColumn('uuid')` for id
- `CreateDateColumn` / `UpdateDateColumn` for timestamps
- `ManyToOne` + `JoinColumn` for relationships
- Named exports with `Entity` suffix (MeetingEntity, etc.)
- Enum files co-located with entities or in a shared enums file

### Existing Module: `meetings`

| Entity | Key Fields |
|---|---|
| MeetingEntity | id, title, status (enum), organizer_id, host_id, start_time, end_time, room_id |
| MeetingParticipantEntity | id, meeting_id, user_id, participant_role (enum), invitation_status |
| MeetingEventEntity | id, meeting_id, event_type (enum), metadata (jsonb), created_by |
| MeetingAgendaEntity | id, meeting_id, owner_id, title, status |

### Related Modules

- **notifications**: NotificationEntity with type enum, recipient_id, payload (jsonb)
- **administration**: BackgroundJobEntity, AuditLogEntity
- **accounts**: UserEntity, RoleEntity, PermissionEntity

### Transaction Pattern

The codebase uses TypeORM `DataSource.transaction()` with callback pattern. Inside the callback, use `EntityManager` for all DB operations to ensure atomicity.

### Authorization Pattern

Using `JwtAuthGuard` at controller level with custom `@CurrentUser()` decorator. Permission checking is done in service layer, typically by reading `meetings.organizer_id` / `meetings.host_id` and comparing with `req.user.id`.

## Technology Decisions

| Decision | Choice | Rationale |
|---|---|---|
| Transaction | TypeORM DataSource.transaction() | Project-wide pattern |
| Hard delete | DELETE FROM meeting_participants | No deleted_at column, history via events |
| Auth check | Service layer (not guard) | Need meeting data for ownership check |
| Event type | `participant_removed` (new enum value) | Consistent with existing MeetingEventType |
| Notification type | `meeting_participant_removed` (new enum value) | Consistent with existing NotificationType |
| UUID validation | class-validator @IsUUID('4') | Project-wide convention |
| Response format | Standard `{ success, message, data }` | Per API convention |

## Risks Identified

1. Missing `participant_removed` in MeetingEventType enum — needs addition
2. Missing `meeting_participant_removed` in NotificationType enum — needs addition
3. Must ensure transaction includes all 5 steps (DELETE + 4 INSERTs)
4. Background job entity path: `src/modules/administration/entities/background-job.entity.ts`
5. No existing permission `meeting.participant.remove` — may need seed update

## Dependencies

- `meeting_agendas` table must be queryable for agenda owner check
- `background_jobs` table must support email job type
- Notification sending is async via background_jobs — not in transaction scope