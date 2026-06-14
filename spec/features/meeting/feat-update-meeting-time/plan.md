# Implementation Plan: UC-MM-02 — Cập nhật thời gian họp

## CHANGELOG & REVISION HISTORY
| Ngày cập nhật | Tóm tắt thay đổi | Các dòng thay đổi |
| :--- | :--- | :--- |
| 2026-06-09 | Initial plan from spec + research + design artifacts | All |

---

## 1. Feature Summary

- **Feature ID**: MEETING-TIME-UPDATE-001
- **Use Case ID**: UC-MM-02
- **Module**: `meetings`
- **Priority**: High | **Complexity**: Medium | **Effort**: 3-5 story points

Tính năng cho phép Creator/Organizer, Host, Admin cập nhật `start_time` và `end_time` của một meeting đang ở trạng thái `scheduled`. Hệ thống kiểm tra quyền, trạng thái, room availability, participant conflict; cập nhật `meetings` và `room_bookings` trong cùng transaction; tạo event/audit/notification. Hỗ trợ đổi phòng nếu room conflict (A1) và override participant conflict (E3).

---

## 2. Technical Context

### 2.1 Codebase Baseline

| Aspect | Status | Reference |
|---|---|---|
| Framework | NestJS + TypeORM | `src/` |
| Module hiện tại | `MeetingsModule` có controller (3 endpoints), service, entities | `src/modules/meetings/` |
| Transaction pattern | `DataSource.transaction(async (em) => { ... })` | `meetings.service.ts` |
| Conflict checking | `getRoomAvailability()`, `checkParticipantConflicts()`, `getAvailableRooms()` | `meetings.service.ts` |
| Permission guard | `JwtAuthGuard` + `PermissionsGuard` + `@RequirePermissions()` | `src/modules/auth/` |
| User extraction | `request['user'] as { userId: string }` | Controller convention |
| Notification | Inline `em.create(NotificationEntity)` trong transaction | `meeting-request-review.service.ts` |
| Audit log | Inline `em.create(AuditLogEntity)` trong transaction | Same |
| Background job | `BackgroundJobEntity` có sẵn | `src/modules/administration/` |

### 2.2 Entities Available

| Entity | Status | Usage |
|---|---|---|
| `MeetingEntity` | ✅ Complete | Update `startTime`, `endTime`, `roomId` |
| `MeetingParticipantEntity` | ✅ Complete | Read participant list |
| `MeetingRequestEntity` | ✅ Complete | Create `update_time` + `auto` + `applied` |
| `MeetingEventEntity` | ⚠️ Need `meeting_time_updated` enum value | Create event record |
| `RoomBookingEntity` | ✅ Complete | Update time/room, conflict check |
| `RoomEntity` | ✅ Complete | Read capacity, status |
| `NotificationEntity` | ⚠️ Need `meeting_time_updated` enum value | Create notification |
| `BackgroundJobEntity` | ✅ Complete | Create `send_email` job |
| `AuditLogEntity` | ✅ Complete | Create audit record |

### 2.3 NEEDS CLARIFICATION Resolved

Tất cả clarification questions từ spec đã được giải quyết trong phiên bản spec hiện tại. Xem spec.md sections Out of Scope, Business Rules, Data Model, Error Handling.

---

## 3. Constitution Check

| Gate | Status | Ghi chú |
|---|---|---|
| **DB Gate** | ✅ PASS | Không thêm bảng mới, không sửa schema hiện có |
| **Security Gate** | ✅ PASS | Không lưu/log secret. Auth dùng JwtAuthGuard + PermissionsGuard |
| **Scope Gate** | ✅ PASS | Chỉ implement endpoint `PATCH /api/v1/meetings/{meetingId}/time` |
| **Module Gate** | ✅ PASS | Logic nằm trong `MeetingsModule`. Không vi phạm boundary |
| **API Gate** | ✅ PASS | Response format đúng convention: `{ success, data/message, error, meta }` |
| **Auth Gate** | ✅ PASS | `JwtAuthGuard` trên endpoint. `userId` từ JWT |
| **Test Gate** | ⚠️ Partial | Unit test cho service methods + DTO validation. Integration test suggestions |

