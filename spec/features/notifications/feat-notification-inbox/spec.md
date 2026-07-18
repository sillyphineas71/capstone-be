# Feature Specification: Hộp thư thông báo cá nhân (Notification Inbox — List / Detail)

## 📝 CHANGELOG & REVISION HISTORY
| Ngày cập nhật | Tóm tắt thay đổi | Các dòng thay đổi |
| :--- | :--- | :--- |
| 2026-07-18 | Khởi tạo spec — không có UC gốc trong Feature Table/API Contract chính thức, phát sinh từ yêu cầu bổ sung bắt buộc cho FE ("bổ sung, không có UC riêng nhưng bắt buộc cho FE") | Toàn bộ file |
| 2026-07-18 | **[QUYẾT ĐỊNH PRODUCT OWNER]** Product Owner từ chối phương án bảng mới `notification_reads` đề xuất ở bản khởi tạo, xác nhận trực tiếp: "không đồng ý tạo table mới và thấy việc theo dõi notification_read là không cần thiết". Viết lại toàn bộ feature theo hướng đơn giản hóa: bỏ hẳn khái niệm "đã đọc" (`isRead`/`readAt`), bỏ hẳn endpoint `PATCH /notifications/:id/read`, chỉ còn `GET /notifications` (list) và `GET /notifications/:id` (detail) thuần túy đọc. Code đã rollback tương ứng: xóa migration `CreateNotificationReadsTable`, xóa `NotificationReadEntity`, xóa `markAsRead()` khỏi `NotificationsService`, xóa route `PATCH .../read` khỏi `NotificationsController`. | Toàn bộ file |

> Nguồn gốc: **Không có UC gốc trong `docs/API_CONTRACT_v1.0.md`.** Endpoint gợi ý `GET /notifications` đã được liệt kê ở mục 22.13 ("API endpoint grouping gợi ý") của `CLAUDE.md` nhưng CHƯA có đặc tả chi tiết. Tạm đặt tên **UC-NOTI-01/02 (mới)**, chờ Product Owner gán số chính thức vào Feature Table.

## 1. Context & Goal

### 1.1 Bối cảnh
`NotificationEntity` (`src/modules/notifications/entities/notification.entity.ts`) là mô hình **broadcast** — 1 dòng đại diện cho 1 lần gửi tới **nhiều** người nhận cùng lúc (`recipient_user_ids_json: string[]`), có sẵn 1 cột tổng hợp `read_count: number` (đếm tổng số người đã đọc, không biết ai đã đọc).

### 1.2 Quyết định thiết kế — KHÔNG tracking trạng thái đã đọc theo từng user
Bản khởi tạo của spec này từng đề xuất thêm bảng `notification_reads` (`notification_id`, `user_id`, `read_at`) để hỗ trợ `isRead` chính xác theo từng user. **Product Owner đã từ chối phương án này** (2026-07-18): không đồng ý tạo bảng mới, và cho rằng việc theo dõi "ai đã đọc" là không cần thiết cho phạm vi hiện tại.

Quyết định cuối cùng: feature này **chỉ còn 2 endpoint đọc thuần túy** (list + detail), không có khái niệm "đã đọc"/"chưa đọc" ở tầng API — response không có field `isRead`/`readAt`, không có filter `isRead`, và **không có endpoint đánh dấu đã đọc**. Cột `notifications.read_count` hiện có giữ nguyên, không bị đụng tới, không có cơ chế nào tăng nó trong phạm vi feature này (giá trị mặc định `0` từ `createNotification()`).

Nếu sau này Product Owner đổi ý và cần tracking đã đọc, đó là 1 feature mới riêng biệt, không mở rộng ngầm trong feature này.

### 1.3 Mục tiêu
Cung cấp 2 endpoint đọc-chuyên-biệt cho user hiện tại (không phải endpoint quản trị):
1. `GET /api/v1/notifications` — danh sách thông báo mà user hiện tại là 1 trong các recipient, có pagination.
2. `GET /api/v1/notifications/:id` — chi tiết 1 thông báo (chỉ nếu user hiện tại là recipient).

### 1.4 Giả định
- "User hiện tại là recipient" = `notification.recipientUserIdsJson` (jsonb array) chứa `userId` hiện tại — dùng toán tử jsonb containment `@>` của PostgreSQL, tận dụng GIN index đã có sẵn `ix_notifications_recipients` (`database_v3_2_compact_39_tables.md` dòng 1193) — không cần migration index mới.
- Chỉ áp dụng cho notification có `channel IN ('in_app', 'websocket')` — notification `channel=email`/`sms` không hiển thị trong inbox (đã gửi qua kênh khác).

