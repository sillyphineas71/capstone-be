# Implementation Plan — UC-MM-03 Cập nhật phòng họp

- **Feature ID**: UC-MM-03
- **Feature Name**: Cập nhật phòng họp
- **Spec File**: `spec/features/meeting/feat-update-meeting-room/spec.md`
- **Research**: `spec/features/meeting/feat-update-meeting-room/research.md`
- **Data Model**: `spec/features/meeting/feat-update-meeting-room/data-model.md`
- **API Contract**: `spec/features/meeting/feat-update-meeting-room/contracts/update-meeting-room-api.md`
- **Quickstart**: `spec/features/meeting/feat-update-meeting-room/quickstart.md`

---

## 1. Feature Summary

Cho phép người tổ chức (organizer) hoặc chủ trì (host) cuộc họp cập nhật phòng họp vật lý của một cuộc họp đã được lên lịch (scheduled), với điều kiện meeting chưa bắt đầu. Hệ thống kiểm tra room conflict, capacity warning, release booking cũ, tạo booking mới, ghi event/audit, và gửi thông báo bất đồng bộ cho participants.

**Scope**: Chỉ thay đổi `meetings.room_id`. Mọi trường khác giữ nguyên 100%. Không thêm bảng mới. Không approval flow thủ công. Không xử lý recurring series master.

---

## 2. Technical Context

### 2.1 Tech Stack
- NestJS + TypeORM + PostgreSQL
- JWT auth + RBAC (permission-based)
- Transaction via `DataSource.transaction()`
- Notification async qua `background_jobs`

### 2.2 Existing Codebase Leverage

| Component | Hiện có | Sẽ làm |
|-----------|---------|--------|
| `MeetingEntity` | ✅ Đã có `roomId`, `updatedBy`, `updatedAt`, `startTime`, `endTime` | Không cần sửa |
| `RoomBookingEntity` | ✅ Đã có `BookingType.RELOCATED`, `RoomBookingStatus.RELEASED` | Không cần sửa |
| `MeetingRequestEntity` | ✅ Đã có `MeetingRequestType.UPDATE_ROOM`, `ApprovalMode.AUTO`, `ApprovalStatus.APPLIED` | Không cần sửa |
| `RoomEventEntity` | ✅ Đã có `eventType` string linh hoạt | Không cần sửa |
| `RoomBookingEntity.bookingCode` | ✅ Cần generate | Reuse `generateBookingCode()` |
| `getRoomAvailability()` | ✅ Đã có trong MeetingsService | Reuse |
| `getAvailableRooms()` | ✅ Đã có trong MeetingsService | Mở rộng thêm capacity filter & exclude current room |
| `checkParticipantConflicts()` | ✅ Đã có | Không cần dùng (không đổi participant) |
| `MeetingEventType` | ❌ Thiếu `ROOM_CHANGED` | **Thêm enum value** |
| `NotificationType` | ❌ Thiếu `MEETING_ROOM_UPDATED` | **Thêm enum value** |
| Permission `meeting.room.update` | ❌ Chưa có | **Thêm vào seed** |

### 2.3 Module Boundary
- **Controller**: `MeetingsController` (thêm 2 endpoints mới)
- **Service**: `MeetingsService` (thêm method `updateRoom`, `getAvailableRoomsForMeeting`)
- **No new module** — tất cả code trong `meetings` module hiện có

### 2.4 Constitution Check
- ✅ **DB Gate**: Không thêm bảng mới. Chỉ thêm enum values.
- ✅ **Security Gate**: JWT + RBAC cho mọi endpoint.
- ✅ **Scope Gate**: Chỉ đổi phòng, không đổi time/participants/title.
- ✅ **Module Gate**: Giữ trong meetings module, reuse room entities qua TypeOrm.forFeature().
- ✅ **API Gate**: Response format `{ success, message, data }`, HTTP codes đúng.
- ✅ **Auth Gate**: `JwtAuthGuard` + `PermissionsGuard` cho PATCH; chỉ `JwtAuthGuard` cho GET.
- ✅ **Test Gate**: Unit test cho service logic, DTO validation, và transaction rollback.

