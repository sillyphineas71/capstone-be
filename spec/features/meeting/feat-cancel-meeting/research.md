# Research: Cancel Scheduled Meeting (UC-MM-04)

## 📝 CHANGELOG & REVISION HISTORY
| Ngày cập nhật | Tóm tắt thay đổi | Các dòng thay đổi |
| :--- | :--- | :--- |
| 2026-06-09 | Research analysis cho UC-MM-04 | Toàn bộ file |

---

## Codebase Analysis

### Entity Inventory

| Entity | File | Key Fields for This Feature |
|---|---|---|
| `MeetingEntity` | `src/modules/meetings/entities/meeting.entity.ts` | `id`, `organizerId`, `hostId`, `status`, `cancellationReason`, `startTime`, `createdBy`, `updatedBy`, `createdAt`, `updatedAt`, `deletedAt` |
| `RoomBookingEntity` | `src/modules/rooms/entities/room-booking.entity.ts` | `id`, `meetingId`, `roomId`, `status`, `cancellationReason`, `startTime`, `endTime` |
| `RoomBookingUsageEntity` | `src/modules/rooms/entities/room-booking-usage.entity.ts` | `id`, `bookingId`, `usageStatus`, `releasedAt`, `releasedBy`, `releaseReason` |
| `MeetingEventEntity` | `src/modules/meetings/entities/meeting-event.entity.ts` | `id`, `meetingId`, `eventType`, `eventTime`, `actorUserId`, `description`, `oldValueJson`, `newValueJson`, `metadataJson` |
| `RoomEventEntity` | `src/modules/rooms/entities/room-event.entity.ts` | `id`, `roomId`, `bookingId`, `eventType`, `oldStatus`, `newStatus`, `description` |
| `NotificationEntity` | `src/modules/notifications/entities/notification.entity.ts` | `id`, `notificationType`, `channel`, `subject`, `content`, `recipientUserIdsJson`, `recipientEmailsJson`, `deliveryStatus`, `payloadJson` |
| `BackgroundJobEntity` | `src/modules/administration/entities/background-job.entity.ts` | `id`, `jobType`, `status`, `payloadJson`, `attempts` |
| `AuditLogEntity` | `src/modules/administration/entities/audit-log.entity.ts` | `id`, `userId`, `actionType`, `entityType`, `entityId`, `oldValueJson`, `newValueJson`, `metadataJson`, `ipAddress`, `userAgent` |

### Enum Inventory

| Enum | File | Relevant Values |
|---|---|---|
| `MeetingStatus` | `meeting.entity.ts` | `SCHEDULED = 'scheduled'`, `CANCELLED = 'cancelled'` |
| `RoomBookingStatus` | `room-booking.entity.ts` | `PENDING`, `APPROVED`, `CANCELLED` (not `RELEASED` for user cancel) |
| `UsageStatus` | `room-booking-usage.entity.ts` | `NOT_STARTED = 'not_started'`, `RELEASED = 'released'` |
| `MeetingEventType` | `meeting-event.entity.ts` | `STATUS_CHANGED = 'status_changed'` ✅ exists |
| `NotificationType` | `notification.entity.ts` | `CANCELLATION = 'cancellation'` ✅ exists |
| `NotificationChannel` | `notification.entity.ts` | `EMAIL`, `IN_APP` |
| `AuditLogSeverity` | `audit-log.entity.ts` | `INFO` |

### Existing Pattern Analysis

| Pattern | File Reference | Notes |
|---|---|---|
| Transaction + pessimistic lock | `meeting-request-review.service.ts` | `dataSource.transaction(async (em) => { em.findOne(..., { lock: { mode: 'pessimistic_write' } }) })` |
| Event creation | `meeting-request-review.service.ts` | `em.create(MeetingEventEntity, { eventType, meetingId, oldValueJson, newValueJson, ... })` |
| Notification creation | `meetings.service.ts` (updateMeetingTime) | `repository.create(NotificationEntity, {...})` + `repository.save()` sau transaction |
| Background job creation | `meetings.service.ts` (updateMeetingTime) | `repository.create(BackgroundJobEntity, {...})` sau transaction |
| Audit log | `meeting-request-review.service.ts` | `em.create(AuditLogEntity, {...})` + `em.save()` trong transaction |
| Permission guard | `meetings.controller.ts` | `@UseGuards(JwtAuthGuard, PermissionsGuard)` + `@RequirePermissions('...')` |
| Current user extraction | `meetings.controller.ts` | `request['user'] as { userId: string }` |
| DTO validation | `update-meeting-room.dto.ts` | class-validator + whitelist + forbidNonWhitelisted |
| Response format | `meetings.controller.ts` | `{ success, message, data }` |

### Key Decisions

| Decision | Choice | Rationale |
|---|---|---|
| **Locking strategy** | `pessimistic_write` | Pattern existing trong `meeting-request-review.service.ts`. Đảm bảo không concurrent cancel. |
| **Notification timing** | After transaction commit | Pattern từ `meetings.service.ts` updateMeetingTime. Email failure không rollback core operation. |
| **Usage update condition** | Only if `usage_status = 'not_started'` | Spec FR-010/FR-023. Không update usage `in_use`, `completed`, `no_show`. |
| **Booking status** | `'cancelled'` (not `'released'`) | Spec clarify #4. `released` reserved for auto-release/no-show behavior. |
| **Meeting event type** | `'status_changed'` | MeetingEventType đã có sẵn. Spec clarify #5. Dùng old/new JSON để lưu context. |
| **cancelledAt** | Derived from `updated_at` | DB v3.2 Compact không có cột `cancelled_at`. Spec clarify #3. |
| **Authorization** | Guard on `cancel.own` + service check `organizer_id`/`host_id` | Spec clarify #2. `created_by` không dùng cho authorization. |

### No Clarifications Remain
Tất cả 6 clarify issues đã được resolve và áp dụng vào spec. Không còn điểm mù.
