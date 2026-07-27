# Implementation Plan: Notification Inbox

## 📝 CHANGELOG & REVISION HISTORY
| Ngày cập nhật | Tóm tắt thay đổi | Các dòng thay đổi |
| :--- | :--- | :--- |
| 2026-07-18 | Khởi tạo plan cho feat-notification-inbox | Toàn bộ file |
| 2026-07-18 | **[QUYẾT ĐỊNH PRODUCT OWNER]** Product Owner từ chối bảng `notification_reads`. Viết lại toàn bộ plan: bỏ Phase 1 (Data Model/migration), bỏ `markAsRead()`, chỉ còn 2 endpoint đọc thuần túy. Code đã rollback tương ứng (xem tasks.md). | Toàn bộ file |
| 2026-07-27 | **[ĐỢT P1, BE-07]** Thêm §14 — tái áp dụng mark-read qua Redis (KHÔNG bảng/cột DB mới, tôn trọng vế "không schema mới" của quyết định PO). Xem spec.md §1.2 (cập nhật) để biết phạm vi đảo ngược quyết định. | §14 (mới) |

## 1. Feature Summary
Thêm 2 endpoint (`GET /notifications`, `GET /notifications/:id`) vào `NotificationsController` (đã tạo ở `feat-send-meeting-invitation`), 2 method trong `NotificationsService` hiện có. **Không thêm bảng, không thêm cột** — Product Owner xác nhận không cần tracking "đã đọc" theo từng user (xem spec.md mục 1.2).

## 2. Technical Context

### 2.1 Tech Stack
NestJS + TypeORM + PostgreSQL. Chỉ 1 migration seed permission `notification.read.self` — không có migration schema.

### 2.2 Existing Codebase Analysis
| Thành phần | Vị trí | Vai trò |
| :--- | :--- | :--- |
| `ix_notifications_recipients` (GIN index) | `database_v3_2_compact_39_tables.md:1193` | Tái sử dụng cho query `recipient_user_ids_json @> [userId]` |
| `NotificationsService` | `notifications/notifications.service.ts` | Thêm 2 method mới trực tiếp (CRUD đọc đơn giản trên entity của module) |

### 2.3 Patterns to Follow
- Controller trả `{ success, message, data, meta }` (list có `meta` pagination theo CLAUDE.md mục 8.4).
- Guard: `@RequirePermissions('notification.read.self')` cho cả 2 route — permission cấp cho MỌI role đăng nhập (chỉ 1 rule: user phải là recipient).

## 3. Scope Confirmation

### 3.1 In Scope
2 endpoint, 2 method service, 1 permission mới `notification.read.self`.

### 3.2 Out of Scope
Xem spec.md mục 8 — đặc biệt: **không** tracking đã đọc dưới bất kỳ hình thức nào.

### 3.3 Constitution Gate Check
| Rule | Kết quả |
| :--- | :--- |
| SEC-02, SEC-03 | PASS |
| DB-01 (không tự ý thêm bảng) | PASS — Product Owner từ chối, feature giữ nguyên schema hiện có |
| ENG-01 | Áp dụng |

### 3.4 Complexity Tracking
Thấp — thuần API layer đọc trên schema có sẵn, không có quyết định schema nào cần chờ duyệt.

## 4. Data Model Impact
**0 bảng mới, 0 cột mới.** 1 permission mới `notification.read.self`.

## 5. API / Contract Plan
- `GET /api/v1/notifications` — `200`, pagination `?page&limit`.
- `GET /api/v1/notifications/:id` — `200`.
- Error: `400`, `401`, `403 NOTIFICATION_ACCESS_DENIED`, `404 NOTIFICATION_NOT_FOUND`.

## 6. Authorization Plan

### 6.1 Permission Design
`notification.read.self` — cấp cho MỌI role (`EMPLOYEE`, `MANAGER`, `BUSINESS_ADMIN`, `SYSTEM_ADMIN`).

### 6.2 Authorization Flow
1. `JwtAuthGuard` + `PermissionsGuard` + `@RequirePermissions('notification.read.self')`.
2. Service check: `userId ∈ notification.recipientUserIdsJson` → nếu không, `403 NOTIFICATION_ACCESS_DENIED`.

## 7. Business Logic Plan

### 7.1 Flow — `listMyNotifications`
```text
1. SELECT n.* FROM notifications n
   WHERE n.recipient_user_ids_json @> :userIdJsonArray
     AND n.channel IN ('in_app', 'websocket')
   ORDER BY n.created_at DESC
   LIMIT :limit OFFSET :offset
2. COUNT(*) tương ứng cho meta.total
3. Trả { data: [...], meta: { page, limit, total, totalPages } }
```

### 7.2 Flow — `getMyNotificationDetail`
```text
1. SELECT * FROM notifications WHERE id = :id
2. IF không tồn tại -> 404 NOTIFICATION_NOT_FOUND
3. IF userId NOT IN recipient_user_ids_json -> 403 NOTIFICATION_ACCESS_DENIED
4. Trả chi tiết
```

### 7.3 Key Business Rules Implemented
User chỉ đọc được notification mà họ là recipient; không có write path nào trong feature này.

## 8. Validation Plan

### 8.1 Input Validation (DTO)
`ListNotificationsQueryDto`: `page?: number` (`@IsOptional() @IsInt() @Min(1)`), `limit?: number` (`@IsOptional() @IsInt() @Min(1) @Max(100)`). Path `:id` — `ParseUUIDPipe`.

### 8.2 Business Validation (Service)
Theo thứ tự mục 7.2.

## 9. Error Handling Plan

| Điều kiện | Exception | Code |
| :--- | :--- | :--- |
| `id` không tồn tại | `NotFoundException` | `NOTIFICATION_NOT_FOUND` |
| User không phải recipient | `ForbiddenException` | `NOTIFICATION_ACCESS_DENIED` |
| `limit > 100` | `BadRequestException` | `VALIDATION_ERROR` |

