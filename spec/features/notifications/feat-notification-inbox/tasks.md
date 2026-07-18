# Task List: Notification Inbox (List / Detail)

## 📝 CHANGELOG & REVISION HISTORY
| Ngày cập nhật | Tóm tắt thay đổi | Các dòng thay đổi |
| :--- | :--- | :--- |
| 2026-07-18 | Khởi tạo tasks — chưa implement, chỉ lên spec/plan/tasks | Toàn bộ file |
| 2026-07-18 | Implement 3 endpoint đầy đủ (list/detail/mark-read) + bảng `notification_reads`. QA review phát hiện 4 bug logic ở nhóm UC-143..146 (đã fix riêng, không liên quan feature này). | `notifications.service.ts`, `notifications.controller.ts`, migration, entity |
| 2026-07-18 | **[QUYẾT ĐỊNH PRODUCT OWNER]** Product Owner từ chối bảng `notification_reads`, xác nhận không cần tracking "đã đọc". Rollback: xóa migration `20260718000001-CreateNotificationReadsTable.ts`, xóa `notification-read.entity.ts`, xóa `mark-notification-read-response.dto.ts`, xóa `markAsRead()` khỏi `NotificationsService`, xóa route `PATCH notifications/:id/read` khỏi `NotificationsController`, bỏ field `isRead`/`readAt` khỏi `NotificationListItemDto`, bỏ query param `isRead` khỏi `ListNotificationsQueryDto`. Build pass, 47/47 test pass sau rollback. | `notifications.module.ts`, `notifications.service.ts`, `notifications.controller.ts`, `notifications.controller.spec.ts`, các DTO liên quan |

## Checklist
- [x] T001 [US1][US2] DTO → `src/modules/notifications/dto/list-notifications-query.dto.ts`, `notification-list-item.dto.ts`
- [x] T002 [US1][US2] Service `listMyNotifications()`, `getMyNotificationDetail()` → `src/modules/notifications/notifications.service.ts`
- [x] T003 [US1][US2] Controller 2 route → `src/modules/notifications/notifications.controller.ts`
- [x] T004 [US1][US2] Migration seed permission `notification.read.self`
- [x] T005 [US1][US2] Unit test controller
- [x] T006 Lint/build/test toàn repo (build + test pass; lint formatting còn tồn đọng ngoài phạm vi feature này)
- [x] ~~T000 [BLOCKER] Xác nhận Product Owner phương án bảng `notification_reads`~~ — **Đã xác nhận: TỪ CHỐI**, không tạo bảng. Task này coi như đã giải quyết theo hướng "không làm".
- [x] ~~T-migration [US3] Migration `CREATE TABLE notification_reads`~~ — **Đã xóa** theo quyết định Product Owner.
- [x] ~~T-markread [US3] Service/Controller `markAsRead()` + route `PATCH .../read`~~ — **Đã xóa** theo quyết định Product Owner.

## Phase 1: DTO

### Task T001 [US1][US2]
**Files**: `src/modules/notifications/dto/list-notifications-query.dto.ts` (`page?`, `limit?` — không còn `isRead`), `notification-list-item.dto.ts` (`id`, `notificationType`, `subject`, `content`, `relatedEntityType`, `relatedEntityId`, `priority`, `createdAt` — không còn `isRead`/`readAt`).
**Verification**: `npm run build` pass.

## Phase 2: Service Logic

### Task T002 [US1][US2]
**File**: `src/modules/notifications/notifications.service.ts`
**Action**: `listMyNotifications(userId, page, limit)` — query `recipient_user_ids_json @> [userId]` + `channel IN (in_app, websocket)`, không JOIN gì thêm. `getMyNotificationDetail(id, userId)` — load + check `recipientUserIdsJson.includes(userId)`.
**Verification**: Exercised gián tiếp qua `notifications.controller.spec.ts` (không có file spec riêng cho `NotificationsService`).

## Phase 3: Controller Endpoints

### Task T003 [US1][US2]
**File**: `src/modules/notifications/notifications.controller.ts`
**Action**: `GET notifications` (dùng `@Query() query: ListNotificationsQueryDto`), `GET notifications/:id` (`ParseUUIDPipe`). Cả 2 `@RequirePermissions('notification.read.self')`.
**Verification**: Test T005.

## Phase 4: Seed & Tests

### Task T004 [US1][US2]
**File**: `src/database/migrations/20260718000005-SeedNotificationReadSelfPermission.ts`
**Action**: Seed `notification.read.self`, roles=`EMPLOYEE, MANAGER, BUSINESS_ADMIN, SYSTEM_ADMIN`. Giữ nguyên — permission này vẫn cần cho việc đọc (list/detail), không liên quan tới quyết định bỏ tracking đã đọc.
**Verification**: Đã seed đúng role code (`EMPLOYEE`, không `INTERNAL_USER`).

### Task T005 [US1][US2] — Unit test controller
**File**: `src/modules/notifications/notifications.controller.spec.ts`
**Verification**: `npx jest src/modules/notifications` → 47/47 pass.

### Task T006 — Lint/build/test toàn repo
**Action**: `npm run build` pass, `npx jest src/modules/notifications` pass. Lint formatting (prettier) của cả module `notifications` vẫn còn tồn đọng — ngoài phạm vi task rollback này, chưa xử lý.

## Requirements Coverage

### FR Coverage
| FR ID | Task(s) |
| :--- | :--- |
| FR-001, FR-002, FR-004, FR-006 | T002 |
| FR-009, FR-010, FR-011 | T002, T005 |

### AC Coverage
| AC ID | Task(s) |
| :--- | :--- |
| AC-001, AC-007b | T002, T005 |
| AC-005 | T002, T005 |
| AC-007, AC-008 | T001, T002, T005 |

### Error Code Coverage
| Error Code | HTTP | Task(s) |
| :--- | ---: | :--- |
| VALIDATION_ERROR | 400 | T001, T005 |
| NOTIFICATION_ACCESS_DENIED | 403 | T002, T005 |
| NOTIFICATION_NOT_FOUND | 404 | T002, T005 |

## Dependencies Graph
```text
T001 ─> T002 ─> T003 ─> T004
              └─> T005 ──> T006
```

## Implementation Order
| Step | Task(s) | Description |
| :--- | :--- | :--- |
| 1 | T001 | DTO |
| 2 | T002 | Service |
| 3 | T003 | Controller route |
| 4 | T004 | Migration seed (giữ nguyên, không đổi) |
| 5 | T005 | Tests |
| 6 | T006 | Lint/build/test toàn repo |
