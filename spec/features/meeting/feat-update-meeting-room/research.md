# Research — UC-MM-03 Cập nhật phòng họp

## Codebase Analysis

### Existing Module Structure

| Module | Implementation Status | Liên quan đến feature |
|--------|----------------------|-----------------------|
| **meetings** | FULLY IMPLEMENTED — controllers, services, DTOs, entities (8) | Core — cần thêm method `updateRoom` vào MeetingsService và controller endpoint mới |
| **rooms** | Entities only (5 entities) | RoomEntity, RoomBookingEntity, RoomEventEntity đã có sẵn enums cần dùng |
| **administration** | Entities only (3 entities) | AuditLogEntity, BackgroundJobEntity đã có — cần service để ghi |
| **notifications** | Entities only (1 entity) | NotificationEntity đã có — cần service để ghi |
| **accounts** | FULLY IMPLEMENTED | UserEntity, RoleEntity, PermissionEntity — dùng cho permission check |

### Key Findings

1. **Meeting entity** (`meetings`):
   - Đã có `roomId` (nullable), `updatedBy`, `updatedAt`, `startTime`, `endTime`
   - `status` enum: `draft`, `pending_approval`, `scheduled`, `in_progress`, `completed`, `cancelled`
   - Soft delete qua `deletedAt`

2. **RoomBooking entity** (`room_bookings`):
   - `BookingType` enum đã có `RELOCATED = 'relocated'`
   - `RoomBookingStatus` enum đã có `RELEASED = 'released'`
   - Các status conflict check: `PENDING`, `APPROVED`, `ACTIVE`
   - Các bỏ qua: `COMPLETED`, `CANCELLED`, `RELEASED`

3. **MeetingRequest entity** (`meeting_requests`):
   - `MeetingRequestType` enum đã có `UPDATE_ROOM = 'update_room'`
   - `ApprovalMode` enum đã có `AUTO = 'auto'`
   - `ApprovalStatus` enum đã có `APPLIED = 'applied'`
   - Đã có `requestPayloadJson`, `targetRoomId`

4. **MeetingEvent entity** (`meeting_events`):
   - `MeetingEventType` enum **chưa có** `ROOM_CHANGED` — cần thêm
   - Đã có `oldValueJson`, `newValueJson`, `metadataJson`, `actorUserId`

5. **RoomEvent entity** (`room_events`):
   - `eventType` là string (không phải enum) — linh hoạt, dùng `room_released` / `room_reserved`
   - Đã có `oldStatus`, `newStatus`, `meetingId`, `bookingId`

6. **Notification entity** (`notifications`):
   - `NotificationType` enum **chưa có** `MEETING_ROOM_UPDATED` — cần thêm
   - Đã có `recipientUserIdsJson`, `channel`, `deliveryStatus`, `retryCount`

7. **AuditLog entity** (`audit_logs`):
   - Đã có `actionType`, `entityType`, `entityId`, `oldValueJson`, `newValueJson`, `ipAddress`, `userAgent`

8. **BackgroundJob entity** (`background_jobs`):
   - Đã có `jobType`, `status`, `payload`, `retryCount`, `maxRetries`

9. **MeetingsService** đã có:
   - `getRoomAvailability()` — check room conflict (có thể tái sử dụng)
   - `getAvailableRooms()` — lọc phòng khả dụng (có thể tái sử dụng)
   - `checkParticipantConflicts()` — check participant conflict
   - Transaction pattern: `dataSource.transaction(async em => {...})`
   - `generateBookingCode()` — tạo booking code

10. **Controller pattern**:
    - Route: `meetings` controller, không phải sub-controller riêng
    - Guard: `JwtAuthGuard` + `PermissionsGuard` + `@RequirePermissions()`
    - Response: `{ success, message, data }`

### Existing Permission Seed
- File pattern: `src/database/seeds/20260608025437-SeedMeetingRequestPermissions.ts`
- Permission naming convention: `meeting.cancel`, `meeting.approve`, `meeting.reject`
- Need to add: `meeting.room.update` nếu chưa có

### Gaps cần xử lý
1. MeetingEventType thiếu `ROOM_CHANGED`
2. NotificationType thiếu `MEETING_ROOM_UPDATED`
3. Chưa có permission `meeting.room.update` trong seed
4. Chưa có DTO cho update room endpoint
5. Chưa có service method `updateRoom`

## Technology Decisions

| Decision | Choice | Rationale |
|----------|--------|-----------|
| Module chính | `meetings` module | MeetingsService đã có đầy đủ pattern, giảm thiểu code mới |
| Transaction | `dataSource.transaction(async em => {...})` | Pattern hiện có trong MeetingsService |
| Conflict check | Tái sử dụng `getRoomAvailability()` | Logic đã đúng vì bỏ qua RELEASED, CANCELLED |
| Available room search | Cải tiến `getAvailableRooms()` cộng thêm filter capacity | Có thể tái sử dụng có mở rộng |
| Permission | `meeting.room.update` | Theo convention dot notation hiện có |
| Guard | `JwtAuthGuard` + `PermissionsGuard` | Pattern chuẩn của dự án |
| MeetingEvent type | Thêm `ROOM_CHANGED` vào enum | Cần thiết cho event tracking |
| Notification type | Thêm `MEETING_ROOM_UPDATED` vào enum | Cần thiết cho notification |
| Booking type | `BookingType.RELOCATED` | Đã có sẵn trong enum |
| Booking status (cũ) | `RoomBookingStatus.RELEASED` | Đã có sẵn trong enum |
| Generator code | `generateBookingCode()` | Tái sử dụng |

None of these technology decisions violate the Database Integrity (no new tables), Security-First, or No Scope Creep principles.

## Alternatives Considered

| Alternative | Rejected because |
|-------------|-----------------|
| Tạo module riêng `update-meeting-room` | MeetingsService đã có đủ pattern, circular dependency dễ quản lý hơn khi giữ trong meetings module |
| Dùng raw SQL transaction | `dataSource.transaction` pattern đã đủ mạnh và type-safe hơn |
| Thêm bảng mới | Spec cấm — mọi dữ liệu đã có trong 39 bảng hiện tại |
