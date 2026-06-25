# Tasks: Bắt đầu phiên họp — UC-IMM-01

**Input**: Design documents from `spec/features/live-meeting/feat-start-meeting-session/`
**Prerequisites**: plan.md, spec.md, research.md, data-model.md, contracts/start-meeting-api.md

## Format: `[ID] [P?] [Story] Description`

- `[P]`: Can run in parallel (different files, no dependencies)
- `[Story]`: US1 = Manual Start, US2 = AF1 Device Check-in
- Include exact file paths in descriptions

---

## Phase 1: Setup (Shared Infrastructure)

**Purpose**: Khởi tạo cấu trúc module live-meeting và các thay đổi nền tảng cần thiết.

**⚠️ Không task nào phụ thuộc lẫn nhau trong phase này — tất cả đều [P].**

- [x] T001 [P] [Shared] Tạo cấu trúc module live-meeting hoàn chỉnh trong `src/modules/live-meeting/live-meeting.module.ts`: import TypeOrmModule.forFeature với các entities cần thiết (MeetingEntity, MeetingEventEntity, RoomBookingEntity, RoomBookingUsageEntity, AuditLogEntity), import AccountsModule, AuthModule, WebsocketModule, AdministrationModule, NotificationsModule.

- [x] T002 [P] [Shared] Thêm `DEVICE = 'device'` vào enum `MeetingEventSourceType` trong `src/modules/meetings/entities/meeting-event.entity.ts` để hỗ trợ AF1. (Lưu ý: Column `source_type` trong DB hiện tại đang có `type: 'varchar'`, không phải Postgres enum, do đó KHÔNG CẦN tạo migration DB cho thay đổi này).

- [x] T003 [P] [Shared] Tạo seed permission `meeting.session.start` tại `src/database/seeds/20260616000001-SeedMeetingSessionStartPermission.ts`.
  - Insert `permission_code = 'meeting.session.start'`, `permission_name = 'Bắt đầu phiên họp'`, `module_code = 'live-meeting'`, `action_code = 'session.start'`.
  - Gán permission này cho system roles: INTERNAL_USER, MANAGER, BUSINESS_ADMIN, SYSTEM_ADMIN (theo API_CONTRACT_v1.0_with_system_roles.md).
  - Chạy seed trong transaction, ON CONFLICT DO NOTHING.
  - Tham khảo pattern từ `src/database/seeds/20260609000002-SeedMeetingCancelPermissions.ts`.

**Checkpoint**: Module live-meeting sẵn sàng nhận business logic. Permission đã có trong DB.

---

## Phase 2: Foundational (Blocking Prerequisites)

**Purpose**: DTOs, Error codes, Base service class trước khi implement business logic.

**⚠️ Cả US1 và US2 đều phụ thuộc phase này.**

- [x] T004 [P] [Shared] Tạo `StartMeetingResponseDto` tại `src/modules/live-meeting/dto/start-meeting-response.dto.ts` với các field: `meetingId: string`, `status: string`, `actualStartTime: string | null`, `alreadyStarted: boolean`. Dùng class-validator/transformer decorators theo pattern có sẵn (VD: `src/modules/meetings/dto/cancel-meeting-response.dto.ts`).

- [x] T005 [P] [Shared] Tạo file hằng số error codes `src/modules/live-meeting/constants/meeting-start-error.constant.ts` chứa danh sách mã lỗi dạng string:
  - `MEETING_NOT_FOUND`, `MEETING_NOT_IN_SCHEDULED_STATUS`, `MEETING_ALREADY_STARTED`, `MEETING_ALREADY_COMPLETED`, `MEETING_CANCELLED`, `MEETING_PENDING_APPROVAL`, `MEETING_IN_DRAFT_STATUS`, `MEETING_START_TOO_EARLY`, `MEETING_START_WINDOW_EXPIRED`, `MEETING_START_AMBIGUOUS_DEVICE_MATCH`.

- [x] T006 [P] [Shared] Tạo `DeviceStartMeetingParams` interface tại `src/modules/live-meeting/types/device-start-meeting-params.type.ts` gồm: `deviceId: string`, `roomId: string`, `recognizedUserId: string`, `sourceType: 'device'`.

**Checkpoint**: DTOs, error codes, types sẵn sàng — có thể implement service.

---

## Phase 3: User Story 1 — Manual Start Meeting (Normal Flow) 🎯 MVP

**Goal**: Cho phép Host/Organizer gọi API `POST /api/v1/live-meetings/{meetingId}/start` để bắt đầu phiên họp.

**Independent Test**: Gọi API với meeting hợp lệ → 200 OK, `status=in_progress`, `actualStartTime` được set, DB updated.

### Implementation Tasks

