# Tasks: Thêm thành viên nội bộ cuộc họp thủ công

- **Feature ID**: MEET-ADD-PARTICIPANT-001
- **Created**: 2026-06-10
- **Based on**: spec.md, plan.md, research.md, data-model.md, contracts/add-internal-participant-api.md, quickstart.md

---

## 📝 CHANGELOG & REVISION HISTORY
| Ngày cập nhật | Tóm tắt thay đổi | Các dòng thay đổi |
| :--- | :--- | :--- |
| 2026-06-10 | Khởi tạo tasks cho tính năng thêm thành viên nội bộ | Toàn bộ file |
| 2026-06-10 | Fix format: add [US1] to T005/T006, [P] to T004/T010/T011/T012, fix FR/AC ref T004→T005 | Mục Requirements Coverage, Phase 1-5 |
| 2026-06-10 | Hoàn thành implement toàn bộ 12 tasks: seed, DTO, util, service, controller, module, tests, build, lint | Toàn bộ file |

---

## Phase 1: Foundation

Mục tiêu: Tạo các thành phần nền tảng độc lập (seed permission, DTO, WarningToken utility).

### 1.1 Seed Permissions

- [x] T001 Tạo file seed permission `src/database/seeds/20260610000001-SeedAddParticipantPermissions.ts`
  - File: `src/database/seeds/20260610000001-SeedAddParticipantPermissions.ts`
  - Permission `meeting.participant.add.internal`: gán cho role ADMIN, MANAGER, EMPLOYEE
  - Permission `meeting.participant.override_capacity`: gán cho role ADMIN, ROOM_ADMIN
  - Pattern: giống seed file `src/database/seeds/20260609000001-SeedMeetingRoomUpdatePermission.ts`
  - Outcome: 2 permission records trong `permissions` + role-permission mappings trong `role_permissions`

### 1.2 DTO & Response

- [x] T002 [P] Tạo `AddInternalParticipantDto` tại `src/modules/meetings/dto/add-internal-participant.dto.ts`
  - Fields:
    - `userId: string` — `@IsUUID('4')` `@IsNotEmpty()`
    - `overrideWarnings?: boolean` — `@IsOptional()` `@IsBoolean()`
    - `warningToken?: string` — `@IsOptional()` `@IsString()`
  - Import từ `class-validator` (`IsUUID`, `IsNotEmpty`, `IsOptional`, `IsBoolean`, `IsString`)
  - Outcome: DTO class ready for controller usage

- [x] T003 [P] Tạo `AddInternalParticipantResponseDto` tại `src/modules/meetings/dto/add-internal-participant-response.dto.ts`
  - Fields: `participantId`, `meetingId`, `userId`, `role`, `status`
  - Constructor nhận data object + `Object.assign(this, data)`
  - Pattern: giống `src/modules/meetings/dto/create-meeting-response.dto.ts`
  - Outcome: Response DTO class ready

### 1.3 WarningToken Utility

- [x] T004 [P] Tạo `WarningTokenUtil` tại `src/modules/meetings/utils/warning-token.util.ts`
  - Import `JwtService` từ `@nestjs/jwt`, `ConfigService` từ `@nestjs/config`
  - Method `generateToken(meetingId: string, userId: string, warnings: WarningItem[]): string`
    - JWT payload: `{ sub: 'warning:meet-add-participant', meetingId, userId, warnings, iat, exp }`
    - TTL: 5 phút
    - Sign với secret key `WARNING_TOKEN_SECRET` từ ConfigService (fallback: `'fallback-warning-secret'`)
  - Method `verifyToken(token: string, meetingId: string, userId: string): { valid: boolean; warnings?: WarningItem[] }`
    - Verify signature, check `meetingId` + `userId` match, check `exp`
    - Return `{ valid: true, warnings }` hoặc `{ valid: false }`
  - Interface `WarningItem`: `{ type: string; message: string }`
  - Decorator `@Injectable()` để inject được JwtService + ConfigService
  - Outcome: Utility class có thể inject vào MeetingsService

---

## Phase 2: Service Business Logic

Mục tiêu: Implement method `addInternalParticipant()` trong `MeetingsService`.

### 2.1 Service Method

