# Implementation Plan: Cancel Scheduled Meeting (UC-MM-04)

## 📝 CHANGELOG & REVISION HISTORY
| Ngày cập nhật | Tóm tắt thay đổi | Các dòng thay đổi |
| :--- | :--- | :--- |
| 2026-06-09 | Tạo plan lần đầu cho UC-MM-04 Hủy cuộc họp | Toàn bộ file |

---

- **Feature ID**: MEETING-CANCEL-001
- **Plan Version**: 1.0
- **Based on Spec**: `spec.md` (v2026-06-09, clarified)
- **Target Module**: `meetings` / `meeting-management`
- **Branch**: `008-cancel-scheduled-meeting`

---

## 1. Feature Summary

Tính năng cho phép **Meeting Organizer, Meeting Host hoặc System Admin** hủy một cuộc họp đã được lên lịch (`scheduled`) và chưa bắt đầu. Khi hủy, hệ thống:

- Cập nhật `meetings.status = 'cancelled'`
- Giải phóng `room_bookings` liên quan (status `cancelled`)
- Giải phóng `room_booking_usages` nếu có và đang `not_started`
- Ghi `meeting_events` (`event_type = 'status_changed'`) và `room_events` (`event_type = 'room_released'`)
- Ghi `audit_logs` cho cả cancel meeting và release room
- Tạo `notifications` + `background_jobs` để gửi thông báo bất đồng bộ đến participants

---

## 2. Technical Context

### 2.1 Tech Stack
- **Runtime**: Node.js + NestJS
- **ORM**: TypeORM (DataSource + transaction + pessimistic lock)
- **Database**: PostgreSQL (DB v3.2 Compact, 39 bảng)
- **Auth**: JWT (stateless) + RBAC via PermissionsGuard
- **Validation**: class-validator + ValidationPipe (whitelist + forbidNonWhitelisted)

### 2.2 Existing Codebase Analysis

| Component | Status | Ghi chú |
|---|---|---|
| `MeetingEntity.cancellationReason` | ✅ Đã có | `@Column({ name: 'cancellation_reason', type: 'text', nullable: true })` |
| `RoomBookingEntity.cancellationReason` | ✅ Đã có | `@Column({ name: 'cancellation_reason', type: 'text', nullable: true })` |
| `MeetingStatus.CANCELLED` | ✅ Đã có | Enum value `'cancelled'` |
| `RoomBookingStatus.CANCELLED` | ✅ Đã có | Enum value `'cancelled'` |
| `NotificationType.CANCELLATION` | ✅ Đã có | Enum value `'cancellation'` |
| `MeetingEventType.STATUS_CHANGED` | ✅ Đã có | Enum value `'status_changed'` |
| `RoomBookingUsageEntity` | ✅ Đã có | Entity với `usageStatus`, `releasedAt`, `releasedBy`, `releaseReason` |
| `RoomEventEntity` | ✅ Đã có | Entity với `oldStatus`, `newStatus`, `description` |
| `BackgroundJobEntity` | ✅ Đã có | Entity với `jobType`, `status`, `payloadJson` |
| `MeetingsModule` | ✅ Đã có | Module cần update (thêm service method, controller endpoint) |
| `cancel` method trong `MeetingsService` | ❌ Chưa có | Cần tạo mới |
| Cancel endpoint trong controller | ❌ Chưa có | Cần tạo mới |
| Permission seed (`meeting.cancel.own`, `meeting.cancel.any`) | ❌ Chưa có | Cần seed migration mới |
| `cancel` DTO | ❌ Chưa có | Cần tạo `CancelMeetingDto` |
| `cancel` response DTO | ❌ Chưa có | Cần tạo `CancelMeetingResponseDto` |

### 2.3 Patterns to Follow

