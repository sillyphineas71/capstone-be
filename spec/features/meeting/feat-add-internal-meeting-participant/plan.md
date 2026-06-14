# Implementation Plan: Thêm thành viên nội bộ cuộc họp thủ công

- **Feature ID**: MEET-ADD-PARTICIPANT-001
- **Created**: 2026-06-10
- **Status**: Draft

---

## 📝 CHANGELOG & REVISION HISTORY
| Ngày cập nhật | Tóm tắt thay đổi | Các dòng thay đổi |
| :--- | :--- | :--- |
| 2026-06-10 | Khởi tạo plan cho tính năng thêm thành viên nội bộ | Toàn bộ file |
| 2026-06-10 | Cập nhật mục 12: đánh số Task T001-T012 cho khớp với tasks.md | Mục 12 |

---

## 1. Feature Summary

Cho phép Organizer/Host/Meeting Manager/Admin thêm nhân viên nội bộ (Internal Employee) vào danh sách `meeting_participants` của một cuộc họp đang ở trạng thái `scheduled` hoặc `in_progress`. Luồng có 2 bước nếu phát hiện soft warning (schedule conflict hoặc capacity warning): bước 1 trả warning + token, bước 2 client gửi lại token để xác nhận.

---

## 2. Technical Context

- **Module**: `meetings` (src/modules/meetings/)
- **Framework**: NestJS, TypeORM
- **Auth**: JwtAuthGuard + PermissionsGuard + @RequirePermissions
- **Database**: PostgreSQL v3.2 Compact (39 tables) — không thay đổi schema
- **Reuse**: `checkParticipantConflicts()`, `getAttendeeCount()`, transaction pattern hiện có
- **New pattern**: `warningToken` JWT short-lived (khác với simple boolean confirm hiện tại)
- **Constitution**: Tuân thủ đầy đủ — không thêm bảng, không scope creep, dùng UUID/timestamptz, Stateless JWT

---

## 3. Constitution Check

- **DB Gate**: PASS — không thêm/xóa bảng, không đổi tên cột
- **Security Gate**: PASS — JWT auth, user_id từ token, không log secret
- **Scope Gate**: PASS — đúng spec UC-MM-06, không mở rộng
- **Module Gate**: PASS — logic trong meetings module, notification/audit qua module import
- **API Gate**: PASS — response format `{ success, message, data, error }`, HTTP codes đúng mục 8.3 AGENTS.md
- **Auth Gate**: PASS — JwtAuthGuard + PermissionsGuard, user_id từ JWT
- **Test Gate**: PASS — unit test cho DTO validation + service methods + controller

**Complexity Justification warning**:
- `warningToken` là pattern mới (JWT short-lived) so với simple boolean confirm trong codebase hiện tại. Lý do: spec yêu cầu token để chống giả mạo (FR-009, FR-010). Alternative đơn giản hơn (boolean flag) không đáp ứng security requirement về "không được phép tự động bypass cảnh báo nếu không có `warningToken` hợp lệ".

---

## 4. Scope Confirmation

### In scope:
- Thêm Internal Employee (user nội bộ) vào meeting_participants
- 2-step warning confirmation cho schedule conflict & capacity warning
- Private meeting enforcement (chỉ Organizer/Host/Admin)
- Capacity policy (`meeting.capacity_policy` từ `system_configs`)
- Audit logging
- Notification + background_job tạo async
- Device sync event (best-effort) khi meeting in_progress
- Race condition handling (pre-check + unique constraint)

### Out of scope (từ spec):
- Room-specific capacity policy (chỉ dùng global config)
- Gọi đồng bộ thiết bị cứng (chỉ emit event application)
- External participant
- Thay đổi role participant sau khi thêm
- SMS notification
- Cấu hình warning token TTL (mặc định 5 phút)

---

## 5. Data Model Impact

**Không thay đổi schema**. Các entity liên quan:

| Entity | Tác động |
|--------|----------|
| `meeting_participants` | INSERT record mới (các field: meeting_id, user_id, participant_role='attendee', invitation_status='pending', attendance_required=true, is_required=true, invited_by=[Actor.id]) |
| `notifications` | INSERT record mới (notification_type='MEETING_INVITE', recipient_user_ids_json=[userId]) |
| `background_jobs` | INSERT record mới (job_type='SEND_EMAIL', inputJson={template:'meeting_invite', notificationId}) |
| `audit_logs` | INSERT record mới (action_type='ADD_PARTICIPANT', entity_id=participantId) |