- [x] T005 [US1] Implement `addInternalParticipant()` trong `src/modules/meetings/services/meetings.service.ts`
  - Signature:
    ```ts
    async addInternalParticipant(
      meetingId: string,
      dto: AddInternalParticipantDto,
      authUser: AuthUser,
      clientContext: ClientContext,
    ): Promise<{ participantId: string; meetingId: string; userId: string; role: string; status: string }>
    ```
  - Imports cần thêm: `AddInternalParticipantDto`, `WarningTokenUtil`, `ForbiddenException`
  - Inject `WarningTokenUtil` vào constructor

  **Step 1 — Pre-validation:**
  1. `meetings.findOne({ where: { id: meetingId } })` → throw `NotFoundException('MEETING_NOT_FOUND')` nếu null
  2. Check `meeting.status` ∈ `[MeetingStatus.SCHEDULED, MeetingStatus.IN_PROGRESS]` → throw `BadRequestException('INVALID_MEETING_STATUS')` nếu không
  3. `users.findOne({ where: { id: dto.userId } })` → throw `NotFoundException('USER_NOT_FOUND')` nếu null hoặc `account_status !== 'active'`
  4. `participants.findOne({ where: { meetingId, userId: dto.userId } })` → throw `ConflictException('PARTICIPANT_ALREADY_EXISTS')` nếu đã tồn tại
  5. **Private check**: nếu `meeting.visibilityLevel === 'PRIVATE'`:
     - Cho phép nếu `authUser.userId === meeting.organizerId || authUser.userId === meeting.hostId`
     - Hoặc nếu authUser có permission `admin.all` (dùng `checkUserPermission()`)
     - Nếu không → throw `ForbiddenException('FORBIDDEN_ACCESS')`

  **Step 2 — Warning check:**
  6. **Schedule conflict**: Gọi `checkParticipantConflicts(meeting.startTime, meeting.endTime, dto.userId, meetingId)`
     - Nếu có conflict → thêm vào `warnings[]` object
  7. **Capacity check** (nếu `meeting.roomId` không null):
     - Gọi `getAttendeeCount(meetingId)` → `currentCount`
     - `room = rooms.findOne({ where: { id: meeting.roomId } })`
     - Nếu `currentCount + 1 > room.capacity`:
       - Đọc `system_configs` với key `meeting.capacity_policy`:
         - Nếu `'block'` → throw `UnprocessableEntityException('ROOM_CAPACITY_EXCEEDED')`
         - Nếu `'warning'` → thêm capacity warning vào `warnings[]`
  8. **Return warnings nếu chưa override**:
     - Nếu `warnings.length > 0` AND (`dto.overrideWarnings !== true` OR `!dto.warningToken`):
       - `token = this.warningTokenUtil.generateToken(meetingId, dto.userId, warnings)`
       - throw `UnprocessableEntityException('WARNING_CONFIRMATION_REQUIRED')` kèm `{ warningToken: token, warnings }`

  **Step 3 — Override processing:**
  9. **Verify warningToken** (nếu `dto.overrideWarnings === true` và `dto.warningToken` có):
     - `result = this.warningTokenUtil.verifyToken(dto.warningToken, meetingId, dto.userId)`
     - Nếu `!result.valid` → throw `BadRequestException('INVALID_WARNING_TOKEN')`
     - `warnings = result.warnings`
  10. **Re-check capacity override permission**:
      - Nếu có capacity warning trong `warnings`:
        - Đọc lại `meeting.capacity_policy` (phòng config thay đổi)
        - Nếu `'block'` → throw `UnprocessableEntityException('ROOM_CAPACITY_EXCEEDED')`
        - Nếu `'warning'`:
          - Kiểm tra authUser có permission `meeting.participant.override_capacity` không
          - Nếu không → throw `UnprocessableEntityException('ROOM_CAPACITY_EXCEEDED')`

  **Step 4 — Transaction:**
  11. `this.dataSource.transaction(async (em) => { ... })`:
      - `em.findOne(MeetingEntity, { where: { id: meetingId }, lock: { mode: 'pessimistic_write' } })`
      - `em.findOne(MeetingParticipantEntity, { where: { meetingId, userId: dto.userId } })` → re-check duplicate, nếu có → throw `ConflictException`
      - `participant = em.create(MeetingParticipantEntity, { meetingId, userId: dto.userId, participantRole: ParticipantRole.ATTENDEE, invitationStatus: InvitationStatus.PENDING, attendanceRequired: true, isRequired: true, invitedBy: authUser.userId })`
      - `em.save(participant)`
      - `auditLog = em.create(AuditLogEntity, { userId: authUser.userId, actionType: 'ADD_PARTICIPANT', entityType: 'meeting_participant', entityId: participant.id, newValueJson: { userId: dto.userId, meetingId, invitedBy: authUser.userId }, ipAddress: clientContext.ipAddress, userAgent: clientContext.userAgent, severity: 'INFO' })`
      - `em.save(auditLog)`
      - Return `participant.id`

  12. **Post-transaction** (best-effort, try/catch, không throw):
      - `notification = this.notificationRepo.create({ notificationType: 'MEETING_INVITE', channel: 'IN_APP', subject: '...', content: '...', relatedEntityType: 'meeting', relatedEntityId: meetingId, recipientScope: 'user_list', recipientUserIdsJson: [dto.userId], deliveryStatus: 'QUEUED', createdBy: authUser.userId })`
      - `this.notificationRepo.save(notification)`
      - `bgJob = this.bgJobRepo.create({ jobType: 'SEND_EMAIL', relatedEntityType: 'meeting', relatedEntityId: meetingId, status: 'QUEUED', inputJson: { notificationId: notification.id, template: 'meeting_invite' }, requestedBy: authUser.userId })`
      - `this.bgJobRepo.save(bgJob)`
      - Nếu meeting đang `IN_PROGRESS`: emit event (dùng `EventEmitter` hoặc log cho device sync) — best-effort

  13. **Return**: `{ participantId: participant.id, meetingId, userId: dto.userId, role: 'attendee', status: 'pending' }`

  - Import repositories cần thêm: `UserEntity` (từ `AccountsModule` — đã import)
  - Import entities: `UserEntity` (từ `../../accounts/entities/user.entity`)
  - Import `WarningTokenUtil` từ `../utils/warning-token.util`
  - Outcome: Method hoàn chỉnh, ready for controller

