# Implementation Plan: Notification Inbox

## 📝 CHANGELOG & REVISION HISTORY
| Ngày cập nhật | Tóm tắt thay đổi | Các dòng thay đổi |
| :--- | :--- | :--- |
| 2026-07-18 | Khởi tạo plan cho feat-notification-inbox | Toàn bộ file |
| 2026-07-18 | **[QUYẾT ĐỊNH PRODUCT OWNER]** Product Owner từ chối bảng `notification_reads`. Viết lại toàn bộ plan: bỏ Phase 1 (Data Model/migration), bỏ `markAsRead()`, chỉ còn 2 endpoint đọc thuần túy. Code đã rollback tương ứng (xem tasks.md). | Toàn bộ file |

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

## Artifacts Produced
`spec.md`, `plan.md`, `tasks.md`.
