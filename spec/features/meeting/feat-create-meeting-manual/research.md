# 📝 Research: Tạo cuộc họp mới thủ công

**Feature**: MEETING-CREATE-MANUAL-001
**Date**: 2026-06-08
**Phase**: 0 — Research & Codebase Analysis

---

## Codebase Analysis Summary

### Existing Module Structure

| Module | Status | Notes |
|--------|--------|-------|
| `meetings/` | Entities only (8 entities) | No controller/service/DTO — MUST create |
| `rooms/` | Entities only (5 entities) | RoomBookingEntity exists |
| `notifications/` | Entities only (1 entity) | NotificationEntity exists |
| `administration/` | Entities + Module | AuditLogEntity exists |
| `accounts/` | Fully built | Canonical pattern to follow |
| `auth/` | Fully built | Guards, decorators ready |
| `approvals/` | Empty stub | Not needed for this feature |

### Reusable Components

| Component | File | Ready |
|-----------|------|-------|
| `JwtAuthGuard` | `src/modules/auth/guards/jwt-auth.guard.ts` | Yes |
| `PermissionsGuard` | `src/modules/auth/guards/permissions.guard.ts` | Yes |
| `@RequirePermissions()` | `src/modules/auth/decorators/require-permissions.decorator.ts` | Yes |
| `DataSource` for transactions | `src/modules/accounts/services/users.service.ts` (pattern) | Follow pattern |
| `ValidationPipe` global | Set in `main.ts` via `app.useGlobalPipes(...)` | Yes, but not enforced in `main.ts` currently—accounts uses `@UsePipes` on controller |
| Response format | Manual `{ success, message, data }` per controller | Follow pattern |

### Key Entity Details Already Existing

**MeetingEntity** (`meetings/entities/meeting.entity.ts`):
- Fields: `id`, `meetingCode`, `title`, `description`, `organizerId`, `hostId`, `roomId`, `startTime`, `endTime`, `status` (enum: draft/pending_approval/scheduled/in_progress/completed/cancelled), `meetingType`, `meetingMode`, `priority`, `visibilityLevel`, `expectedAttendeeCount`, `createdBy`, `updatedBy`, `createdAt`, `updatedAt`, `deletedAt`
- Relations: `organizer` → UserEntity, `host` → UserEntity

**MeetingRequestEntity** (`meetings/entities/meeting-request.entity.ts`):
- Enums: `MeetingRequestType` (create_meeting/update_time/...), `ApprovalStatus` (pending/approved/rejected/applied/cancelled), `ConflictCheckStatus`
- Fields: `id`, `requestCode`, `meetingId`, `requestType`, `requestedBy`, `requestedAt`, `targetRoomId`, `requestedStartTime`, `requestedEndTime`, `approvalMode`, `approvalStatus`, `conflictSummaryJson` (jsonb), `decisionBy`, `decisionAt`, `rejectionReason`, `requestPayloadJson` (jsonb), `ruleSnapshotJson` (jsonb), `appliedAt`, `notes`

**MeetingParticipantEntity** (`meetings/entities/meeting-participant.entity.ts`):
- Enums: `ParticipantRole` (host/attendee/approver/note_taker), `InvitationStatus`, `ParticipantAttendanceStatus`
- Fields: `id`, `meetingId`, `userId`, `participantRole`, `invitationStatus`, `attendanceStatus`, `invitedByUserId`

**RoomBookingEntity** (`rooms/entities/room-booking.entity.ts`):
- Enums: `BookingType`, `RoomBookingStatus` (pending/approved/active/completed/cancelled/released)
- Fields: `id`, `bookingCode`, `meetingId`, `roomId`, `reservedStartTime`, `reservedEndTime`, `status`, `bookingType`, `releaseReason`, `releasedById`

**NotificationEntity** (`notifications/entities/notification.entity.ts`):
- Enums: `NotificationType` (includes `meeting_request_created`), `NotificationChannel`, `NotificationDeliveryStatus` (includes `queued`)
- Fields: `id`, `type`, `channel`, `priority`, `title`, `body`, `senderId`, `recipientUserIdsJson` (jsonb), `recipientEmailsJson` (jsonb), `referenceType`, `referenceId`, `deliveryStatus`, `scheduledAt`, `sentAt`, `readAt`

**AuditLogEntity** (`administration/entities/audit-log.entity.ts`):
- Fields: `id`, `actorId`, `action`, `entityType`, `entityId`, `changesJson` (jsonb), `metadata` (jsonb), `ipAddress`, `userAgent`, `requestId`, `timestamp`, `createdAt`

### Technology Decisions

| Decision | Choice | Rationale |
|----------|--------|-----------|
| ORM | TypeORM (existing) | Already configured, entities exist |
| Auth | JWT + RBAC | JwtAuthGuard + PermissionsGuard ready |
| Transaction | `DataSource.transaction()` | Pattern in accounts service |
| Response format | `{ success, message, data }` | Already used across controllers |
| API prefix | `/api/v1` | Set in main.ts? Not found — but accounts uses `@Controller('users')` |
| Validation | class-validator DTOs + ValidationPipe | Existing pattern |
| Notification creation | Record only, no delivery | Spec requires record within transaction |
| Code generation | Server-side auto (meeting_code, booking_code) | FR-041, FR-042 |

### Key Risks

| Risk | Mitigation |
|------|------------|
| No standard response interceptor | Follow manual pattern from accounts controller |
| Existing MeetingEntity doesn't have `roomId` FK check | Rely on validator or query |
| `approvals/` module is empty stub | Not needed—meeting requests live in meetings module |
| No `NotificationsModule` exports for other modules | May need to import `TypeOrmModule.forFeature([NotificationEntity])` directly or set up exports |
| No `AdministrationModule` exports for AuditLog | Same issue—may need direct entity import |

### Unresolved Questions (from spec)

- Spec says "filter rooms available" (FR-006) — is this backend filtering or frontend? **Assumption**: Frontend filters via API query params; backend only validates at submit time.
- Approver resolution: How is the Manager/Approver determined for notification? **Assumption**: Room-level approver via `rooms.approver_id` or department-level; needs clarification in implementation.
- meeting_code format: `MT-YYYYMMDD-XXX` — sequential counter per day. Need Redis or DB sequence.
- booking_code format: `BK-YYYYMMDD-XXX` — same approach.