- **Transaction**: `this.dataSource.transaction(async (em) => {...})` với `pessimistic_write` lock (pattern từ `meeting-request-review.service.ts`, `meetings.service.ts`)
- **Auth**: `@UseGuards(JwtAuthGuard, PermissionsGuard)` + `@RequirePermissions('meeting.cancel.own')` (pattern từ `meetings.controller.ts`)
- **Current User**: `request['user'] as { userId: string }` (pattern từ controller)
- **Notification**: Tạo `NotificationEntity` + `BackgroundJobEntity` *sau khi* transaction commit (pattern từ `meetings.service.ts`: `updateMeetingTime`)
- **Audit**: `em.create(AuditLogEntity, {...})` bên trong transaction (pattern từ `meeting-request-review.service.ts`)
- **Event**: `em.create(MeetingEventEntity, {...})` + `em.create(RoomEventEntity, {...})` bên trong transaction
- **DTO**: class-validator decorators, whitelist + forbidNonWhitelisted
- **Error**: `NotFoundException`, `ConflictException`, `ForbiddenException`, `BadRequestException`, `UnprocessableEntityException` với object `{ success, message, error: { code, details } }`

---

## 3. Scope Confirmation

### 3.1 In Scope
- POST `/api/v1/meetings/:meetingId/cancel` endpoint
- Auth + authorization (organizer_id/host_id/admin)
- Validate meeting status (`scheduled`), time (`start_time > now`)
- Optional `cancellationReason` (max 1000 chars, trim)
- Update `meetings` status + cancellation_reason + updated_by + updated_at
- Update `room_bookings` status = `cancelled` + cancellation_reason + updated_at
- Update `room_booking_usages` if exists AND `not_started` → `released`
- Create `meeting_events` with `event_type = 'status_changed'`
- Create `room_events` with `event_type = 'room_released'` (nếu có room booking)
- Create `audit_logs` (cancel + release)
- Create `notifications` + `background_jobs` for email
- Transaction + pessimistic lock
- Concurrent cancel handling
- Response: `{ meetingId, status, cancelledAt, cancelledBy, roomReleased, releasedBookingId, notificationStatus }`
- Seed permissions: `meeting.cancel.own`, `meeting.cancel.any`

### 3.2 Out of Scope (confirmed from spec)
- Hard delete meeting data
- Restore cancelled meeting
- Cancel recurring series
- End in-progress meeting early
- Edit meeting time/room
- Approval workflow for cancellation
- Per-recipient email retry
- Synchronous email sending

### 3.3 Constitution Gate Check

| Gate | Status | Ghi chú |
|---|---|---|
| **DB Gate** | ✅ PASS | Không thêm bảng mới. Chỉ dùng existing columns. |
| **Security Gate** | ✅ PASS | JWT + PermissionsGuard. user_id từ JWT. Không log secret. |
| **Scope Gate** | ✅ PASS | Bám sát UC-MM-04 spec. Không mở rộng. |
| **Module Gate** | ✅ PASS | Logic trong `meetings` module. Gọi notification/administration qua import. |
| **API Gate** | ✅ PASS | Tuân thủ response convention. Dùng HTTP codes chuẩn. |
| **Auth Gate** | ✅ PASS | JwtAuthGuard + PermissionsGuard. user_id từ JWT. |
| **Test Gate** | ✅ PASS | Unit test cho service + DTO + controller. |

### 3.4 Complexity Tracking
Không có vi phạm constitution. Không cần justification.

---

## 4. Data Model Impact

### 4.1 Bảng bị ảnh hưởng (cập nhật, không thêm mới)

| Bảng | Thao tác | Field bị ảnh hưởng |
|---|---|---|
| `meetings` | UPDATE | `status`, `cancellation_reason`, `updated_by`, `updated_at` |
| `room_bookings` | UPDATE | `status`, `cancellation_reason`, `updated_at` |
| `room_booking_usages` | UPDATE (có điều kiện) | `usage_status`, `released_at`, `released_by`, `release_reason` |

### 4.2 Bảng được INSERT (tạo mới)

| Bảng | Mục đích |
|---|---|
| `meeting_events` | Ghi event `status_changed` với old/new value JSON |
| `room_events` | Ghi event `room_released` nếu có room booking |
| `audit_logs` | Ghi audit cancel meeting + release room |
| `notifications` | Tạo notification cancellation cho participants |
| `background_jobs` | Queue job gửi email |

### 4.3 Seed / Migration
- **Migration**: Tạo seed file `20260609000002-SeedMeetingCancelPermissions.ts` để thêm permissions:
  - `meeting.cancel.own` → assigned to roles: employee, manager, admin
  - `meeting.cancel.any` → assigned to role: admin
