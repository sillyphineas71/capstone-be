# Task List: Send Meeting Invitation (UC-143)

## 📝 CHANGELOG & REVISION HISTORY
| Ngày cập nhật | Tóm tắt thay đổi | Các dòng thay đổi |
| :--- | :--- | :--- |
| 2026-07-18 | Khởi tạo tasks — chưa implement, chỉ lên spec/plan/tasks theo yêu cầu viết tài liệu | Toàn bộ file |

## Checklist
- [ ] T001 [US1] `NotificationsController` mới → `src/modules/notifications/notifications.controller.ts`
- [ ] T002 [US1] `MeetingNotificationsService` mới → `src/modules/notifications/services/meeting-notifications.service.ts`
- [ ] T003 [US1] DTO gửi thư mời → `src/modules/notifications/dto/send-meeting-invitation.dto.ts`
- [ ] T004 [US1] Cập nhật `notifications.module.ts` (controllers, TypeOrmModule.forFeature entity đọc)
- [ ] T005 [US1] Migration seed permission `notification.invite.send`
- [ ] T006 [US1] Unit test service
- [ ] T007 [US1] Unit test controller
- [ ] T008 Lint/build/test toàn repo

> **Lưu ý**: Đây là bản kế hoạch (planning) — CHƯA implement code, theo đúng yêu cầu "viết tài liệu" của phiên làm việc này.

## Phase 1: Module Scaffolding

### Task T001 [US1] — Tạo `NotificationsController`
**File**: `src/modules/notifications/notifications.controller.ts`
**Action**: `@Controller('meetings')`, route `POST :meetingId/invitations`, `@UseGuards(JwtAuthGuard, PermissionsGuard)`, `@RequirePermissions('notification.invite.send')`, `@HttpCode(202)`. Đây cũng là nơi các feature `feat-send-meeting-reminder`, `feat-send-cancellation-notification` sẽ bổ sung route sau (cùng controller, khác method).
**Outcome**: File controller tồn tại, compile.
**Verification**: `npm run build` pass.

### Task T004 [US1] — Wire module
**File**: `src/modules/notifications/notifications.module.ts`
**Action**: Thêm `controllers: [NotificationsController]`, `providers: [..., MeetingNotificationsService]`, `TypeOrmModule.forFeature([NotificationEntity, BackgroundJobEntity, MeetingEntity, MeetingParticipantEntity, MeetingExternalParticipantEntity, MeetingAgendaEntity, UserEntity])`. KHÔNG import `MeetingsModule`/`AccountsModule` (xem plan.md mục 12 — circular risk).
**Outcome**: Module compile, DI hoạt động.
**Verification**: `npm run build` pass.

## Phase 2: DTO

### Task T003 [US1] — DTO
**File**: `src/modules/notifications/dto/send-meeting-invitation.dto.ts`
**Action**: `SendMeetingInvitationDto` theo spec.md mục 5.2 (`channels`, `includeAgenda?`, `message?`).
**Outcome**: DTO validate đúng ở boundary.
**Verification**: Unit test T006 case validation pass.

## Phase 3: Service Logic

### Task T002 [US1] — `MeetingNotificationsService.sendMeetingInvitation`
**File**: `src/modules/notifications/services/meeting-notifications.service.ts`
**Action**: Implement theo pseudo-code plan.md mục 7.1. Inject `AuthzReadRepository` (từ module `auth`, đã export sẵn cho module khác dùng — kiểm tra `AuthModule.exports` lúc code) để tính `isAdmin`.
**Outcome**: Method hoàn chỉnh, đúng nhánh lỗi mục 6 của spec.md.
**Verification**: Test T006 pass toàn bộ nhánh.

## Phase 4: Controller Endpoint
Route đã khai báo ở T001, gọi `meetingNotificationsService.sendMeetingInvitation(meetingId, authUser, dto)`.

## Phase 5: Seed & Tests

### Task T005 [US1] — Migration seed permission
**File**: `src/database/migrations/<timestamp>-SeedNotificationInviteSendPermission.ts`
**Action**: Copy pattern từ `20260717000001-FixMinutesAttachmentEmployeeRole.ts` (role code đúng). Seed `notification.invite.send`, `module_code=notifications`, `action_code=invite.send`, roles=`EMPLOYEE, MANAGER, BUSINESS_ADMIN, SYSTEM_ADMIN`.
**Outcome**: Migration `up()`/`down()` đầy đủ, idempotent.
**Verification**: Chạy thử trên DB local nếu có.

### Task T006 [US1] — Unit test service
**File**: `src/modules/notifications/services/meeting-notifications.service.spec.ts`
**Action**: Test theo plan.md mục 10.1.
**Outcome**: Coverage đủ nhánh lỗi + happy path.
**Verification**: `npm run test` pass.

### Task T007 [US1] — Unit test controller
**File**: `src/modules/notifications/notifications.controller.spec.ts`
**Action**: Test route trả đúng response shape/status, propagate lỗi.
**Outcome**: Test pass.
**Verification**: `npm run test` pass.

### Task T008 — Lint/build/test toàn repo
**Action**: `npm run lint`, `npm run build`, `npm run test`. Đối chiếu [[project_capstone_be_dev_test_baseline]] (dev branch có ~96 test fail pre-existing không liên quan — không coi là regression mới nếu không tăng thêm).

## Requirements Coverage

### FR Coverage
| FR ID | Task(s) |
| :--- | :--- |
| FR-001..010 | T002 |
| FR-011..016 | T002, T006 |
| FR-017 | T002 |

### AC Coverage
| AC ID | Task(s) |
| :--- | :--- |
| AC-001, AC-002, AC-003 | T002, T006 |
| AC-004, AC-005 | T001, T002, T006 |
| AC-006, AC-007 | T002, T006 |
| AC-008, AC-009 | T003, T006 |

### Error Code Coverage
| Error Code | HTTP | Task(s) |
| :--- | ---: | :--- |
| VALIDATION_ERROR | 400 | T003, T006 |
| FORBIDDEN | 403 | T001 (guard) |
| NOT_MEETING_OWNER | 403 | T002, T006 |
| MEETING_NOT_FOUND | 404 | T002, T006 |
| MEETING_CANCELLED | 409 | T002, T006 |

## Dependencies Graph
```text
T003 ─┐
      ├─> T002 ─> T001 ─> T004 ─> T005
      │
      └──────────────────> T006, T007 ──> T008
```

## Implementation Order
| Step | Task(s) | Phase | Description |
| :--- | :--- | :--- | :--- |
| 1 | T003 | 2 | DTO |
| 2 | T002 | 3 | Service |
| 3 | T001, T004 | 1/4 | Controller + wiring |
| 4 | T005 | 5 | Migration seed permission |
| 5 | T006, T007 | 5 | Tests |
| 6 | T008 | 5 | Lint/build/test toàn repo |
