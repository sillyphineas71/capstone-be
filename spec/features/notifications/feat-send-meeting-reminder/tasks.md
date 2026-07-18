# Task List: Send Meeting Reminder (UC-144)

## 📝 CHANGELOG & REVISION HISTORY
| Ngày cập nhật | Tóm tắt thay đổi | Các dòng thay đổi |
| :--- | :--- | :--- |
| 2026-07-18 | Khởi tạo tasks — chưa implement, chỉ lên spec/plan/tasks | Toàn bộ file |

## Checklist
- [ ] T001 [US1] DTO nhắc lịch → `src/modules/notifications/dto/send-meeting-reminder.dto.ts`
- [ ] T002 [US1] Service `sendMeetingReminder()` → `src/modules/notifications/services/meeting-notifications.service.ts`
- [ ] T003 [US1] Route `POST :meetingId/reminders` → `src/modules/notifications/notifications.controller.ts`
- [ ] T004 [US1] Migration seed permission `notification.reminder.send`
- [ ] T005 [US1] Unit test service
- [ ] T006 [US1] Unit test controller
- [ ] T007 Lint/build/test toàn repo

> Phụ thuộc: `feat-send-meeting-invitation` phải implement trước (dùng chung `NotificationsController` + `MeetingNotificationsService`).

## Phase 1: DTO

### Task T001 [US1]
**File**: `src/modules/notifications/dto/send-meeting-reminder.dto.ts`
**Action**: `SendMeetingReminderDto` theo spec.md mục 5.2 + plan.md mục 8.1.
**Outcome**: DTO validate đúng, kể cả cross-field (`sendAt` bắt buộc khi `reminderType=scheduled` — validate ở service, không ở decorator).
**Verification**: Unit test T005.

## Phase 2: Service Logic

### Task T002 [US1]
**File**: `src/modules/notifications/services/meeting-notifications.service.ts`
**Action**: Thêm method `sendMeetingReminder()` theo pseudo-code plan.md mục 7.1.
**Outcome**: 2 nhánh `manual`/`scheduled` hoạt động đúng, tách biệt rõ (nhánh `scheduled` KHÔNG gọi enqueue).
**Verification**: Test T005 pass toàn bộ nhánh, đặc biệt case "scheduled không gọi BullMQ".

## Phase 3: Controller Endpoint

### Task T003 [US1]
**File**: `src/modules/notifications/notifications.controller.ts`
**Action**: Thêm `POST :meetingId/reminders`, `@RequirePermissions('notification.reminder.send')`, `@HttpCode(202)`.
**Outcome**: Route hoạt động.
**Verification**: Test T006.

## Phase 4: Seed & Tests

### Task T004 [US1]
**File**: `src/database/migrations/<timestamp>-SeedNotificationReminderSendPermission.ts`
**Action**: Seed `notification.reminder.send`, roles=`EMPLOYEE, MANAGER, BUSINESS_ADMIN, SYSTEM_ADMIN` (role code đúng).
**Outcome**: Migration đầy đủ, idempotent.
**Verification**: Chạy thử nếu có DB local.

### Task T005 [US1] — Unit test service
**File**: `src/modules/notifications/services/meeting-notifications.service.spec.ts` (mở rộng file đã tạo ở UC-143)
**Action**: Test theo plan.md mục 10.1.
**Verification**: `npm run test` pass.

### Task T006 [US1] — Unit test controller
**File**: `src/modules/notifications/notifications.controller.spec.ts` (mở rộng)
**Verification**: `npm run test` pass.

### Task T007 — Lint/build/test toàn repo
**Action**: `npm run lint`, `npm run build`, `npm run test`.

## Requirements Coverage

### FR Coverage
| FR ID | Task(s) |
| :--- | :--- |
| FR-001..006 | T002 |
| FR-007..013 | T002, T005 |
| FR-014 | T002 |

### AC Coverage
| AC ID | Task(s) |
| :--- | :--- |
| AC-001, AC-002 | T002, T005 |
| AC-003 | T002, T005 |
| AC-004, AC-005, AC-006 | T001, T002, T005 |

### Error Code Coverage
| Error Code | HTTP | Task(s) |
| :--- | ---: | :--- |
| VALIDATION_ERROR | 400 | T001, T002, T005 |
| FORBIDDEN | 403 | T003 (guard) |
| NOT_MEETING_OWNER | 403 | T002, T005 |
| MEETING_NOT_FOUND | 404 | T002, T005 |
| MEETING_NOT_UPCOMING | 409 | T002, T005 |
| REMINDER_AFTER_MEETING_START | 409 | T002, T005 |

## Dependencies Graph
```text
T001 ─> T002 ─> T003 ─> T004
              └─> T005, T006 ──> T007
```

## Implementation Order
| Step | Task(s) | Description |
| :--- | :--- | :--- |
| 1 | T001 | DTO |
| 2 | T002 | Service |
| 3 | T003 | Controller route |
| 4 | T004 | Migration seed |
| 5 | T005, T006 | Tests |
| 6 | T007 | Lint/build/test toàn repo |