---

## Phase 3: Controller & Integration

Mục tiêu: Expose endpoint HTTP + đảm bảo module wired.

- [x] T006 [US1] Thêm endpoint vào `src/modules/meetings/controllers/meetings.controller.ts`
  - Route: `POST meetings/:meetingId/participants/internal`
  - Decorators:
    - `@Post('meetings/:meetingId/participants/internal')`
    - `@HttpCode(HttpStatus.CREATED)`
    - `@UseGuards(JwtAuthGuard, PermissionsGuard)`
    - `@RequirePermissions('meeting.participant.add.internal')`
    - `@UsePipes(new ValidationPipe({ whitelist: true, transform: true, forbidNonWhitelisted: true }))`
  - Parameters:
    - `@Param('meetingId', ParseUUIDPipe) meetingId: string`
    - `@Body() dto: AddInternalParticipantDto`
    - `@Req() request: Request`
    - `@Ip() ipAddress: string`
    - `@Headers('user-agent') userAgent?: string`
  - Body:
    ```ts
    const user = request['user'] as { userId: string } | undefined;
    const result = await this.meetingsService.addInternalParticipant(
      meetingId, dto, { userId: user!.userId }, { ipAddress, userAgent },
    );
    return { success: true, message: 'Thêm thành viên vào cuộc họp thành công', data: result };
    ```
  - Import: `AddInternalParticipantDto` từ `../dto/add-internal-participant.dto.js`
  - Update signature return type
  - Outcome: Endpoint hoạt động, trả response đúng format

- [x] T007 Đảm bảo `src/modules/meetings/meetings.module.ts` không cần thay đổi
  - Kiểm tra: `AuthModule` đã import (cung cấp `JwtAuthGuard`, `PermissionsGuard`, `@RequirePermissions`)
  - Kiểm tra: `AccountsModule` đã import (cung cấp `UserEntity`)
  - Kiểm tra: `NotificationsModule` đã import (cung cấp `NotificationEntity`)
  - Kiểm tra: `AdministrationModule` đã import (cung cấp `AuditLogEntity`, `BackgroundJobEntity`, `SystemConfigEntity`)
  - Nếu `WarningTokenUtil` cần `JwtModule` + `ConfigModule`:
    - Kiểm tra `AuthModule` đã export `JwtService` chưa
    - Nếu chưa, cần thêm `JwtModule` vào imports của `MeetingsModule` hoặc đảm bảo `AuthModule` re-export
  - Add `WarningTokenUtil` vào `providers: [...]` array
  - Outcome: Module wired, dependencies resolved