Chi tiết xem `data-model.md`.

---

## 6. API / Contract Plan

### New Endpoint: `POST /api/v1/meetings/:meetingId/participants/internal`

| Aspect | Detail |
|--------|--------|
| Method | POST |
| Path | `/api/v1/meetings/:meetingId/participants/internal` |
| Auth | JwtAuthGuard + PermissionsGuard |
| Permission | `meeting.participant.add.internal` |
| Request body | `AddInternalParticipantDto` |

### DTO: `AddInternalParticipantDto`
```
userId: UUID (required)
overrideWarnings: boolean (optional, default false)
warningToken: string (optional, nullable)
```

### Responses
| Status | Code | Condition |
|--------|------|-----------|
| 201 | — | Success |
| 400 | `INVALID_WARNING_TOKEN` | Token sai/hết hạn |
| 400 | `INVALID_MEETING_STATUS` | Meeting không ở scheduled/in_progress |
| 403 | `FORBIDDEN_ACCESS` | Không đủ quyền |
| 404 | `MEETING_NOT_FOUND` | Meeting không tồn tại |
| 404 | `USER_NOT_FOUND` | User không tồn tại/inactive |
| 409 | `PARTICIPANT_ALREADY_EXISTS` | Duplicate |
| 422 | `WARNING_CONFIRMATION_REQUIRED` | Soft warning lần đầu |
| 422 | `ROOM_CAPACITY_EXCEEDED` | Hard block capacity |

Chi tiết xem `contracts/add-internal-participant-api.md`.

---

## 7. Authorization Plan

### Permission check sequence trong controller/service:

1. **JwtAuthGuard**: Xác thực token, gán `request['user']`
2. **PermissionsGuard**: Kiểm tra `meeting.participant.add.internal` permission
3. **Service ownership check**:
   - Nếu meeting `visibility_level = 'private'`:
     - Cho phép: `organizer_id`, `host_id`, hoặc Admin (có `admin.all` permission)
     - Từ chối: Meeting Manager thông thường → throw 403 `FORBIDDEN_ACCESS`
   - Nếu meeting không private:
     - Cho phép: Organizer, Host, hoặc bất kỳ user nào có `meeting.participant.add.internal` và đang active

### Permission seed:
- `meeting.participant.add.internal` — gán cho: ADMIN, MANAGER, EMPLOYEE (vì Organizer/Host có thể là bất kỳ role nào)
- `meeting.participant.override_capacity` — gán cho: ADMIN, ROOM_ADMIN (nếu có)

### Capacity override permission:
- Chỉ check khi có warning về capacity và policy là `warning`
- User cần có permission `meeting.participant.override_capacity` để override
- Nếu không có → trả 422 `ROOM_CAPACITY_EXCEEDED`

---

## 8. Business Logic Plan

### Service method: `addInternalParticipant(meetingId, dto, authUser, clientContext)`

#### Step 1: Pre-validation (đọc + kiểm tra)
1. **Meeting check**: `findOne(meetingId)` → 404 nếu không tồn tại
2. **Status check**: `status IN ('scheduled','in_progress')` → 400 nếu không
3. **User check**: `users.findOne(userId)` + `account_status='active'` → 404 nếu không
4. **Duplicate check**: `meeting_participants.findOne({meeting_id, user_id})` → 409 nếu đã tồn tại
5. **Private check**: Nếu `visibility_level='private'`, check `authUser.userId === organizer_id || host_id` hoặc Admin → 403 nếu không

#### Step 2: Warning check (nếu chưa override)
6. **Schedule conflict check**: Dùng `checkParticipantConflicts()` cho user tại time range của meeting
7. **Capacity check**:
   - Đếm current participants: `getAttendeeCount(meetingId)`
   - Đọc `rooms.capacity`
   - So sánh: `currentCount + 1 > roomCapacity`
   - Nếu có warning → đọc `meeting.capacity_policy` từ `system_configs`
   - Nếu policy = `'block'` → 422 `ROOM_CAPACITY_EXCEEDED` (hard block)
   - Nếu policy = `'warning'` → thêm vào warnings list