---

## 3. Scope Confirmation

### In Scope
- API lấy danh sách phòng khả dụng (`GET /meetings/:id/available-rooms`)
- API cập nhật phòng (`PATCH /meetings/:id/room`)
- Kiểm tra quyền (organizer/host check + permission guard)
- Kiểm tra meeting status (scheduled, chưa bắt đầu)
- Kiểm tra room conflict tại thời điểm submit (pessimistic lock)
- Capacity soft-warning với override confirmation
- Transaction: release booking cũ → tạo booking mới → update meeting
- Ghi meeting_events, room_events, audit_logs
- Gửi notification async (background job)
- Thêm enum values: `MeetingEventType.ROOM_CHANGED`, `NotificationType.MEETING_ROOM_UPDATED`
- Thêm seed permission: `meeting.room.update`

### Out of Scope (confirmed)
- ❌ Không cập nhật time/title/participants/agenda/recording policy
- ❌ Không xử lý recurring series master (từ chối với lỗi)
- ❌ Không approval flow thủ công
- ❌ Không thêm bảng mới
- ❌ Không xử lý auto-release / no-show
- ❌ Không xóa / tạo meeting mới

---

## 4. Data Model Impact

Chi tiết đầy đủ tại `data-model.md`.

**Tóm tắt thay đổi:**
- `meetings`: UPDATE `room_id`, `updated_by` (no new columns)
- `room_bookings` (cũ): UPDATE status → `released`
- `room_bookings` (mới): INSERT với `booking_type = relocated`, status `approved`
- `meeting_events`: INSERT với event_type `room_changed`
- `room_events`: INSERT 2 records (`room_released`, `room_reserved`)
- `meeting_requests`: INSERT snapshot (optional — request_type `update_room`, approval_mode `auto`, approval_status `applied`)
- `notifications`: INSERT cho participants
- `background_jobs`: INSERT job gửi notification
- `audit_logs`: INSERT với action `update_room`

**Enum changes:**
- `MeetingEventType` → thêm `ROOM_CHANGED = 'room_changed'`
- `NotificationType` → thêm `MEETING_ROOM_UPDATED = 'meeting_room_updated'`

---

## 5. API / Contract Plan

Chi tiết đầy đủ tại `contracts/update-meeting-room-api.md`.

### 5.1 Endpoints

| Method | Path | Auth | Permission | Purpose |
|--------|------|------|-----------|---------|
| GET | `/meetings/:meetingId/available-rooms` | JwtAuthGuard | None (any auth user) | Lấy danh sách phòng khả dụng |
| PATCH | `/meetings/:meetingId/room` | JwtAuthGuard + PermissionsGuard | `meeting.room.update` hoặc owner check | Cập nhật phòng |

### 5.2 Request/Response

**GET /meetings/:meetingId/available-rooms**
- Query: `capacityWarningMode` (bool), `includeCurrentRoom` (bool)
- Response 200: `{ success, message, data: RoomAvailableDto[] }`
- Mỗi RoomAvailableDto: `roomId, roomName, roomCode, capacity, location, equipmentFlags, availabilityStatus, isCurrentRoom, capacityWarning`

**PATCH /meetings/:meetingId/room**
- Body: `{ newRoomId (uuid, required), confirmCapacityOverride (bool, default false), changeReason (string, max 500, optional) }`
- Response 200: `{ success, message, data: UpdateRoomResponseDto }` với `meetingId, oldRoom, newRoom, oldBookingId, newBookingId, startTime, endTime, notificationStatus, updatedAt`
- Error codes: `ROOM_CAPACITY_WARNING` (422), `ROOM_CONFLICT` (409), `SAME_ROOM` (422), `INVALID_MEETING_STATUS` (409), `ROOM_CAPACITY_NOT_CONFIGURED` (422), `RECURRING_SERIES_UPDATE_NOT_SUPPORTED` (409), `MEETING_NOT_FOUND` (404), `FORBIDDEN` (403), `UNAUTHORIZED` (401), `VALIDATION_ERROR` (400)

