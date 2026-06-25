# Implementation Plan: Bắt đầu phiên họp (UC-IMM-01)

**Feature Directory**: `spec/features/live-meeting/feat-start-meeting-session`
**Date**: 2026-06-16
**Spec**: `spec.md`
**Research**: `research.md`
**Data Model**: `data-model.md`
**API Contract**: `contracts/start-meeting-api.md`
**Quickstart**: `quickstart.md`

---

## 1. Feature Summary

Cho phép Host hoặc Organizer chủ động bắt đầu phiên họp đã scheduled, chuyển trạng thái meeting sang `in_progress`, ghi nhận `actual_start_time` bằng server time, cập nhật trạng thái phòng họp (`room_bookings.status = active`, `room_booking_usages.usage_status = in_use`), tạo timeline event (`meeting_started`), ghi audit log, và đồng bộ realtime qua WebSocket.

Hỗ trợ 2 flow:
- **Manual (Normal Flow)**: Host/Organizer gọi API.
- **Device (Alternative Flow AF1)**: Module `iot`/`attendance` gọi internal service của `live-meeting`.

## 2. Technical Context

| Aspect | Detail |
|---|---|
| **Framework** | NestJS (TypeScript) |
| **ORM** | TypeORM, DataSource pattern với transaction + pessimistic lock |
| **Database** | PostgreSQL, 39 tables v3.2 Compact |
| **Realtime** | Socket.IO qua WebsocketService (events.gateway) |
| **Auth** | JWT Bearer + `@UseGuards(JwtAuthGuard, PermissionsGuard)` |
| **Permission** | `meeting.session.start` (cần tạo seed mới) |
| **Source Type** | `MeetingEventSourceType` cần thêm `DEVICE` cho AF1 |
| **Target Module** | `live-meeting` (hiện là skeleton — tạo mới hoàn toàn) |
| **Module phụ thuộc** | `meetings` (entities), `rooms` (entities), `websocket` (service), `auth` (guards), `administration` (audit log entity), `notifications` (optional) |

## 3. Scope Confirmation

### IN SCOPE
- API endpoint: `POST /api/v1/live-meetings/{meetingId}/start`.
- Permission `meeting.session.start` + seed.
- Kiểm tra Host/Organizer ownership.
- Time window validation: `[start_time - 15m, end_time)`.
- Idempotent handling: second call returns `alreadyStarted=true`.
- DB row lock (`SELECT FOR UPDATE`) chống race condition.
- Transaction: meetings + meeting_events + room_bookings + room_booking_usages + audit_logs.
- Realtime WebSocket push (best-effort sau commit).
- Internal service method cho AF1 (module `live-meeting` cung cấp, `iot`/`attendance` gọi).
- Thêm `DEVICE` vào `MeetingEventSourceType` enum.

### OUT OF SCOPE
- End meeting, extend meeting, agenda control, minutes, recording, transcription.
- Warning 10 phút trước end_time (feature scheduling riêng).
- No-show detection.
- Email notification (chỉ in-app + WebSocket).
- Public webhook/device endpoint (thuộc module `iot`/`attendance`).
- Thêm bảng mới ngoài database v3.2 Compact.

## 4. Data Model Impact

**Tables bị tác động (UPDATE)**:
- `meetings`: status → `in_progress`, actual_start_time = now(), updated_by, updated_at.
- `room_bookings`: status → `active` (WHERE status = `approved` AND meeting_id = meetingId).
- `room_booking_usages`: usage_status → `in_use`, actual_start_time = now(), occupancy_source.

**Tables bị tác động (INSERT)**:
- `meeting_events`: event_type = `meeting_started`, source_type = `manual`/`device`.
- `audit_logs`: action_type = `start_meeting`.

**Entity changes**:
- Thêm `DEVICE = 'device'` vào `MeetingEventSourceType` enum.

Chi tiết xem `data-model.md`.

## 5. API / Contract Plan