## 10. Testing Strategy

### 10.1 Unit Tests — Service
List: chỉ trả `in_app`/`websocket` (không trả `email`), đúng pagination. Detail: happy path, not-found (404), not-recipient (403).

### 10.2 Unit Tests — Controller
2 route trả đúng response shape/status.

## 11. Implementation Phases

### Phase 1: DTO
`ListNotificationsQueryDto`, `NotificationListItemDto`.

### Phase 2: Service Logic
`NotificationsService.listMyNotifications()`, `getMyNotificationDetail()`.

### Phase 3: Controller Endpoints
2 route trong `NotificationsController`.

### Phase 4: Seed & Tests
Migration seed `notification.read.self` (role `EMPLOYEE`, cấp cho mọi role). Unit test service + controller.

## 12. Risks & Mitigations
| Risk | Mitigation |
| :--- | :--- |
| Query `recipient_user_ids_json @> :userIdJsonArray` không dùng đúng GIN index nếu viết sai cú pháp TypeORM | Dùng raw SQL fragment qua `createQueryBuilder().where()` với tham số đã `JSON.stringify([userId])`, kiểm tra `EXPLAIN` khi có DB thật |
| FE đã kỳ vọng field `isRead`/endpoint mark-read theo yêu cầu gốc trong ticket | Đã trao đổi rõ với Product Owner — quyết định là bỏ hẳn khái niệm này ở BE, FE cần điều chỉnh UI tương ứng (không hiển thị trạng thái đã đọc) |

## 13. Acceptance Criteria Traceability
Xem spec.md mục 7.4.

## 14. [BE-07, 2026-07-27] Mark-read qua Redis — bổ sung KHÔNG mở lại §1-13

### 14.1 File
```
src/modules/redis/redis.service.ts                                  (thêm sadd/sismember/smembers)
src/modules/notifications/services/notification-read-state.service.ts  (mới)
src/modules/notifications/notifications.service.ts                  (listMyNotifications/getMyNotificationDetail thêm isRead; +markNotificationRead/markAllNotificationsRead)
src/modules/notifications/notifications.controller.ts               (thêm PATCH read-all TRƯỚC PATCH :id/read)
src/modules/notifications/dto/notification-list-item.dto.ts         (thêm isRead: boolean)
src/modules/notifications/notifications.module.ts                   (đăng ký NotificationReadStateService)
src/database/migrations/20260727000002-SeedNotificationUpdateSelfPermission.ts (mới)
```

### 14.2 Redis key design
Xem spec.md §5.1b. `READ_SET_TTL_SECONDS = 90 * 24 * 60 * 60`.

### 14.3 `NotificationReadStateService`
`markRead(userId, id)` → `sadd` + `expire` (refresh TTL). `markAllRead(userId)` → `set(notif:readall:{userId}, ISO now)`. `getReadState(userId)` → đọc `smembers` + `get` MỘT LẦN (Promise.all), trả `{readIds: Set, readAllAt: Date|null}`. `computeIsRead(state, id, createdAt)` → hàm thuần, dùng cho cả batch (list) và đơn (detail). `isRead(userId, id, createdAt)` → gọi `getReadState` + `computeIsRead`, dùng cho 1 item (detail).

Toàn bộ method fail-soft: `try/catch`, log lỗi, KHÔNG throw. `getReadState` lỗi → trả state rỗng (mọi thứ coi như chưa đọc).

### 14.4 Wiring vào `NotificationsService`
`listMyNotifications`: gọi `getReadState()` **1 LẦN** sau khi có `items`, map `isRead` bằng `computeIsRead()` cho từng phần tử — **cấm N+1** (không gọi Redis riêng từng notification trong vòng lặp).
`getMyNotificationDetail`: sau khi xác nhận recipient, gọi `readStateService.isRead()`.
`markNotificationRead(id, userId)`: gọi `getMyNotificationDetail(id, userId)` trước (ném 404/403 nếu cần) rồi mới `readStateService.markRead()` — đảm bảo không đánh dấu đọc hộ người khác.
`markAllNotificationsRead(userId)`: gọi thẳng `readStateService.markAllRead()`.

### 14.5 Controller
`PATCH notifications/read-all` khai **TRƯỚC** `PATCH notifications/:id/read` (path tĩnh trước path động, tránh Nest hiểu nhầm `read-all` là 1 giá trị `:id`). Cả 2 route `@RequirePermissions('notification.update.self')`, lấy `userId` qua `@CurrentUser()` (từ token).

### 14.6 Migration
`20260727000002-SeedNotificationUpdateSelfPermission.ts` — role đối chiếu đúng `notification.read.self` trong `20260720000005-BackfillRolePermissions.ts`: `BUSINESS_ADMIN`, `EMPLOYEE`, `MANAGER`, `SYSTEM_ADMIN`.

### 14.7 Test
`redis.service.spec.ts` (+3 method mới, kể cả lỗi propagate). `notification-read-state.service.spec.ts` (mới, 100% stmt/func/line, 91.66% branch). `notifications.service.spec.ts` (mới — trước đây CHƯA có file test cho service này; cover listMyNotifications/getMyNotificationDetail/markNotificationRead/markAllNotificationsRead). `notifications.controller.spec.ts` (thêm 2 test route mới, cập nhật mock `isRead`).

### 14.8 Gate
`tsc --noEmit` sạch; `npx jest notifications redis` xanh (90/90); coverage `notification-read-state.service.ts` 100%/91.66%, `redis.service.ts` 95%/83.33% (≥80%).

## Artifacts Produced
`spec.md`, `plan.md`, `tasks.md`.