8. **Return warnings if any + no override**:
   - Nếu `warnings.length > 0` và `dto.overrideWarnings !== true` hoặc `!dto.warningToken`:
     - Generate `warningToken` JWT (5 phút TTL) chứa `{ meetingId, userId, warnings[] }`
     - Return 422 `WARNING_CONFIRMATION_REQUIRED`

#### Step 3: Warning override processing (nếu có overrideWarnings + warningToken)
9. **Verify warningToken**:
   - Decode + verify JWT signature
   - Check `meetingId` và `userId` match request params
   - Check `exp` chưa hết hạn
   - Nếu fail → 400 `INVALID_WARNING_TOKEN`

10. **Re-check capacity override permission** (nếu capacity warning trong warnings):
    - Nếu capacity warning tồn tại trong token payload:
      - Đọc lại `meeting.capacity_policy` (phòng trường hợp config thay đổi giữa 2 request)
      - Nếu policy = `'block'` → 422 `ROOM_CAPACITY_EXCEEDED` (vẫn block)
      - Nếu policy = `'warning'`:
        - Kiểm tra user có permission `meeting.participant.override_capacity` không
        - Nếu không → 422 `ROOM_CAPACITY_EXCEEDED`

#### Step 4: Transaction execution
11. **Pessimistic lock**: `em.findOne(MeetingEntity, { where: { id: meetingId }, lock: { mode: 'pessimistic_write' } })`
12. **Re-check duplicate** (race condition): `em.findOne(MeetingParticipantEntity, { meeting_id, user_id })` → nếu tồn tại, throw 409
13. **INSERT meeting_participants**: `em.create(MeetingParticipantEntity, { ... })`
14. **INSERT audit_log**: `em.create(AuditLogEntity, { actionType: 'ADD_PARTICIPANT', ... })`
15. **Commit transaction**

#### Step 5: Post-transaction async (best-effort)
16. **INSERT notification** (NotificationEntity): `notificationType='MEETING_INVITE'`, `recipientUserIdsJson=[userId]`
17. **INSERT background_job** (BackgroundJobEntity): `jobType='SEND_EMAIL'`, `inputJson={notificationId, template:'meeting_invite'}`
18. **Nếu meeting in_progress**: Emit application event (dùng `@Injectable()` EventEmitter hoặc gọi WebSocket service) — best-effort, không throw
19. **Return**: `{ participantId, meetingId, userId, role: 'attendee', status: 'pending' }`

---

## 9. Validation Plan

### DTO Validation (`AddInternalParticipantDto`):

| Field | Rule | Decorator |
|-------|------|-----------|
| `userId` | Required, valid UUID | `@IsUUID()` `@IsNotEmpty()` |
| `overrideWarnings` | Optional, boolean | `@IsOptional()` `@IsBoolean()` |
| `warningToken` | Optional, string | `@IsOptional()` `@IsString()` |

### Business Validation (service):

| Check | Method | Error |
|-------|--------|-------|
| Meeting tồn tại | `findOne` | 404 `MEETING_NOT_FOUND` |
| Meeting status | `status IN ('scheduled','in_progress')` | 400 `INVALID_MEETING_STATUS` |
| User tồn tại + active | `findOne` user | 404 `USER_NOT_FOUND` |
| Duplicate participant | `findOne(meeting_id, user_id)` | 409 `PARTICIPANT_ALREADY_EXISTS` |
| Private meeting access | Organizer/Host/Admin check | 403 `FORBIDDEN_ACCESS` |
| Schedule conflict | `checkParticipantConflicts()` | 422 (warning) |
| Room capacity | `currentCount + 1 > capacity` | 422 (warning/block) |
| warningToken valid | JWT verify | 400 `INVALID_WARNING_TOKEN` |
| Override permission | permission check | 422 `ROOM_CAPACITY_EXCEEDED` |

---

## 10. Error Handling Plan