**Constitution Reference**: `AGENTS.md` sections 5 (DB baseline), 8 (API convention), 9 (Auth/RBAC), 10.1 (Meeting rules), 15 (TypeORM convention)

---

## 4. Scope Confirmation

### 4.1 In Scope

- [x] `PATCH /api/v1/meetings/{meetingId}/time` endpoint
- [x] Kiểm tra quyền: Creator/Organizer, Host, Admin (with `meeting.time.update.any`)
- [x] Kiểm tra trạng thái meeting: chỉ cho phép `scheduled`
- [x] Kiểm tra time validation: `startTime < endTime`, không quá khứ, duration 15p-8h
- [x] Kiểm tra room conflict (blocking) với re-check trước commit
- [x] Kiểm tra participant conflict (soft warning, có thể override)
- [x] Hỗ trợ đổi phòng (A1) với capacity check
- [x] Cập nhật `meetings` + `room_bookings` trong cùng transaction
- [x] Tạo `meeting_events`, `audit_logs`, `meeting_requests`
- [x] Tạo `notifications` + `background_jobs` (không block transaction)
- [x] Thêm enum values: `MeetingEventType.MEETING_TIME_UPDATED`, `NotificationType.MEETING_TIME_UPDATED`
- [x] Tạo `UpdateMeetingTimeDto` với class-validator

### 4.2 Out of Scope (Confirmed)

- ❌ Không tạo bảng database mới
- ❌ Không recurring series update
- ❌ Không approval flow (dùng `approval_mode = 'auto'`)
- ❌ Không email provider thật
- ❌ Không API endpoint khác
- ❌ Không implement notifications service riêng (giữ inline pattern)
- ❌ Không implement auto no-show release
- ❌ Không implement recording config changes

---

## 5. Data Model Impact

### 5.1 No New Tables

Feature sử dụng 7 bảng hiện có trong DB v3.2 Compact:
`meetings`, `room_bookings`, `meeting_requests`, `meeting_events`, `notifications`, `background_jobs`, `audit_logs`

### 5.2 New Enum Values

| File | Enum | New Value |
|---|---|---|
| `src/modules/meetings/entities/meeting-event.entity.ts` | `MeetingEventType` | `meeting_time_updated = 'meeting_time_updated'` |
| `src/modules/notifications/entities/notification.entity.ts` | `NotificationType` | `meeting_time_updated = 'meeting_time_updated'` |

### 5.3 Full Data Mapping

Xem `data-model.md` sections 1.1 → 1.7 cho chi tiết từng entity.

### 5.4 Transaction Boundary

```
Transaction (dataSource.transaction):
  1. Tìm và lock booking record hiện tại (pessimistic_write)
  2. Re-check room conflict (loại trừ booking hiện tại)
  3. Update meetings (start_time, end_time, room_id, updated_by)
  4. Update room_bookings (reserved_start/end_time, room_id, booking_type)
  5. Tạo meeting_requests (request_type = 'update_time', auto + applied)
  6. Tạo meeting_events (event_type = 'meeting_time_updated')
  7. Tạo audit_logs (action_type = 'update')
  Commit — nếu fail bất kỳ step nào → rollback toàn bộ

After transaction (try-catch, không ảnh hưởng kết quả):
  8. Tạo notifications (notification_type = 'meeting_time_updated')
  9. Tạo background_jobs (job_type = 'send_email')
  10. Nếu step 8/9 fail → ghi log error, response notificationStatus = 'failed'
```

---

## 6. API / Contract Plan

### 6.1 Endpoint

| Thuộc tính | Giá trị |
|---|---|
| Method | `PATCH` |
| Path | `/api/v1/meetings/{meetingId}/time` |
| Auth | JWT Bearer required |
| Guard | `JwtAuthGuard` + `PermissionsGuard` + `@RequirePermissions('meeting.time.update')` |
| Content-Type | `application/json` |

### 6.2 Request Body Schema

```typescript
class UpdateMeetingTimeDto {
  @IsNotEmpty()
  @IsISO8601({ strict: true })
  startTime: string;

  @IsNotEmpty()
  @IsISO8601({ strict: true })
  endTime: string;

  @IsOptional()
  @IsUUID()
  newRoomId?: string;

  @IsOptional()
  @IsBoolean()
  overrideParticipantConflict?: boolean;

  @IsOptional()
  @MaxLength(500)
  changeReason?: string;
}
```

