# Tasks — UC-MM-03 Cập nhật phòng họp (Update Meeting Room)

- **Feature ID**: UC-MM-03
- **Feature Name**: Cập nhật phòng họp
- **Source Documents**:
  - `spec/features/meeting/feat-update-meeting-room/spec.md`
  - `spec/features/meeting/feat-update-meeting-room/plan.md`
  - `spec/features/meeting/feat-update-meeting-room/research.md`
  - `spec/features/meeting/feat-update-meeting-room/data-model.md`
  - `spec/features/meeting/feat-update-meeting-room/contracts/update-meeting-room-api.md`
- **Ngày tạo**: 2026-06-09
- **Tổng số tasks**: 17
- **Ký hiệu**: `[P]` = có thể chạy song song (parallel)

---

## Phase 0: Foundation — Enum & Permission Seed

> Dependency: không có. Có thể chạy song song với Phase 1.

- [x] T001 [P] **Thêm `ROOM_CHANGED` vào `MeetingEventType` enum**
  - File: `src/modules/meetings/entities/meeting-event.entity.ts`
  - Việc làm: Thêm dòng `ROOM_CHANGED = 'room_changed'` vào enum `MeetingEventType`
  - Outcome: Enum có sẵn value `room_changed` để dùng trong meeting_events INSERT

- [x] T002 [P] **Thêm `MEETING_ROOM_UPDATED` vào `NotificationType` enum**
  - File: `src/modules/notifications/entities/notification.entity.ts`
  - Việc làm: Thêm dòng `MEETING_ROOM_UPDATED = 'meeting_room_updated'` vào enum `NotificationType`
  - Outcome: Enum có sẵn value `meeting_room_updated` để dùng trong notifications INSERT

- [x] T003 **Tạo seed permission `meeting.room.update` + gán cho ADMIN role**
  - File mới: `src/database/seeds/20260609000001-SeedMeetingRoomUpdatePermission.ts`
  - Việc làm: Tạo seed function `seedMeetingRoomUpdatePermission(dataSource)` theo pattern `SeedMeetingRequestPermissions.ts` (raw SQL INSERT, ON CONFLICT DO NOTHING, gán cho ADMIN role)
  - Nội dung: INSERT vào `permissions` với `code='meeting.room.update'`, `name='Cập nhật phòng họp'`, `module='meetings'`, `action='room_update'`, `description='Cho phép cập nhật phòng họp'`
  - Chỉ gán cho ADMIN role (không gán cho MANAGER/EMPLOYEE vì owner check trong service)
  - Outcome: Permission tồn tại trong DB, ADMIN role có quyền `meeting.room.update`

---

## Phase 1: DTO Definitions

> Dependency: không có. Có thể chạy song song với Phase 0.

- [x] T004 [P] **Tạo `UpdateMeetingRoomDto`**
  - File mới: `src/modules/meetings/dto/update-meeting-room.dto.ts`
  - Nội dung:
    - `newRoomId` — `@IsUUID('4')`, `@IsNotEmpty()`
    - `confirmCapacityOverride` — `@IsOptional()`, `@IsBoolean()`, default `false`
    - `changeReason` — `@IsOptional()`, `@IsString()`, `@MaxLength(500)`
  - Outcome: DTO request cho PATCH endpoint với validation đầy đủ

- [x] T005 [P] **Tạo `UpdateMeetingRoomResponseDto`**
  - File mới: `src/modules/meetings/dto/update-meeting-room-response.dto.ts`
  - Nội dung (class với constructor):
    ```typescript
    meetingId: string;
    oldRoom: { id: string; name: string };
    newRoom: { id: string; name: string };
    oldBookingId: string;
    newBookingId: string;
    startTime: string;
    endTime: string;
    notificationStatus: string;
    updatedAt: string;
    ```
  - Outcome: DTO response chuẩn cho PATCH endpoint

- [x] T006 [P] **Tạo `AvailableRoomDto`**
  - File mới: `src/modules/meetings/dto/available-room.dto.ts`
  - Nội dung:
    ```typescript
    roomId: string;
    roomName: string;
    roomCode: string;
    capacity: number;
    location: string | null;
    equipmentFlags: string[];
    availabilityStatus: string;
    isCurrentRoom: boolean;
    capacityWarning: { roomCapacity: number; attendeeCount: number; message: string } | null;
    ```
  - Outcome: DTO response cho GET available-rooms endpoint