---

## Phase 4: Testing

Mục tiêu: Unit test cho DTO, Service, Controller.

### 4.1 DTO Validation Tests

- [x] T008 Tạo `src/modules/meetings/dto/add-internal-participant.dto.spec.ts`
  - Test cases từ quickstart.md #Error Cases + plan.md section 11.3:
    1. Valid DTO với userId UUID hợp lệ
    2. Missing userId → validation error
    3. userId không phải UUID → validation error
    4. overrideWarnings không phải boolean → validation error
    5. warningToken là string hợp lệ → pass
    6. warningToken không có → pass (optional)
    7. Tất cả fields optional (userId là required, check fail)
  - Pattern: sử dụng `validate()` từ `class-validator` hoặc `ValidationPipe`
  - Outcome: DTO validation spec pass

### 4.2 Service Tests

- [x] T009 Thêm test cases vào `src/modules/meetings/services/meetings.service.spec.ts`
  - Mock pattern: giống existing tests (mock `DataSource.transaction`, `EntityManager`)
  - Inject mock `WarningTokenUtil`
  - **8 test groups với tổng cộng 18+ test cases:**

  **Group 1 — Pre-validation (FR-008, AC-007 implicit):**
  1. Meeting not found → 404 `MEETING_NOT_FOUND`
  2. Meeting status cancelled → 400 `INVALID_MEETING_STATUS`
  3. Meeting status draft → 400 `INVALID_MEETING_STATUS`
  4. User not found → 404 `USER_NOT_FOUND`
  5. User inactive → 404 `USER_NOT_FOUND`
  6. Duplicate participant → 409 `PARTICIPANT_ALREADY_EXISTS`

  **Group 2 — Authorization (FR-004, AC-003, AC-004):**
  7. Private meeting + Manager (không Org/Host) → 403 `FORBIDDEN_ACCESS`
  8. Private meeting + Organizer → 201 success
  9. Private meeting + Admin → 201 success
  10. Non-private meeting + Manager (có permission) → 201 success

  **Group 3 — Warning flow — Schedule Conflict (FR-009, AC-001, AC-002):**
  11. Schedule conflict + no overrideWarnings → 422 `WARNING_CONFIRMATION_REQUIRED`
  12. Schedule conflict + overrideWarnings=true nhưng không warningToken → 422 `WARNING_CONFIRMATION_REQUIRED`

  **Group 4 — Warning flow — Capacity Warning (FR-011, FR-012, AC-005, AC-006, AC-007):**
  13. Capacity full + policy=warning + không có override permission → 422 `ROOM_CAPACITY_EXCEEDED`
  14. Capacity full + policy=block → 422 `ROOM_CAPACITY_EXCEEDED`

  **Group 5 — Override flow (FR-010, AC-001, AC-005):**
  15. Valid warningToken + overrideWarnings=true → 201 success
  16. Invalid warningToken → 400 `INVALID_WARNING_TOKEN`
  17. Capacity warning + override_capacity permission + confirm → 201 success

  **Group 6 — Race Condition (FR-013, AC-008):**
  18. Pre-check pass → duplicate in pessimistic lock → catch unique violation → 409 `PARTICIPANT_ALREADY_EXISTS`

  **Group 7 — In-progress meeting (FR-007):**
  19. Meeting in_progress + success → device sync event emitted (best-effort, verify log/event emitter called)

  **Group 8 — Transaction + Post-transaction (NFR-002, FR-005, FR-006):**
  20. Transaction thành công → participant + audit_log created
  21. Transaction rollback on failure → participant + audit_log NOT created
  22. Notification + bg_job created outside transaction (không rollback nếu fail)

  - Outcome: Service method coverage > 90%, 22+ test cases pass

### 4.3 Controller Tests

- [x] T010 [P] Thêm test cases vào `src/modules/meetings/controllers/meetings.controller.spec.ts`
  - Thêm mock method `addInternalParticipant` vào service mock
  - Test cases:
    1. 201 response format đúng API contract (`{ success, message, data: { participantId, meetingId, userId, role, status } }`)
    2. 422 response format (warning confirmation required)
    3. Guards integration (JwtAuthGuard + PermissionsGuard override hợp lệ)
    4. Param `meetingId` được ParseUUIDPipe validate
  - Pattern: giống existing test `createMeeting`, override guards
  - Outcome: Controller spec pass