### 6.3 Response Details

Xem `contracts/meeting-update-time-api.md` cho tất cả response formats và error codes.

---

## 7. Authorization Plan

### 7.1 Permission Check Flow

```
Request đến endpoint PATCH /api/v1/meetings/{meetingId}/time
  ↓
[JwtAuthGuard] 
  → Validate JWT token
  → Set request['user'] = { userId, jti, exp }
  ↓
[PermissionsGuard] 
  → Đọc 'meeting.time.update' từ metadata
  → Kiểm tra user có permission này không
  → Pass: tiếp tục | Fail: 403 FORBIDDEN
  ↓
[Controller Method]
  → Load meeting từ DB
  → Nếu user có 'meeting.time.update.any': cho phép (admin bypass)
  → Nếu user chỉ có 'meeting.time.update':
    → Kiểm tra user.id === meeting.organizerId
       hoặc user.id === meeting.hostId
    → Nếu match: cho phép | Không match: 403 MEETING_TIME_UPDATE_FORBIDDEN
```

### 7.2 Permission Values

| Permission | Scope | Assigned To |
|---|---|---|
| `meeting.time.update` | Creator/Organizer, Host của meeting | Default roles |
| `meeting.time.update.any` | Admin override | Admin role |

---

## 8. Business Logic Plan

### 8.1 Main Flow (Service Method: `updateMeetingTime`)

```
updateMeetingTime(meetingId, dto, authUser, clientContext):
  1. Tìm meeting theo meetingId
     - Not found/soft deleted → 404 MEETING_NOT_FOUND
     - Status != 'scheduled' → 409 MEETING_STATUS_NOT_EDITABLE
  
  2. Kiểm tra quyền chi tiết (beyond PermissionsGuard)
     - Nếu user có 'meeting.time.update.any' → OK
     - Nếu user có 'meeting.time.update' 
       và (authUser.userId === meeting.organizerId 
            hoặc authUser.userId === meeting.hostId) → OK
     - Không → 403 MEETING_TIME_UPDATE_FORBIDDEN
  
  3. Parse và validate thời gian
     - startTime/endTime là ISO-8601 hợp lệ (DTO validated)
     - startTime < endTime → 422 INVALID_TIME_RANGE
     - startTime không trong quá khứ → 422 MEETING_TIME_IN_PAST
     - Duration 15p <= X <= 8h → 422 MEETING_DURATION_OUT_OF_RANGE
  
  4. Xác định room_id (hiện tại hoặc newRoomId)
     - Nếu dto.newRoomId:
       - Kiểm tra room tồn tại → 404 ROOM_NOT_FOUND
       - Kiểm tra room active → 409 ROOM_NOT_AVAILABLE
       - Kiểm tra capacity >= attendeeCount → 409 ROOM_CAPACITY_INSUFFICIENT
       - targetRoomId = dto.newRoomId
     - Nếu không: targetRoomId = meeting.roomId
  
  5. Kiểm tra room conflict (trước transaction)
     - Query overlapping bookings cho targetRoomId trong khung giờ mới
     - Loại trừ booking hiện tại của meeting này
     - Nếu conflict → 409 ROOM_TIME_CONFLICT với suggestedRooms
     - Nếu conflict và có newRoomId → conflict blocking (không thể tiếp)

  6. Kiểm tra participant conflict (trước transaction)
     - Query participants của meeting
     - Check lịch của từng participant trong khung giờ mới
     - Nếu conflict:
       - Nếu !dto.overrideParticipantConflict → return 409 PARTICIPANT_TIME_CONFLICT_WARNING
       - Nếu dto.overrideParticipantConflict === true → tiếp tục

  7. Transaction:
     a. Lock: tìm và lock booking record (pessimistic_write)
        - Nếu không có booking: tạo booking mới (FR-029)
     b. Re-check room conflict (same query, trong transaction)
        - Nếu conflict mới → rollback, 409 ROOM_TIME_CONFLICT
     c. Update meetings
     d. Update room_bookings (booking_type = 'relocated' nếu đổi phòng)
     e. Create meeting_requests (request_type='update_time', approval_mode='auto', applied)
     f. Create meeting_events (event_type='meeting_time_updated')
     g. Create audit_logs (action_type='update')
     Commit

  8. After transaction (try-catch):
     a. Create notifications for all participants
     b. Create background_jobs (send_email)
     c. Nếu fail → log error, set notificationStatus = 'failed'

  9. Return success response
```