---

## Phase 2: Service Logic

> Dependency: T001, T002, T003, T004, T005, T006

- [x] T007 **Thêm private helper `getAttendeeCount(meetingId)` & method `getAvailableRoomsForMeeting()`**
  - File: `src/modules/meetings/services/meetings.service.ts`
  - **`getAttendeeCount(meetingId)`**:
    - Query count: `meeting_participants` + `meeting_external_participants` cho meeting đó
    - Trả về `{ total: number }`
  - **`getAvailableRoomsForMeeting(meetingId, options?)`**:
    - Load meeting → lấy `startTime`, `endTime`, `currentRoomId`
    - Reuse `getAvailableRooms()` hiện có, mở rộng thêm:
      - Loại bỏ các phòng có `capacity = null` khỏi danh sách kết quả (tuyệt đối không throw exception — việc throw 422 ROOM_CAPACITY_NOT_CONFIGURED chỉ xảy ra ở PATCH endpoint)
      - Nếu `includeCurrentRoom = false` (default), loại bỏ phòng hiện tại
      - Nếu `capacityWarningMode = true`, với mỗi phòng, gọi `getAttendeeCount()` → nếu capacity < attendeeCount thì gắn `capacityWarning`
      - Check room conflict: reuse `getRoomAvailability()` nhưng ghi chú rõ phải truyền status array `[PENDING, APPROVED, ACTIVE]` để chỉ filter các booking đang chiếm phòng, bỏ qua `[CANCELLED, RELEASED]`
      - Enrich response với `isCurrentRoom`, `capacityWarning`
    - Trả về `Promise<AvailableRoomDto[]>`
  - Outcome: Service có khả năng trả danh sách phòng khả dụng, kèm capacity warning

- [x] T008 **Thêm private helper `generateBookingCodeTransaction(em)` hỗ trợ transaction**
  - File: `src/modules/meetings/services/meetings.service.ts`
  - Việc làm: Extract logic generate booking code từ `generateBookingCode()` thành version nhận `EntityManager` làm tham số để dùng trong transaction
  - Outcome: Có thể generate booking code an toàn bên trong transaction

