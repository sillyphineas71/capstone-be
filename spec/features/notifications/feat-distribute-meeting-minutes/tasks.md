# Task List: Distribute Meeting Minutes (UC-146)

## 📝 CHANGELOG & REVISION HISTORY
| Ngày cập nhật | Tóm tắt thay đổi | Các dòng thay đổi |
| :--- | :--- | :--- |
| 2026-07-18 | Khởi tạo tasks — chưa implement, chỉ lên spec/plan/tasks | Toàn bộ file |

## Checklist
- [ ] T001 [US1] DTO → `src/modules/notifications/dto/distribute-meeting-minutes.dto.ts`
- [ ] T002 [US1] Thêm `MeetingMinutesEntity` vào `TypeOrmModule.forFeature` của `notifications.module.ts`
- [ ] T003 [US1] Service `distributeMeetingMinutes()` → `src/modules/notifications/services/meeting-notifications.service.ts`
- [ ] T004 [US1] Route `POST :meetingId/minutes/distributions` → `src/modules/notifications/notifications.controller.ts`
- [ ] T005 [US1] Migration seed permission `minutes.distribute`
- [ ] T006 [US1] Unit test service
- [ ] T007 [US1] Unit test controller
- [ ] T008 Lint/build/test toàn repo

> Phụ thuộc: `feat-send-meeting-invitation` phải implement trước (dùng chung controller + service).

## Phase 1: Data Model & DTO

### Task T002 [US1]
**File**: `src/modules/notifications/notifications.module.ts`
**Action**: Thêm `MeetingMinutesEntity` vào mảng `TypeOrmModule.forFeature([...])` hiện có.
**Verification**: `npm run build` pass.

### Task T001 [US1]
**File**: `src/modules/notifications/dto/distribute-meeting-minutes.dto.ts`
**Action**: `DistributeMeetingMinutesDto` theo spec.md mục 5.2 + plan.md mục 8.1.
**Verification**: Unit test T006.

## Phase 2: Service Logic

### Task T003 [US1]
**File**: `src/modules/notifications/services/meeting-notifications.service.ts`
**Action**: Thêm method `distributeMeetingMinutes()` theo pseudo-code plan.md mục 7.1.
**Verification**: Test T006 pass toàn bộ nhánh, đặc biệt 2 nhánh `recipientScope`.

## Phase 3: Controller Endpoint

### Task T004 [US1]
**File**: `src/modules/notifications/notifications.controller.ts`
**Action**: Thêm `POST :meetingId/minutes/distributions`, `@RequirePermissions('minutes.distribute')`, `@HttpCode(202)`.
**Verification**: Test T007.

## Phase 4: Seed & Tests

### Task T005 [US1]
**File**: `src/database/migrations/<timestamp>-SeedMinutesDistributePermission.ts`
**Action**: Seed `minutes.distribute`, `module_code=minutes`, `action_code=distribute`, roles=`EMPLOYEE, MANAGER, BUSINESS_ADMIN, SYSTEM_ADMIN`.
**Verification**: Chạy thử nếu có DB local.

### Task T006 [US1] — Unit test service
**File**: `src/modules/notifications/services/meeting-notifications.service.spec.ts` (mở rộng)
**Verification**: `npm run test` pass.

### Task T007 [US1] — Unit test controller
**File**: `src/modules/notifications/notifications.controller.spec.ts` (mở rộng)
**Verification**: `npm run test` pass.

### Task T008 — Lint/build/test toàn repo
**Action**: `npm run lint`, `npm run build`, `npm run test`.

## Requirements Coverage

### FR Coverage
| FR ID | Task(s) |
| :--- | :--- |
| FR-001..009 | T003 |
| FR-010..016 | T003, T006 |
| FR-017 | T003 |

### AC Coverage
| AC ID | Task(s) |
| :--- | :--- |
| AC-001, AC-002, AC-003 | T003, T006 |
| AC-004 | T003, T006 |
| AC-005, AC-006 | T003, T006 |
| AC-007, AC-008 | T001, T003, T006 |

### Error Code Coverage
| Error Code | HTTP | Task(s) |
| :--- | ---: | :--- |
| VALIDATION_ERROR | 400 | T001, T006 |
| FORBIDDEN | 403 | T004 (guard) |
| NOT_MINUTES_OWNER | 403 | T003, T006 |
| MEETING_NOT_FOUND | 404 | T003, T006 |
| MINUTES_NOT_FOUND | 404 | T003, T006 |
| MINUTES_NOT_PUBLISHED | 409 | T003, T006 |

## Dependencies Graph
```text
T002 ─┐
T001 ─┼─> T003 ─> T004 ─> T005
      │
      └────────> T006, T007 ──> T008
```

## Implementation Order
| Step | Task(s) | Description |
| :--- | :--- | :--- |
| 1 | T002, T001 | Entity wiring + DTO |
| 2 | T003 | Service |
| 3 | T004 | Controller route |
| 4 | T005 | Migration seed |
| 5 | T006, T007 | Tests |
| 6 | T008 | Lint/build/test toàn repo |