### Public Endpoint
| Method | Path | Permission | Mô tả |
|---|---|---|---|
| `POST` | `/api/v1/live-meetings/{meetingId}/start` | `meeting.session.start` | Bắt đầu phiên họp |

Chi tiết request/response/error codes xem `contracts/start-meeting-api.md`.

### Internal Service (AF1)
```typescript
interface DeviceStartMeetingParams {
  deviceId: string;
  roomId: string;
  recognizedUserId: string;
  sourceType: 'device';
}
```

Method `LiveMeetingService.startMeetingFromDeviceCheckIn(params)`:
1. Query meeting với `host_id = recognizedUserId`, `room_id = params.roomId`, `status = scheduled`, time window hợp lệ.
2. Nếu 0 match → throw `MEETING_START_AMBIGUOUS_DEVICE_MATCH` (không tìm thấy).
3. Nếu >1 match → throw `MEETING_START_AMBIGUOUS_DEVICE_MATCH` (nhiều hơn 1).
4. Nếu đúng 1 match → thực hiện start meeting với `source_type = device`.

## 6. Authorization Plan

### Permission Check (Guard Layer)
- `@UseGuards(JwtAuthGuard, PermissionsGuard)`
- `@RequirePermissions('meeting.session.start')`

### Ownership Check (Service Layer)
- `currentUserId === meetings.hostId` HOẶC `currentUserId === meetings.organizerId`.
- Nếu không match → throw `ForbiddenException`.

### Seed Permission
- Tạo seed file: `src/database/seeds/20260616000001-SeedMeetingSessionStartPermission.ts`.
- Insert `permission_code = 'meeting.session.start'`.
- Gán permission này cho system roles: `INTERNAL_USER`, `MANAGER`, `BUSINESS_ADMIN`, `SYSTEM_ADMIN`.

## 7. Business Logic Plan

### Service: `LiveMeetingService`

**Method 1: `startMeeting(meetingId, authUser, clientContext)`**

Flow:
```
1. Find meeting by id (không load relations để tránh lock unnecessary tables)
2. Validate:
   a. meeting exists && !deletedAt
   b. currentUserId === hostId || organizerId
   c. status === 'scheduled'
   d. actualStartTime === null
   e. NOW() >= startTime - 15m
   f. NOW() < endTime
3. IF (status === 'in_progress' && actualStartTime !== null):
   → Idempotent: return { alreadyStarted: true }
   (Không throw — xử lý đặc biệt)
4. Transaction (SELECT FOR UPDATE on meetings):
   a. Lock meeting row
   b. Re-check tất cả validation (double-check trong transaction)
   c. UPDATE meetings: status=in_progress, actual_start_time=NOW(), updated_by, updated_at
   d. INSERT meeting_events: meeting_started, manual, old/new value
   e. IF room_bookings exists with status=approved: UPDATE to active
   f. IF room_booking_usages exists with usage_status=not_started: UPDATE to in_use
   g. INSERT audit_logs: start_meeting
   h. Commit transaction
5. Post-transaction (best-effort):
   a. Push WebSocket event to meeting:meetingId room
   b. Log success
6. Return response DTO
```

**Method 2: `startMeetingFromDeviceCheckIn(params)`**
```
Same as startMeeting but:
- Bỏ qua authorization (đã được xác thực qua internal call)
- Tự động resolve meeting từ recognizedUserId + roomId + time window
- source_type = 'device'
- actor_user_id = recognizedUserId hoặc null
- Nếu match 0 hoặc >1 meetings → throw MEETING_START_AMBIGUOUS_DEVICE_MATCH
```

### WebSocket Event Payload
```json
{
  "eventType": "meeting.session.started",
  "data": {
    "meetingId": "uuid",
    "status": "in_progress",
    "actualStartTime": "ISO-8601",
    "scheduledStartTime": "ISO-8601",
    "scheduledEndTime": "ISO-8601",
    "roomId": "uuid",
    "startedBy": "userId",
    "occurredAt": "ISO-8601"
  }
}
```

## 8. Validation Plan