### 8.2 Alternative Flow A1 — Đổi phòng

Trigger: Room conflict detected at step 5 AND `newRoomId` provided.

- `targetRoomId = newRoomId` với validation đầy đủ
- Transaction updates cả `room_id` trong `meetings` và `room_bookings`
- `booking_type` set to `'relocated'`
- Các step còn lại giống main flow

### 8.3 Business Rules Enforcement

| BR ID | Implementation Point |
|---|---|
| BR-01 → BR-04 | Step 1: status check + authorization |
| BR-05 → BR-06, BR-15 | Step 3: time validation |
| BR-07 | Step 7c: Partial update, chỉ set các field cần thiết |
| BR-08 | Step 5 + 7b: room conflict = blocking |
| BR-09 | Step 6: participant conflict = soft warning |
| BR-10 | Step 7: đồng bộ meetings + room_bookings trong transaction |
| BR-11 | Step 8: notification failure không ảnh hưởng |
| BR-12 | Step 7f + 7g: event + audit bắt buộc |
| BR-13 | Chỉ update meeting identified by meetingId |
| BR-14 | Step 4: capacity check khi có newRoomId |
| BR-15 | Step 3: duration validation |

---

## 9. Validation Plan

### 9.1 DTO-level Validation (class-validator)

| Field | Validator | Error Code |
|---|---|---|
| `startTime` | `@IsNotEmpty()` + `@IsISO8601({ strict: true })` | `INVALID_DATE_FORMAT` |
| `endTime` | `@IsNotEmpty()` + `@IsISO8601({ strict: true })` | `INVALID_DATE_FORMAT` |
| `newRoomId` | `@IsOptional()` + `@IsUUID()` | `INVALID_UUID` |
| `overrideParticipantConflict` | `@IsOptional()` + `@IsBoolean()` | `INVALID_BOOLEAN` |
| `changeReason` | `@IsOptional()` + `@MaxLength(500)` | `FIELD_TOO_LONG` |

### 9.2 Service-level Validation

| Check | Method | Error Code |
|---|---|---|
| Meeting exists | `findOne` query | `MEETING_NOT_FOUND` |
| Meeting status = scheduled | status check | `MEETING_STATUS_NOT_EDITABLE` |
| startTime < endTime | manual compare | `INVALID_TIME_RANGE` |
| startTime not in past | manual compare | `MEETING_TIME_IN_PAST` |
| Duration 15p-8h | calculate diff | `MEETING_DURATION_OUT_OF_RANGE` |
| Room exists (newRoomId) | `findOne` query | `ROOM_NOT_FOUND` |
| Room active | status/is_active check | `ROOM_NOT_AVAILABLE` |
| Room capacity | compare with attendee count | `ROOM_CAPACITY_INSUFFICIENT` |
| Room conflict | overlap query | `ROOM_TIME_CONFLICT` |
| Participant conflict | overlap query | `PARTICIPANT_TIME_CONFLICT_WARNING` |

---

## 10. Error Handling Plan

### 10.1 Error Code Map

| Error Code | HTTP | Thrown By | Details |
|---|---|---|---|
| `INVALID_UUID` | 400 | Pipe/DTO | meetingId hoặc newRoomId không phải UUID |
| `INVALID_BOOLEAN` | 400 | DTO | overrideParticipantConflict không phải boolean |
| `UNAUTHORIZED` | 401 | JwtAuthGuard | Token missing/expired/invalid |
| `MEETING_TIME_UPDATE_FORBIDDEN` | 403 | Service | User không có quyền với meeting này |
| `MEETING_NOT_FOUND` | 404 | Service | Meeting không tồn tại / soft deleted |
| `ROOM_NOT_FOUND` | 404 | Service | newRoomId không tồn tại |
| `MEETING_STATUS_NOT_EDITABLE` | 409 | Service | Meeting không ở trạng thái scheduled |
| `ROOM_TIME_CONFLICT` | 409 | Service | Room conflict blocking (kèm suggestedRooms) |
| `ROOM_NOT_AVAILABLE` | 409 | Service | Phòng inactive/maintenance |
| `ROOM_CAPACITY_INSUFFICIENT` | 409 | Service | Phòng không đủ sức chứa |
| `PARTICIPANT_TIME_CONFLICT_WARNING` | 409 | Service | Participant conflict (blocking=false + requiresConfirmation) |
| `INVALID_DATE_FORMAT` | 422 | DTO/Service | startTime/endTime sai định dạng |
| `INVALID_TIME_RANGE` | 422 | Service | startTime >= endTime |
| `MEETING_TIME_IN_PAST` | 422 | Service | startTime/endTime trong quá khứ |
| `MEETING_DURATION_OUT_OF_RANGE` | 422 | Service | Duration < 15p hoặc > 8h |
| `FIELD_TOO_LONG` | 422 | DTO | changeReason > 500 ký tự |
| `INTERNAL_SERVER_ERROR` | 500 | Global | Database error, unexpected error |