- **Không có schema migration** vì không thêm bảng/cột mới.

---

## 5. API / Contract Plan

### 5.1 Endpoint
- **Method**: `POST`
- **Path**: `/api/v1/meetings/:meetingId/cancel`
- **Content-Type**: `application/json`

### 5.2 Request
```json
{
  "cancellationReason": "Host có việc đột xuất" (optional, string, max 1000 chars)
}
```

### 5.3 Success Response (200 OK)
```json
{
  "success": true,
  "message": "Cuộc họp đã được hủy thành công",
  "data": {
    "meetingId": "uuid",
    "status": "cancelled",
    "cancelledAt": "ISO-8601 (derived from updated_at)",
    "cancelledBy": "uuid",
    "roomReleased": true/false,
    "releasedBookingId": "uuid or null",
    "notificationStatus": "queued | failed_to_queue"
  }
}
```

### 5.4 Error Responses
| HTTP Status | Error Code | Điều kiện |
|---|---|---|
| 400 | `VALIDATION_ERROR` | meetingId không phải UUID, body chứa field lạ |
| 401 | `UNAUTHORIZED` | Không có JWT token |
| 403 | `FORBIDDEN` | Không có quyền `meeting.cancel.own` hoặc `meeting.cancel.any` |
| 404 | `MEETING_NOT_FOUND` | Meeting không tồn tại hoặc đã soft-delete |
| 409 | `MEETING_ALREADY_CANCELLED` | Meeting đã cancelled |
| 409 | `INVALID_MEETING_STATUS` | Meeting không ở trạng thái `scheduled` |
| 409 | `MEETING_ALREADY_STARTED` | `start_time <= now` |
| 409 | `CONCURRENT_MODIFICATION` | Concurrent cancel |
| 422 | `VALIDATION_ERROR` | cancellationReason > 1000 ký tự |

### 5.5 Full Contract
Xem file `contracts/meeting-cancel-api.md`.

---

## 6. Authorization Plan

### 6.1 Permission Design
| Permission | Scope | Roles mặc định |
|---|---|---|
| `meeting.cancel.own` | User tự hủy meeting của mình (kiểm tra `organizer_id`/`host_id`) | employee, manager |
| `meeting.cancel.any` | Hủy bất kỳ meeting nào | admin |

### 6.2 Authorization Flow
1. `JwtAuthGuard` → xác thực user, gắn `request['user']`
2. `PermissionsGuard` + `@RequirePermissions('meeting.cancel.own')` → kiểm tra user có permission
3. **Service layer**: kiểm tra bổ sung:
   - Nếu user có `meeting.cancel.any` → bypass ownership check
   - Nếu user chỉ có `meeting.cancel.own` → verify `currentUser.id === meeting.organizer_id` OR `currentUser.id === meeting.host_id`
   - `meetings.created_by` **không được dùng** để xác định quyền hủy

### 6.3 Error
- `403 Forbidden` với error code `FORBIDDEN` nếu không thỏa điều kiện

---

## 7. Business Logic Plan

### 7.1 Transaction Boundary
Toàn bộ các bước sau chạy trong **một transaction** (`dataSource.transaction`):

```
BEGIN TRANSACTION
  LOCK meeting (pessimistic_write)
  LOCK room_booking (pessimistic_write) nếu có

  VALIDATE: meeting exists AND not soft-deleted
  VALIDATE: meeting.status === 'scheduled'
  VALIDATE: meeting.start_time > now
  VALIDATE: currentUser is organizer OR host OR admin

  UPDATE meetings SET status = 'cancelled',
                       cancellation_reason = :reason,
                       updated_by = :userId,
                       updated_at = now()

  IF booking exists AND booking.status IN ('pending', 'approved'):
    UPDATE room_bookings SET status = 'cancelled',
                              cancellation_reason = :reason,
                              updated_at = now()

  IF room_booking_usages exists AND usage_status = 'not_started':
    UPDATE room_booking_usages SET usage_status = 'released',
                                    released_at = now(),
                                    released_by = :userId,
                                    release_reason = :reason

  INSERT INTO meeting_events (event_type, meeting_id, description,
    actor_user_id, old_value_json, new_value_json, metadata_json, ...)

  IF room booking was released:
    INSERT INTO room_events (event_type, room_id, booking_id, ...)

  INSERT INTO audit_logs (cancel action)
  IF room booking was released:
    INSERT INTO audit_logs (release action)

COMMIT
```

