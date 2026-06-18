# Research: Bắt đầu phiên họp (UC-IMM-01)

**Date**: 2026-06-16
**Context**: Codebase analysis for feature implementation plan.

## Codebase Analysis

### Module `live-meeting` (target)
- **Status**: Module skeleton only (`live-meeting.module.ts`) — empty `@Module({})`.
- **Cần tạo mới**: Controller, Service, DTOs, spec tests, entities (nếu cần import từ module khác).

### Codebase Patterns (từ `meetings` module — mẫu tham chiếu chính)

#### Module Structure
- Module import pattern: `TypeOrmModule.forFeature([...entities])` + imported modules (`AccountsModule`, `NotificationsModule`, `AdministrationModule`, `AuthModule`).
- Controller pattern: `@Controller()` decorator (no prefix at class level), full path in each method decorator.
- Service pattern: `@Injectable()` class, injected with `DataSource` for transactions.
- Guard pattern: `@UseGuards(JwtAuthGuard, PermissionsGuard)` + `@RequirePermissions('permission.code')`.

#### Transaction Pattern
```typescript
await this.dataSource.transaction(async (em) => {
  const meeting = await em.findOne(MeetingEntity, {
    where: { id },
    lock: { mode: 'pessimistic_write' },
  });
  // ... create/save entities via em ...
  await em.save(MeetingEventEntity, event);
  await em.save(AuditLogEntity, log);
});
```

#### Entity References
- `MeetingEntity` (meetings): `status`, `actualStartTime`, `hostId`, `organizerId`, `roomId`, `deletedAt`.
- `MeetingEventEntity` (meeting_events): `eventType` enum includes `MEETING_STARTED`, `sourceType` enum (`MANUAL`, `SYSTEM`).
- `RoomBookingEntity` (room_bookings): `status` enum (`PENDING`, `APPROVED`, `ACTIVE`, etc.), `meetingId`, `roomId`.
- `RoomBookingUsageEntity` (room_booking_usages): `usageStatus` enum (`NOT_STARTED`, `IN_USE`, etc.), `actualStartTime`, `bookingId`, `meetingId`, `roomId`.
- `AuditLogEntity` (audit_logs): `userId`, `actionType`, `entityType`, `entityId`, `oldValueJson`, `newValueJson`.
- `WebsocketService` (websocket module): `emitToRoom(room, event, data)` và `emitToUser(userId, event, data)`.

#### Notification Pattern
Sau transaction commit, notification được gọi best-effort:
```typescript
try {
  await this.notificationsService.createNotification({ ... });
} catch (notifError) {
  this.logger.error(...);
}
```

### Key Entities Alreadly Created
- `MeetingEventType.MEETING_STARTED` exists in `MeetingEventEntity`.
- `MeetingEventSourceType` has `MANUAL`, `SYSTEM` — **cần thêm `DEVICE`** cho AF1.
- `RoomBookingUsageEntity` already has `RoomUsageStatus.NOT_STARTED` and `IN_USE`.
- `RoomBookingEntity` already has `RoomBookingStatus.APPROVED` and `ACTIVE`.

### Existing Seed Files
- `src/database/seeds/` contains multiple permission seeds (e.g., `SeedMeetingCancelPermissions`).
- **Cần tạo seed mới**: `SeedMeetingSessionStartPermission` cho `meeting.session.start`.

### Permission `meeting.session.start`
- **Chưa tồn tại** trong codebase. Cần tạo mới.
- Align with `API_CONTRACT_v1.0_with_system_roles.md`: `INTERNAL_USER`, `MANAGER`, `BUSINESS_ADMIN`, `SYSTEM_ADMIN` roles được cấp permission này.

### WebSocket Pattern
- `WebsocketService` exposed as `emitToRoom(room: string, event: string, data: unknown)`.
- Meeting room convention: `meeting:{meetingId}`.
- Event name: `meeting.session.started`.

### AF1 (Device Check-in) — Internal Service Pattern
- Module `live-meeting` chỉ cung cấp internal method, không mở public endpoint cho thiết bị.
- Module `iot`/`attendance` chịu trách nhiệm nhận raw event, chuẩn hóa, và gọi internal service.
- Cần `InternalApiGuard` để bảo vệ internal endpoint.

## Technology Decisions

| Decision | Choice | Rationale |
|---|---|---|
| ORM | TypeORM (existing) | Already used across project |
| Transaction | `DataSource.transaction()` | Existing pattern |
| Row Lock | `lock: { mode: 'pessimistic_write' }` | Existing pattern |
| Realtime | Socket.IO via `WebsocketService` | Already set up |
| Permissions | `meeting.session.start` | Align with API contract |
| Audit Log | `AuditLogEntity` via `em.save()` | Existing pattern |
| Meeting Event | `MeetingEventEntity` via `em.create()` | Existing pattern |
| Notification | `NotificationsService.createNotification()` | Post-transaction best-effort |
| Source Type for AF1 | Need to add `DEVICE` to `MeetingEventSourceType` enum | Current enum lacks device source |

## Risks & Mitigations

| Risk | Mitigation |
|---|---|
| Race condition on concurrent start | `SELECT FOR UPDATE` với pessimistic lock |
| Realtime push failure | Best-effort sau commit, không rollback transaction |
| MeetingEventSourceType chưa có DEVICE | Thêm enum value trong entity, migration seed |
| Permission chưa tồn tại | Tạo migration/seed mới trước implement |
| Live-meeting module mới hoàn toàn | Kế thừa pattern từ meetings module có sẵn |