### 10.2 Exception Types Used

| NestJS Exception | When |
|---|---|
| `BadRequestException` | UUID/boolean validation fail |
| `UnauthorizedException` | No/invalid JWT |
| `ForbiddenException` | Permission denied |
| `NotFoundException` | Meeting/room không tồn tại |
| `ConflictException` | Status conflict, room conflict, room inactive, capacity |
| `UnprocessableEntityException` | Time validation fail (past, invalid range, duration) |
| `InternalServerErrorException` | Database/unexpected errors |

---

## 11. Testing Strategy

### 11.1 Unit Tests

| Test | Scope | File |
|---|---|---|
| `UpdateMeetingTimeDto` validation | DTO | `update-meeting-time.dto.spec.ts` |
| `updateMeetingTime` — happy path | Service | `meetings.service.spec.ts` |
| `updateMeetingTime` — room conflict | Service | Same |
| `updateMeetingTime` — participant conflict | Service | Same |
| `updateMeetingTime` — override participant conflict | Service | Same |
| `updateMeetingTime` — đổi phòng (A1) | Service | Same |
| `updateMeetingTime` — meeting not found | Service | Same |
| `updateMeetingTime` — forbidden | Service | Same |
| `updateMeetingTime` — wrong status | Service | Same |
| `updateMeetingTime` — past time | Service | Same |
| `updateMeetingTime` — duration out of range | Service | Same |
| `updateMeetingTime` — capacity insufficient | Service | Same |
| `updateMeetingTime` — room not found | Service | Same |
| `updateMeetingTime` — race condition rollback | Service | Same |
| `updateMeetingTime` — missing booking (FR-029) | Service | Same |
| `updateMeetingTime` — notification failure graceful | Service | Same |

### 11.2 Integration Tests

| Test | Description |
|---|---|
| Full transaction success flow | Create meeting → update time → verify all entities |
| Transaction rollback on conflict | Force room conflict at re-check → verify no change |
| Pessimistic locking behavior | Concurrent requests → only one succeeds |
| Admin override permission | Admin với `meeting.time.update.any` trên meeting người khác |

### 11.3 Acceptance Criteria Coverage

| AC ID | Test Coverage | Priority |
|---|---|---|
| AC-001 | Happy path unit test | High |
| AC-002 | Admin override unit test | High |
| AC-003 → AC-005 | Validation unit tests | High |
| AC-006 → AC-008 | Auth unit tests | High |
| AC-009 → AC-011 | Status check unit tests | High |
| AC-012 → AC-013 | Room conflict unit tests | High |
| AC-014 → AC-015 | Participant conflict unit tests | High |
| AC-016 → AC-020 | Data integrity post-condition tests | Medium |

---

## 12. Implementation Phases

### Phase 1: Enum & DTO Changes

**Files to modify:**
- `src/modules/meetings/entities/meeting-event.entity.ts` — add `meeting_time_updated` enum value
- `src/modules/notifications/entities/notification.entity.ts` — add `meeting_time_updated` enum value

**Files to create:**
- `src/modules/meetings/dto/update-meeting-time.dto.ts` — new DTO with class-validator decorators

**Verification:** Build pass, DTO validation tests pass.

### Phase 2: Service Logic