| Validation | Layer | Error Code | HTTP Status |
|---|---|---|---|
| meetingId UUID format | Controller (ParseUUIDPipe) | 400 | 400 |
| Meeting tồn tại, không soft-delete | Service | MEETING_NOT_FOUND | 404 |
| User là Host hoặc Organizer | Service | FORBIDDEN | 403 |
| `meeting.session.start` permission | Guard | 403 | 403 |
| JWT authentication | Guard | 401 | 401 |
| Status = `scheduled` | Service | MEETING_NOT_IN_SCHEDULED_STATUS | 409 |
| `actual_start_time` null | Service | (idempotent path) | 200 |
| Time window: not too early | Service | MEETING_START_TOO_EARLY | 409 |
| Time window: not expired | Service | MEETING_START_WINDOW_EXPIRED | 409 |
| Status != `completed` | Service | MEETING_ALREADY_COMPLETED | 409 |
| Status != `cancelled` | Service | MEETING_CANCELLED | 409 |
| Status != `pending_approval` | Service | MEETING_PENDING_APPROVAL | 409 |
| Status != `draft` | Service | MEETING_IN_DRAFT_STATUS | 409 |
| AF1: unique meeting match | Service | MEETING_START_AMBIGUOUS_DEVICE_MATCH | 409 |

## 9. Error Handling Plan

Tất cả errors throw NestJS exception và được format theo convention dự án:
```json
{
  "success": false,
  "message": "...",
  "error": { "code": "ERROR_CODE", "details": {} },
  "timestamp": "...",
  "path": "..."
}
```

**Exception mapping**:
- `NotFoundException` → 404 (MEETING_NOT_FOUND).
- `ForbiddenException` → 403 (FORBIDDEN).
- `ConflictException` → 409 (các MEETING_* error codes).
- `BadRequestException` → 400 (validation).
- `UnauthorizedException` → 401 (UNAUTHENTICATED).

**Transaction error handling**:
- Wrap `this.dataSource.transaction(...)` trong try/catch.
- Exception trong transaction → rollback tự động.
- Lỗi không phải NestJS exception (unexpected) → `Logger.error` + rethrow.
- Realtime push failure → `Logger.error` + không ảnh hưởng business data.

## 10. Testing Strategy

### Unit Tests

**T015 Service specs (`live-meeting.service.spec.ts`)**:
- startMeeting happy path — tất cả tables cập nhật đúng.
- Meeting không tồn tại → `MEETING_NOT_FOUND`.
- User không phải Host/Organizer → `FORBIDDEN`.
- Status không phải `scheduled` → `MEETING_NOT_IN_SCHEDULED_STATUS`.
- Time window quá sớm → `MEETING_START_TOO_EARLY`.
- Time window hết hạn → `MEETING_START_WINDOW_EXPIRED`.
- Meeting đã `in_progress` → idempotent `alreadyStarted=true`.
- Meeting `completed` → `MEETING_ALREADY_COMPLETED`.
- Meeting `cancelled` → `MEETING_CANCELLED`.
- Meeting `pending_approval` → `MEETING_PENDING_APPROVAL`.
- Meeting soft-deleted → `MEETING_NOT_FOUND`.
- AF1 device match chính xác 1 meeting → start thành công.
- AF1 device match 0 meeting → `MEETING_START_AMBIGUOUS_DEVICE_MATCH`.
- AF1 device match >1 meeting → `MEETING_START_AMBIGUOUS_DEVICE_MATCH`.
- Race condition — concurrent start → lock + idempotent handling.
- WebSocket push thất bại → không rollback transaction.
- Transaction rollback khi ghi `meeting_events` hoặc `audit_logs` thất bại → đảm bảo rollback toàn bộ, status meeting không bị đổi.

**T016 Controller specs (`live-meeting.controller.spec.ts`)**:
- POST endpoint gọi service đúng params.
- ParseUUIDPipe reject invalid meetingId.
- RequirePermissions decorator.