- [x] T009 **Thêm method `updateMeetingRoom()` — core business logic**
  - File: `src/modules/meetings/services/meetings.service.ts`
  - Signature: `updateMeetingRoom(meetingId: string, dto: UpdateMeetingRoomDto, authUser: AuthUser, clientContext: ClientContext): Promise<UpdateMeetingRoomResponseDto>`
  - **Pre-validation (trước transaction, có thể throw exception)**:
    1. Load meeting từ DB
    2. Kiểm tra meeting tồn tại, `deletedAt` là null → nếu không → throw `NotFoundException('MEETING_NOT_FOUND')`
    3. Kiểm tra `meeting.status === MeetingStatus.SCHEDULED` → nếu không → throw `ConflictException('INVALID_MEETING_STATUS')`
    4. Kiểm tra `now < meeting.startTime` → nếu không → throw `ConflictException('MEETING_ALREADY_STARTED')`
    5. Kiểm tra recurring series master: `recurrenceRuleId != null && parentMeetingId == null` → throw `ConflictException('RECURRING_SERIES_UPDATE_NOT_SUPPORTED')`
    6. Owner check: nếu user không phải `organizerId`/`hostId` và không có permission `meeting.room.update` → throw `ForbiddenException('FORBIDDEN')`
    7. Kiểm tra phòng mới != phòng hiện tại → throw `UnprocessableEntityException('SAME_ROOM')`
    8. Kiểm tra phòng mới tồn tại, `isActive=true`, `currentStatus != inactive` → throw `UnprocessableEntityException('ROOM_NOT_AVAILABLE')`
    9. Kiểm tra `newRoom.capacity != null` → nếu null → throw `UnprocessableEntityException('ROOM_CAPACITY_NOT_CONFIGURED')`
    10. Gọi `getAttendeeCount()` → kiểm tra capacity: nếu `capacity < attendeeCount && !confirmCapacityOverride` → throw `UnprocessableEntityException('ROOM_CAPACITY_WARNING')`
    11. Kiểm tra room conflict: reuse `getRoomAvailability()` (truyền status array `[PENDING, APPROVED, ACTIVE]` để chỉ filter các booking đang chiếm phòng, bỏ qua `[CANCELLED, RELEASED]`), exclude booking cũ của chính meeting này → nếu conflict → throw `ConflictException('ROOM_CONFLICT')`
  - **Transaction logic** (`dataSource.transaction(async em => { ... })`):
    1. Lock meeting row: `em.findOne(MeetingEntity, { where: { id: meetingId }, lock: { mode: 'pessimistic_write' } })`
    2. Re-check status + startTime (phòng race condition)
    3. **Release old booking**: `em.update(RoomBookingEntity, { meetingId, roomId: meeting.roomId, status: Not(RoomBookingStatus.RELEASED) }, { status: RoomBookingStatus.RELEASED })`
    4. **Create new booking**: `em.create(RoomBookingEntity, { bookingCode, meetingId, roomId: newRoomId, bookingType: BookingType.RELOCATED, reservedStartTime: meeting.startTime, reservedEndTime: meeting.endTime, status: RoomBookingStatus.APPROVED, bookedBy: authUser.userId })`
    5. **Update meeting**: `em.update(MeetingEntity, meetingId, { roomId: newRoomId, updatedBy: authUser.userId })`
    6. **Insert meeting_event**: `MeetingEventType.ROOM_CHANGED`, `oldValueJson: { roomId: oldRoomId }`, `newValueJson: { roomId: newRoomId }`, `metadataJson: { changeReason, confirmCapacityOverride }`
    7. **Insert room_event** (phòng cũ): `eventType = 'room_released'`, `oldStatus = 'approved'`, `newStatus = 'released'`
    8. **Insert room_event** (phòng mới): `eventType = 'room_reserved'`, `newStatus = 'approved'`
    9. **Insert meeting_request snapshot**: `requestType = MeetingRequestType.UPDATE_ROOM`, `approvalMode = ApprovalMode.AUTO`, `approvalStatus = ApprovalStatus.APPLIED`, `conflictCheckStatus = ConflictCheckStatus.CLEAR`, `requestPayloadJson = { changeReason, confirmCapacityOverride, oldRoomId }`
    10. **Insert audit_log**: `actionType = 'update_room'`, `entityType = 'meeting'`, `entityId = meetingId`, `oldValueJson = { roomId, roomName }`, `newValueJson = { roomId: newRoomId, roomName, changeReason, confirmCapacityOverride }`
    11. Return `{ meeting, newBooking, oldRoomName, newRoomName }`
  - **Sau transaction** (không throw, không rollback nếu fail):
    1. Lấy `participants` + `external participants` + `organizer` + `host` → deduplicate → `recipientUserIds`
    2. Tạo `NotificationEntity` với `notificationType = NotificationType.MEETING_ROOM_UPDATED`, `channel = IN_APP`, `recipientUserIdsJson = allUserIds`
    3. Tạo `BackgroundJobEntity` với `jobType = BackgroundJobType.SEND_EMAIL`, `status = QUEUED`, `maxRetries = 3`, `inputJson = { notificationId, template: 'meeting_room_updated' }`
    4. Nếu notification fail → ghi log error, set `notificationStatus = 'failed'`; response vẫn 200
  - **Return**: `UpdateMeetingRoomResponseDto` với đầy đủ oldRoom, newRoom, oldBookingId, newBookingId, notificationStatus
  - Outcome: Core use case hoàn chỉnh với transaction, events, audit, notification async

---

## Phase 3: Controller Endpoints

> Dependency: T007, T009, T004, T005, T006

- [x] T010 **Thêm endpoint `GET /meetings/:meetingId/available-rooms`**
  - File: `src/modules/meetings/controllers/meetings.controller.ts`
  - Route: `@Get('meetings/:meetingId/available-rooms')`
  - Guard: `@UseGuards(JwtAuthGuard)` — chỉ cần authenticated
  - Query params: `capacityWarningMode` (bool, optional), `includeCurrentRoom` (bool, optional)
  - Body: gọi `meetingsService.getAvailableRoomsForMeeting(meetingId, { capacityWarningMode, includeCurrentRoom })`
  - Response: `{ success: true, message: 'Danh sách phòng khả dụng', data: AvailableRoomDto[] }`
  - Error handling: nếu meeting không tồn tại → 404, nếu user chưa login → 401
  - Outcome: Frontend có thể gọi API lấy danh sách phòng khả dụng