- [x] T007 [US1] Implement `LiveMeetingService` core method `startMeeting(meetingId: string, authUser: AuthUser, clientContext: ClientContext)` tại `src/modules/live-meeting/services/live-meeting.service.ts`:
  - 1. Kiểm tra meeting tồn tại, không soft-delete → `MEETING_NOT_FOUND`.
  - 2. Kiểm tra ownership: `currentUserId === meeting.hostId || organizerId` → `FORBIDDEN`.
  - 3. Kiểm tra status: nếu `actual_start_time != null` → idempotent path (trả DTO với `alreadyStarted=true`, không tạo event/audit mới).
  - 4. Kiểm tra status: `scheduled`? nếu không → lỗi tương ứng (`completed`/`cancelled`/`pending_approval`/`draft`).
  - 5. Kiểm tra time window: `NOW() >= start_time - 15m`? `NOW() < end_time`? → `MEETING_START_TOO_EARLY` / `MEETING_START_WINDOW_EXPIRED`.
  - 6. Transaction với `SELECT FOR UPDATE`:
    - `em.findOne(MeetingEntity, { where: { id }, lock: { mode: 'pessimistic_write' } })`.
    - Re-check tất cả validations trong transaction.
    - `UPDATE meetings.status = 'in_progress'`, `actual_start_time = NOW()`, `updated_by`, `updated_at`.
    - `INSERT meeting_events` với `eventType = MEETING_STARTED`, `sourceType = MANUAL`, `old_value_json`/`new_value_json`.
    - `UPDATE room_bookings SET status = 'active'` WHERE `status = 'approved'` AND `meeting_id = meetingId`.
    - `UPDATE room_booking_usages SET usage_status = 'in_use', actual_start_time = NOW(), occupancy_source` WHERE `usage_status = 'not_started'` AND `meeting_id = meetingId`.
    - `INSERT audit_logs` với `actionType = 'start_meeting'`, `entityType = 'meeting'`, `entityId = meetingId`.
  - Commit transaction.
  - 7. Post-transaction: emit WebSocket event (best-effort) — gọi `WebsocketService.emitToRoom('meeting:{meetingId}', 'meeting.session.started', payload)`.
  - 8. Return `StartMeetingResponseDto`.

  Pattern tham khảo: `src/modules/meetings/services/meetings.service.ts` (method `cancelMeeting`).

- [x] T008 [US1] Implement `LiveMeetingController` tại `src/modules/live-meeting/controllers/live-meeting.controller.ts`:
  - Endpoint: `POST live-meetings/:meetingId/start`.
  - Guards: `@UseGuards(JwtAuthGuard, PermissionsGuard)` + `@RequirePermissions('meeting.session.start')`.
  - Decorator: `@HttpCode(HttpStatus.OK)`, `@ApiTags('live-meeting')`, `@ApiBearerAuth()`.
  - Param: `@Param('meetingId', ParseUUIDPipe) meetingId: string`.
  - Body injection: `@Req() request`, `@Ip() ipAddress`, `@Headers('user-agent') userAgent`.
  - Gọi `this.liveMeetingService.startMeeting(meetingId, { userId }, { ipAddress, userAgent })`.
  - Return: `{ success, message, data: StartMeetingResponseDto }`.

  Pattern tham khảo: `src/modules/meetings/controllers/meetings.controller.ts` (method `cancelMeeting` hoặc `updateMeetingTime`).

- [x] T009 [US1] Cập nhật `LiveMeetingModule` tại `src/modules/live-meeting/live-meeting.module.ts`:
  - Thêm `LiveMeetingService` vào `providers`.
  - Thêm `LiveMeetingController` vào `controllers`.
  - Export `LiveMeetingService` nếu cần cho internal module sử dụng (AF1).

- [x] T010 [US1] Thêm `LiveMeetingService` vào app module exports nếu cần: kiểm tra `src/app.module.ts` — `LiveMeetingModule` phải được import.

**Checkpoint**: API start meeting hoạt động được manual flow. Có thể test với Postman/Jest.

---

## Phase 4: User Story 2 — Alternative Flow 1: Device Check-in Trigger (AF1)

**Goal**: Module `live-meeting` cung cấp internal service method `startMeetingFromDeviceCheckIn()` cho module `iot`/`attendance` gọi khi host check-in trên Door Face Attendance Terminal.

**Independent Test**: Gọi internal service method với params hợp lệ → start meeting thành công với `source_type = device`.

### Implementation Tasks