| Exception | HTTP Status | Error Code | Xử lý |
|-----------|-------------|-----------|-------|
| NotFoundException (meeting) | 404 | `MEETING_NOT_FOUND` | Throw từ service |
| NotFoundException (user) | 404 | `USER_NOT_FOUND` | Throw từ service |
| BadRequestException (status) | 400 | `INVALID_MEETING_STATUS` | Throw từ service |
| ConflictException (duplicate) | 409 | `PARTICIPANT_ALREADY_EXISTS` | Pre-check + catch DB unique violation |
| ForbiddenException (private) | 403 | `FORBIDDEN_ACCESS` | Throw từ service |
| UnprocessableEntityException (warning) | 422 | `WARNING_CONFIRMATION_REQUIRED` | Throw từ service kèm warningToken |
| BadRequestException (token) | 400 | `INVALID_WARNING_TOKEN` | Throw từ service |
| UnprocessableEntityException (capacity) | 422 | `ROOM_CAPACITY_EXCEEDED` | Throw từ service |
| QueryFailedError (unique violation) | 409 | `PARTICIPANT_ALREADY_EXISTS` | Catch trong service hoặc global filter |

### Transaction rollback:
- Nếu bất kỳ lỗi nào xảy ra trong transaction → rollback tất cả
- Notification/BackgroundJob/DeviceSync ngoài transaction → không rollback, chỉ log lỗi

---

## 11. Testing Strategy

### 11.1 Unit Tests

| File | Test cases |
|------|-----------|
| `dto/add-internal-participant.dto.spec.ts` | Validate UUID userId, optional fields, missing required field, invalid type |
| `services/meetings.service.spec.ts` | Tất cả service method scenarios (8 test groups) |

### Service test groups:

| Group | Tests |
|-------|-------|
| Pre-validation | Meeting not found, wrong status, user not found, inactive user, duplicate |
| Authorization | Private meeting + Manager → 403, Private + Organizer → 201, Normal meeting → 201 |
| Warning flow | Schedule conflict → 422, Capacity warning (policy=warning) → 422, No warning → 201 |
| Override flow | overrideWarnings=true + valid warningToken → 201, Invalid token → 400 |
| Capacity policy | policy=block → 422, policy=warning + no override perm → 422, policy=warning + override perm + confirm → 201 |
| Race condition | 2 concurrent requests → 1 success, 1 conflict |
| In-progress meeting | Device sync event emitted (verify best-effort) |
| Transaction | Atomic insert participant + audit_log, rollback on failure |

### 11.2 Controller Tests

| File | Test cases |
|------|-----------|
| `controllers/meetings.controller.spec.ts` | HTTP 201 response format, 422 response format, guard integration |

### 11.3 DTO Validation Tests

| File | Test cases |
|------|-----------|
| `dto/add-internal-participant.dto.spec.ts` | ValidationPipe với các input hợp lệ/không hợp lệ |

---

## 12. Implementation Phases

### Phase A: Foundation (Tasks T001-T004)
1. **T001 — Seed permission**: Tạo file seed `20260610000001-SeedAddParticipantPermissions.ts`
   - Permissions: `meeting.participant.add.internal`, `meeting.participant.override_capacity`
   - Gán cho roles: ADMIN (cả 2), MANAGER (add.internal), EMPLOYEE (add.internal), ROOM_ADMIN (override_capacity)
2. **T002 — Add DTO**: Tạo `dto/add-internal-participant.dto.ts` (validation)
3. **T003 — Add Response DTO**: Tạo `dto/add-internal-participant-response.dto.ts`
4. **T004 — Add WarningToken utility**: Tạo `utils/warning-token.util.ts` để generate + verify JWT warning token

### Phase B: Service Logic (Task T005)
5. **T005 — Implement `addInternalParticipant()`** trong `meetings.service.ts`:
   - Toàn bộ business logic (steps 1-19 ở mục 8)

### Phase C: Controller & Integration (Tasks T006-T007)
6. **T006 — Add controller endpoint**: Method `addInternalParticipant()` trong `meetings.controller.ts`
7. **T007 — Update module**: Đảm bảo `meetings.module.ts` imports đủ dependencies