- [x] T011 **Thêm endpoint `PATCH /meetings/:meetingId/room`**
  - File: `src/modules/meetings/controllers/meetings.controller.ts`
  - Route: `@Patch('meetings/:meetingId/room')` with `@HttpCode(HttpStatus.OK)`
  - Guard: `@UseGuards(JwtAuthGuard, PermissionsGuard)`
  - Permission: `@RequirePermissions('meeting.room.update')` — nhưng service sẽ check owner fallback
  - Body: `@Body() dto: UpdateMeetingRoomDto` với `@UsePipes(new ValidationPipe({ whitelist: true, transform: true, forbidNonWhitelisted: true }))`
  - Gọi: `meetingsService.updateMeetingRoom(meetingId, dto, { userId }, { ipAddress, userAgent })`
  - Response: `{ success: true, message: 'Phòng họp đã được cập nhật thành công', data: UpdateMeetingRoomResponseDto }`
  - Error mapping: các exception từ service tự mapping qua HTTP status nhờ NestJS exception filters
  - Outcome: Frontend có thể gửi request đổi phòng

---

## Phase 4: Tests

> Dependency: T009, T007, T010, T011, T004, T005, T006

- [x] T012 **Viết unit tests cho `updateMeetingRoom()`**
  - File: `src/modules/meetings/tests/meetings.service.spec.ts`
  - 15 test cases (theo plan.md section 10.1):
    1. `updateRoom_success_organizer` — Organizer đổi phòng hợp lệ → 200, booking cũ released, booking mới created, events/audit ghi đúng
    2. `updateRoom_success_host` — Host đổi phòng → 200
    3. `updateRoom_success_admin` — Admin đổi phòng thay host → 200, audit actor = admin
    4. `updateRoom_forbidden_participant` — Participant cố gắng đổi → 403 FORBIDDEN
    5. `updateRoom_invalid_status` — Meeting `completed` → 409 INVALID_MEETING_STATUS
    6. `updateRoom_meeting_started` — `now >= startTime` → 409 MEETING_ALREADY_STARTED
    7. `updateRoom_same_room` — `newRoomId = current room` → 422 SAME_ROOM
    8. `updateRoom_room_conflict` — Room bị booking khác chiếm → 409 ROOM_CONFLICT
    9. `updateRoom_capacity_warning` — capacity < attendee → 422 ROOM_CAPACITY_WARNING
    10. `updateRoom_capacity_override` — warning + override → 200
    11. `updateRoom_room_capacity_null` — `room.capacity = null` → 422 ROOM_CAPACITY_NOT_CONFIGURED
    12. `updateRoom_recurring_master` — Series master → 409 RECURRING_SERIES_UPDATE_NOT_SUPPORTED
    13. `updateRoom_transaction_rollback` — Lỗi sau release → rollback, dữ liệu không đổi
    14. `updateRoom_data_preserved` — Các trường khác (title, time, participants) giữ nguyên
    15. `updateRoom_notification_failure` — Notification fail → response vẫn 200, `notificationStatus = 'failed'`
  - Pattern: mock `DataSource`, mock `EntityManager`, mock repositories. Reuse pattern từ test hiện có (`meetings.service.spec.ts`)
  - Outcome: Coverage đầy đủ cho 15 ACs tương ứng

- [~] T016 **Viết Integration Tests cho các kịch bản Full Flow, Concurrency, Double-click** *— BLOCKED: chưa có test database infrastructure*
  - File mới: `src/modules/meetings/tests/meetings.service.integration.spec.ts`
  - Sử dụng test database hoặc transaction rollback pattern
  - Test cases:
    1. **Full Flow**: Organizer đổi phòng → assert booking cũ status = `released`, booking mới `booking_type = relocated` & status = `approved`, `meetings.room_id` = phòng mới, `meeting_events` có `room_changed`, `room_events` có `room_released` + `room_reserved`, `audit_logs` có `update_room`, `notifications` có `MEETING_ROOM_UPDATED`, `background_jobs` có `SEND_EMAIL`
    2. **Concurrency (race condition)**: Tạo 2 request đồng thời vào cùng phòng cho 2 meeting khác nhau → request thứ 2 nhận 409 ROOM_CONFLICT, dữ liệu không bị corrupt
    3. **Double-click idempotency**: Submit request 2 lần với cùng nội dung → lần 2 detect đã tồn tại booking relocated + meeting đã đổi phòng → trả về no-op hoặc lỗi, không tạo duplicate booking
  - Outcome: Đảm bảo transaction integrity, race condition handling, và idempotency