---

## 6. Authorization Plan

### 6.1 Permission Model
- Permission name: `meeting.room.update`
- Seed vào bảng `permissions` và `role_permissions` (gán cho admin role)
- Naming convention: dot notation (vd: `meeting.create`, `meeting.cancel`, `meeting.room.update`)

### 6.2 Guard Strategy

**GET /meetings/:meetingId/available-rooms:**
- `@UseGuards(JwtAuthGuard)` — chỉ cần authenticated
- Không kiểm tra permission — bất kỳ user nào cũng xem được

**PATCH /meetings/:meetingId/room:**
- `@UseGuards(JwtAuthGuard, PermissionsGuard)` — yêu cầu authenticated + permission
- `@RequirePermissions('meeting.room.update')` — permission guard
- **Owner check trong service**: Nếu user có permission `meeting.room.update`, cho phép. Nếu không, kiểm tra user có phải `organizer_id` hoặc `host_id` không.
- Logic: `hasPermission → allow` OR `isOwnerOrHost → allow` ELSE `403`

### 6.3 Owner Check Logic
```typescript
const meeting = await em.findOne(MeetingEntity, {
  where: { id: meetingId },
  lock: { mode: 'pessimistic_write' },
});
const isOwner = meeting.organizerId === userId || meeting.hostId === userId;
const hasPermission = await this.checkPermission(userId, 'meeting.room.update');
if (!isOwner && !hasPermission) {
  throw new ForbiddenException({ ... });
}
```

---

## 7. Business Logic Plan

### 7.1 Service Method: `getAvailableRoomsForMeeting(meetingId, options)`

Dựa trên `getAvailableRooms()` hiện có, mở rộng thêm:

1. Load meeting để lấy `startTime`, `endTime`, `roomId`
2. Gọi query lấy rooms active, không maintenance
3. Loại bỏ phòng `capacity = null`
4. Loại bỏ phòng đang bị booking conflict (status pending/approved/active, time overlap)
5. Nếu `includeCurrentRoom = false`, loại bỏ phòng hiện tại
6. Nếu `capacityWarningMode = true`, tính capacity cho mỗi phòng dựa trên attendee count
7. Trả về danh sách đã enrich

### 7.2 Service Method: `updateMeetingRoom(meetingId, dto, authUser, clientContext)`