**T017 DTO specs**:
- StartMeetingResponseDto format.

### Integration Tests
**T018 Quickstart validation**:
- Test toàn bộ flow quickstart.

## 11. Implementation Phases

### Phase 1: Foundation (Setup)
| Task | Mô tả |
|---|---|
| T001 | Tạo cấu trúc module live-meeting hoàn chỉnh |
| T002 | Thêm `DEVICE` vào `MeetingEventSourceType` enum |
| T003 | Tạo seed permission `meeting.session.start` |

### Phase 2: Foundational (Blocking Prerequisites)
| Task | Mô tả |
|---|---|
| T004 | Tạo `StartMeetingResponseDto` |
| T005 | Tạo file hằng số error codes |
| T006 | Tạo `DeviceStartMeetingParams` interface |

### Phase 3: Core Logic (US1 Manual Start)
| Task | Mô tả |
|---|---|
| T007 | Implement `LiveMeetingService` core method `startMeeting()` |
| T008 | Implement `LiveMeetingController` endpoint `POST` |
| T009 | Cập nhật `LiveMeetingModule` providers/controllers |
| T010 | Thêm `LiveMeetingService` vào app module exports nếu cần |

### Phase 4: Alternative Flow 1 (US2 Device Check-in)
| Task | Mô tả |
|---|---|
| T011 | Implement `startMeetingFromDeviceCheckIn()` internal service |
| T012 | Export `LiveMeetingService` cho các module khác |

### Phase 5: Integration & WebSocket Sync
| Task | Mô tả |
|---|---|
| T013 | Implement WebSocket push helper method |
| T014 | Gọi `emitMeetingStartedEvent` sau transaction commit |

### Phase 6: Testing & Documentation
| Task | Mô tả |
|---|---|
| T015 | Service unit tests |
| T016 | Controller unit tests |
| T017 | DTO specs |
| T018 | Quickstart validation |

## 12. Risks & Mitigations

| Risk | Likelihood | Impact | Mitigation |
|---|---|---|---|
| Race condition concurrent start | Medium | High (double start) | `SELECT FOR UPDATE` pessimistic lock |
| Realtime push failure | Low | Low (user miss realtime update) | Best-effort + log, không ảnh hưởng dữ liệu |
| Quên seed permission | Low | High (API trả 403) | Seed trong Phase 1, test kiểm tra permission |
| `MeetingEventSourceType` chưa có `DEVICE` | Low | Medium (AF1 không log đúng source) | Thêm enum ngay Phase 1 |
| Module `live-meeting` mới chưa có entity imports | Medium | High (compile lỗi) | Import đúng entities từ `meetings` và `rooms` module |

## 13. Acceptance Criteria Traceability

| AC ID | Requirement ID | Verification | Test Phase |
|---|---|---|---|
| AC-001 | FR-001..006, 009, 025, 031-035 | Happy path: API 200 + DB updates | Phase 4 |
| AC-017 | FR-017a, ERR-016 | Time window too early → 409 | Phase 4 |
| AC-018 | FR-017b, ERR-017 | Time window expired → 409 | Phase 4 |
| AC-019 | FR-012, 018 | Idempotent: alreadyStarted=true | Phase 4 |
| (mở rộng) | FR-015, ERR-005 | Meeting not found → 404 | Phase 4 |
| (mở rộng) | FR-016, ERR-003 | Not host → 403 | Phase 4 |
| (mở rộng) | FR-017, ERR-006 | Wrong status → 409 | Phase 4 |
| (mở rộng) | FR-019, ERR-008 | Completed → 409 | Phase 4 |
| (mở rộng) | FR-020, ERR-009 | Cancelled → 409 | Phase 4 |
| (mở rộng) | FR-021, ERR-010 | Pending approval → 409 | Phase 4 |
| (mở rộng) | FR-024a, ERR-018 | AF1 ambiguous match → 409 | Phase 4 |
| (mở rộng) | FR-036 | WebSocket event emitted | Phase 3/4 |