### 7.2 Outside Transaction (after commit)
```
IF transaction succeeded:
  TRY:
    INSERT notification
    INSERT background_job (type: send_email, payload: notification_id)
    SET notificationStatus = 'queued'
  CATCH:
    LOG error
    SET notificationStatus = 'failed_to_queue'
    (không rollback transaction)
```

### 7.3 State Machine
```
meeting:  scheduled ──► cancelled  (terminal)
booking:  pending ──► cancelled (terminal)
booking:  approved ──► cancelled (terminal)
usage:    not_started ──► released (terminal)
```

### 7.4 Key Business Rules Implemented
- **BR-001**: Organizer (`organizer_id`), Host (`host_id`), Admin (`cancel.any`)
- **BR-002**: Chỉ `scheduled` + `start_time > now`
- **BR-003**: `cancelled` là terminal state
- **BR-004**: No hard delete
- **BR-005**: Booking released, phòng available cho booking mới
- **BR-006**: Notification async (background_job)
- **BR-007**: Email failure không rollback cancel
- **BR-008**: Queue failure → `notificationStatus = failed_to_queue`
- **BR-010**: Reason optional, lưu nếu có
- **BR-011**: Subject prefix `[CANCELLED]` hoặc `[ĐÃ HỦY]`
- **BR-012**: Bao gồm cả internal + external participants
- **BR-013**: Chỉ hủy 1 occurrence, không hủy series

---

## 8. Validation Plan

### 8.1 Input Validation (DTO - class-validator)
| Field | Rule | Validator |
|---|---|---|
| `meetingId` (path) | Must be UUID v4 | `@Param('meetingId', ParseUUIDPipe)` |
| `cancellationReason` (body) | Optional, string, max 1000 chars, trim whitespace | `@IsOptional()`, `@IsString()`, `@MaxLength(1000)` |
| Extra fields | Reject unknown fields | `forbidNonWhitelisted: true` on `ValidationPipe` |

### 8.2 Business Validation (Service)
| Điều kiện | Error |
|---|---|
| meeting không tồn tại hoặc `deletedAt` != null | `404 MEETING_NOT_FOUND` |
| `meeting.status !== 'scheduled'` | `409 INVALID_MEETING_STATUS` |
| `meeting.start_time <= now` | `409 MEETING_ALREADY_STARTED` |
| User không có `cancel.own` và không có `cancel.any` | `403 FORBIDDEN` |
| User có `cancel.own` nhưng không phải organizer/host | `403 FORBIDDEN` |
| Concurrent cancel (pessimistic lock timeout) | `409 CONCURRENT_MODIFICATION` |
| `cancellationReason` > 1000 chars (already caught by DTO) | `422 VALIDATION_ERROR` |

---

## 9. Error Handling Plan

### 9.1 Exception Mapping
| Exception | HTTP Status | Error Code |
|---|---|---|
| `BadRequestException` | 400 | `VALIDATION_ERROR` |
| `UnauthorizedException` | 401 | `UNAUTHORIZED` |
| `ForbiddenException` | 403 | `FORBIDDEN` |
| `NotFoundException` | 404 | `MEETING_NOT_FOUND` |
| `ConflictException` | 409 | `INVALID_MEETING_STATUS` / `MEETING_ALREADY_STARTED` / `MEETING_ALREADY_CANCELLED` / `CONCURRENT_MODIFICATION` |
| `UnprocessableEntityException` | 422 | `VALIDATION_ERROR` |

### 9.2 Transaction Error Handling
```typescript
try {
  await this.dataSource.transaction(async (em) => {
    // ... business logic ...
  });
} catch (error) {
  if (error instanceof ConflictException || error instanceof NotFoundException
      || error instanceof ForbiddenException || error instanceof BadRequestException) {
    throw error; // business errors re-throw
  }
  // Unexpected errors (DB failure, etc.)
  this.logger.error('Cancel meeting transaction failed', error.stack);
  throw new InternalServerErrorException({
    success: false,
    message: 'Đã xảy ra lỗi khi hủy cuộc họp. Vui lòng thử lại sau.',
    error: { code: 'INTERNAL_ERROR' },
  });
}
```