- [x] T011 [US2] Implement `startMeetingFromDeviceCheckIn(params: DeviceStartMeetingParams)` trong `src/modules/live-meeting/services/live-meeting.service.ts`:
  - 1. Query meeting: `host_id = params.recognizedUserId`, `room_id = params.roomId`, `status = 'scheduled'`, `actual_start_time IS NULL`, `NOW() >= start_time - 15m`, `NOW() < end_time`.
  - 2. Nếu `meetings.length === 0` → throw `MEETING_START_AMBIGUOUS_DEVICE_MATCH`.
  - 3. Nếu `meetings.length > 1` → throw `MEETING_START_AMBIGUOUS_DEVICE_MATCH`.
  - 4. Nếu `meetings.length === 1` → gọi lại `startMeeting()` logic nhưng với `sourceType = DEVICE`, `actorUserId = params.recognizedUserId` hoặc `null`.
  - Gợi ý: Tách phần transaction + validation core thành private method `executeStartMeeting(meetingId, sourceType, actorUserId, clientContext)` để cả `startMeeting` và `startMeetingFromDeviceCheckIn` đều dùng chung.

- [x] T012 [US2] Export `LiveMeetingService` từ `LiveMeetingModule` để module `iot`/`attendance` có thể inject và gọi `startMeetingFromDeviceCheckIn()`.

**Checkpoint**: AF1 device flow có thể trigger start meeting qua internal service call.

---

## Phase 5: Integration & WebSocket Sync

**Purpose**: Đảm bảo realtime event được push đúng đến participants khi meeting started.

- [x] T013 [P] Implement WebSocket push helper trong `LiveMeetingService` — method riêng `emitMeetingStartedEvent(meetingId, actualStartTime, startedBy)`:
  - Payload: `{ eventType: 'meeting.session.started', data: { meetingId, status: 'in_progress', actualStartTime, scheduledStartTime, scheduledEndTime, roomId, startedBy, occurredAt } }`.
  - Dùng `this.websocketService.emitToRoom('meeting:{meetingId}', 'meeting.session.started', payload)`.
  - Wrap trong try/catch, log error (best-effort, không rollback transaction).

- [x] T014 Gọi `emitMeetingStartedEvent` sau transaction commit thành công ở cả `startMeeting` và `startMeetingFromDeviceCheckIn`.

**Checkpoint**: WebSocket event được phát ra khi meeting started (best-effort).

---

## Phase 6: Testing & Documentation

**Purpose**: Đảm bảo code coverage và tài liệu.

- [x] T015 [P] Tạo service unit tests tại `src/modules/live-meeting/tests/live-meeting.service.spec.ts`:
  - Test happy path: start meeting thành công → verify meetings, meeting_events, room_bookings, room_booking_usages, audit_logs đều updated.
  - Test meeting không tồn tại → MEETING_NOT_FOUND.
  - Test user không phải host/organizer → FORBIDDEN.
  - Test meeting `completed` → MEETING_ALREADY_COMPLETED.
  - Test meeting `cancelled` → MEETING_CANCELLED.
  - Test meeting `pending_approval` → MEETING_PENDING_APPROVAL.
  - Test meeting `draft` → MEETING_IN_DRAFT_STATUS.
  - Test time window too early → MEETING_START_TOO_EARLY.
  - Test time window expired → MEETING_START_WINDOW_EXPIRED.
  - Test idempotent: call 2 lần → lần 2 trả `alreadyStarted=true`, không tạo event thứ 2.
  - Test race condition: SELECT FOR UPDATE lock hoạt động.
  - Test AF1 internal: exact 1 match → start thành công.
  - Test AF1 internal: 0 match → MEETING_START_AMBIGUOUS_DEVICE_MATCH.
  - Test AF1 internal: >1 match → MEETING_START_AMBIGUOUS_DEVICE_MATCH.
  - Test WebSocket push thất bại → không rollback transaction.
  - Test transaction rollback khi ghi `meeting_events` hoặc `audit_logs` thất bại (mock error), đảm bảo `meetings.status` không bị lưu là `in_progress`.
  
  Pattern tham khảo: `src/modules/meetings/tests/*.spec.ts`, `src/modules/meetings/services/meetings.service.spec.ts`.

- [x] T016 [P] Tạo controller unit tests tại `src/modules/live-meeting/tests/live-meeting.controller.spec.ts`:
  - Test endpoint gọi service đúng params.
  - Test ParseUUIDPipe reject invalid meetingId.
  - Test @RequirePermissions decorator hoạt động.

- [x] T017 [P] Tạo DTO spec tests tại `src/modules/live-meeting/dto/start-meeting-response.dto.spec.ts`:
  - Test response format đúng với API contract.

- [x] T018 Chạy quickstart validation: kiểm tra tất cả kịch bản trong `quickstart.md` pass.

**Checkpoint**: Code coverage đầy đủ, tất cả AC pass.

---

## Dependencies & Execution Order

### Phase Dependencies