**Pre-validation (trước transaction):**
1. Load meeting với `pessimistic_write` lock (trong transaction)
2. Kiểm tra meeting tồn tại, không bị xóa mềm
3. Kiểm tra meeting status = `scheduled`
4. Kiểm tra `now < startTime`
5. Kiểm tra phòng mới active, capacity != null
6. Kiểm tra phòng mới != phòng hiện tại
7. Kiểm tra không phải recurring series master (recurrenceRuleId != null && parentMeetingId == null → từ chối)
8. Kiểm tra room conflict (reuse `getRoomAvailability`, exclude current meeting's old booking)
9. Tính attendee count (meeting_participants + meeting_external_participants)
10. Nếu capacity < attendee count && !confirmCapacityOverride → return 422 warning

**Transaction logic:**
```typescript
await this.dataSource.transaction(async (em) => {
  // 1. Lock meeting row
  const meeting = await em.findOne(MeetingEntity, {
    where: { id: meetingId },
    lock: { mode: 'pessimistic_write' },
  });

  // 2. Re-check all preconditions (in case of race condition)
  if (!meeting || meeting.status !== MeetingStatus.SCHEDULED) throw ...
  if (new Date(meeting.startTime) <= new Date()) throw ...

  // 3. Release old booking
  await em.update(RoomBookingEntity, { meetingId, roomId: meeting.roomId, status: Not(RoomBookingStatus.RELEASED) }, {
    status: RoomBookingStatus.RELEASED,
  });

  // 4. Generate new booking code
  const bookingCode = await this.generateBookingCodeTransaction(em);

  // 5. Create new booking
  const newBooking = em.create(RoomBookingEntity, {
    bookingCode,
    meetingId: meeting.id,
    roomId: newRoomId,
    bookingType: BookingType.RELOCATED,
    reservedStartTime: meeting.startTime,
    reservedEndTime: meeting.endTime,
    status: RoomBookingStatus.APPROVED,
    bookedBy: authUser.userId,
  });
  await em.save(RoomBookingEntity, newBooking);

  // 6. Update meeting.room_id
  await em.update(MeetingEntity, meetingId, {
    roomId: newRoomId,
    updatedBy: authUser.userId,
  });

  // 7. Insert meeting_events
  await em.save(MeetingEventEntity, {
    meetingId: meeting.id,
    eventType: MeetingEventType.ROOM_CHANGED,
    actorUserId: authUser.userId,
    sourceType: 'manual',
    description: `Đổi phòng từ "${oldRoomName}" sang "${newRoomName}"`,
    oldValueJson: { roomId: meeting.roomId, roomName: oldRoomName },
    newValueJson: { roomId: newRoomId, roomName: newRoomName },
    metadataJson: { changeReason: dto.changeReason, confirmCapacityOverride: dto.confirmCapacityOverride },
  });

  // 8. Insert room_events for old room
  await em.save(RoomEventEntity, {
    roomId: meeting.roomId,
    meetingId: meeting.id,
    eventType: 'room_released',
    actorUserId: authUser.userId,
    oldStatus: RoomBookingStatus.APPROVED,
    newStatus: RoomBookingStatus.RELEASED,
  });

  // 9. Insert room_events for new room
  await em.save(RoomEventEntity, {
    roomId: newRoomId,
    meetingId: meeting.id,
    eventType: 'room_reserved',
    actorUserId: authUser.userId,
    newStatus: RoomBookingStatus.APPROVED,
  });

  // 10. Insert meeting_requests (optional audit snapshot)
  await em.save(MeetingRequestEntity, {
    requestCode: bookingCode,
    meetingId: meeting.id,
    requestType: MeetingRequestType.UPDATE_ROOM,
    requestedBy: authUser.userId,
    targetRoomId: newRoomId,
    requestedStartTime: meeting.startTime,
    requestedEndTime: meeting.endTime,
    approvalMode: ApprovalMode.AUTO,
    approvalStatus: ApprovalStatus.APPLIED,
    conflictCheckStatus: ConflictCheckStatus.CLEAR,
    requestPayloadJson: {
      changeReason: dto.changeReason,
      confirmCapacityOverride: dto.confirmCapacityOverride,
      oldRoomId: meeting.roomId,
    },
    appliedAt: new Date(),
  });

  // 11. Insert audit_logs
  await em.save(AuditLogEntity, {
    userId: authUser.userId,
    actionType: 'update_room',
    entityType: 'meeting',
    entityId: meeting.id,
    oldValueJson: { roomId: meeting.roomId, roomName: oldRoomName },
    newValueJson: { roomId: newRoomId, roomName: newRoomName, changeReason: dto.changeReason, confirmCapacityOverride: dto.confirmCapacityOverride },
    ipAddress: clientContext.ipAddress,
    userAgent: clientContext.userAgent,
    severity: AuditLogSeverity.INFO,
  });

  return { meeting, newBooking, oldRoomName, newRoomName };
});
```

**Sau transaction:**
1. Tạo notification record
2. Queue background job gửi email
3. Nếu notification job fail → ghi audit warning, response vẫn 200

---

## 8. Validation Plan

### 8.1 DTO Validation (class-validator)

**UpdateMeetingRoomDto:**
| Field | Decorators |
|-------|-----------|
| `newRoomId` | `@IsUUID('4')`, `@IsNotEmpty()` |
| `confirmCapacityOverride` | `@IsOptional()`, `@IsBoolean()` |
| `changeReason` | `@IsOptional()`, `@IsString()`, `@MaxLength(500)` |

### 8.2 Business Validation (service layer)

| Check | Error Code | HTTP Status |
|-------|-----------|-------------|
| Meeting not found / soft-deleted | `MEETING_NOT_FOUND` | 404 |
| Meeting status != scheduled | `INVALID_MEETING_STATUS` | 409 |
| `now >= startTime` | `MEETING_ALREADY_STARTED` | 409 |
| User không có quyền | `FORBIDDEN` | 403 |
| New room = current room | `SAME_ROOM` | 422 |
| New room inactive / maintenance | `ROOM_NOT_AVAILABLE` | 422 |
| New room capacity = null | `ROOM_CAPACITY_NOT_CONFIGURED` | 422 |
| Room conflict (concurrency) | `ROOM_CONFLICT` | 409 |
| Recurring series master | `RECURRING_SERIES_UPDATE_NOT_SUPPORTED` | 409 |
| Capacity < attendee count (no override) | `ROOM_CAPACITY_WARNING` | 422 |

### 8.3 DTO Validation (query params — GET available-rooms)

| Field | Decorators |
|-------|-----------|
| `capacityWarningMode` | `@IsOptional()`, `@Transform(({value}) => value === 'true')` |
| `includeCurrentRoom` | `@IsOptional()`, `@Transform(({value}) => value === 'true')` |

---

## 9. Error Handling Plan

### 9.1 Error Codes

```typescript
export enum MeetingRoomUpdateError {
  MEETING_NOT_FOUND = 'MEETING_NOT_FOUND',
  FORBIDDEN = 'FORBIDDEN',
  INVALID_MEETING_STATUS = 'INVALID_MEETING_STATUS',
  MEETING_ALREADY_STARTED = 'MEETING_ALREADY_STARTED',
  SAME_ROOM = 'SAME_ROOM',
  ROOM_NOT_AVAILABLE = 'ROOM_NOT_AVAILABLE',
  ROOM_CAPACITY_NOT_CONFIGURED = 'ROOM_CAPACITY_NOT_CONFIGURED',
  ROOM_CONFLICT = 'ROOM_CONFLICT',
  ROOM_CAPACITY_WARNING = 'ROOM_CAPACITY_WARNING',
  RECURRING_SERIES_UPDATE_NOT_SUPPORTED = 'RECURRING_SERIES_UPDATE_NOT_SUPPORTED',
  TRANSACTION_FAILED = 'TRANSACTION_FAILED',
}
```

### 9.2 Exception Mapping

| Tình huống | Exception | Error Code |
|-----------|-----------|-----------|
| Unauthenticated | `UnauthorizedException` | `UNAUTHORIZED` |
| Forbidden | `ForbiddenException` | `FORBIDDEN` |
| Meeting not found | `NotFoundException` | `MEETING_NOT_FOUND` |
| Invalid status | `ConflictException` | `INVALID_MEETING_STATUS` |
| Meeting started | `ConflictException` | `MEETING_ALREADY_STARTED` |
| Room conflict | `ConflictException` | `ROOM_CONFLICT` |
| Recurring series | `ConflictException` | `RECURRING_SERIES_UPDATE_NOT_SUPPORTED` |
| Same room | `UnprocessableEntityException` | `SAME_ROOM` |
| Room inactive | `UnprocessableEntityException` | `ROOM_NOT_AVAILABLE` |
| Capacity not configured | `UnprocessableEntityException` | `ROOM_CAPACITY_NOT_CONFIGURED` |
| Capacity warning | `UnprocessableEntityException` | `ROOM_CAPACITY_WARNING` |
| Validation error | `BadRequestException` | `VALIDATION_ERROR` |
| Transaction failure | `InternalServerErrorException` | `TRANSACTION_FAILED` |

### 9.3 Notification Failure

Notification failure **không rollback** transaction chính. Xử lý:
1. Ghi `background_jobs` với status `pending`, maxRetries = 3
2. Nếu job fail → retry, sau 3 lần → set status `failed`
3. Ghi `audit_logs` với severity WARNING
4. Notification delivery status set to `partial_failed` hoặc `failed`
5. Response trả `notificationStatus: "failed"` hoặc `"retry_pending"`

---

## 10. Testing Strategy

### 10.1 Unit Tests (MeetingsService)

| Test case | Mô tả | Expected |
|-----------|-------|----------|
| `updateRoom_success_organizer` | Organizer đổi phòng hợp lệ | 200, booking released, booking created |
| `updateRoom_success_host` | Host đổi phòng | 200 |
| `updateRoom_success_admin` | Admin đổi phòng thay host | 200, audit actor = admin |
| `updateRoom_forbidden_participant` | Participant cố gắng đổi | 403 |
| `updateRoom_forbidden_unauth` | Unauthenticated | 401 |
| `updateRoom_invalid_status` | Meeting không scheduled | 409 |
| `updateRoom_meeting_started` | now >= startTime | 409 |
| `updateRoom_same_room` | newRoomId = current room | 422 SAME_ROOM |
| `updateRoom_room_conflict` | Room bị booking khác chiếm | 409 ROOM_CONFLICT |
| `updateRoom_capacity_warning` | capacity < attendee, no override | 422 ROOM_CAPACITY_WARNING |
| `updateRoom_capacity_override` | capacity warning + override | 200 |
| `updateRoom_room_capacity_null` | room.capacity = null | 422 ROOM_CAPACITY_NOT_CONFIGURED |
| `updateRoom_recurring_master` | Series master | 409 RECURRING_SERIES_UPDATE_NOT_SUPPORTED |
| `updateRoom_transaction_rollback` | Lỗi sau release → rollback | Dữ liệu không đổi |
| `updateRoom_data_preserved` | Các trường khác không đổi | title, time, participants giữ nguyên |

### 10.2 Integration Tests

| Test case | Mô tả |
|-----------|-------|
| Full flow: Organizer → đổi phòng → kiểm tra booking cũ/mới, events, audit logs |
| Concurrency: Hai request cùng lúc cho cùng phòng → một 409, một 200 |
| Double-click: Submit 2 lần → idempotent (không duplicate booking) |

### 10.3 DTO Validation Tests

| Test case | Expected |
|-----------|----------|
| `newRoomId` missing | 400 |
| `newRoomId` invalid UUID | 400 |
| `changeReason` > 500 chars | 400 |

---

## 11. Implementation Phases

### Phase 1: Enum & Permission Changes
**Files:**
- `src/modules/meetings/entities/meeting-event.entity.ts` — thêm `ROOM_CHANGED = 'room_changed'`
- `src/modules/notifications/entities/notification.entity.ts` — thêm `MEETING_ROOM_UPDATED = 'meeting_room_updated'`
- `src/database/seeds/` — tạo seed mới: `SeedMeetingRoomUpdatePermission.ts`

### Phase 2: DTOs
**New files:**
- `src/modules/meetings/dto/update-meeting-room.dto.ts`
- `src/modules/meetings/dto/update-meeting-room-response.dto.ts`
- `src/modules/meetings/dto/available-room.dto.ts`

### Phase 3: Service Methods
**File:** `src/modules/meetings/services/meetings.service.ts`
- Add method: `getAvailableRoomsForMeeting(meetingId, options)`
- Add method: `updateMeetingRoom(meetingId, dto, authUser, clientContext)`
- Add private helper: `getAttendeeCount(meetingId)`

### Phase 4: Controller Endpoints
**File:** `src/modules/meetings/controllers/meetings.controller.ts`
- Add: `GET /meetings/:meetingId/available-rooms`
- Add: `PATCH /meetings/:meetingId/room`

### Phase 5: Notification Logic
**File:** `src/modules/meetings/services/meetings.service.ts`
- Logic tạo notification trong service (sau transaction)
- Logic tạo background_job trong service

### Phase 6: Tests
**Files:**
- `src/modules/meetings/tests/meetings.service.spec.ts`
- `src/modules/meetings/tests/meetings.controller.spec.ts`

---

## 12. Risks & Mitigations

| Risk | Impact | Mitigation |
|------|--------|-----------|
| Race condition: 2 users đổi phòng cho 2 meeting khác nhau vào cùng phòng | Conflict | Pessimistic lock + re-check conflict tại submit |
| Double click / duplicate submit | Duplicate booking | Idempotency: check xem booking released + booking relocated cho meeting đã tồn tại chưa |
| Meeting bị cancel trong lúc đổi phòng | Data inconsistency | Lock meeting row + re-check status trong transaction |
| Notification job fail sau khi đổi phòng thành công | Mất thông báo | Không rollback, retry 3 lần, ghi audit warning |
| Phòng bị maintenance giữa chừng | Chọn phòng không hợp lệ | Re-check room active trong transaction |
| Participant count thay đổi trước submit | Capacity warning sai | Tính attendee count tại submit, không cache |

---

## 13. Acceptance Criteria Traceability

| Acceptance Criteria | Phases liên quan | Test Strategy |
|---|---|---|
| AC-001: Organizer đổi phòng thành công | Phase 3, 4, 5 | Unit: `updateRoom_success_organizer` |
| AC-002: Host đổi phòng thành công | Phase 3, 4 | Unit: `updateRoom_success_host` |
| AC-003: Admin đổi phòng thành công | Phase 3, 4, 6 | Unit: `updateRoom_success_admin` |
| AC-004: Participant bị chặn | Phase 3, 6 | Unit: `updateRoom_forbidden_participant` |
| AC-005: Unauthenticated bị chặn | Phase 6 | Guard test / E2E |
| AC-006: Meeting không scheduled | Phase 3 | Unit: `updateRoom_invalid_status` |
| AC-007: Meeting đã bắt đầu | Phase 3 | Unit: `updateRoom_meeting_started` |
| AC-008: Chọn phòng trùng | Phase 3 | Unit: `updateRoom_same_room` |
| AC-009: Conflict với booking khác | Phase 3 | Unit: `updateRoom_room_conflict` |
| AC-010: Capacity warning trả về | Phase 3 | Unit: `updateRoom_capacity_warning` |
| AC-011: Override capacity được chấp nhận | Phase 3 | Unit: `updateRoom_capacity_override` |
| AC-012: Transaction rollback | Phase 3 | Unit: `updateRoom_transaction_rollback` + Integration |
| AC-013: Booking cũ released, mới created | Phase 3, 5 | Unit + Integration |
| AC-014: Audit log được ghi | Phase 3 | Unit + Integration |
| AC-015: Các trường khác không đổi | Phase 3 | Unit: `updateRoom_data_preserved` |

---

## Complexity Tracking

| Item | Complexity | Justification |
|------|-----------|--------------|
| Thêm enum values (2 files) | Trivial | Không phá vỡ existing code |
| Thêm DTO (3 files) | Low | Pattern chuẩn của dự án |
| Thêm service methods (2 methods) | Medium | Business logic phức tạp (transaction, conflict, capacity), nhưng pattern đã có sẵn trong MeetingsService |
| Thêm controller endpoints (2 routes) | Low | Pattern chuẩn |
| Thêm seed permission | Trivial | Pattern chuẩn |
| Tests | Medium | 15+ test cases |
| **Tổng thể** | **Medium** | Không break change, không new table, reuse existing patterns heavily |

Không có vi phạm constitution nào. Tất cả thay đổi nằm trong module `meetings` hiện có, chỉ thêm enum values và service methods.
