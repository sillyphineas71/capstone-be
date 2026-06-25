# Research: Yeu cau gia han phien hop (UC-IMM-02)

**Date**: 2026-06-16
**Context**: Codebase analysis for feature implementation plan based on spec.md.

## Codebase Analysis

### Module live-meeting (target)
- **Status**: Has controller, service, DTOs from UC-IMM-01 implementation.
- Module already has: LiveMeetingService, LiveMeetingController, StartMeetingResponseDto.
- Can reuse: transaction pattern, guard pattern, WebSocket service, error constants pattern.

### Codebase Patterns (from UC-IMM-01 + meetings module)

#### Transaction Pattern
`
await this.dataSource.transaction(async (em) => {
  const meeting = await em.findOne(MeetingEntity, {
    where: { id },
    lock: { mode: 'pessimistic_write' },
  });
  await em.save(MeetingRequestEntity, request);
  await em.update(MeetingEntity, id, { ... });
  await em.save(MeetingEventEntity, event);
  await em.save(AuditLogEntity, log);
});
`

#### Error Constants Pattern
- File: src/modules/live-meeting/constants/meeting-start-error.constant.ts (reference for naming convention).
- Need to create: meeting-extension-error.constant.ts with new error codes.

#### Entity References Available
- MeetingEntity (meetings): status, endTime, hostId, 
oomId, updatedBy.
- MeetingRequestEntity (meeting_requests): 
equestType (supports extend_meeting), pprovalMode, pprovalStatus, conflictCheckStatus, conflictSummaryJson, 
equestPayloadJson, 
uleSnapshotJson, ppliedAt.
- RoomBookingEntity (room_bookings): status, 
eservedStartTime, 
eservedEndTime, meetingId, 
oomId.
- RoomBookingUsageEntity (room_booking_usages): usageStatus, 
eservedEndTime.
- MeetingEventEntity (meeting_events): eventType (need to add EXTENSION_REQUESTED), oldValueJson, 
ewValueJson, metadataJson.
- NotificationEntity (notifications): 
otificationType, 
elatedEntityType, 
elatedEntityId, 
ecipientUserIdsJson, priority, payloadJson.
- AuditLogEntity (audit_logs): userId, ctionType, entityType, entityId, oldValueJson, 
ewValueJson.
- SystemConfigEntity (system_configs): configKey, configGroup, alueType, configJson.

#### Extension Policy from system_configs
- Config key: meeting.extension.policy, group: scheduling.
- Must handle missing config gracefully with fallback defaults.

#### Manager Approver Resolution
- Uses users.direct_manager_id, fallback departments.manager_user_id.
- Need access to UsersService or direct query via relations.
- If no approver found and conflict exists -> 409 MEETING_EXTENSION_NO_APPROVER.

#### Notification for Manager
- On conflict path: create 
otification_type = meeting_extension_request.
- CTA type: iew_extension_request (no approve/reject action in UC-IMM-02).
- Post-transaction best-effort as per existing pattern.

#### WebSocket Pattern
- WebsocketService.emitToRoom('meeting:{meetingId}', 'meeting.extension.requested', payload).
- Payload includes new/old endTime, status, extensionMinutes.

### Existing Seed Files
- Need to check if meeting.extension.request.own permission exists.
- If not, create: SeedMeetingExtensionRequestPermission.

### Permission meeting.extension.request.own
- Likely needs new seed.
- Roles: INTERNAL_USER, MANAGER, BUSINESS_ADMIN, SYSTEM_ADMIN.

### MeetingEventType enum
- Has MEETING_STARTED, MEETING_ENDED, etc.
- Need to add EXTENSION_REQUESTED.

## Technology Decisions

| Decision | Choice | Rationale |
|---|---|---|
| ORM | TypeORM (existing) | Already used across project |
| Transaction | DataSource.transaction() with pessimistic_lock | Existing pattern from UC-IMM-01 |
| Row Lock | lock: { mode: 'pessimistic_write' } on meetings | Existing pattern |
| Realtime | Socket.IO via WebsocketService | Already set up |
| Permissions | meeting.extension.request.own | Align with spec |
| Audit Log | AuditLogEntity via em.save() | Existing pattern |
| Meeting Event | MeetingEventEntity via em.save() | Need to add EXTENSION_REQUESTED |
| Notification | NotificationEntity via em.save() | Post-transaction best-effort |
| Extension Policy | system_configs (meeting.extension.policy) | Config-driven with fallback |
| Approver Resolution | users.direct_manager_id -> departments.manager_user_id | Spec-defined priority |

## Risks & Mitigations

| Risk | Mitigation |
|---|---|
| system_configs missing or invalid | Fallback to defaults [15,30,60], maxExtensions=2, maxTotal=60 |
| Manager/Approver not found | Return 409 MEETING_EXTENSION_NO_APPROVER |
| Race condition concurrent extension | SELECT FOR UPDATE on meetings row |
| Notification push failure | Best-effort after commit, no rollback |
| meeting.extension.request.own permission missing | Create seed before implementation |
| MeetingEventType.EXTENSION_REQUESTED missing | Add enum value in entity |