### 9.3 Notification Error (Non-blocking)
```typescript
let notificationStatus = 'queued';
try {
  // Create notification + background_job
} catch (notifError) {
  this.logger.error('Failed to queue cancellation notification', notifError.stack);
  notificationStatus = 'failed_to_queue';
  // Ghi audit log about notification failure
}
// Response vẫn 200 OK with notificationStatus
```

---

## 10. Testing Strategy

### 10.1 Unit Tests

#### MeetingsService.cancelMeeting()
| Test Case | Type | AC Ref |
|---|---|---|
| Cancel success khi user là organizer | Happy path | AC-001 |
| Cancel success khi user là host | Happy path | AC-002 |
| Cancel success khi user là admin | Happy path | AC-003 |
| Forbidden khi user là participant thường | Error | AC-004 |
| Forbidden khi user có `cancel.own` nhưng không phải organizer/host | Error | AC-005 |
| Conflict khi meeting đang `in_progress` | Error | AC-006 |
| Conflict khi meeting `completed` | Error | AC-007 |
| Conflict khi meeting đã `cancelled` | Error | AC-008 |
| Conflict khi `start_time <= now` | Error | AC-009 |
| NotFound khi meeting không tồn tại | Error | AC-010 |
| Room booking được cập nhật `status = 'cancelled'` + `cancellation_reason` | State | AC-013 |
| Không có room booking → `roomReleased = false` | State | AC-014 |
| Usage `not_started` → `released` khi có usage record | State | AC-015 |
| Usage không được tạo mới khi chưa tồn tại | State | AC-016 |
| `meeting_events.event_type = 'status_changed'` | Event | AC-017 |
| `room_events.event_type = 'room_released'` | Event | AC-018 |
| Notification queue với `[CANCELLED]` prefix | Notif | AC-019 |
| Audit log được ghi | Audit | AC-021 |
| Concurrent cancel → second request returns 409 | Concurrency | AC-022 |

#### DTO Validation
| Test Case | Validator |
|---|---|
| meetingId không phải UUID → 400 | `ParseUUIDPipe` |
| cancellationReason > 1000 chars → 422 | `@MaxLength(1000)` |
| cancellationReason là optional → không lỗi khi bỏ qua | `@IsOptional()` |
| Body chứa field lạ → 400 | `forbidNonWhitelisted` |

### 10.2 Integration Test Ideas
- Full flow: cancel meeting + verify DB state (meeting, booking, usage, events, audit, notification)
- Cancel with reason → verify reason persisted in meeting + booking
- Cancel without reason → verify reason is null
- Cancel with room → verify room booking `cancelled`, usage `released`
- Cancel without room → verify `roomReleased = false`

### 10.3 Permission Seed Test
- Verify seed tạo đúng permissions `meeting.cancel.own` + `meeting.cancel.any`
- Verify permissions gán đúng roles

---

## 11. Implementation Phases

### Phase 1: Preparation (Seed + DTOs)
1. Tạo migration seed: `20260609000002-SeedMeetingCancelPermissions.ts`
   - Thêm permissions `meeting.cancel.own`, `meeting.cancel.any`
   - Gán `meeting.cancel.own` cho roles: employee, manager, admin
   - Gán `meeting.cancel.any` cho role: admin
2. Tạo `CancelMeetingDto`:
   - `@IsOptional() @IsString() @MaxLength(1000) cancellationReason?: string`
   - `@Transform(({ value }) => value?.trim())` để trim
3. Tạo `CancelMeetingResponseDto`:
   - `meetingId: string; status: string; cancelledAt: Date; cancelledBy: string; roomReleased: boolean; releasedBookingId: string | null; notificationStatus: string;`

### Phase 2: Service Logic
4. Thêm method `cancelMeeting()` trong `MeetingsService`:
   - Auth + ownership check (organizer_id / host_id / admin)
   - Transaction với pessimistic lock
   - Update meeting, booking, usage
   - Create events + audit logs
   - Outside transaction: create notification + background_job
   - Return success response