### 1.5 Cần làm rõ — đã giải quyết
- **[ĐÃ GIẢI QUYẾT]** Bảng mới hay cột JSON cho tracking đã đọc? → **Không làm cả hai.** Product Owner xác nhận không cần tracking đã đọc (mục 1.2).
- **[ĐỀ XUẤT] Notification không tồn tại `id` nhưng user KHÔNG phải recipient?** Trả `403` thay vì `404` — nhất quán nguyên tắc "không confirm sự tồn tại của resource cho người không có quyền" đã dùng cho `MEETING_MINUTES_ACCESS_DENIED` ở module `minutes`, khác với trường hợp `id` không tồn tại thật sự (`404`).

## 2. Actor & Roles

### 2.1 Danh sách actor
- **Primary Actor**: Bất kỳ user nội bộ đã đăng nhập (Employee/Manager/Admin) — chỉ thao tác trên thông báo của chính mình.

### 2.2 Role & Permission Rules
- Permission: `notification.read.self` (`module_code=notifications`, `action_code=read.self`) — đúng theo `docs/API_CONTRACT_v1.0.md` dòng 5285-5287 (đã liệt kê `notification.invite.send`/`.reminder.send`/`.cancellation.send` trong Phụ lục A nhưng **thiếu** `read.self` — bổ sung ở feature này).
- Role mặc định: **TẤT CẢ role đăng nhập được** (`EMPLOYEE`, `MANAGER`, `BUSINESS_ADMIN`, `SYSTEM_ADMIN`) — đây là quyền đọc thông báo của chính mình, không phải quyền nghiệp vụ đặc thù, tương tự `schedule.read.self` (`meetings.controller.ts:738`).

### 2.3 Actor Constraints
- User chỉ xem được thông báo mà chính họ là recipient (`recipientUserIdsJson` chứa `userId` của họ) — không có ngoại lệ Admin-bypass (Admin muốn xem thông báo của user khác phải qua kênh khác, ví dụ `audit_logs`, không phải qua API này).

## 3. Functional Requirements

### 3.1 Core Requirements (Ubiquitous)
- **FR-001**: THE system SHALL cho phép user xem danh sách thông báo mà họ là recipient, có phân trang.
- **FR-002**: THE system SHALL cho phép user xem chi tiết 1 thông báo mà họ là recipient.

### 3.2 Event-driven Requirements
- **FR-004**: WHEN `GET /notifications` được gọi, THE system SHALL trả danh sách `notifications` WHERE `recipient_user_ids_json @> [userId]` AND `channel IN ('in_app','websocket')`, sắp xếp `created_at DESC`.
- **FR-006**: WHEN `GET /notifications/:id` được gọi VÀ user là recipient, THE system SHALL trả chi tiết đầy đủ.

### 3.3 Unwanted Behavior Requirements
- **FR-009**: IF `id` không tồn tại trong `notifications`, THEN `404 NOTIFICATION_NOT_FOUND`.
- **FR-010**: IF `id` tồn tại nhưng user hiện tại KHÔNG phải recipient, THEN `403 NOTIFICATION_ACCESS_DENIED` (không confirm sự tồn tại — xem mục 1.5).
- **FR-011**: IF `page`/`limit` vượt giới hạn cho phép (`limit > 100`), THEN `400 VALIDATION_ERROR` (đúng convention pagination chung của CLAUDE.md mục 8.4).

### 3.4 Traceability
| FR ID | Nguồn gốc |
| :--- | :--- |
| FR-001, FR-002 | Yêu cầu bổ sung bắt buộc cho FE (không có UC gốc) |
| FR-010 | Suy luận bảo mật, đối chiếu pattern `MEETING_MINUTES_ACCESS_DENIED` |

## 4. Non-functional Requirements

### 4.1 Performance
`GET /notifications` phải dùng GIN index sẵn có (`ix_notifications_recipients`) cho điều kiện `recipient_user_ids_json @> ...` — KHÔNG full scan bảng `notifications`.

### 4.2 Security
JWT bắt buộc cho cả 2 endpoint. `userId` lấy từ token (`@CurrentUser()`), KHÔNG tin `userId` truyền từ query/body.

### 4.6 Maintainability
2 method trong `NotificationsService` (service đã có sẵn, method đọc-cho-user là mở rộng tự nhiên, KHÔNG cần service riêng): `listMyNotifications()`, `getMyNotificationDetail()`.