### Phase D: Testing (Tasks T008-T010)
8. **T008 — DTO validation tests**: Tạo `dto/add-internal-participant.dto.spec.ts`
9. **T009 — Service unit tests**: Thêm test cases vào `meetings.service.spec.ts`
10. **T010 — Controller tests**: Thêm test cases vào `meetings.controller.spec.ts`

### Phase E: Verification (Tasks T011-T012)
11. **T011 — Build pass**: `npm run build` / `nest build`
12. **T012 — Lint pass**: `npm run lint`

---

## 13. Risks & Mitigations

| Risk | Likelihood | Impact | Mitigation |
|------|-----------|--------|------------|
| `warningToken` reuse across different meetings | Low | Medium | JWT payload chứa `meetingId` + `userId`, verify match |
| Capacity config thay đổi giữa 2 request | Low | Medium | Đọc lại `meeting.capacity_policy` ở step 2 (không trust token) |
| Pessimistic lock contention trên meeting row | Low | Low | Transaction ngắn (chỉ INSERT + audit), không gọi external service trong lock |
| Notification worker chưa implement | Medium | Low | Pattern hiện tại: chỉ tạo record QUEUED, không ảnh hưởng core flow |
| Meeting có 0 room (online meeting) | Low | Low | Bỏ qua capacity check nếu `meeting.room_id` null |

---

## 14. Acceptance Criteria Traceability

| AC # | Mô tả | Test scenario | Phần code |
|------|-------|---------------|-----------|
| AC-001 | 2-step warning: lần 1 → 422, lần 2 → 201 | Service test #Override flow | `addInternalParticipant()` steps 6-15 |
| AC-002 | Lần 1 có `overrideWarnings=true` nhưng không `warningToken` → 422 | Service test #Override flow | Step 8 check `!dto.warningToken` |
| AC-003 | Private meeting + Manager (không Org/Host) → 403 | Service test #Authorization | Step 5 private check |
| AC-004 | Private meeting + Organizer → 201 | Service test #Authorization | Step 5 private check pass |
| AC-005 | Capacity full + policy=warning + Admin override → 201 | Service test #Capacity policy | Steps 7-10-13 |
| AC-006 | Capacity full + policy=warning + no override perm → 422 | Service test #Capacity policy | Step 10 override perm check fail |
| AC-007 | Capacity full + policy=block → 422 (dù Admin) | Service test #Capacity policy | Step 7 hard block |
| AC-008 | Race condition: 2 concurrent requests → 1x201 + 1x409 | Service test #Race condition | Step 12 re-check + unique constraint |

---

## 15. Files to Create / Modify

| File | Action | Mục đích |
|------|--------|----------|
| `src/modules/meetings/dto/add-internal-participant.dto.ts` | CREATE | DTO validation |
| `src/modules/meetings/dto/add-internal-participant.dto.spec.ts` | CREATE | DTO validation tests |
| `src/modules/meetings/utils/warning-token.util.ts` | CREATE | JWT warningToken generate + verify |
| `src/modules/meetings/controllers/meetings.controller.ts` | MODIFY | Add endpoint method |
| `src/modules/meetings/controllers/meetings.controller.spec.ts` | MODIFY | Add controller tests |
| `src/modules/meetings/services/meetings.service.ts` | MODIFY | Add `addInternalParticipant()` method |
| `src/modules/meetings/services/meetings.service.spec.ts` | MODIFY | Add service tests |
| `src/database/seeds/20260610000001-SeedAddParticipantPermissions.ts` | CREATE | Seed permissions |

---

## 16. Dependencies & Integration Points

| Dependency | Integration | Ghi chú |
|-----------|-------------|---------|
| `AccountsModule` | `UserEntity` | User lookup |
| `NotificationsModule` | `NotificationEntity` | Tạo notification record |
| `AdministrationModule` | `AuditLogEntity`, `BackgroundJobEntity`, `SystemConfigEntity` | Audit, bg_job, config |
| `AuthModule` | `JwtAuthGuard`, `PermissionsGuard`, `@RequirePermissions`, `@CurrentUser` | Auth + permission |
| `RoomsModule` (entity only) | `RoomEntity` (TypeOrmModule.forFeature) | Capacity check |
| `JwtService` | Generate + verify warningToken | Từ `@nestjs/jwt` |