- [x] T013 **Viết unit tests cho `getAvailableRoomsForMeeting()`**
  - File: `src/modules/meetings/tests/meetings.service.spec.ts`
  - Test cases:
    1. Trả về danh sách phòng khả dụng (không bao gồm phòng hiện tại)
    2. `includeCurrentRoom = true` — bao gồm phòng hiện tại
    3. `capacityWarningMode = true` — phòng có capacity warning
    4. Phòng hiện tại bị loại bỏ khỏi danh sách
    5. Meeting không tồn tại → throw error
  - Outcome: Đảm bảo logic lọc phòng khả dụng hoạt động đúng

- [x] T014 **Viết unit tests cho DTO validation**
  - File mới: `src/modules/meetings/dto/update-meeting-room.dto.spec.ts` (theo pattern `create-meeting.dto.spec.ts`)
  - Test cases:
    1. `newRoomId` missing → validation fail
    2. `newRoomId` invalid UUID → validation fail
    3. `changeReason` > 500 ký tự → validation fail
    4. Hợp lệ: đầy đủ field → validation pass
    5. `confirmCapacityOverride` không phải boolean → validation fail
  - Outcome: DTO validation được kiểm tra độc lập

- [x] T015 **Viết controller tests cho 2 endpoints mới**
  - File: `src/modules/meetings/controllers/meetings.controller.spec.ts`
  - Test cases:
    1. `GET /meetings/:id/available-rooms` trả về 200 + danh sách
    2. `GET /meetings/:id/available-rooms` không auth → 401
    3. `PATCH /meetings/:id/room` trả về 200 + response đúng format
    4. `PATCH /meetings/:id/room` không auth → 401
    5. `PATCH /meetings/:id/room` không permission → 403
  - Pattern: mock service, test guard + response format
  - Outcome: Controller endpoints được kiểm tra

- [~] T017 **Cập nhật notification worker: ghi audit_logs severity WARNING khi job fail quá 3 lần** *— BLOCKED: chưa có SEND_EMAIL worker infrastructure*
  - File: (worker/service xử lý background job notification, cần xác định vị trí phù hợp trong codebase)
  - Việc làm:
    1. Tìm/tạo worker xử lý `BackgroundJobType.SEND_EMAIL` — nơi retry logic được implement
    2. Khi `job.retryCount >= maxRetries (3)` và job vẫn fail:
       - Set `job.status = BackgroundJobStatus.FAILED`
       - Set `notification.deliveryStatus = NotificationDeliveryStatus.FAILED` (hoặc `PARTIAL_FAILED`)
       - Ghi `AuditLogEntity` với:
         - `actionType = 'notification_failed'`
         - `entityType = 'meeting_room_update'`
         - `entityId = meetingId`
         - `severity = AuditLogSeverity.WARNING`
         - `metadataJson = { jobId, notificationId, error, maxRetries }`
    3. Ghi log warning để dễ dàng debug
  - Outcome: Khi email notification không thể gửi sau 3 lần retry, hệ thống ghi audit warning thay vì im lặng bỏ qua

---

## Requirements Coverage

### Functional Requirements → Tasks