### Phase 3: Controller Endpoint
5. Thêm endpoint trong `MeetingsController`:
   - `POST /meetings/:meetingId/cancel`
   - `@UseGuards(JwtAuthGuard, PermissionsGuard)`
   - `@RequirePermissions('meeting.cancel.own')`
   - Validate UUID param
   - Gọi `meetingsService.cancelMeeting()`

### Phase 4: Tests
6. Unit test cho `MeetingsService.cancelMeeting()` (22+ test cases)
7. Unit test cho `CancelMeetingDto` validation
8. Unit test cho controller endpoint

---

## 12. Risks & Mitigations

| Risk | Impact | Mitigation |
|---|---|---|
| **Race condition**: hai request cancel đồng thời | Double notification, inconsistent state | `pessimistic_write` lock trên meeting + booking |
| **Notification queue failure** | Participant không nhận được thông báo | Không rollback cancel; ghi log + `failed_to_queue` |
| **User có `cancel.own` nhưng không phải organizer/host** | Authorization bypass | Service layer kiểm tra `organizer_id`/`host_id` sau permission guard |
| **Usage đang `in_use` khi cancel** | Inconsistent usage state | Không update usage nếu không phải `not_started`; ghi log |
| **Transaction timeout** | Request thất bại | Giữ transaction gọn; notification tách riêng |
| **Seed permission missing** | Endpoint không hoạt động | Tạo seed migration; kiểm tra seed trước khi test |
| **Meeting bị soft-delete nhưng status `scheduled`** | Cancel deleted meeting | Check `deletedAt` == null trong query |

---

## 13. Acceptance Criteria Traceability

| AC ID | Phase | Test Type | Verification |
|---|---|---|---|
| AC-001 | Phase 2, 4 | Unit + Integration | service cancelMeeting, response data |
| AC-002 | Phase 2, 4 | Unit + Integration | service cancelMeeting với host context |
| AC-003 | Phase 2, 4 | Unit + Integration | service cancelMeeting với admin bypass |
| AC-004 | Phase 2, 4 | Unit | ForbiddenException, không đổi DB |
| AC-005 | Phase 2, 4 | Unit | ForbiddenException khi user != organizer_id/host_id |
| AC-006 | Phase 2, 4 | Unit | ConflictException khi status in_progress |
| AC-007 | Phase 2, 4 | Unit | ConflictException khi status completed |
| AC-008 | Phase 2, 4 | Unit | ConflictException khi status cancelled |
| AC-009 | Phase 2, 4 | Unit | ConflictException khi start_time <= now |
| AC-010 | Phase 2, 4 | Unit | NotFoundException |
| AC-011 | Phase 1, 4 | DTO | ParseUUIDPipe reject |
| AC-012 | Phase 1, 4 | DTO | MaxLength(1000) reject |
| AC-013 | Phase 2, 4 | Unit + Integration | booking status + cancellation_reason |
| AC-014 | Phase 2, 4 | Unit | roomReleased=false |
| AC-015 | Phase 2, 4 | Unit | usage_status = released |
| AC-016 | Phase 2, 4 | Unit | không tạo usage mới |
| AC-017 | Phase 2, 4 | Unit | event_type, old/new/meta JSON |
| AC-018 | Phase 2, 4 | Unit | room event event_type |
| AC-019 | Phase 2, 4 | Unit | notification subject prefix |
| AC-020 | Phase 2, 4 | Unit | notification includes reason |
| AC-021 | Phase 2, 4 | Unit | audit log count + content |
| AC-022 | Phase 2, 4 | Unit | concurrent → second 409 + single notification |

---

## Artifacts Produced

| Artifact | Path |
|---|---|
| Implementation Plan | `spec/features/meeting/feat-cancel-meeting/plan.md` |
| Research | `spec/features/meeting/feat-cancel-meeting/research.md` |
| Data Model | `spec/features/meeting/feat-cancel-meeting/data-model.md` |
| API Contract | `spec/features/meeting/feat-cancel-meeting/contracts/meeting-cancel-api.md` |
| Quickstart | `spec/features/meeting/feat-cancel-meeting/quickstart.md` |