**Files to modify:**
- `src/modules/meetings/services/meetings.service.ts` — add `updateMeetingTime()` method
- `src/modules/meetings/meetings.module.ts` — verify all entity imports (notifications, background_jobs, meeting_events, meeting_requests, audit_logs)

**Verification:** Unit tests for all business logic paths pass.

### Phase 3: Controller Endpoint

**Files to modify:**
- `src/modules/meetings/controllers/meetings.controller.ts` — add `@Patch('meetings/:meetingId/time')` endpoint

**Verification:** Controller integration test passes, response format matches contract.

### Phase 4: Permissions

**Files to modify:**
- Seed data hoặc permissions table initialization — add `meeting.time.update` và `meeting.time.update.any`

**Verification:** Permission guard test passes.

### Phase 5: Testing

**Files to create/modify:**
- `src/modules/meetings/dto/update-meeting-time.dto.spec.ts` — DTO validation spec
- `src/modules/meetings/services/meetings.service.spec.ts` — add updateMeetingTime tests
- `src/modules/meetings/controllers/meetings.controller.spec.ts` — add endpoint tests

**Verification:** `npm test` passes, coverage >= 80% cho new code.

### Phase 6: Lint & Build

- `npm run lint` — zero errors
- `npm run build` — zero errors

---

## 13. Risks & Mitigations

| Risk | Likelihood | Impact | Mitigation |
|---|---|---|---|
| Race condition: 2 requests cùng update 1 meeting | Low | Medium | Pessimistic lock + re-check trước commit |
| Notification creation fail sau transaction | Medium | Low | Không rollback; log error + response `notificationStatus: 'failed'` |
| Forgot to add enum values | Low | High | Code review checklist item: verify all enum additions |
| Forgot to import entity in module | Low | High | Build will catch missing TypeORM imports |
| Participant conflict detection performance (nhiều participants) | Low | Medium | Conflict check uses indexed queries; acceptable for < 100 participants |
| MeetingRequestType `update_time` chưa được validate trong review service | None | None | Update-time được auto-approve, không qua review service |

---

## 14. Acceptance Criteria Traceability

| AC ID | FR ID | Test | Phase |
|---|---|---|---|
| AC-001 | FR-007, FR-008, FR-009 | `updateMeetingTime success` | P2, P5 |
| AC-002 | FR-034 | `admin override` | P2, P4, P5 |
| AC-003 | FR-023, ERR-003 | `startTime >= endTime` | P1, P5 |
| AC-004 | FR-024, ERR-004 | `startTime in past` | P1, P5 |
| AC-005 | ERR-001 | `invalid UUID` | P1, P5 |
| AC-006 | FR-031 | `no token` | P3, P5 |
| AC-007 | FR-021, ERR-006 | `participant forbidden` | P2, P5 |
| AC-008 | FR-032, ERR-006 | `no permission` | P2, P4, P5 |
| AC-009 | FR-016, FR-022, ERR-007 | `meeting in_progress` | P2, P5 |
| AC-010 | FR-016, FR-022, ERR-007 | `meeting completed` | P2, P5 |
| AC-011 | FR-016, FR-022, ERR-007 | `meeting cancelled` | P2, P5 |
| AC-012 | FR-025, ERR-008 | `room conflict` | P2, P5 |
| AC-013 | FR-010, FR-011 | `change room` | P2, P5 |
| AC-014 | FR-028, ERR-009 | `participant conflict warning` | P2, P5 |
| AC-015 | FR-014, FR-028 | `override participant conflict` | P2, P5 |
| AC-016 | FR-004, FR-008 | `data integrity` | P2, P5 |
| AC-017 | FR-009, TXN-006, TXN-007 | `booking consistency` | P2, P5 |
| AC-018 | FR-006, AUD-005 | `audit log` | P2, P5 |
| AC-019 | FR-005, AUD-001 | `event log` | P2, P5 |
| AC-020 | FR-040, FR-041 | `notification queued` | P2, P5 |

---

## 15. Complexity Tracking

Không có vi phạm principle nào được phát hiện. Plan này tuân thủ đầy đủ:
- **DB Gate**: Không thêm bảng, không sửa schema
- **Security**: JWT + RBAC, userId từ token
- **Scope**: Chỉ implement những gì spec yêu cầu
- **Module**: Logic trong MeetingsModule
- **API**: Response format theo chuẩn dự án