| FR ID | Mô tả | Tasks liên quan |
|-------|-------|-----------------|
| FR-001 | Permission check (organizer/host/admin) | T009 (owner check), T011 (permission guard) |
| FR-002 | Phòng mới phải khác phòng hiện tại | T009 (step 7) |
| FR-003 | Giữ nguyên các trường khác | T009 (chỉ update roomId, updatedBy) |
| FR-004 | Phòng mới active, không maintenance | T009 (step 8) |
| FR-005 | GET available-rooms | T007, T010 |
| FR-006 | Re-check conflict tại submit | T009 (pre-val step 11 + trong transaction step 2) |
| FR-007 | Transaction: release + create + update | T009 (transaction logic) |
| FR-008 | room_event cho phòng cũ (room_released) | T009 (step 7) |
| FR-009 | room_event cho phòng mới (room_reserved) | T009 (step 8) |
| FR-010 | meeting_event (room_changed) | T001, T009 (step 6) |
| FR-011 | audit_logs với old/new value | T009 (step 10) |
| FR-012 | Notification + background_job cho participants | T002, T009 (sau transaction) |
| FR-013 | Capacity soft-warning | T009 (step 10) |
| FR-014 | Override capacity được chấp nhận | T009 (step 10), T004 (confirmCapacityOverride) |
| FR-015 | Hủy sau capacity warning | T009 (throw exception, không thay đổi gì) |
| FR-016 | Meeting scheduled mới được đổi | T009 (step 3) |
| FR-017 | Meeting in_progress/completed/cancelled bị chặn | T009 (step 3) |
| FR-018 | Phòng inactive/maintenance bị chặn | T009 (step 8) |
| FR-019 | meeting_requests snapshot auto-applied | T009 (step 9) |
| FR-020 | background_job cho notification | T009 (sau transaction) |
| FR-021 | 401 Unauthorized | T010, T011 (guard) |
| FR-022 | 403 Forbidden | T009 (owner check), T011 (permission guard) |
| FR-023 | 404 Not Found | T009 (step 1-2) |
| FR-024 | 409 Invalid meeting status | T009 (step 3) |
| FR-025 | 409 Meeting already started | T009 (step 4) |
| FR-026 | 422 Room not available | T009 (step 8) |
| FR-027 | 409 Room conflict | T009 (step 11) |
| FR-028 | 422 Same room | T009 (step 7) |
| FR-029 | Transaction rollback | T009 (try-catch transaction) |
| FR-030 | Notification failure không rollback | T009 (sau transaction xử lý riêng) |
| FR-031 | Recurring series master bị từ chối | T009 (pre-val step 5) |
| FR-032 | Phòng mới capacity = null bị từ chối | T009 (pre-val step 9) |

### Acceptance Criteria → Tasks

| AC ID | Mô tả | Tasks kiểm tra |
|-------|-------|----------------|
| AC-001 | Organizer đổi phòng thành công | T012 (test 1) |
| AC-002 | Host đổi phòng thành công | T012 (test 2) |
| AC-003 | Admin đổi phòng thành công | T012 (test 3) |
| AC-004 | Participant bị chặn 403 | T012 (test 4), T015 (test 5) |
| AC-005 | Unauthenticated bị chặn 401 | T015 (test 2, 4) |
| AC-006 | Meeting không scheduled → 409 | T012 (test 5) |
| AC-007 | Meeting đã bắt đầu → 409 | T012 (test 6) |
| AC-008 | Chọn phòng trùng → 422 | T012 (test 7) |
| AC-009 | Room conflict → 409 | T012 (test 8) |
| AC-010 | Capacity warning → 422 | T012 (test 9) |
| AC-011 | Override capacity → 200 | T012 (test 10) |
| AC-012 | Transaction rollback | T012 (test 13) |
| AC-013 | Booking cũ released, mới created | T012 (test 1 — assert booking status) |
| AC-014 | Audit log được ghi | T012 (test 1 — assert audit_log) |
| AC-015 | Các trường khác không đổi | T012 (test 14) |

---

## Dependency Graph

```
Phase 0 (T001, T002, T003) ──┐  Phase 1 (T004, T005, T006) ──┐
                             ├──► Phase 2 (T007, T008, T009) ──┤
                             └──────────────────────────────────┘
                                    │
                                    ▼
                              Phase 3 (T010, T011)
                                    │
                                    ▼
               ┌───────────────────┼───────────────────┐
               ▼                   ▼                   ▼
     T012 (unit-svc)      T016 (integration)    T015 (controller)
     T013 (avail-rooms)                         T014 (dto)
     T017 (worker)

```

- T001, T002, T003 (Phase 0): không dependency — chạy song song
- T004, T005, T006 (Phase 1): không dependency — chạy song song
- T007, T008, T009 (Phase 2): dependency vào T001–T006
- T010, T011 (Phase 3): dependency vào T007, T009
- T012, T013, T014, T015, T016, T017 (Phase 4): dependency vào T009, T010, T011, T004–T006
  - T012, T013, T014, T015, T017 có thể chạy song song sau khi T009 hoàn tất
  - T016 (integration) nên chạy sau T012 (unit tests pass trước)