```
Phase 1: Setup         → Không phụ thuộc
    │
    ▼
Phase 2: Foundational  → Phụ thuộc Phase 1
    │
    ▼
Phase 3: US1 Manual    → Phụ thuộc Phase 1 + 2
    │
    ├──▶ Phase 4: US2 AF1  → Phụ thuộc Phase 3 (dùng chung executeStartMeeting core)
    │
    └──▶ Phase 5: WebSocket → Phụ thuộc Phase 3
    │
    ▼
Phase 6: Testing       → Phụ thuộc Phase 3 + 4 + 5
```

### Trong mỗi Phase

- Tasks `[P]` có thể chạy song song.
- Tasks không `[P]` chạy tuần tự theo thứ tự.

### Parallel Opportunities

| Phase | Tasks có thể chạy song song |
|---|---|
| Phase 1 | T001, T002, T003 |
| Phase 2 | T004, T005, T006 |
| Phase 6 | T015, T016, T017 |

---

## Implementation Strategy

### MVP Scope (Phase 1 + 2 + 3)

1. Phase 1 + 2: Setup + Foundational → Nền tảng sẵn sàng.
2. Phase 3: US1 Manual Start → Core MVP có thể test và demo.
3. **STOP & VALIDATE**: Gọi API Postman → 200 OK, DB updated.

### Incremental Delivery

1. MVP (Phase 1-3) → Demo manual start meeting.
2. Phase 5 → Thêm realtime sync.
3. Phase 4 → Thêm AF1 device flow.
4. Phase 6 → Testing coverage đầy đủ.

---

## Requirements Coverage

### FR → Task Mapping

| Requirement ID | Task(s) | AC liên quan |
|---|---|---|
| FR-001, FR-002, FR-003, FR-004, FR-004a | T007, T008 | AC-001 |
| FR-005, FR-006 | T007 | AC-001 |
| FR-007 | T007 | AC-001 |
| FR-008 | T007 | AC-001 |
| FR-009 | T007 | AC-001 |
| FR-010, FR-011, FR-012, FR-012a | T007 | AC-001, AC-019 |
| FR-013, FR-026 | T011, T012 | AC-015, AC-016 |
| FR-014 | T013, T014 | AC-014 |
| FR-015 → FR-021 | T007 | AC-002 → AC-010 |
| FR-022, FR-023 | T007 | Transaction boundary |
| FR-024 | T013, T014 | Best-effort realtime |
| FR-024a | T011 | AC-016 |
| FR-025 | T007 | AC-001 |
| FR-027 → FR-030 | T008 | AC-003, AC-004 |
| FR-031 → FR-034 | T007 | AC-001 |
| FR-035 | T007 | AC-013 |
| FR-036 | T013, T014 | AC-014 |
| FR-037 | T013 | Best-effort realtime |
| FR-041 | T007 | AC-001 |

### Error Codes → Task Mapping

| Error Code | Task | HTTP Status |
|---|---|---|
| MEETING_NOT_FOUND | T007 | 404 |
| FORBIDDEN | T007 | 403 |
| MEETING_NOT_IN_SCHEDULED_STATUS | T007 | 409 |
| MEETING_ALREADY_STARTED (idempotent) | T007 | 200 |
| MEETING_ALREADY_COMPLETED | T007 | 409 |
| MEETING_CANCELLED | T007 | 409 |
| MEETING_PENDING_APPROVAL | T007 | 409 |
| MEETING_IN_DRAFT_STATUS | T007 | 409 |
| MEETING_START_TOO_EARLY | T007 | 409 |
| MEETING_START_WINDOW_EXPIRED | T007 | 409 |
| MEETING_START_AMBIGUOUS_DEVICE_MATCH | T011 | 409 |

### Acceptance Criteria → Task Mapping

| AC ID | Task xác nhận | Loại test |
|---|---|---|
| AC-001 | T015 | Service unit test |
| AC-017 | T015 | Service unit test |
| AC-018 | T015 | Service unit test |
| AC-019 | T015 | Service unit test |
| AC-002 → AC-010 | T015 | Service unit test |
| AC-011, AC-012 | T015 | Service unit test |
| AC-013 | T015 | Service unit test |
| AC-014 | T015 | Service unit test |
| AC-015, AC-016 | T015 | Service unit test |
| Controller + DTO | T016, T017 | Unit test |

---

## Summary

| Metric | Value |
|---|---|
| **Total tasks** | 18 |
| **Phase 1 (Setup)** | 3 tasks (all [P]) |
| **Phase 2 (Foundational)** | 3 tasks (all [P]) |
| **Phase 3 (US1 Manual)** | 4 tasks |
| **Phase 4 (US2 AF1)** | 2 tasks |
| **Phase 5 (WebSocket)** | 2 tasks |
| **Phase 6 (Testing)** | 4 tasks (3 [P]) |
| **Parallel tasks** | 9 tasks marked [P] |
| **Suggested MVP** | Phase 1 + 2 + 3 (10 tasks) |
