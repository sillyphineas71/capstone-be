# Task List: Send/Resend Cancellation Notification (UC-145)

## 📝 CHANGELOG & REVISION HISTORY
| Ngày cập nhật | Tóm tắt thay đổi | Các dòng thay đổi |
| :--- | :--- | :--- |
| 2026-07-18 | Khởi tạo tasks — chưa implement, chỉ lên spec/plan/tasks | Toàn bộ file |

## Checklist
- [ ] T001 [US1] DTO → `src/modules/notifications/dto/resend-cancellation-notification.dto.ts`
- [ ] T002 [US1] Service `resendCancellationNotification()` → `src/modules/notifications/services/meeting-notifications.service.ts`
- [ ] T003 [US1] Route `POST :meetingId/cancellation-notifications` → `src/modules/notifications/notifications.controller.ts`
- [ ] T004 [US1] Migration seed permission `notification.cancellation.send`
- [ ] T005 [US1] Unit test service
- [ ] T006 [US1] Unit test controller
- [ ] T007 Regression: chạy lại `meetings.service.spec.ts` không đổi
- [ ] T008 Lint/build/test toàn repo

> Phụ thuộc: `feat-send-meeting-invitation` phải implement trước (dùng chung controller + service). **KHÔNG được sửa** `src/modules/meetings/services/meetings.service.ts` trong bất kỳ task nào ở đây (xem plan.md mục 12).

## Phase 1: DTO
### Task T001 [US1]
**File**: `src/modules/notifications/dto/resend-cancellation-notification.dto.ts`
**Action**: `ResendCancellationNotificationDto` (`reason?`, `channels`).
**Verification**: Unit test T005.

## Phase 2: Service Logic
### Task T002 [US1]
**File**: `src/modules/notifications/services/meeting-notifications.service.ts`
**Action**: Thêm method `resendCancellationNotification()` theo pseudo-code plan.md mục 7.1. Đọc `MeetingEntity.cancellationReason` làm fallback.
**Verification**: Test T005 pass toàn bộ nhánh.

## Phase 3: Controller Endpoint
### Task T003 [US1]
**File**: `src/modules/notifications/notifications.controller.ts`
**Action**: Thêm `POST :meetingId/cancellation-notifications`, `@RequirePermissions('notification.cancellation.send')`, `@HttpCode(202)`.
**Verification**: Test T006.

## Phase 4: Seed & Tests
### Task T004 [US1]
**File**: `src/database/migrations/<timestamp>-SeedNotificationCancellationSendPermission.ts`
**Action**: Seed `notification.cancellation.send`, roles=`EMPLOYEE, MANAGER, BUSINESS_ADMIN, SYSTEM_ADMIN`.
**Verification**: Chạy thử nếu có DB local.

### Task T005 [US1] — Unit test service
**File**: `src/modules/notifications/services/meeting-notifications.service.spec.ts` (mở rộng)
**Verification**: `npm run test` pass.

### Task T006 [US1] — Unit test controller
**File**: `src/modules/notifications/notifications.controller.spec.ts` (mở rộng)
**Verification**: `npm run test` pass.

### Task T007 — Regression `meetings.service.spec.ts`
**Action**: Chạy `npm run test -- meetings.service.spec.ts`, xác nhận số test pass/fail y hệt baseline trước khi bắt đầu feature (0 thay đổi vì không sửa file này).
**Verification**: Diff kết quả test = 0.

### Task T008 — Lint/build/test toàn repo
**Action**: `npm run lint`, `npm run build`, `npm run test`.

## Requirements Coverage

### FR Coverage
| FR ID | Task(s) |
| :--- | :--- |
| FR-001..008 | T002 |
| FR-009..013 | T002, T005 |
| FR-014 | T002 |

### AC Coverage
| AC ID | Task(s) |
| :--- | :--- |
| AC-001, AC-002 | T002, T005 |
| AC-003 | T002, T005 |
| AC-004, AC-005 | T002, T005 |
| AC-006 | T007 |

### Error Code Coverage
| Error Code | HTTP | Task(s) |
| :--- | ---: | :--- |
| VALIDATION_ERROR | 400 | T001, T005 |
| FORBIDDEN | 403 | T003 (guard) |
| NOT_MEETING_OWNER | 403 | T002, T005 |
| MEETING_NOT_FOUND | 404 | T002, T005 |
| MEETING_NOT_CANCELLED | 409 | T002, T005 |

## Dependencies Graph
```text
T001 ─> T002 ─> T003 ─> T004
              └─> T005, T006 ──> T007 ──> T008
```

## Implementation Order
| Step | Task(s) | Description |
| :--- | :--- | :--- |
| 1 | T001 | DTO |
| 2 | T002 | Service |
| 3 | T003 | Controller route |
| 4 | T004 | Migration seed |
| 5 | T005, T006 | Tests |
| 6 | T007 | Regression check |
| 7 | T008 | Lint/build/test toàn repo |