---

## Phase 5: Verification

Mục tiêu: Build + Lint pass.

- [x] T011 [P] Chạy build: `npm run build` hoặc `nest build`
  - Fix compilation errors nếu có
  - Outcome: Build pass, không lỗi TypeScript

- [x] T012 [P] Chạy lint: `npm run lint`
  - Fix lint errors nếu có
  - Outcome: Lint pass

---

## Requirements Coverage

| FR | Mô tả | Task liên quan | AC |
|----|-------|----------------|-----|
| FR-001 | Tìm kiếm nhân sự nội bộ | T005 (user lookup in service) | — |
| FR-002 | Lưu `invited_by` | T005 (Step 4 — participant creation) | — |
| FR-003 | Giá trị mặc định participant | T005 (Step 4 — role/status defaults) | — |
| FR-004 | Private meeting restriction | T005 (Step 1 — private check) | AC-003, AC-004 |
| FR-005 | Notification + bg_job async | T005 (Step 5 — post-transaction) | — |
| FR-006 | Audit log | T005 (Step 4 — audit_log INSERT) | — |
| FR-007 | Device sync event (in_progress) | T005 (Step 5 — event emit) | — |
| FR-008 | Meeting status restriction | T005 (Step 1 — status check) | — |
| FR-009 | Warning 2-step (first call) | T005 (Step 2 — warning check + return) | AC-001, AC-002 |
| FR-010 | Warning override with token | T005 (Step 3 — token verify + override) | AC-001 |
| FR-011 | Capacity policy from system_configs | T005 (Step 2 — capacity policy lookup) | AC-005, AC-006, AC-007 |
| FR-012 | Hard block capacity | T005 (Step 2/3 — block policy / no perm) | AC-006, AC-007 |
| FR-013 | Race condition handling | T005 (Step 4 — pessimistic lock + re-check) | AC-008 |
| NFR-001 | Response < 2s | T005 (transaction ngắn, notif ngoài txn) | — |
| NFR-002 | Atomic transaction | T005 (Step 4 — dataSource.transaction) | — |

| AC | Mô tả | Task liên quan |
|----|-------|----------------|
| AC-001 | 2-step warning: 422 → 201 | T005 (Steps 2+3) |
| AC-002 | overrideWarnings=true nhưng không warningToken → 422 | T005 (Step 2 — `!dto.warningToken` check) |
| AC-003 | Private + Manager → 403 | T005 (Step 1 — private check) |
| AC-004 | Private + Organizer → 201 | T005 (Step 1 — private check pass) |
| AC-005 | Capacity full + policy=warning + Admin override → 201 | T005 (Steps 2+3+4) |
| AC-006 | Capacity full + policy=warning + no override perm → 422 | T005 (Step 3 — perm check fail) |
| AC-007 | Capacity full + policy=block → 422 | T005 (Step 2 — hard block) |
| AC-008 | Race condition → 1x201 + 1x409 | T005 (Step 4 — re-check + unique constraint) |

## Dependency Graph

```
Phase 1          Phase 2      Phase 3          Phase 4              Phase 5
T001 (seed) ─┐
T002 (dto) ──┤
T003 (resp) ─┼──→ T005 (service) ──→ T006 (controller) ──→ T008 (dto test) ──→ T011 (build)
T004 (util) ─┘                      T007 (module)          T009 (srv test)         │
                                                           T010 (ctrl test)        └→ T012 (lint)
```

## Parallel Execution Opportunities

| Task ID | Runs in parallel with | Lý do |
|---------|-----------------------|-------|
| T002 | T003, T004 | DTO và Response DTO không phụ thuộc lẫn nhau; WarningTokenUtil cũng độc lập |
| T003 | T002, T004 | Response DTO độc lập |
| T010 | T008, T009 | Controller test độc lập với DTO và service test (khác file) |
| T011 | T012 | Build và lint độc lập |

## Implementation Strategy (MVP)

MVP scope: Tất cả 12 tasks đều trong scope. Có thể deliver theo thứ tự:
1. **Wave 1** (Foundation): T001 → (T002 + T003 + T004 parallel)
2. **Wave 2** (Core): T005 → T006 + T007
3. **Wave 3** (Testing): T008 + T009 + T010 parallel
4. **Wave 4** (Verification): T011 → T012

Không có incremental delivery vì feature là một endpoint atomic — không thể deliver nửa endpoint.