## 5. Data Model

### 5.1 Không có bảng/cột mới
Feature này **không thêm bảng, không thêm cột** trên `notifications`. Chỉ đọc dữ liệu hiện có qua `NotificationEntity`.

### 5.2 Entity liên quan
`NotificationEntity` (đọc, không ghi).

### 5.3 Dữ liệu đầu vào

**List** — `GET /api/v1/notifications?page=1&limit=20`

**Detail** — `GET /api/v1/notifications/:id`

### 5.4 Dữ liệu đầu ra

**List (200):**
```jsonc
{
  "success": true,
  "data": [
    {
      "id": "uuid",
      "notificationType": "meeting_invite",
      "subject": "string",
      "content": "string",
      "relatedEntityType": "meeting",
      "relatedEntityId": "uuid",
      "priority": "normal",
      "createdAt": "ISO datetime"
    }
  ],
  "meta": { "page": 1, "limit": 20, "total": 42, "totalPages": 3 }
}
```

**Detail (200)**: giống 1 phần tử của List.

### 5.5 Data Constraints
Không có — feature chỉ đọc dữ liệu hiện có, không ghi.

## 6. Error Handling

| Điều kiện | HTTP | Code |
| :--- | ---: | :--- |
| `id` không phải UUID | 400 | `VALIDATION_ERROR` |
| `limit > 100` | 400 | `VALIDATION_ERROR` |
| Không có JWT | 401 | — |
| `id` tồn tại nhưng không phải recipient | 403 | `NOTIFICATION_ACCESS_DENIED` |
| `id` không tồn tại | 404 | `NOTIFICATION_NOT_FOUND` |

## 7. Acceptance Criteria

### 7.1 Happy Path
- **AC-001**: GIVEN user `U` là recipient của 5 notification (`channel IN in_app/websocket`), WHEN `U` gọi `GET /notifications`, THEN trả 5 phần tử, không có field `isRead`/`readAt`.
- **AC-007b**: GIVEN user `U` gọi `GET /notifications/:id` cho 1 notification mà họ là recipient, THEN trả `200` với đầy đủ nội dung.

### 7.2 Authorization Cases
- **AC-005**: GIVEN notification `N` mà user `X` KHÔNG phải recipient, WHEN `X` gọi `GET /notifications/N`, THEN `403 NOTIFICATION_ACCESS_DENIED`.

### 7.3 Validation / Not Found Cases
- **AC-007**: GIVEN `id` không tồn tại, WHEN gọi Detail, THEN `404 NOTIFICATION_NOT_FOUND`.
- **AC-008**: GIVEN `limit=500`, WHEN gọi List, THEN `400 VALIDATION_ERROR`.

### 7.4 Acceptance Criteria Traceability
| AC ID | FR liên quan |
| :--- | :--- |
| AC-001 | FR-004 |
| AC-007b | FR-006 |
| AC-005 | FR-010 |
| AC-007 | FR-009 |
| AC-008 | FR-011 |

## 8. Out of Scope

### 8.1 Không triển khai trong feature này
- **Bất kỳ hình thức tracking "đã đọc" nào** (`isRead`, `readAt`, bảng mới, cột JSON) — Product Owner đã từ chối, xem mục 1.2. Đây không phải deferred/future, mà là quyết định rõ ràng "không cần" cho tới khi có yêu cầu mới.
- Endpoint `PATCH /notifications/:id/read` — bị loại bỏ hoàn toàn khỏi phạm vi (đã có ở bản khởi tạo, đã rollback).
- "Đánh dấu tất cả đã đọc" — không áp dụng (không có khái niệm đã đọc).
- Xóa/ẩn notification khỏi inbox cá nhân (soft-delete riêng cho từng user) — ngoài phạm vi.
- Push realtime qua WebSocket khi có notification mới — đã có event naming gợi ý `notification.created` trong CLAUDE.md mục 12 nhưng KHÔNG implement trong feature này.

### 8.2 Out-of-scope EARS Guardrails
- **FR-OOS-001**: THE system SHALL NOT thêm bảng hoặc cột mới để tracking trạng thái đã đọc.
- **FR-OOS-002**: THE system SHALL NOT trả về notification có `channel=email`/`sms` trong danh sách inbox.
- **FR-OOS-003**: THE system SHALL NOT cho Admin bypass để xem thông báo của user khác qua endpoint này.

## Assumptions
Xem mục 1.4 và 1.5.
